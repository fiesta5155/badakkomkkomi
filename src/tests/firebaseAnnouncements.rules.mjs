import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { deleteAnnouncement, saveAnnouncement, subscribeAnnouncementAdmin, subscribeAnnouncements } from '../services/announcementService.ts';
import { parseAnnouncement } from '../services/announcementModel.ts';

let env;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Only local demo emulator allowed');
  env = await initializeTestEnvironment({ projectId: 'demo-bada-profile', firestore: { host: '127.0.0.1', port: 8085, rules: readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const uid of ['admin', 'staff', 'calendar-only']) await setDoc(doc(ctx.firestore(), 'users', uid), { uid, realName: '범진', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(doc(ctx.firestore(), 'appSettings', 'announcements'), { adminUid: 'admin' });
    await setDoc(doc(ctx.firestore(), 'calendarAdmins', 'calendar-only'), { enabled: true });
  });
});
after(async () => { await env?.cleanup(); });
const dbFor = (uid, provider = 'google.com') => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
const input = (extra = {}) => ({ title: '업무 안내', body: '현장 점검\n준비 사항', published: true, sortOrder: 0, ...extra });
const data = (extra = {}) => ({ ...input(), schemaVersion: 1, createdBy: 'admin', updatedBy: 'admin', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1, ...extra });
const ref = (db, id = 'notice1') => doc(db, 'announcements', id);
const read = async (db, id = 'notice1') => { const snap = await getDoc(ref(db, id)); return parseAnnouncement(snap.id, snap.data()); };

