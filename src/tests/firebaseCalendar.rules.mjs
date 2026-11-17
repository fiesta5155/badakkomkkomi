import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { saveSharedEntry, deleteSharedEntry, subscribeCalendar, subscribeCalendarAdmin } from '../services/calendarFirestoreService.ts';
import { parseSharedEntry } from '../services/sharedCalendarModel.ts';

let env;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Only the local demo emulator may be used');
  env = await initializeTestEnvironment({ projectId: 'demo-bada-profile', firestore: { host: '127.0.0.1', port: 8085, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const uid of ['owner', 'other', 'admin']) await setDoc(doc(ctx.firestore(), 'users', uid), { uid, realName: '범진', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(doc(ctx.firestore(), 'calendarAdmins', 'admin'), { enabled: true });
  });
});
after(async () => { await env?.cleanup(); });
const dbFor = (uid, provider = 'google.com') => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
const refFor = (db, vessel = '101', id = 'status_2026-11-17') => doc(db, 'calendarVessels', vessel, 'entries', id);
const data = (extra = {}) => ({ schemaVersion: 1, date: '2026-11-17', kind: 'planned', content: '순찰\n예정', authorUid: 'owner', authorName: '범진', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1, ...extra });
const input = (extra = {}) => ({ id: 'status_2026-11-17', date: '2026-11-17', kind: 'planned', content: '순찰', ...extra });
const profile = { uid: 'owner', realName: '범진' };
const read = async (db, vessel = '101', id = 'status_2026-11-17') => { const s = await getDoc(refFor(db, vessel, id)); return parseSharedEntry(s.id, s.data()); };

it('separates vessels, permits status kind changes and multiple memos', async () => {
  const db = dbFor('owner');
  await saveSharedEntry(db, '101', profile, input());
  await saveSharedEntry(db, '103', profile, input({ kind: 'unavailable' }));
  const expected = await read(db);
  await saveSharedEntry(db, '101', profile, input({ kind: 'unavailable', expected }));
  const changed = await read(db);
  assert.equal(changed.kind, 'unavailable'); assert.equal(changed.revision, 2);
  await saveSharedEntry(db, '101', profile, input({ expected: changed }));
  assert.equal((await read(db)).kind, 'planned');
  for (let i = 0; i < 2; i++) await saveSharedEntry(db, '101', profile, input({ id: 'memo_' + randomUUID(), kind: 'memo' }));
  assert.equal((await getDocs(collection(db, 'calendarVessels', '101', 'entries'))).size, 3);
  assert.equal((await read(db, '103')).kind, 'unavailable');
  await assert.rejects(saveSharedEntry(db, '101', profile, input()), /calendar\/exists/);
});

