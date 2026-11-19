import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicSave, collectTides, KhoaDiagnosticError, safeTideDiagnostic, updateTides } from '../../scripts/update-khoa-tides.mjs';

const secret = 'FAKE-SECRET-MUST-NOT-APPEAR';
const options = { key: secret, now: new Date('2026-01-19T00:00:00Z'), sleep: async () => {} };
function responsePayload(url: URL) {
  const date = url.searchParams.get('reqDate')!;
  return { header: { resultCode: '00' as unknown }, body: { type: 'json', pageNo: 1 as unknown,
    numOfRows: 100, totalCount: 1, items: { item: [{
      obsvtrNm: url.searchParams.get('obsCode') === 'DT_0014' ? '통영' : '고현항',
      predcDt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} 04:00`,
      predcTdlvVl: 120 as unknown, extrSe: '1',
    }] } } };
}
async function failure(fetchImpl: (url: URL) => Promise<Response>, overrides = {}) {
  try { await collectTides({ ...options, fetchImpl, ...overrides }); }
  catch (error) { return safeTideDiagnostic(error); }
  assert.fail('Expected collection to fail');
}

test('CONFIG classifies missing and malformed credentials without echoing input', async () => {
  const forbidden = async () => { assert.fail('No network allowed'); };
  assert.equal((await failure(forbidden, { key: '' })).reason, 'KEY_MISSING');
  const error = await failure(forbidden, { key: '%invalid' });
  assert.equal(error.category, 'CONFIG');
  assert.equal(error.reason, 'KEY_ENCODING');
});

test('API_AUTH identifies bounded JSON and XML auth codes without logging message or body', async () => {
  for (const code of ['20', '30', '31']) {
    for (const format of ['json', 'xml']) {
      const value = await failure(async url => {
        const payload = responsePayload(url); payload.header.resultCode = code;
        return new Response(format === 'json' ? JSON.stringify({ ...payload, private: secret })
          : `<OpenAPI_ServiceResponse><returnReasonCode>${code}</returnReasonCode><returnAuthMsg>${secret}</returnAuthMsg></OpenAPI_ServiceResponse>`);
      });
      assert.equal(value.category, 'API_AUTH');
      assert.equal(value.apiCode, code);
      assert.equal(value.format, format);
      assert.equal(value.field, format === 'json' ? 'header.resultCode' : 'xml.errorCode');
      assert.equal(value.httpStatus, 200);
      assert.equal(value.station, 'DT_0014');
      assert.equal(value.date, '2026-01-19');
      assert.ok(!JSON.stringify(value).includes(secret));
    }
  }
  const value = await failure(async () => new Response('<x><resultCode>30</resultCode></x>', { status: 403 }));
  assert.equal(value.category, 'API_AUTH');
  assert.equal(value.httpStatus, 403);
});

test('HTTP retains status and retry counts; HTTP denial alone does not assert bad credentials', async () => {
  for (const status of [401, 403, 429, 503]) {
    const value = await failure(async () => new Response(secret, { status }));
    assert.equal(value.category, 'HTTP');
    assert.equal(value.httpStatus, status);
    assert.equal(value.requests, status < 429 ? 1 : 2);
    assert.equal(value.attempt, value.requests);
    assert.ok(!JSON.stringify(value).includes(secret));
  }
});

test('NETWORK keeps only allowlisted DNS/TLS/timeout codes and distinguishes body failures', async () => {
  for (const code of ['ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
    const value = await failure(async () => { throw Object.assign(new Error(`https://private.test/?serviceKey=${secret}`), { cause: { code, message: secret } }); });
    assert.equal(value.category, 'NETWORK');
    assert.equal(value.networkCode, code);
    assert.equal(value.requests, 2);
    assert.ok(!JSON.stringify(value).includes(secret));
  }
  const timeout = await failure(async () => { throw Object.assign(new Error(secret), { name: 'TimeoutError' }); });
  assert.equal(timeout.networkCode, 'TimeoutError');
  const value = await failure(async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(secret)); } })));
  assert.equal(value.category, 'NETWORK');
  assert.equal(value.reason, 'BODY_READ');
  const unknown = await failure(async () => { throw { code: secret, message: secret, stack: secret }; });
  assert.equal(unknown.networkCode, undefined);
});

