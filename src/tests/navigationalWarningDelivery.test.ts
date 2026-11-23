import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWarningDataLoader, warningDataState, parseWarningAttempt } from '../services/navigationalWarningService.ts';

const seed = JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/latest.json', import.meta.url), 'utf8'));
const start = Date.parse('2026-11-23T03:00:00Z');
const normal = new Date(start).toISOString();
const encode = (v: unknown) => JSON.stringify(v);
function fixture(count = 0, time: string | null = normal, status = 'success', publicationState = 'ready') {
  const snapshot = { ...seed, lastSuccessfulAt: time, documents: Array.from({ length: count }, (_, i) => ({
    docNum: `test-${i}`, issuedAt: null, observations: [{ queryDate: '20261123', raw: { doc_num: `test-${i}`, title: '제목', content: '원문' } }], areas: [],
  })) };
  const text = encode(snapshot);
  const attempt = { schemaVersion: 1, status, lastSuccessfulAt: time, lastAttemptAt: normal,
    publication: { state: publicationState, preparedAt: normal, snapshotSha256: createHash('sha256').update(text).digest('hex'), reason: 'collection_artifact' } };
  return { snapshot, attempt, text };
}
const response = (url: RequestInfo | URL, value: ReturnType<typeof fixture>) => new Response(String(url).includes('/latest.json') ? value.text : encode(value.attempt));

test('panel reads are lazy, deduplicated, reused for one minute and revalidated without polling', async () => {
  let now = start, calls = 0, release: () => void = () => {};
  let value = fixture(0);
  const gate = new Promise<void>(resolve => { release = resolve; });
  const urls: string[] = [];
  const load = createWarningDataLoader(async (url, init) => {
    calls++; urls.push(String(url)); assert.equal(init?.cache, 'no-store');
    await gate; return response(url, value);
  }, () => now);
  assert.equal(calls, 0);
  const a = load('/badakkomkkomi/'), b = load('/badakkomkkomi/');
  release(); const [first, duplicate] = await Promise.all([a, b]);
  assert.equal(calls, 2); assert.equal(first, duplicate); assert.equal(first.publicationVerified, true);
  assert.equal(warningDataState(first, now).publicationState, 'received');
  await load('/badakkomkkomi/'); assert.equal(calls, 2);
  value = fixture(1, new Date(start + 3600000).toISOString()); now += 61000;
  const next = await load('/badakkomkkomi/');
  assert.equal(next.snapshot?.documents.length, 1); assert.equal(calls, 4);
  assert.ok(urls.every(url => url.startsWith('/badakkomkkomi/data/navigational-warnings/')));
  assert.notEqual(new URL(urls[0], 'https://example.test').search, new URL(urls[2], 'https://example.test').search);
});
test('generation hash mismatch cannot turn a mixed response into normal zero; good memory is retained', async () => {
  let now = start, value = fixture(1);
  const load = createWarningDataLoader(async url => response(url, value), () => now);
  const good = await load('/');
  now += 61000; value = fixture(0); value.attempt.publication.snapshotSha256 = '0'.repeat(64);
  const bad = await load('/');
  assert.equal(bad.snapshot, good.snapshot); assert.equal(bad.publicationDelayed, true); assert.ok(bad.errors.length);
  const initial = createWarningDataLoader(async url => response(url, value));
  const rejected = await initial('/'); assert.equal(rejected.snapshot, null); assert.ok(rejected.errors.length);
});
test('failed HTTP and older collection/status responses cannot roll back cached normal data', async () => {
  let now = start, value = fixture(1), failedHttp = false;
  const load = createWarningDataLoader(async url => failedHttp ? new Response('', { status: 503 }) : response(url, value), () => now);
  const good = await load('/'); now += 61000; failedHttp = true;
  const fallback = await load('/'); assert.equal(fallback.snapshot, good.snapshot); assert.ok(fallback.errors.length);
  now += 61000; failedHttp = false; value = fixture(0, '2026-11-22T00:00:00Z');
  const older = await load('/'); assert.equal(older.snapshot, good.snapshot); assert.equal(older.publicationDelayed, true);
  now += 61000; value = fixture(1); value.attempt.lastAttemptAt = '2026-11-23T02:00:00Z';
  const olderStatus = await load('/'); assert.equal(olderStatus.attempt, good.attempt); assert.equal(olderStatus.publicationDelayed, true);
});
test('cancelling one viewer does not abort a shared load or create duplicate requests', async () => {
  const value = fixture(); let calls = 0, release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const load = createWarningDataLoader(async url => { calls++; await gate; return response(url, value); });
  const controller = new AbortController();
  const first = load('/', controller.signal), second = load('/'); controller.abort();
  assert.ok((await first).errors.length); release(); assert.equal((await second).publicationVerified, true); assert.equal(calls, 2);
});
test('collection failure, publication delay, missing baseline and aging remain independent', () => {
  const value = fixture(0);
  const success = { snapshot: value.snapshot, attempt: parseWarningAttempt(value.attempt), errors: [], publicationVerified: true };
  assert.match(warningDataState(success, start).briefMessage, /정상 수집 결과가 0건/);
  assert.equal(warningDataState(success, start).publicationState, 'received');
  const failed = { ...success, attempt: parseWarningAttempt({ ...value.attempt, status: 'failed' }) };
  assert.match(warningDataState(failed, start).briefMessage, /수집 실패/);
  assert.equal(warningDataState(success, start + 76 * 60000).publicationState, 'delayed');
  assert.equal(warningDataState(success, start + 76 * 60000).stale, false);
  assert.equal(warningDataState(success, start + 4 * 3600000).stale, true);
  const delayed = { ...success, attempt: parseWarningAttempt({ ...value.attempt, publication: { ...value.attempt.publication, state: 'delayed' } }) };
  assert.match(warningDataState(delayed, start).briefMessage, /갱신 지연/);
});
test('warning cache policy precedes general JSON handling, avoids precache and leaves tide strategy intact', () => {
  const config = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
  assert.ok(config.includes("'**/data/navigational-warnings/**'"));
  const warning = config.indexOf('handler: \'NetworkOnly\'');
  const tide = config.indexOf("cacheName: 'bada-khoa-tides-v1'");
  assert.ok(warning > 0 && warning < tide);
  assert.ok(config.includes('createTideCachePlugin()'));
});
