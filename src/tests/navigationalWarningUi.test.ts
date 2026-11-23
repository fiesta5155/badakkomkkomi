import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchWarningData, parseWarningSnapshot, parseWarningAttempt, warningDataState, formatWarningTime } from '../services/navigationalWarningService.ts';

const now = Date.parse('2026-11-23T03:00:00Z');
const time = '2026-11-23T02:00:00Z';
const raw = { doc_num: '26-2', title: '제목', content: '첫 줄\n다음 줄', basic: '공식 근거' };
const doc = (docNum = '26-2', issuedAt: string | null = null) => ({ docNum, issuedAt,
  observations: [{ queryDate: '20261123', raw: { ...raw, doc_num: docNum } }],
  areas: [{ raw: { doc_num: docNum, area: '1', position: '좌표 원문', position_desc: '영역 설명', alarm_date: '2026-11-23,', alarm_time: '08:00 ~ 18:00,', sea_pos: '2200' } }] });
const snapshot = (documents = [doc()], lastSuccessfulAt: string | null = time) => ({ schemaVersion: 1,
  source: 'https://www.data.go.kr/data/15057792/openapi.do', apiBase: 'https://apis.data.go.kr/1192136/NavigationalWarning/',
  lastSuccessfulAt, coverage: { queryDates: ['20261123'] }, documents });
const attempt = (status = 'success', lastSuccessfulAt: string | null = time) => ({ schemaVersion: 1, status, lastSuccessfulAt, lastAttemptAt: time });
const bundle = (documents = [doc()]) => ({ snapshot: parseWarningSnapshot(snapshot(documents)), attempt: parseWarningAttempt(attempt()), errors: [] });

test('helm guide describes the configured hourly collection schedule without inventing release times', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/collect-navigational-warnings.yml', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../components/navigation/SettingsInformation.tsx', import.meta.url), 'utf8');
  const minute = workflow.match(/cron:\s*'(\d+) \* \* \* \*'/)?.[1];
  assert.ok(minute, 'Collection schedule changed: review the user guide.');
  assert.ok(guide.includes(`매시간 ${Number(minute)}분`));
  assert.ok(!/07:17|13:17/.test(guide));
});