test('FORMAT distinguishes XML, HTML, malformed JSON and oversized responses without content', async () => {
  for (const [text, format, reason] of [
    ['<error>private</error>', 'xml', 'XML_RESPONSE'],
    ['<!doctype html><html>private</html>', 'html', 'XML_RESPONSE'],
    ['{broken private', 'other', 'INVALID_JSON'],
    ['x'.repeat(1024 * 1024 + 1), 'other', 'RESPONSE_SIZE'],
  ]) {
    const value = await failure(async () => new Response(text));
    assert.equal(value.category, 'FORMAT');
    assert.equal(value.format, format);
    assert.equal(value.reason, reason);
    assert.ok(!JSON.stringify(value).includes('private'));
  }
  const entity = await failure(async () => new Response(`<!DOCTYPE x [<!ENTITY private "${secret}">]><x><resultCode>&private;</resultCode></x>`));
  assert.equal(entity.apiCode, undefined);
  assert.ok(!JSON.stringify(entity).includes(secret));
});

test('DATA_VALIDATION reports field and type but never the invalid value', async () => {
  for (const [field, mutate] of [
    ['body.pageNo', (p: ReturnType<typeof responsePayload>) => { p.body.pageNo = '1'; }],
    ['predcTdlvVl', (p: ReturnType<typeof responsePayload>) => { p.body.items.item[0].predcTdlvVl = secret; }],
  ] as const) {
    const value = await failure(async url => { const p = responsePayload(url); mutate(p); return new Response(JSON.stringify(p)); });
    assert.equal(value.category, 'DATA_VALIDATION');
    assert.equal(value.field, field);
    assert.equal(value.actualType, 'string');
    assert.ok(!JSON.stringify(value).includes(secret));
  }
  const value = await failure(async url => { const p = responsePayload(url); p.header.resultCode = '05'; return new Response(JSON.stringify(p)); });
  assert.equal(value.reason, 'API_RESULT');
  assert.equal(value.apiCode, '05');
  const unexpected = await failure(async url => { const p = responsePayload(url); p.header.resultCode = secret; return new Response(JSON.stringify(p)); });
  assert.equal(unexpected.apiCode, undefined);
});

test('STORAGE reports operation and bounded code; failed collections leave existing bytes intact', async () => {
  const snapshot = (await collectTides({ ...options, fetchImpl: async (url: URL) => new Response(JSON.stringify(responsePayload(url))) })).snapshot;
  const dir = await mkdtemp(join(tmpdir(), 'khoa-diagnostics-'));
  try {
    const blocker = join(dir, 'blocked');
    await writeFile(blocker, 'original');
    try { await atomicSave(snapshot, join(blocker, 'latest.json')); assert.fail('Expected storage failure'); }
    catch (error) {
      const value = safeTideDiagnostic(error);
      assert.equal(value.category, 'STORAGE');
      assert.equal(value.operation, 'mkdir');
      assert.ok(['ENOTDIR', 'EEXIST', 'ENOENT'].includes(value.storageCode));
      assert.ok(!JSON.stringify(value).includes(dir));
    }
    const output = join(dir, 'latest.json');
    await atomicSave(snapshot, output);
    const before = await readFile(output, 'utf8');
    await assert.rejects(updateTides({ ...options, output, fetchImpl: async () => new Response('<x><resultCode>30</resultCode></x>') }));
    assert.equal(await readFile(output, 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('output boundary rejects unknown exception content and tampered diagnostic properties', () => {
  const error = new KhoaDiagnosticError('NETWORK', 'FETCH_FAILED', {
    networkCode: secret, message: secret, stack: secret, url: secret, response: secret,
    field: secret, actualType: secret, apiCode: secret, station: secret,
  });
  error.message = secret; error.stack = secret;
  error.diagnostic.raw = secret;
  error.diagnostic.field = secret;
  const value = safeTideDiagnostic(error);
  assert.deepEqual(value, { category: 'NETWORK', reason: 'FETCH_FAILED' });
  assert.deepEqual(safeTideDiagnostic(new Error(secret)), { category: 'DATA_VALIDATION', reason: 'UNEXPECTED' });
  error.diagnostic = null;
  assert.deepEqual(safeTideDiagnostic(error), { category: 'DATA_VALIDATION', reason: 'UNEXPECTED' });
});

test('CLI emits only one diagnostic JSON without raw exceptions, URLs or credentials', () => {
  const run = spawnSync(process.execPath, ['scripts/update-khoa-tides.mjs'], {
    encoding: 'utf8', env: { ...process.env, KHOA_SERVICE_KEY: '%invalid' },
  });
  assert.equal(run.status, 1);
  assert.equal(run.stdout, '');
  assert.deepEqual(JSON.parse(run.stderr), { category: 'CONFIG', reason: 'KEY_ENCODING' });
  assert.ok(!run.stderr.includes('%invalid'));
  assert.ok(!run.stderr.includes('https://'));
  assert.ok(!run.stderr.includes(' at '));
});
