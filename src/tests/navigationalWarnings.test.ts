import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parsePage, inspectCoordinates, defaultDates, validateDates, createRequester, allPages, collectWarnings, dataState, isSnapshot, safeDiagnostic, WarningError, SOURCE, API_BASE } from '../../scripts/lib/navigational-warnings.mjs';
import { runCollection, atomicJson } from '../../scripts/collect-navigational-warnings.mjs';

const xml = (items = '', total = '0', page = '1', rows = '100') => `<response><header><resultCode>00</resultCode></header><body><items>${items}</items><numOfRows>${rows}</numOfRows><pageNo>${page}</pageNo><totalCount>${total}</totalCount></body></response>`;
const page = (items: unknown[], totalCount = items.length, pageNo = 1) => ({ items, totalCount, pageNo, numOfRows: 100 });
const rawDoc = { doc_num: '26-391', area: '1,2', title: '공식 제목', content: '원문\n내용', basic: '발행 근거' };
const position = '34-09-41N,128-00-00E\r\n34-18-01.0N,128-11-27E';
const detail = (area: string) => ({ doc_num: '26-391', area, position, position_nm: '욕지도 남방', position_desc: '순차 연결한 선내 해역', alarm_date: '2026-11-21,', alarm_time: '08:00 ~ 18:00,', sea_pos: '2200' });