it('only the configured admin can create/update/delete while staff and calendar admins cannot', async () => {
  const admin = dbFor('admin');
  await assertSucceeds(saveAnnouncement(admin, 'admin', 'notice1', input()));
  await assertSucceeds(saveAnnouncement(admin, 'admin', 'notice1', input({ title: '수정' }), await read(admin)));
  for (const uid of ['staff', 'calendar-only']) {
    const db = dbFor(uid);
    await assertFails(setDoc(ref(db, 'forged'), data({ createdBy: uid, updatedBy: uid })));
    await assertFails(setDoc(ref(db, 'forged2'), data()));
    await assertFails(updateDoc(ref(db), { body: '직접 수정', revision: 3, updatedBy: uid, updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref(db)));
  }
  await assertSucceeds(deleteAnnouncement(admin, await read(admin)));
});

it('staff may only query/get published notices, not drafts or unfiltered lists', async () => {
  const admin = dbFor('admin'), staff = dbFor('staff');
  await saveAnnouncement(admin, 'admin', 'notice1', input());
  await saveAnnouncement(admin, 'admin', 'draft', input({ published: false }));
  await assertSucceeds(getDoc(ref(staff)));
  await assertFails(getDoc(ref(staff, 'draft')));
  await assertFails(getDocs(collection(staff, 'announcements')));
  const visible = await assertSucceeds(getDocs(query(collection(staff, 'announcements'), where('published', '==', true))));
  assert.deepEqual(visible.docs.map((item) => item.id), ['notice1']);
  assert.equal((await getDocs(collection(admin, 'announcements'))).size, 2);
  for (const db of [env.unauthenticatedContext().firestore(), dbFor('unknown'), dbFor('admin', 'anonymous')]) {
    await assertFails(getDoc(ref(db)));
    await assertFails(setDoc(ref(db, 'unauthorized'), data()));
  }
});

it('nobody can self-assign an admin UID or modify settings through the client', async () => {
  for (const uid of ['staff', 'admin', 'calendar-only']) {
    const db = dbFor(uid);
    const settings = doc(db, 'appSettings', 'announcements');
    await assertSucceeds(getDoc(settings));
    await assertFails(setDoc(settings, { adminUid: uid }));
    await assertFails(updateDoc(settings, { adminUid: uid }));
    await assertFails(deleteDoc(settings));
    await assertFails(getDocs(collection(db, 'appSettings')));
    await assertFails(setDoc(doc(db, 'appSettings', 'other'), { adminUid: uid }));
  }
});

it('missing or invalid configuration grants nobody authority; replacing the UID transfers sole authority', async () => {
  const change = async (settings) => env.withSecurityRulesDisabled(async (ctx) => {
    const target = doc(ctx.firestore(), 'appSettings', 'announcements');
    if (settings === null) await deleteDoc(target); else await setDoc(target, settings);
  });
  for (const settings of [null, {}, { email: 'admin@example.com' }, { adminUid: ['admin', 'staff'] }, { adminUid: '' }]) {
    await change(settings);
    for (const uid of ['admin', 'staff']) await assertFails(setDoc(ref(dbFor(uid)), data({ createdBy: uid, updatedBy: uid })));
  }
  await change({ adminUid: 'staff' });
  await assertFails(setDoc(ref(dbFor('admin')), data()));
  await assertSucceeds(saveAnnouncement(dbFor('staff'), 'staff', 'notice1', input()));
});

it('enforces notice fields, lengths, order, actor identity, timestamps and immutable revision metadata', async () => {
  const db = dbFor('admin');
  for (const extra of [{ title: '' }, { title: '\u3000' }, { title: 'x'.repeat(121) }, { body: ' \n\t\ufeff' }, { body: 'x'.repeat(10001) },
    { sortOrder: -1 }, { sortOrder: 10000 }, { sortOrder: 0.5 }, { published: 'true' }, { createdBy: 'staff' }, { updatedBy: 'staff' },
    { role: 'admin' }, { revision: 2 }, { createdAt: Timestamp.fromMillis(0) }, { updatedAt: Timestamp.fromMillis(0) }]) {
    await assertFails(setDoc(ref(db), data(extra)));
  }
  await setDoc(ref(db), data());
  for (const extra of [{ createdBy: 'staff' }, { createdAt: Timestamp.fromMillis(0) }, { schemaVersion: 2 }, { revision: 1 }, { revision: 3 }, { updatedBy: 'staff' }]) {
    await assertFails(updateDoc(ref(db), { body: '변경', updatedAt: serverTimestamp(), updatedBy: 'admin', revision: 2, ...extra }));
  }
  await assertSucceeds(updateDoc(ref(db), { published: false, sortOrder: 10, revision: 2, updatedAt: serverTimestamp() }));
});

it('stale saves and deleted notices are not silently overwritten or recreated', async () => {
  const db = dbFor('admin');
  await saveAnnouncement(db, 'admin', 'notice1', input());
  const expected = await read(db);
  await saveAnnouncement(db, 'admin', 'notice1', input({ title: '최신' }), expected);
  await assert.rejects(saveAnnouncement(db, 'admin', 'notice1', input(), expected), /notice\/conflict/);
  await assert.rejects(deleteAnnouncement(db, expected), /notice\/conflict/);
  await deleteAnnouncement(db, await read(db));
  await assert.rejects(saveAnnouncement(db, 'admin', 'notice1', input(), expected), /notice\/conflict/);
  assert.equal((await getDoc(ref(db))).exists(), false);
});

it('published changes arrive live, unpublishing/deleting yields an empty list, and cleanup stops delivery', async () => {
  const admin = dbFor('admin'), staff = dbFor('staff');
  let latest;
  let failure;
  let deliveries = 0;
  const stop = subscribeAnnouncements(staff, false, (entries, cache) => { if (!cache) { latest = entries; deliveries++; } }, (cause) => { failure = cause; });
  const until = async (predicate) => {
    const deadline = Date.now() + 12000;
    while (!predicate() && !failure && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    if (failure) throw failure;
    assert.ok(predicate(), 'real-time notice update timed out');
  };
  try {
    await until(() => latest?.length === 0);
    await saveAnnouncement(admin, 'admin', 'notice1', input({ published: false }));
    assert.equal(latest.length, 0);
    await saveAnnouncement(admin, 'admin', 'notice1', input(), await read(admin));
    await until(() => latest?.length === 1);
    await saveAnnouncement(admin, 'admin', 'notice1', input({ title: '실시간 수정' }), await read(admin));
    await until(() => latest?.[0]?.title === '실시간 수정');
    await saveAnnouncement(admin, 'admin', 'notice1', input({ published: false }), await read(admin));
    await until(() => latest?.length === 0);
    await saveAnnouncement(admin, 'admin', 'notice1', input(), await read(admin));
    await until(() => latest?.length === 1);
    await deleteAnnouncement(admin, await read(admin));
    await until(() => latest?.length === 0);
  } finally { stop(); }
  const count = deliveries;
  await saveAnnouncement(admin, 'admin', 'notice2', input());
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(deliveries, count);
});

it('admin listener follows the singleton UID and revokes access after a settings change', async () => {
  let state = false;
  let failure;
  const stop = subscribeAnnouncementAdmin(dbFor('admin'), 'admin', (value) => { state = value; }, (cause) => { failure = cause; });
  const wait = async (value) => {
    const deadline = Date.now() + 12000;
    while (state !== value && !failure && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    if (failure) throw failure;
    assert.equal(state, value);
  };
  try {
    await wait(true);
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'appSettings', 'announcements'), { adminUid: 'staff' }));
    await wait(false);
  } finally { stop(); }
});
