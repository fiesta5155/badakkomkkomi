import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPorpoiseCsv, createPorpoiseCsvFile, escapeCsvCell, sharePorpoiseCsv } from '../services/porpoiseExportService.ts';
import type { PorpoiseRecord } from '../types/porpoise.ts';

const record: PorpoiseRecord = { id: 'one', lat: 34.8, lng: 128.4, observedAt: '2026-11-20T00:05', count: 3, createdAt: 123 };

test('CSV uses the exact fourteen survey columns, numeric lng/lat, real name, BOM and CRLF', async () => {
  const csv = buildPorpoiseCsv([record], '범진');
  const [header, row, end] = csv.slice(1).split('\r\n');
  assert.equal(header, '구분,국립공원,사무소,과제명,과제연차,국명,학명,경도,위도,조사일자,조사시각(시점),조사자,개체수,비고');
  assert.deepEqual(row.split(','), ['1', '한려해상', '한려', '상괭이모니터링', '2026', '상괭이', 'Neophocaena asiaeorientalis', '128.4', '34.8', '2026-11-20', '00:05', '범진', '3', '']);
  assert.equal(end, '');
  const file = createPorpoiseCsvFile([record], '범진', new Date('2026-11-19T15:01:00Z'));
  assert.equal(file.name, '상괭이모니터링_20261120.csv');
  assert.equal(file.type, 'text/csv;charset=utf-8');
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes), csv.slice(1));
});

test('observation dates preserve stored local time across midnight, year, leap day and ISO suffixes', () => {
  for (const time of ['2025-12-31T23:59', '2026-01-01T00:01', '2024-02-29T00:00', '2026-11-20T00:05:59.123+09:00', '2026-11-20T23:55:00Z']) {
    const row = buildPorpoiseCsv([{ ...record, observedAt: time }], '승환').slice(1).split('\r\n')[1].split(',');
    assert.equal(row[4], time.slice(0, 4));
    assert.equal(row[9], time.slice(0, 10));
    assert.equal(row[10], time.slice(11, 16));
    assert.equal(row[11], '승환');
  }
});

test('CSV sorts all observations by stored wall clock without mutating records or changing schema', () => {
  const times = ['2026-11-20T12:00:01.1', '2026-11-19T23:59', '2026-11-20T12:00:01.01', '2026-11-20T12:00', '2026-11-20T12:00:01.01'];
  const records = times.map((observedAt, i) => Object.freeze({ ...record, id: String(i), observedAt, count: i + 1 }));
  const before = JSON.stringify(records);
  const rows = buildPorpoiseCsv(Object.freeze(records), '범진').slice(1).trimEnd().split('\r\n').slice(1).map(row => row.split(','));
  assert.deepEqual(rows.map(row => row[12]), ['2', '4', '3', '5', '1']);
  assert.deepEqual(rows.map(row => row[0]), ['1', '2', '3', '4', '5']);
  assert.equal(JSON.stringify(records), before);
  assert.deepEqual(Object.keys(records[0]), ['id', 'lat', 'lng', 'observedAt', 'count', 'createdAt']);
});

test('CSV escaping retains commas, quotes, CR and LF inside quoted fields', () => {
  assert.equal(escapeCsvCell('한글'), '한글');
  assert.equal(escapeCsvCell(128.4), '128.4');
  assert.equal(escapeCsvCell('조사,"메모"\r\n다음'), '"조사,""메모""\r\n다음"');
  assert.equal(escapeCsvCell('줄\n바꿈'), '"줄\n바꿈"');
  assert.equal(escapeCsvCell(''), '');
});

test('invalid and empty records fail without skipping any observations', () => {
  assert.throws(() => buildPorpoiseCsv([], '범진'), /기록이 없습니다/);
  for (const realName of ['', 'Google displayName', '범진 ']) assert.throws(() => buildPorpoiseCsv([record], realName), /실명/);
  for (const patch of [{ lat: NaN }, { lng: Infinity }, { lat: 91 }, { lng: -181 }, { lat: '34.8' }, { count: 0 }, { count: 1.5 }, { count: Number.MAX_SAFE_INTEGER + 1 }, { id: '' }, { createdAt: NaN }, { observedAt: '2026-02-29T12:00' }, { observedAt: '2026-13-01T12:00' }, { observedAt: '2026-11-20T24:00' }, { observedAt: '2026-11-20T12:60' }, { observedAt: '2026-11-20T12:00:60' }, { observedAt: '' }, { observedAt: null }]) {
    const records = [record, { ...record, ...patch }] as PorpoiseRecord[];
    const before = JSON.stringify(records);
    assert.throws(() => buildPorpoiseCsv(records, '범진'));
    assert.equal(JSON.stringify(records), before);
  }
});

test('file sharing checks only files and synchronously invokes the selected platform without claiming email delivery', async () => {
  const file = createPorpoiseCsvFile([record], '범진');
  const calls: string[] = [];
  const result = sharePorpoiseCsv(file, {
    canShare: data => { calls.push('canShare'); assert.deepEqual(data, { files: [file] }); return true; },
    share: async data => { calls.push('share'); assert.deepEqual(data.files, [file]); assert.equal(data.title, '상괭이 관찰기록'); assert.equal(data.text, '상괭이모니터링 관찰기록 CSV'); assert.equal(data.url, undefined); },
  });
  assert.deepEqual(calls, ['canShare', 'share']);
  assert.equal(await result, 'shared');
});

test('share cancellation is silent and unsupported APIs request a download fallback', async () => {
  const file = createPorpoiseCsvFile([record], '범진');
  assert.equal(await sharePorpoiseCsv(file, { canShare: () => true, share: async () => { throw new DOMException('cancel', 'AbortError'); } }), 'cancelled');
  for (const platform of [{}, { share: async () => assert.fail('must not share') }, { canShare: () => false, share: async () => assert.fail('must not share') }, { canShare: () => { throw new Error('unavailable'); }, share: async () => assert.fail('must not share') }]) {
    assert.equal(await sharePorpoiseCsv(file, platform), 'unsupported');
  }
  await assert.rejects(sharePorpoiseCsv(file, { canShare: () => true, share: async () => { throw new DOMException('blocked', 'NotAllowedError'); } }), /다운로드/);
});