test('XML preserves strings, entities and raw newlines; empty success differs from errors', () => {
  const result = parsePage(xml('<item><doc_num>01-001</doc_num><title>가 &amp; 나</title><position>1&#xD;\n2</position></item>', '1'));
  assert.equal(result.items[0].doc_num, '01-001');
  assert.equal(result.items[0].title, '가 & 나');
  assert.equal(result.items[0].position, '1\r\n2');
  assert.deepEqual(parsePage(xml()).items, []);
  for (const input of ['<broken>', xml().replace('00', '30'), '<!DOCTYPE response><response/>', xml().replace('<items></items>', '<items><item><nested><a>x</a></nested></item></items>')]) assert.throws(() => parsePage(input));
});
test('DMS retains all pairs, refuses invalid seconds and never infers geometry or datum', () => {
  const parsed = inspectCoordinates(position);
  assert.equal(parsed.status, 'datum_unverified');
  assert.equal(parsed.pairs.length, 2);
  assert.ok(Math.abs(parsed.pairs[0].latitude - (34 + 9 / 60 + 41 / 3600)) < 1e-9);
  assert.equal(parsed.pairs[0].longitude, 128);
  assert.equal(parsed.geometry, null);
  assert.equal(inspectCoordinates('36-12-54N,129-28-67E').status, 'invalid_dms');
  assert.equal(inspectCoordinates('90-01-00N,180-00-00E').status, 'invalid_dms');
  assert.equal(inspectCoordinates('위치 미상').status, 'unparsed');
  assert.equal(inspectCoordinates('').status, 'missing');
});
test('query dates use KST boundaries and reject calendar rollover', () => {
  assert.deepEqual(defaultDates(new Date('2026-11-20T15:01:00Z')), ['20261120', '20261121', '20261122']);
  assert.deepEqual(defaultDates(new Date('2026-12-31T15:01:00Z')), ['20261231', '20270101', '20270102']);
  assert.throws(() => validateDates(['20260230']));
  assert.throws(() => validateDates([]));
});
test('request uses exact official paths, uppercase ServiceKey and single URL encoding', async () => {
  const request = createRequester('test%2Bkey%2F%3D', async (url: URL) => {
    assert.equal(url.pathname, '/1192136/NavigationalWarning/getNavigationalWarningInfo');
    assert.equal(url.searchParams.get('ServiceKey'), 'test+key/=');
    assert.equal(url.searchParams.get('date'), '20261121');
    return new Response(xml());
  });
  assert.equal((await request('getNavigationalWarningInfo', { date: '20261121' })).totalCount, 0);
});
test('network errors and credential echoes cannot leak through diagnostics', async () => {
  const secret = 'dummy-private-token';
  for (const fetcher of [async () => { throw Error(`https://example.invalid/?ServiceKey=${secret}`); }, async () => new Response(xml(`<item><title>${secret}</title></item>`, '1'))]) {
    await assert.rejects(createRequester(secret, fetcher)('getNavigationalWarningInfo', {}), error => ['network_error', 'credential_in_response'].includes(safeDiagnostic(error).code) && !String(error).includes(secret));
  }
});
test('streamed UTF-8 XML spans chunks safely and excessive/error responses are rejected', async () => {
  const bytes = new TextEncoder().encode(xml('<item><title>항행경보 원문</title></item>', '1'));
  let offset = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) { controller.close(); return; }
    controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7;
  } });
  const request = createRequester('fake-key', async () => new Response(stream));
  assert.equal((await request('getNavigationalWarningInfo', {})).items[0].title, '항행경보 원문');
  for (const response of [new Response('unavailable', { status: 503 }), new Response('', { headers: { 'content-length': '4000001' } })]) {
    await assert.rejects(createRequester('fake-key', async () => response, { maxAttempts: 1 })('getNavigationalWarningInfo', {}));
  }
});
test('pagination collects all pages and rejects drift, short or repeated pages', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ doc_num: String(i) }));
  const result = await allPages(async (_op: string, params: Record<string, string>) => params.pageNo === '1' ? page(items, 101) : page([{ doc_num: '100' }], 101, 2), 'op', {});
  assert.equal(result.length, 101);
  for (const request of [async () => page([], 1), async () => page(items, 101), async (_op: string, p: Record<string, string>) => page(items, Number(p.pageNo) === 1 ? 101 : 102, Number(p.pageNo))]) await assert.rejects(allPages(request, 'op', {}));
});
test('collection deduplicates query observations, keeps all areas/raw fields and uses document-wide detail query', async () => {
  const snapshot = await collectWarnings(async (op: string, params: Record<string, string>) => {
    if (op === 'getNavigationalWarningInfo') return page([rawDoc]);
    assert.equal(params.doc_num, '26-391'); assert.equal(params.area, undefined);
    return page([detail('1'), { ...detail('2'), position: '' }]);
  }, ['20261120', '20261121'], '2026-11-21T00:00:00Z');
  assert.ok(isSnapshot(snapshot));
  assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.documents[0].observations.length, 2);
  assert.deepEqual(snapshot.documents[0].observations[0].raw, rawDoc);
  assert.equal(snapshot.documents[0].areas.length, 2);
  assert.equal(new Set(snapshot.documents[0].areas.map(a => a.id)).size, 2);
  assert.equal(snapshot.documents[0].areas[0].raw.alarm_date, '2026-11-21,');
  assert.equal(snapshot.documents[0].areas[1].coordinates.status, 'missing');
  assert.equal(snapshot.documents[0].issuedAt, null);
});
test('missing or mismatched area detail rejects the entire collection', async () => {
  for (const details of [[detail('1')], [{ ...detail('1'), doc_num: 'wrong' }], [detail('1'), detail('2'), { ...detail('2'), position_nm: 'conflict' }]]) {
    await assert.rejects(collectWarnings(async (op: string) => page(op === 'getNavigationalWarningInfo' ? [rawDoc] : details), ['20261121']));
  }
});
test('failed or unconfigured attempts preserve latest bytes and never log external exceptions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-navigation-'));
  try {
    const lastSuccessfulAt = '2026-11-21T00:00:00Z';
    await atomicJson(path.join(directory, 'latest.json'), { lastSuccessfulAt, documents: [{ original: true }] });
    const before = await readFile(path.join(directory, 'latest.json'), 'utf8');
    const logs: string[] = [];
    const options = { directory, log: (s: string) => logs.push(s) };
    assert.equal(await runCollection({ ...options, key: '', request: () => assert.fail('must not request') }), 0);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8')).status, 'not_configured');
    assert.equal(await runCollection({ ...options, key: 'fake', dates: ['20261121'], request: async () => { throw Error('secret-should-not-appear'); } }), 1);
    assert.equal(await readFile(path.join(directory, 'latest.json'), 'utf8'), before);
    const status = JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8'));
    assert.equal(status.status, 'failed'); assert.equal(status.lastSuccessfulAt, lastSuccessfulAt);
    assert.ok(!logs.join('').includes('secret-should-not-appear'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('successful empty query records success without asserting no active warnings; stale/failed states stay distinct', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-navigation-'));
  try {
    assert.equal(await runCollection({ directory, key: 'fake', dates: ['20261121'], now: new Date('2026-11-21T00:00:00Z'), clock: () => new Date('2026-11-21T00:00:00Z'), request: async () => page([]), log: () => {} }), 0);
    const snapshot = JSON.parse(await readFile(path.join(directory, 'latest.json'), 'utf8'));
    const state = dataState(snapshot, { status: 'failed' }, new Date('2026-11-21T04:00:00Z'));
    assert.equal(state.availability, 'empty_query_result'); assert.equal(state.activeSetCompleteness, 'unverified');
    assert.equal(state.lastAttempt, 'failed'); assert.equal(state.stale, true);
    assert.equal(dataState(null, null).availability, 'not_collected');
    assert.equal(isSnapshot({ ...snapshot, source: 'invalid' }), false);
    assert.ok(isSnapshot({ schemaVersion: 1, source: SOURCE, apiBase: API_BASE, lastSuccessfulAt: null, coverage: { activeSetCompleteness: 'unverified', datum: null, queryDates: [] }, documents: [] }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function fakeTime() {
  let time = 0;
  const waits: number[] = [];
  return { waits, clock: () => time, sleep: async (ms: number) => { waits.push(ms); time += ms; } };
}
test('temporary HTTP and API failures recover with bounded exponential backoff', async () => {
  const timing = fakeTime(); let calls = 0;
  const request = createRequester('fake-key', async () => {
    calls++;
    if (calls === 1) return new Response('', { status: 503 });
    if (calls === 2) return new Response(xml().replace('00', '05'));
    return new Response(xml());
  }, timing);
  assert.equal((await request('getNavigationalWarningInfo', {})).totalCount, 0);
  assert.equal(request.stats.requests, 3); assert.equal(request.stats.retries, 2);
  assert.deepEqual(timing.waits, [2000, 4000]);
  assert.deepEqual(request.stats.failures, [{ code: 'http_error', httpStatus: 503 }, { code: 'api_error', apiCode: '05' }]);
});
test('retry exhaustion records all attempts and never retries a fourth time', async () => {
  const timing = fakeTime();
  const request = createRequester('fake-key', async () => new Response('', { status: 502 }), timing);
  await assert.rejects(request('getNavigationalWarningInfo', {}), e => safeDiagnostic(e).httpStatus === 502);
  assert.equal(request.stats.requests, 3); assert.equal(request.stats.retries, 2);
  assert.deepEqual(timing.waits, [2000, 4000]);
});
test('transport reset and timeouts are distinguished; unsafe external text never escapes', async () => {
  const timing = fakeTime(); let calls = 0;
  const request = createRequester('private-token', async () => {
    calls++;
    if (calls === 1) throw new TypeError('https://invalid/?ServiceKey=private-token', { cause: { code: 'ECONNRESET' } });
    if (calls === 2) throw new DOMException('private-token', 'TimeoutError');
    return new Response(xml());
  }, timing);
  await request('getNavigationalWarningInfo', {});
  assert.deepEqual(request.stats.failures, [{ code: 'network_error', networkCode: 'ECONNRESET' }, { code: 'timeout' }]);
  assert.ok(!JSON.stringify(request.stats).includes('private-token'));
  assert.deepEqual(safeDiagnostic(Error('private-token')), { code: 'collection_error' });
});
test('auth, quota, invalid XML, parameter and unknown API errors do not retry', async () => {
  for (const response of [() => new Response('', { status: 403 }), () => new Response('', { status: 400 }),
    ...['10', '22', '30', '99', '03'].map(code => () => new Response(xml().replace('00', code))),
    () => new Response('<broken>')]) {
    const request = createRequester('fake-key', async () => response(), fakeTime());
    await assert.rejects(request('getNavigationalWarningInfo', {}));
    assert.equal(request.stats.requests, 1);
  }
});
test('gateway XML errors use the same safe API-code classification', async () => {
  let calls = 0;
  const request = createRequester('fake-key', async () => ++calls === 1
    ? new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>private text</errMsg><returnReasonCode>01</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>')
    : new Response(xml()), fakeTime());
  await request('getNavigationalWarningInfo', {});
  assert.equal(request.stats.requests, 2); assert.equal(request.stats.failures[0].apiCode, '01');
});
test('normal requests are paced and Retry-After is respected without excessive waits', async () => {
  const timing = fakeTime(); let calls = 0;
  const request = createRequester('fake-key', async () => ++calls === 1
    ? new Response('', { status: 429, headers: { 'retry-after': '5' } }) : new Response(xml()), timing);
  await request('getNavigationalWarningInfo', {}); await request('getNavigationalWarningInfo', {});
  assert.deepEqual(timing.waits, [5000, 1000]);
  const longWait = createRequester('fake-key', async () => new Response('', { status: 429, headers: { 'retry-after': '120' } }), fakeTime());
  await assert.rejects(longWait('getNavigationalWarningInfo', {})); assert.equal(longWait.stats.requests, 1);
});
test('request budget caps all retries and concurrent use is refused', async () => {
  const request = createRequester('fake-key', async () => new Response('', { status: 503 }), { ...fakeTime(), maxRequests: 2 });
  await assert.rejects(request('getNavigationalWarningInfo', {}), e => safeDiagnostic(e).code === 'request_limit');
  assert.equal(request.stats.requests, 2);
  let release: (r: Response) => void = () => {};
  const concurrent = createRequester('fake-key', () => new Promise<Response>(resolve => { release = resolve; }), fakeTime());
  const first = concurrent('getNavigationalWarningInfo', {});
  await assert.rejects(concurrent('getNavigationalWarningInfo', {}), e => safeDiagnostic(e).code === 'concurrent_request');
  release(new Response(xml())); await first;
});
test('duplicate documents/areas are removed while conflicting originals fail closed', async () => {
  const snapshot = await collectWarnings(async (op: string) => page(op === 'getNavigationalWarningInfo'
    ? [rawDoc, { ...rawDoc }] : [detail('1'), detail('2'), detail('2')]), ['20261121']);
  assert.deepEqual(snapshot.duplicatesRemoved, { documents: 1, areas: 1 });
  assert.equal(snapshot.documents.length, 1); assert.equal(snapshot.documents[0].areas.length, 2);
  assert.equal(snapshot.documents[0].areas[0].id, JSON.stringify(['26-391', '1']));
  await assert.rejects(collectWarnings(async () => page([rawDoc, { ...rawDoc, title: 'changed' }]), ['20261121']), e => safeDiagnostic(e).code === 'conflicting_document');
});
test('a repeated page with superficially valid pagination cannot manufacture completeness', async () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ doc_num: String(i) }));
  await assert.rejects(allPages(async (_op: string, params: Record<string, string>) => page(items, 200, Number(params.pageNo)), 'op', {}));
});
test('DMS boundaries, hemispheres, malformed fragments and pair counts stay explicit', () => {
  const valid = inspectCoordinates('90-00-00N,180-00-00W, 00-00-00S,000-00-00E');
  assert.equal(valid.pairCount, 2); assert.equal(valid.pairs[0].longitude, -180); assert.equal(valid.geometry, null); assert.equal(valid.datum, null);
  for (const p of ['34-60-00N,128-00-00E', '34-00-60N,128-00-00E', '91-00-00N,128-00-00E', '34-00-00N,181-00-00E', '34-00-00E,128-00-00N']) {
    assert.equal(inspectCoordinates(p).status, 'invalid_dms'); assert.deepEqual(inspectCoordinates(p).pairs, []);
  }
  const broken = inspectCoordinates(position + '\n해석불가');
  assert.equal(broken.status, 'unparsed'); assert.equal(broken.pairCount, 2); assert.deepEqual(broken.pairs, []);
});
test('failure after a valid list/detail prefix preserves good bytes and distinguishes empty success', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-navigation-'));
  try {
    const good = await collectWarnings(async (op: string) => page(op === 'getNavigationalWarningInfo' ? [rawDoc] : [detail('1'), detail('2')]), ['20261121'], '2026-11-21T00:00:00Z');
    await atomicJson(path.join(directory, 'latest.json'), good);
    const before = await readFile(path.join(directory, 'latest.json'), 'utf8');
    const code = await runCollection({ directory, key: 'fake', dates: ['20261121'], log: () => {}, request: async (op: string) => {
      if (op === 'getNavigationalWarningInfo') return page([rawDoc]);
      throw new WarningError('http_error', { httpStatus: 503 });
    } });
    assert.equal(code, 1); assert.equal(await readFile(path.join(directory, 'latest.json'), 'utf8'), before);
    const status = JSON.parse(await readFile(path.join(directory, 'status.json'), 'utf8'));
    assert.equal(status.status, 'failed'); assert.deepEqual(status.error, { code: 'http_error', httpStatus: 503 });
    assert.equal(dataState(good, status, new Date('2026-11-21T04:00:00Z')).availability, 'records');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('successful collection time and JSON generation time are separate from attempt start', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-navigation-'));
  try {
    let second = 10;
    await runCollection({ directory, key: 'fake', dates: ['20261121'], now: new Date('2026-11-21T00:00:00Z'),
      clock: () => new Date(`2026-11-21T00:00:${second++}Z`), request: async () => page([]), log: () => {} });
    const snapshot = JSON.parse(await readFile(path.join(directory, 'latest.json'), 'utf8'));
    assert.equal(snapshot.collectionStartedAt, '2026-11-21T00:00:00.000Z');
    assert.equal(snapshot.lastSuccessfulAt, '2026-11-21T00:00:10.000Z');
    assert.equal(snapshot.generatedAt, '2026-11-21T00:00:11.000Z');
    assert.ok(snapshot.coverage.limitations.includes('permanent_and_cancelled_coverage_unverified'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
