import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isAnnouncementAdmin, nextAnnouncementId, parseAnnouncement, publishedAnnouncements, validateAnnouncement } from '../services/announcementModel.ts';

const base = { title: ' 공지 제목 ', body: ' 공지 내용 ', published: true, sortOrder: 1, schemaVersion: 1,
  createdBy: 'admin', updatedBy: 'admin', createdAt: { seconds: 1, nanoseconds: 0 }, updatedAt: { seconds: 1, nanoseconds: 0 }, revision: 1 };

test('announcement input validation enforces lengths, booleans and bounded integer order', () => {
  assert.deepEqual(validateAnnouncement(base), { title: '공지 제목', body: '공지 내용', published: true, sortOrder: 1 });
  for (const invalid of [{ title: '' }, { title: '\u3000\n' }, { title: 'x'.repeat(121) }, { body: '\n\t' },
    { body: 'x'.repeat(10001) }, { sortOrder: -1 }, { sortOrder: 1.5 }, { sortOrder: 10000 }, { published: 'true' }]) {
    assert.throws(() => validateAnnouncement({ ...base, ...invalid } as typeof base), /notice\/invalid/);
  }
  assert.throws(() => parseAnnouncement('bad', { ...base, revision: 0 }), /notice\/invalid/);
});

test('published notices are ordered deterministically, cycle in sequence, and empty notices stay empty', () => {
  const a = parseAnnouncement('a', base);
  const b = parseAnnouncement('b', { ...base, sortOrder: 0 });
  const hidden = parseAnnouncement('hidden', { ...base, published: false });
  const list = publishedAnnouncements([a, hidden, b]);
  assert.deepEqual(list.map((entry) => entry.id), ['b', 'a']);
  assert.equal(nextAnnouncementId(list, 'b'), 'a');
  assert.equal(nextAnnouncementId(list, 'a'), 'b');
  assert.deepEqual(publishedAnnouncements([hidden]), []);
  assert.equal(nextAnnouncementId([], 'any'), '');
});

test('only the exact configured UID is an admin, never an email, Github name or UID list', () => {
  assert.equal(isAnnouncementAdmin('firebase-uid', { adminUid: 'firebase-uid' }), true);
  for (const settings of [null, {}, { email: 'owner@example.com' }, { adminUid: ['firebase-uid'] }, { adminUid: 'other' }]) {
    assert.equal(isAnnouncementAdmin('firebase-uid', settings), false);
  }
  assert.equal(isAnnouncementAdmin('', { adminUid: '' }), false);
  assert.equal(isAnnouncementAdmin('fiesta5155', null), false);
});

test('announcement rules preserve every previous rule verbatim outside the new notice block', () => {
  const backup = readFileSync('docs/backups/firestore.before-announcements.rules', 'utf8').replaceAll('\r\n', '\n');
  const current = readFileSync('firestore.rules', 'utf8').replaceAll('\r\n', '\n');
  const start = current.indexOf('    // 공지 관리자 설정은 단일 문서');
  const end = current.indexOf('    // 명시적으로 허용하지 않은 경로는 기본 거부한다.');
  assert.ok(start > 0 && end > start);
  assert.equal(current.slice(0, start) + current.slice(end), backup);
});
