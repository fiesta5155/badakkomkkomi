import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectTides, forecastDates, updateTides, atomicSave, STATIONS } from '../../scripts/update-khoa-tides.mjs';
import { recoverTides } from '../../scripts/prepare-khoa-tides.mjs';
import { validTideSnapshot, tideFreshness } from '../services/khoaTideSchema.ts';
import { createTideCachePlugin } from '../../scripts/khoa-tide-cache.ts';
import { fetchKhoaTides } from '../services/khoaTideService.ts';

const now = new Date('2026-01-18T20:00:00.000Z');
const times = ['04:00', '10:00', '16:00', '22:00'];
function upstream(url: URL, options: { count?: number; pageSize?: number } = {}) {
  const date = url.searchParams.get('reqDate')!;
  const code = url.searchParams.get('obsCode');
  const page = Number(url.searchParams.get('pageNo'));
  const count = options.count ?? 4;
  const size = options.pageSize ?? 100;
  const items = Array.from({ length: count }, (_, i) => {
    const time = count > 4 ? `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}` : times[i];
    return { obsvtrNm: STATIONS.find(s => s.code === code)!.name,
      predcDt: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)} ${time}`,
      predcTdlvVl: i === 0 ? -2.5 : 100 + i,
      extrSe: count > 4 ? '1' : String(i + 1) };
  }).slice((page - 1) * size, page * size);
  return { header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE' }, body: {
    items: { item: items.reverse() }, totalCount: count, pageNo: page, numOfRows: size, type: 'json' } };
}
const goodFetch = async (url: URL) => new Response(JSON.stringify(upstream(url)));
const options = { key: 'fake+key/=', now, sleep: async () => {}, fetchImpl: goodFetch };
async function fixture() { return (await collectTides(options)).snapshot; }

test('missing credential stops before network or filesystem writes', async () => {
  let calls = 0;
  await assert.rejects(collectTides({ ...options, key: '', fetchImpl: async () => { calls++; throw new Error(); } }), /missing/);
  assert.equal(calls, 0);
});

test('32 KST dates, year boundary and station/date requests are exact; variable events sort safely', async () => {
  assert.equal(forecastDates(now)[0], '2026-01-19');
  assert.equal(forecastDates(new Date('2026-12-31T15:00:00Z'))[0], '2027-01-01');
  const seen = new Set<string>();
  const result = await collectTides({ ...options, key: 'fake%2Bkey%2F%3D', fetchImpl: async (url: URL) => {
    assert.equal(url.searchParams.get('serviceKey'), options.key);
    seen.add(`${url.searchParams.get('obsCode')}:${url.searchParams.get('reqDate')}`);
    return new Response(JSON.stringify(upstream(url, { count: seen.size % 2 ? 3 : 4 })));
  } });
  assert.equal(result.calls, 64);
  assert.equal(seen.size, 64);
  assert.ok(validTideSnapshot(result.snapshot));
  assert.equal(result.snapshot.stations[0].days[0].events.length, 3);
  assert.equal(result.snapshot.stations[0].days[0].events[0].time, '04:00');
  assert.equal(result.snapshot.stations[0].days[0].events[0].heightCm, -2.5);
  assert.equal(result.snapshot.stations[0].days[0].events[0].extrSe, 1);
  assert.ok(!JSON.stringify(result.snapshot).includes('fake'));
});

test('paging collects all items and rejects changed totals, page gaps and partial pages', async () => {
  const result = await collectTides({ ...options, fetchImpl: async (url: URL) => new Response(JSON.stringify(upstream(url, { count: 101 }))) });
  assert.equal(result.calls, 128);
  assert.equal(result.snapshot.stations[0].days[0].events.length, 101);
  for (const mutate of [
    (p: any) => { p.body.totalCount = 102; },
    (p: any) => { p.body.pageNo = 1; },
    (p: any) => { p.body.items.item = []; },
  ]) {
    await assert.rejects(collectTides({ ...options, fetchImpl: async (url: URL) => {
      const p = upstream(url, { count: 101 });
      if (url.searchParams.get('pageNo') === '2') mutate(p);
      return new Response(JSON.stringify(p));
    } }));
  }
});

test('API errors and invalid fields cannot become published forecasts', async () => {
  for (const mutate of [
    (p: any) => { p.header.resultCode = '03'; },
    (p: any) => { p.body.items.item[0].obsvtrNm = '다른 지점'; },
    (p: any) => { p.body.items.item[0].predcDt = '2026-02-30 04:00'; },
    (p: any) => { p.body.items.item[0].predcTdlvVl = null; },
    (p: any) => { p.body.items.item[0].predcTdlvVl = '123'; },
    (p: any) => { p.body.items.item[0].extrSe = '1junk'; },
    (p: any) => { p.body.items.item[0].predcDt = p.body.items.item[1].predcDt; },
    (p: any) => { p.body.items.item[0].extrSe = 5; },
    (p: any) => { p.body.totalCount = 0; p.body.items.item = []; },
  ]) await assert.rejects(collectTides({ ...options, fetchImpl: async (url: URL) => {
    const payload = upstream(url); mutate(payload); return new Response(JSON.stringify(payload));
  } }));
  for (const text of ['<OpenAPI_ServiceResponse><error>bad key</error></OpenAPI_ServiceResponse>', '<html>Error</html>', '{bad']) {
    await assert.rejects(collectTides({ ...options, fetchImpl: async () => new Response(text) }), /non-JSON/);
  }
});

test('timeouts and transient HTTP responses retry at most once; global call budget is enforced', async () => {
  for (const status of [429, 503, 401]) {
    let calls = 0;
    await assert.rejects(collectTides({ ...options, fetchImpl: async () => { calls++; return new Response('', { status }); } }));
    assert.equal(calls, status === 401 ? 1 : 2);
  }
  let calls = 0;
  await assert.rejects(collectTides({ ...options, fetchImpl: async () => { calls++; throw new Error('private URL'); } }));
  assert.equal(calls, 2);
  await assert.rejects(collectTides({ ...options, maxCalls: 2 }), /budget/);
});

test('failed collection and invalid saves preserve the exact old JSON; rerun replaces atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'khoa-test-'));
  try {
    const output = join(dir, 'latest.json');
    await updateTides({ ...options, output });
    const before = await readFile(output, 'utf8');
    await assert.rejects(updateTides({ ...options, output, fetchImpl: async () => new Response('{}') }));
    await assert.rejects(atomicSave({ error: 'bad' }, output));
    assert.equal(await readFile(output, 'utf8'), before);
    await updateTides({ ...options, now: new Date('2026-01-19T20:00:00Z'), output });
    assert.notEqual(await readFile(output, 'utf8'), before);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bootstrap, artifact expiry, failed deployment backup, ordinary push and manual rerun recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'khoa-test-'));
  try {
    const output = join(dir, 'latest.json');
    const artifactFile = join(dir, 'backup.json');
    assert.equal(await recoverTides({ output, artifactFile }), false); // bootstrap required
    const snapshot = await fixture();
    await atomicSave(snapshot, artifactFile);
    assert.equal(await recoverTides({ output, artifactFile }), true); // ordinary push, no key
    assert.equal(await readFile(output, 'utf8'), await readFile(artifactFile, 'utf8'));
    await rm(output); await rm(artifactFile);
    assert.equal(await recoverTides({ output, artifactFile, pagesUrl: 'https://example.test/data/tides/latest.json',
      fetchImpl: async () => new Response(JSON.stringify(snapshot)) }), true); // expired artifact
    await writeFile(artifactFile, '{invalid');
    const before = await readFile(output, 'utf8');
    assert.equal(await recoverTides({ output, artifactFile, pagesUrl: 'https://example.test/x',
      fetchImpl: async () => new Response('<html>error</html>') }), true); // existing good file
    assert.equal(await readFile(output, 'utf8'), before);
    await rm(output);
    assert.equal(await recoverTides({ output, artifactFile, pagesUrl: 'https://example.test/x',
      fetchImpl: async () => new Response('{}', { status: 503 }) }), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('recovery chooses newest validated snapshot; unknown fields, swapped stations and gaps are invalid', async () => {
  const snapshot = await fixture();
  assert.equal(tideFreshness(snapshot, now.getTime() + 37 * 3600000).stale, true);
  assert.equal(tideFreshness(snapshot, now.getTime()).stale, false);
  for (const mutate of [
    (s: any) => { s.serviceKey = 'do not publish'; },
    (s: any) => { s.stations.reverse(); },
    (s: any) => { s.stations[0].days.pop(); },
    (s: any) => { s.stations[0].days[0].events[0].heightCm = Infinity; },
    (s: any) => { s.generatedAt = '2099-01-01T00:00:00.000Z'; },
  ]) { const copy = structuredClone(snapshot); mutate(copy); assert.equal(validTideSnapshot(copy), false); }
  const dir = await mkdtemp(join(tmpdir(), 'khoa-test-'));
  try {
    const output = join(dir, 'latest.json');
    const artifactFile = join(dir, 'backup.json');
    const newer = (await collectTides({ ...options, now: new Date('2026-01-19T20:00:00Z') })).snapshot;
    await atomicSave(snapshot, output);
    await atomicSave(newer, artifactFile);
    assert.equal(await recoverTides({ output, artifactFile, pagesUrl: 'https://example.test/x',
      fetchImpl: async () => new Response(JSON.stringify(snapshot)) }), true);
    assert.equal(JSON.parse(await readFile(output, 'utf8')).generatedAt, newer.generatedAt);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a transient retry succeeds without multiplying all 64 requests', async () => {
  let attempts = 0;
  const result = await collectTides({ ...options, fetchImpl: async (url: URL) => {
    if (++attempts === 1) return new Response('', { status: 503 });
    const payload = upstream(url);
    payload.body.items.item[0].extrSe = 4 as any; // numeric form is also accepted
    return new Response(JSON.stringify(payload));
  } });
  assert.equal(result.calls, 65);
});

test('static client honors BASE_URL and exposes original generation time and stale coverage', async () => {
  const original = globalThis.fetch;
  const snapshot = await fixture();
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(input, '/badakkomkkomi/data/tides/latest.json');
      assert.equal(init?.cache, 'no-store');
      return new Response(JSON.stringify(snapshot));
    };
    const value = await fetchKhoaTides('/badakkomkkomi/');
    assert.equal(value.freshness.generatedAt, snapshot.generatedAt);
    assert.equal(value.freshness.from, '2026-01-19');
    assert.equal(value.freshness.stale, true);
    globalThis.fetch = async () => new Response('{}');
    await assert.rejects(fetchKhoaTides('/badakkomkkomi/'));
  } finally { globalThis.fetch = original; }
});

test('serialized Workbox plugin retains last valid response on errors and rejects CDN regression', async () => {
  const snapshot = await fixture();
  let saved: Response | undefined;
  const original = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: { open: async () => ({ match: async () => saved?.clone() }) } });
  try {
    // Emulate the same serialization used by workbox-build.
    const plugin = createTideCachePlugin();
    const succeed = new Function(`return (${plugin.fetchDidSucceed!.toString()})`)();
    const cached = new Function(`return (${plugin.cachedResponseWillBeUsed!.toString()})`)();
    const request = new Request('https://example.test/app/data/tides/latest.json?v=1');
    saved = await succeed({ request, response: new Response(JSON.stringify(snapshot)) });
    for (const response of [new Response('{}'), new Response('<html>error</html>'), new Response('', { status: 503 })]) {
      await assert.rejects(succeed({ request, response }));
      assert.ok(await cached({ cachedResponse: saved }));
    }
    const older = (await collectTides({ ...options, now: new Date('2026-01-17T20:00:00Z') })).snapshot;
    const result = await succeed({ request, response: new Response(JSON.stringify(older)) });
    assert.equal((await result.json()).generatedAt, snapshot.generatedAt);
    assert.equal(await cached({ cachedResponse: new Response('{}') }), null);
    assert.equal(await cached({ cachedResponse: undefined }), null);
    const key = await (plugin.cacheKeyWillBeUsed as Function)({ request });
    assert.equal(key, 'https://example.test/app/data/tides/latest.json');
  } finally {
    if (original) Object.defineProperty(globalThis, 'caches', original);
    else Reflect.deleteProperty(globalThis, 'caches');
  }
});

test('workflow guards bootstrap, push inheritance, successful backup provenance and deployment races', async () => {
  const yaml = await readFile('.github/workflows/deploy-pages.yml', 'utf8');
  assert.match(yaml, /cron: '17 19 \* \* \*'/);
  assert.match(yaml, /cancel-in-progress: false/);
  assert.doesNotMatch(yaml, /contents: write|git push|git commit/);
  const credentialSteps = yaml.split(/\r?\n      - name:/).filter(step => step.includes('secrets.KHOA_SERVICE_KEY'));
  assert.equal(credentialSteps.length, 2);
  assert.ok(credentialSteps.some(step => step.includes('node scripts/update-khoa-tides.mjs')));
  assert.ok(credentialSteps.some(step => step.includes('node scripts/collect-khoa-tide-series.mjs')));
  assert.match(yaml, /github\.event_name != 'push' \|\| steps\.recovery\.outputs\.restored != 'true'/);
  assert.match(yaml, /run\.conclusion !== 'success'/);
  assert.match(yaml, /data\.commit\.sha !== process\.env\.CHECKED_OUT_SHA/);
  assert.ok(yaml.indexOf('Require validated tide data') < yaml.indexOf('Upload Pages artifact'));
  assert.ok(yaml.indexOf('Preserve successfully deployed tide snapshot') > yaml.search(/- name: Deploy to GitHub Pages\r?\n/));
});

test('actual workflow scripts reject failed/foreign artifacts and superseded reruns', async () => {
  const lines = (await readFile('.github/workflows/deploy-pages.yml', 'utf8')).split(/\r?\n/);
  const scripts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '          script: |') continue;
    let source = '';
    while (++i < lines.length && (lines[i].startsWith('            ') || !lines[i].trim())) source += `${lines[i].slice(12)}\n`;
    scripts.push(source);
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const outputs: Record<string, string> = {};
  const artifact = (id: number, branch = 'main') => ({ id, name: `khoa-tides-${id}-1`, expired: false, workflow_run: { id, head_branch: branch } });
  const github = { rest: { actions: {
    listArtifactsForRepo: async () => ({ data: { artifacts: [artifact(1, 'other'), artifact(2), artifact(3), artifact(4)] } }),
    getWorkflowRun: async ({ run_id }: {run_id: number}) => ({ data: { id: run_id, conclusion: run_id === 2 ? 'failure' : 'success',
      path: run_id === 3 ? '.github/workflows/foreign.yml' : '.github/workflows/deploy-pages.yml', event: 'schedule' } }),
  }, repos: { getBranch: async () => ({ data: { commit: { sha: 'new-main' } } }) } } };
  let failed = false;
  const core = { setOutput: (name: string, value: string) => { outputs[name] = value; }, setFailed: () => { failed = true; } };
  const backupScript = scripts.find(source => source.includes('khoa-tides-'))!;
  const revisionScript = scripts.find(source => source.includes('repos.getBranch'))!;
  await new AsyncFunction('github', 'context', 'core', backupScript)(github, { repo: {} }, core);
  assert.deepEqual(outputs, { id: '4', run: '4' });
  await new AsyncFunction('github', 'context', 'core', 'process', revisionScript)(github, { repo: {} }, core, { env: { CHECKED_OUT_SHA: 'original-rerun-sha' } });
  assert.equal(failed, true);
  failed = false;
  await new AsyncFunction('github', 'context', 'core', 'process', revisionScript)(github, { repo: {} }, core, { env: { CHECKED_OUT_SHA: 'new-main' } });
  assert.equal(failed, false);
});
