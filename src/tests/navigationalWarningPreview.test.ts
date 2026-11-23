import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWarningPreviewMiddleware, navigationalWarningPreviewPlugin } from '../../scripts/navigational-warning-preview.ts';

async function call(options: Parameters<typeof createWarningPreviewMiddleware>[0], url: string, method = 'GET') {
  const result = { status: 200, body: '', next: false, headers: {} as Record<string, string> };
  const response = { setHeader: (name: string, value: string) => { result.headers[name] = value; },
    get statusCode() { return result.status; }, set statusCode(status: number) { result.status = status; },
    end: (body = '') => { result.body = String(body); } };
  await createWarningPreviewMiddleware(options)({ url, method } as IncomingMessage, response as unknown as ServerResponse, () => { result.next = true; });
  return result;
}
test('preview middleware is serve-only and refuses disabled, unknown and write requests', async () => {
  assert.equal(navigationalWarningPreviewPlugin('/').apply, 'serve');
  const url = '/__dev/data/navigational-warnings/latest.json';
  assert.equal((await call({ enabled: false, directory: '/missing' }, url)).status, 404);
  assert.equal((await call({ enabled: true }, url.replace('latest', 'private'))).status, 404);
  assert.equal((await call({ enabled: true }, url, 'POST')).status, 405);
  assert.equal((await call({ enabled: true }, '/data/navigational-warnings/latest.json')).next, true);
  assert.equal((await call({ enabled: false, base: '/app/' }, '/app' + url)).status, 404);
});
test('missing or malformed capture returns a fixed error, never fake warnings or file contents', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-preview-'));
  try {
    const url = '/__dev/data/navigational-warnings/latest.json';
    assert.equal((await call({ enabled: true, directory }, url)).status, 503);
    await writeFile(path.join(directory, 'latest.json'), '{"private":"never disclose"}');
    await writeFile(path.join(directory, 'status.json'), '{}');
    const result = await call({ enabled: true, directory }, url);
    assert.equal(result.status, 503); assert.ok(!result.body.includes('never disclose'));
    assert.equal(result.headers['Cache-Control'], 'no-store');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
const directory = '.dev/fixtures/navigational-warnings';
test('available historical capture serves exact original bytes with 9 documents and 94 areas', { skip: !existsSync(path.join(directory, 'latest.json')) }, async () => {
  const result = await call({ enabled: true, directory }, '/__dev/data/navigational-warnings/latest.json');
  assert.equal(result.status, 200); assert.equal(result.body, readFileSync(path.join(directory, 'latest.json'), 'utf8'));
  const snapshot = JSON.parse(result.body);
  assert.equal(snapshot.documents.length, 9); assert.equal(snapshot.documents.reduce((n: number, d: { areas: unknown[] }) => n + d.areas.length, 0), 94);
  assert.ok(snapshot.documents.every((d: { areas: { coordinates: { geometry: unknown; datum: unknown } }[] }) => d.areas.every(a => a.coordinates.geometry === null && a.coordinates.datum === null)));
  const status = await call({ enabled: true, directory }, '/__dev/data/navigational-warnings/status.json');
  assert.equal(status.status, 200); assert.equal(JSON.parse(status.body).lastSuccessfulAt, snapshot.lastSuccessfulAt);
});