test('real initial JSON is uncollected, not a successful zero-warning result', () => {
  const snapshot = parseWarningSnapshot(JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/latest.json', import.meta.url), 'utf8')));
  const attempt = parseWarningAttempt(JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/status.json', import.meta.url), 'utf8')));
  const state = warningDataState({ snapshot, attempt, errors: [] }, now);
  assert.equal(state.message, '아직 수집된 항행경보 자료가 없습니다.');
  assert.equal(state.uncollected, true);
});
test('successful empty, records, failed retained and failed unavailable stay distinct', () => {
  assert.match(warningDataState(bundle([]), now).message, /정상 수집 결과가 0건/);
  assert.equal(warningDataState(bundle([]), now).uncollected, false);
  assert.match(warningDataState(bundle(), now).message, /수집 자료 1건/);
  assert.match(warningDataState({ ...bundle(), attempt: parseWarningAttempt(attempt('failed')) }, now).message, /이전 정상 자료/);
  assert.match(warningDataState({ snapshot: parseWarningSnapshot(snapshot([], null)), attempt: parseWarningAttempt(attempt('failed', null)), errors: [] }, now).message, /정상 자료가 없습니다/);
  assert.equal(warningDataState(bundle(), now).briefMessage, '수집 자료 1건입니다.');
  assert.match(warningDataState({ ...bundle(), attempt: parseWarningAttempt(attempt('failed')) }, now).briefMessage, /수집 자료 1건.*수집 실패.*이전 정상 자료/);
  assert.equal(warningDataState({ snapshot: parseWarningSnapshot(snapshot([], null)), attempt: parseWarningAttempt(attempt('failed', null)), errors: [] }, now).briefMessage, '수집 실패 · 정상 자료 없음');
});
test('stale policy is configurable and uses last success rather than status generation', () => {
  const data = bundle();
  assert.equal(warningDataState(data, now + 3 * 3600000).stale, true);
  data.snapshot.freshness = { staleAfterSeconds: 7200 };
  assert.equal(warningDataState(data, now).stale, false);
  data.snapshot.freshness = { staleAfterSeconds: 60 };
  assert.equal(warningDataState(data, now).stale, true);
  assert.equal(warningDataState(data, Date.parse('2026-11-20T00:00:00Z')).stale, true);
});
test('mismatched snapshot/status generations cannot silently appear confirmed', () => {
  const data = bundle(); data.attempt.lastSuccessfulAt = '2026-11-23T01:00:00Z';
  assert.equal(warningDataState(data, now).mismatch, true);
  assert.match(warningDataState(data, now).message, /갱신 여부를 확인할 수 없습니다/);
  assert.match(warningDataState(data, now).briefMessage, /수집 상태 미확인/);
  const unavailable = { snapshot: parseWarningSnapshot(snapshot([], null)), attempt: parseWarningAttempt(attempt('failed')), errors: [] };
  assert.match(warningDataState(unavailable, now).briefMessage, /수집 실패.*정상 자료 없음.*수집 상태 미확인/);
});
test('duplicates merge without changing originals or inventing dates; linebreaks remain verbatim', () => {
  const source = snapshot([doc(), doc()]); const before = structuredClone(source);
  const result = parseWarningSnapshot(source);
  assert.equal(result.documents.length, 1); assert.equal(result.documents[0].areas.length, 1);
  assert.equal(result.documents[0].observations[0].raw.content, raw.content);
  assert.equal(result.documents[0].issuedAt, null); assert.deepEqual(source, before);
  const many = doc(); many.areas = Array.from({ length: 58 }, (_, i) => ({ raw: { ...many.areas[0].raw, area: String(i + 1) } }));
  assert.equal(parseWarningSnapshot(snapshot([many])).documents[0].areas.length, 58);
});
test('only explicit issuance timestamps across every document permit sorting', () => {
  assert.deepEqual(parseWarningSnapshot(snapshot([doc('26-2'), doc('26-1')])).documents.map(d => d.docNum), ['26-2', '26-1']);
  assert.deepEqual(parseWarningSnapshot(snapshot([doc('old', '2026-11-21T00:00:00Z'), doc('new', '2026-11-23T00:00:00Z')])).documents.map(d => d.docNum), ['new', 'old']);
  assert.deepEqual(parseWarningSnapshot(snapshot([doc('old', '2026-11-21T00:00:00Z'), doc('unknown', '불확실')])).documents.map(d => d.docNum), ['old', 'unknown']);
});
test('malformed schema, conflicts, non-string originals and impossible query dates are rejected', () => {
  for (const value of [{}, snapshot([doc()], null), { ...snapshot(), coverage: { queryDates: ['20260230'] } }, { ...snapshot(), freshness: { staleAfterSeconds: -1 } },
    snapshot([{ ...doc(), observations: [{ queryDate: '20261123', raw: { ...raw, content: 3 } }] } as never])]) assert.throws(() => parseWarningSnapshot(value));
  const conflict = doc(); conflict.areas[0].raw.position = 'different';
  assert.throws(() => parseWarningSnapshot(snapshot([doc(), conflict])));
  assert.throws(() => parseWarningAttempt(attempt('success', null)));
});
test('KST formatting crosses UTC date boundaries and never substitutes missing timestamps', () => {
  assert.equal(formatWarningTime('2026-11-22T16:02:00Z'), '2026.11.23. 01:02 KST');
  assert.equal(formatWarningTime(null), '미제공'); assert.equal(formatWarningTime('2026-11-22'), '미제공');
  assert.equal(formatWarningTime('2026-02-30T00:00:00Z'), '미제공');
});
test('only static BASE_URL JSON is requested; fetch/schema failures stay separate from empty success', async () => {
  const urls: string[] = [];
  const data = await fetchWarningData('/badakkomkkomi/', undefined, async (url, init) => {
    urls.push(new URL(String(url), 'https://example.test').pathname); assert.equal(init?.cache, 'no-store');
    return new Response(JSON.stringify(String(url).includes('/latest.json') ? snapshot() : attempt()));
  });
  assert.equal(data.errors.length, 0); assert.equal(data.snapshot?.documents.length, 1);
  assert.deepEqual(urls.sort(), ['/badakkomkkomi/data/navigational-warnings/latest.json', '/badakkomkkomi/data/navigational-warnings/status.json']);
  const failed = await fetchWarningData('/', undefined, async () => new Response('', { status: 503 }));
  assert.equal(failed.snapshot, null); assert.equal(failed.errors.length, 2);
  assert.match(warningDataState(failed, now).message, /불러오지 못했습니다/);
  const partial = await fetchWarningData('/', undefined, async url => String(url).includes('/latest.json')
    ? new Response(JSON.stringify(snapshot())) : new Response('{}'));
  assert.equal(partial.snapshot?.documents.length, 1); assert.equal(partial.attempt, null); assert.equal(partial.errors.length, 1);
});