it('enforces owner updates/deletes and admin delete-only rights', async () => {
  const owner = dbFor('owner'), other = dbFor('other'), admin = dbFor('admin');
  await setDoc(refFor(owner), data());
  await assertSucceeds(getDoc(refFor(other)));
  for (const db of [other, admin]) await assertFails(updateDoc(refFor(db), { content: '위조', revision: 2, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(refFor(other)));
  await assertSucceeds(updateDoc(refFor(owner), { content: '수정', revision: 2, updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteSharedEntry(admin, '101', await read(admin)));
  await saveSharedEntry(owner, '101', profile, input());
  await assertSucceeds(deleteSharedEntry(owner, '101', await read(owner)));
});

it('rejects unauthenticated, non-Google, missing profile and self-appointed admin access', async () => {
  for (const db of [env.unauthenticatedContext().firestore(), dbFor('unknown'), dbFor('owner', 'anonymous')]) {
    await assertFails(getDoc(refFor(db)));
    await assertFails(setDoc(refFor(db), data()));
    await assertFails(getDocs(collection(db, 'calendarVessels', '101', 'entries')));
  }
  for (const db of [dbFor('owner'), dbFor('admin')]) {
    await assertFails(setDoc(doc(db, 'calendarAdmins', 'owner'), { enabled: true }));
    await assertFails(updateDoc(doc(db, 'calendarAdmins', 'admin'), { enabled: false }));
    await assertFails(deleteDoc(doc(db, 'calendarAdmins', 'admin')));
    await assertFails(getDocs(collection(db, 'calendarAdmins')));
  }
  await assertFails(getDoc(doc(dbFor('owner'), 'calendarAdmins', 'admin')));
  await assertSucceeds(getDoc(doc(dbFor('owner'), 'calendarAdmins', 'owner')));
});

it('rejects forged identity, dates, ids, fields, timestamps, revisions and blank content', async () => {
  const db = dbFor('owner');
  for (const extra of [{ authorUid: 'other' }, { authorName: '승환' }, { date: '2026-11-18' }, { date: '2026-02-30' }, { date: 'bad' },
    { revision: 2 }, { schemaVersion: 2 }, { role: 'admin' }, { createdAt: Timestamp.fromMillis(0) },
    { updatedAt: Timestamp.fromMillis(0) }, { content: '' }, { content: ' \n\t' }, { content: 'x'.repeat(2001) }, { kind: 'memo' }]) {
    await assertFails(setDoc(refFor(db), data(extra)));
  }
  await assertFails(setDoc(refFor(db, '999'), data()));
  await assertFails(setDoc(refFor(db, '101', 'status_duplicate'), data()));
  await assertFails(setDoc(refFor(db, '101', 'memo_bad'), data({ kind: 'memo' })));
  await setDoc(refFor(db), data());
  for (const extra of [{ authorUid: 'other' }, { authorName: '승환' }, { date: '2026-11-18' }, { createdAt: Timestamp.fromMillis(0) }, { revision: 1 }, { revision: 3 }, { kind: 'memo' }]) {
    await assertFails(updateDoc(refFor(db), { content: '변경', updatedAt: serverTimestamp(), revision: 2, ...extra }));
  }
  await assertSucceeds(setDoc(refFor(db, '101', 'status_2028-02-29'), data({ date: '2028-02-29' })));
  await assertFails(setDoc(refFor(db, '101', 'status_2026-02-29'), data({ date: '2026-02-29' })));
});

// 본 규칙은 외부 프로필 조회의 사전 평가 로그와 무관하게 permission-denied를 확인한다.
const denied = (operation) => assert.rejects(operation, (error) => {
  assert.equal(error.code, 'permission-denied');
  return true;
});

it('rejects malformed dates and accepts valid leap-year and month boundaries', async () => {
  const db = dbFor('owner');
  const invalidDates = ['', 'bad', '-', '2026', '2026-02', '2026--01', '2026-02-', '2026-02-01-extra',
    '2026-2-01', '2026-02-1', '2026/02/01', '2026-aa-01', '2026-02-xx',
    '2026-02-30', '2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31',
    '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '0000-01-01',
    ' 2026-02-01', '2026-02-01 ', '2026-02-01\n', '２０２６-０２-０１', null, 20260201, [], {}];
  // 메모 ID는 날짜와 무관하게 항상 유효하게 하여 날짜 검사를 독립적으로 검증한다.
  for (const date of invalidDates) {
    await denied(setDoc(refFor(db, '101', 'memo_' + randomUUID()), data({ kind: 'memo', date })));
  }
  const missingDate = data({ kind: 'memo' });
  delete missingDate.date;
  await denied(setDoc(refFor(db, '101', 'memo_' + randomUUID()), missingDate));
  for (const date of ['1000-01-01', '2000-02-29', '2028-02-29', '2026-04-30', '2026-12-31', '9999-12-31']) {
    await assertSucceeds(setDoc(refFor(db, '101', 'memo_' + randomUUID()), data({ kind: 'memo', date })));
  }
});

it('date helpers reject invalid values without conversion/index evaluation errors in isolation', async () => {
  // 실제 파일의 함수를 그대로 추출하여 외부 get()의 사전 평가와 분리한다.
  const rules = readFileSync('firestore.rules', 'utf8');
  const helpers = rules.slice(rules.indexOf('    function validCalendarDate('), rules.indexOf('    function validEntry('));
  const probe = await initializeTestEnvironment({ projectId: 'demo-bada-date-validation', firestore: { host: '127.0.0.1', port: 8085,
    rules: `rules_version = '2'; service cloud.firestore { match /databases/{database}/documents {
      ${helpers}
      match /dateChecks/{id} { allow create: if validCalendarDate(request.resource.data.date); }
    } }` } });
  try {
    const db = probe.unauthenticatedContext().firestore();
    for (const date of ['', 'bad', '2026', '2026-02', '2026--01', '2026-aa-01', '2026-02-30',
      '2026-02-29', '2026-13-01', '2026-01-00', '2026-02-01\n', null, 20260201, [], {}]) {
      await assert.rejects(setDoc(doc(db, 'dateChecks', randomUUID()), { date }), (error) => {
        assert.equal(error.code, 'permission-denied');
        assert.doesNotMatch(error.message, /evaluation error|out of bounds|index out of|unable to convert|type error/i);
        return true;
      });
    }
    await assertSucceeds(setDoc(doc(db, 'dateChecks', randomUUID()), { date: '2028-02-29' }));
  } finally { await probe.cleanup(); }
});

it('enforces lowercase UUIDv4 memo IDs and exact fixed status IDs', async () => {
  const db = dbFor('owner');
  for (const id of ['memo_bad', 'memo_12345678-1234-1234-8234-123456789abc',
    'memo_12345678-1234-4234-7234-123456789abc', 'memo_12345678-1234-4234-8234-123456789ab',
    'memo_12345678-1234-4234-8234-123456789abcx', 'memo_12345678123442348234123456789abc',
    'memo_12345678-1234-4234-8234-123456789ABC', 'memo_12345678-1234-4234-8234-123456789abc\n']) {
    await denied(setDoc(refFor(db, '101', id), data({ kind: 'memo' })));
  }
  for (const id of ['status_2026-11-18', 'status_2026-11-17_planned', 'planned_2026-11-17', 'status_2026-11-17\n']) {
    await denied(setDoc(refFor(db, '101', id), data()));
  }
  for (const variant of ['8', '9', 'a', 'b']) {
    const id = `memo_12345678-1234-4234-${variant}234-123456789abc`;
    await assertSucceeds(setDoc(refFor(db, '101', id), data({ kind: 'memo' })));
  }
});

it('blocks ASCII and Unicode whitespace-only content while preserving multiline notes', async () => {
  const db = dbFor('owner');
  for (const content of ['', ' ', '\t', '\n', '\r\n', '\f', '\v', ' \n\t', '\u00a0', '\u3000', '\u2003', '\u2028\u2029', '\ufeff', '\t\u00a0\u3000\ufeff\n']) {
    await denied(setDoc(refFor(db, '101', 'memo_' + randomUUID()), data({ kind: 'memo', content })));
  }
  for (const content of ['순찰', '\n순찰\n준비\n', '\u3000장비 점검\u00a0', '🚢', '0']) {
    await assertSucceeds(setDoc(refFor(db, '101', 'memo_' + randomUUID()), data({ kind: 'memo', content })));
  }
});

it('concurrent registrations and stale concurrent edits cannot overwrite a winner', async () => {
  const db = dbFor('owner');
  const creates = await Promise.allSettled([saveSharedEntry(db, '101', profile, input()), saveSharedEntry(db, '101', profile, input())]);
  assert.equal(creates.filter((r) => r.status === 'fulfilled').length, 1);
  const expected = await read(db);
  const edits = await Promise.allSettled([saveSharedEntry(db, '101', profile, input({ content: 'A', expected })), saveSharedEntry(db, '101', profile, input({ content: 'B', expected }))]);
  assert.equal(edits.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await read(db)).revision, 2);
  await deleteDoc(refFor(db));
  await assert.rejects(saveSharedEntry(db, '101', profile, input({ expected })), /calendar\/deleted/);
  assert.equal((await getDoc(refFor(db))).exists(), false);
  await saveSharedEntry(db, '101', profile, input());
  await assert.rejects(saveSharedEntry(db, '101', profile, input({ expected })), /calendar\/conflict/);
});

it('browser offline guard prevents writes; author identity survives a profile name change', async () => {
  const db = dbFor('owner');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try { await assert.rejects(saveSharedEntry(db, '101', profile, input()), /calendar\/offline/); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor); else delete globalThis.navigator; }
  assert.equal((await getDoc(refFor(db))).exists(), false);
  await saveSharedEntry(db, '101', profile, input());
  const expected = await read(db);
  await updateDoc(doc(db, 'users', 'owner'), { realName: '승환', updatedAt: serverTimestamp() });
  await saveSharedEntry(db, '101', { ...profile, realName: '승환' }, input({ expected, content: '이름 변경 후 수정' }));
  assert.equal((await read(db)).authorName, '범진');
  await assertFails(setDoc(refFor(db, '101', 'memo_' + randomUUID()), data({ kind: 'memo' })));
});

it('two client sessions receive live create/update/delete; unsubscribe stops delivery', async () => {
  const writer = dbFor('owner'), reader = dbFor('other');
  const received = [];
  let wake;
  let failure;
  const stop = subscribeCalendar(reader, '101', '2026-11', (entries, cache) => { if (!cache) { received.push(entries); wake?.(); } }, (error) => { failure = error; wake?.(); });
  const waitFor = async (predicate) => {
    const until = Date.now() + 12000;
    while (!predicate() && !failure && Date.now() < until) await new Promise((resolve) => { const timeout = setTimeout(resolve, 100); wake = () => { clearTimeout(timeout); resolve(); }; });
    if (failure) throw failure;
    assert.ok(predicate(), 'listener timed out');
  };
  try {
    await waitFor(() => received.length > 0);
    await saveSharedEntry(writer, '103', profile, input());
    await saveSharedEntry(writer, '101', profile, input({ id: 'status_2026-12-01', date: '2026-12-01' }));
    assert.equal(received.at(-1).length, 0);
    await saveSharedEntry(writer, '101', profile, input());
    await waitFor(() => received.at(-1)?.length === 1);
    await saveSharedEntry(writer, '101', profile, input({ content: '실시간 수정', expected: await read(writer) }));
    await waitFor(() => received.at(-1)?.[0]?.content === '실시간 수정');
    await deleteSharedEntry(writer, '101', await read(writer));
    await waitFor(() => received.at(-1)?.length === 0);
  } finally { stop(); }
  const count = received.length;
  await saveSharedEntry(writer, '101', profile, input());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(received.length, count);
});

it('admin listener only grants server-confirmed enabled membership', async () => {
  await new Promise((resolve, reject) => {
    let stop;
    const timeout = setTimeout(() => { stop?.(); reject(new Error('admin listener timed out')); }, 12000);
    stop = subscribeCalendarAdmin(dbFor('admin'), 'admin', (enabled) => { if (enabled) { clearTimeout(timeout); stop(); resolve(); } }, reject);
  });
});
