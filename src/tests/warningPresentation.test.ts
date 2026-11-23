import test from 'node:test';
import assert from 'node:assert/strict';
import { warningSchedule, warningPanelStatus } from '../components/notebook/warningPresentation.ts';
import type { WarningData } from '../services/navigationalWarningService.ts';

test('discontinuous and unsorted dates keep their matching individual times', () => {
  assert.deepEqual(warningSchedule('2026-11-21,2026-11-25,2026-11-23,', '08:00 ~ 12:00,09:00 ~ 18:00,14:00 ~ 24:00,'), {
    entries: [{ date: '2026.11.21.', time: '08:00 ~ 12:00' }, { date: '2026.11.25.', time: '09:00 ~ 18:00' }, { date: '2026.11.23.', time: '14:00 ~ 24:00' }], date: '', time: '',
  });
});
test('ambiguous years, invalid dates or empty middle entries preserve source text', () => {
  for (const date of ['11.21,11.23,', '2026-02-30,', '2026-11-21,,2026-11-23,']) {
    const result = warningSchedule(date, '08:00 ~ 12:00,');
    assert.equal(result.date, date); assert.equal(result.time, '08:00 ~ 12:00,'); assert.equal(result.entries.length, 0);
  }
});
test('unequal date/time counts never invent associations; missing time stays empty', () => {
  assert.deepEqual(warningSchedule('2026-11-21,2026-11-23,', '08:00 ~ 12:00,'), { entries: [], date: '2026.11.21., 2026.11.23.', time: '08:00 ~ 12:00' });
  assert.deepEqual(warningSchedule('2026-11-21,', ''), { entries: [], date: '2026.11.21.', time: '' });
  assert.equal(warningSchedule('2026-11-21,', ',, ').time, '');
  assert.equal(warningSchedule('2026-11-21,', '25:00 ~ 26:00,').time, '25:00 ~ 26:00,');
});
const now = Date.parse('2026-11-23T03:00:00Z');
const data = (): WarningData => ({ snapshot: { lastSuccessfulAt: '2026-11-23T02:00:00Z', documents: [], coverage: { queryDates: [] } }, attempt: { status: 'success', lastSuccessfulAt: '2026-11-23T02:00:00Z', lastAttemptAt: '2026-11-23T02:00:00Z' }, errors: [] });
test('compact summary uses KST and distinguishes collected zero from uncollected', () => {
  assert.equal(warningPanelStatus(data(), false, now), '정상 수집 0건 · 최종 갱신 11.23. 11:00');
  assert.equal(warningPanelStatus(data(), true, now), '');
  const empty = data(); empty.snapshot!.lastSuccessfulAt = null; empty.attempt!.lastSuccessfulAt = null; empty.attempt!.status = 'not_collected';
  assert.equal(warningPanelStatus(empty, false, now), '아직 수집된 항행경보 자료가 없습니다.');
});
test('detail retains short failure, old-data, mismatch and delayed flags', () => {
  const d = data(); d.attempt!.status = 'failed'; d.publicationDelayed = true;
  assert.equal(warningPanelStatus(d, true, now + 4 * 3600000), '수집 실패 · 이전 정상 자료 · 과거 자료 · 갱신 지연');
  d.attempt!.lastSuccessfulAt = '2026-11-22T00:00:00Z';
  assert.match(warningPanelStatus(d, true, now), /수집 상태 미확인/);
  d.snapshot!.lastSuccessfulAt = null; d.attempt!.lastSuccessfulAt = null;
  assert.match(warningPanelStatus(d, false, now), /수집 실패 · 정상 자료 없음/);
});
