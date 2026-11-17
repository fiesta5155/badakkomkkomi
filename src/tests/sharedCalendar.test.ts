import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertExpectedEntry, calendarScope, entriesForDay, guardedSubscription, koreaToday, legacyBackup, parseSharedEntry, validCalendarDate, validEntryId } from '../services/sharedCalendarModel.ts';

const raw = { schemaVersion: 1, date: '2026-11-17', kind: 'planned', content: '순찰', authorUid: 'owner', authorName: '범진',
  createdAt: { seconds: 10, nanoseconds: 0 }, updatedAt: { seconds: 10, nanoseconds: 0 }, revision: 1 };

test('Korean dates remain correct across UTC midnight and leap years', () => {
  assert.equal(koreaToday(new Date('2026-11-16T15:01:00Z')), '2026-11-17');
  assert.equal(koreaToday(new Date('2026-11-17T14:59:00Z')), '2026-11-17');
  assert.equal(validCalendarDate('2028-02-29'), true);
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01']) assert.equal(validCalendarDate(date), false);
});

test('status identity is independent of kind; multiple memo identities are allowed', () => {
  assert.equal(validEntryId('status_2026-11-17', raw.date, 'planned'), true);
  assert.equal(validEntryId('status_2026-11-17', raw.date, 'unavailable'), true);
  assert.equal(validEntryId('status_2026-11-18', raw.date, 'planned'), false);
  const status = parseSharedEntry('status_2026-11-17', raw);
  const memo = (id: string) => parseSharedEntry(id, { ...raw, kind: 'memo' });
  const day = entriesForDay([status, memo('memo_12345678-1234-4234-8234-123456789abc'), memo('memo_12345678-1234-4234-8234-123456789abd')], raw.date);
  assert.equal(day.status?.kind, 'planned');
  assert.equal(day.memos.length, 2);
  assert.equal(entriesForDay([status], '2026-11-18').status, undefined);
});

test('stale edits, deleted entries and deleted/recreated status are rejected', () => {
  const original = parseSharedEntry('status_2026-11-17', raw);
  assert.doesNotThrow(() => assertExpectedEntry(original, original));
  assert.throws(() => assertExpectedEntry({ ...original, revision: 2 }, original), /calendar\/conflict/);
  assert.throws(() => assertExpectedEntry(null, original), /calendar\/deleted/);
  assert.throws(() => assertExpectedEntry({ ...original, createdAt: { seconds: 11, nanoseconds: 0 } }, original), /calendar\/conflict/);
  assert.throws(() => parseSharedEntry(original.id, { ...raw, createdAt: null }), /calendar\/invalid-data/);
});

test('legacy backup preserves original bytes, including malformed JSON, without any writes', () => {
  const original = '{ broken JSON\n 한글 원본 ';
  const storage = { getItem: (key: string) => { assert.equal(key, 'bada_kkomkkomi_calendar_v1'); return original; },
    setItem: () => { assert.fail('must not overwrite legacy data'); }, removeItem: () => { assert.fail('must not delete legacy data'); } };
  assert.equal(legacyBackup(storage), original);
  assert.equal(legacyBackup({ getItem: () => null }), null);
  assert.notEqual(calendarScope('one', '101', '2026-11'), calendarScope('one', '103', '2026-11'));
  assert.notEqual(calendarScope('one', '101', '2026-11'), calendarScope('two', '101', '2026-11'));
});

test('subscription disposal blocks queued old account/month callbacks and unsubscribes once', () => {
  let next!: (value: string) => void;
  let error!: (cause: unknown) => void;
  let stops = 0;
  const values: string[] = [];
  const stop = guardedSubscription<string>((onNext, onError) => { next = onNext; error = onError; return () => { stops++; }; },
    (value) => values.push(value), () => assert.fail('disposed listener must not report errors'));
  next('current'); stop(); stop(); next('old account'); error(new Error('queued error'));
  assert.deepEqual(values, ['current']); assert.equal(stops, 1);
});
