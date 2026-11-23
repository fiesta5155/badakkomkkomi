import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { validateWarningPair, selectWarningPublication, readWarningArtifact, readPublishedWarnings, prepareWarningPublication } from '../../scripts/prepare-navigational-warnings.mjs';

const seed = JSON.parse(readFileSync(new URL('../../public/data/navigational-warnings/latest.json', import.meta.url), 'utf8'));
const at = '2026-11-23T03:00:00Z';
const old = '2026-11-23T01:00:00Z';
const encode = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
function pair(time: string | null = at, count = 1, status = 'success', attemptAt: string | null = time) {
  const snapshot = { ...seed, lastSuccessfulAt: time, generatedAt: time, documents: Array.from({ length: count }, (_, i) => ({
    docNum: `unit-${i}`, issuedAt: null, observations: [{ queryDate: '20261123', raw: { doc_num: `unit-${i}`, area: '1', title: 'unit fixture', content: 'original\ncontent' } }],
    areas: [{ raw: { doc_num: `unit-${i}`, area: '1', position: '원문', alarm_date: '2026-11-23,', alarm_time: '08:00 ~ 18:00,' }, coordinates: { geometry: null, datum: null } }],
  })) };
  return { snapshot, status: { schemaVersion: 1, status, lastSuccessfulAt: time, lastAttemptAt: attemptAt } };
}
const emptySeed = () => pair(null, 0, 'not_collected');
const published = (value = pair(old)) => ({ state: 'valid', pair: value });
const prepare = (artifact: ReturnType<typeof pair> | null, baseline = pair(old)) => selectWarningPublication({ published: published(baseline), artifact, seed: emptySeed(), now: new Date(at), sourceRunId: '123', sourceRunAttempt: 2 });

test('publication keeps v1 originals, adds a pair hash, and never fabricates completed deployment', () => {
  const artifact = pair(); const before = structuredClone(artifact);
  const result = prepare(artifact);
  assert.deepEqual(result.snapshot, artifact.snapshot); assert.deepEqual(artifact, before);
  assert.equal(result.status.publication.state, 'ready');
  assert.equal(result.status.publication.collectionRunId, '123');
  assert.equal(result.status.publication.snapshotSha256, createHash('sha256').update(encode(result.snapshot)).digest('hex'));
  assert.equal(result.status.publication.deployedAt, undefined);
  assert.doesNotThrow(() => validateWarningPair(encode(result.snapshot), encode(result.status)));
  assert.throws(() => validateWarningPair(encode({ ...result.snapshot, generatedAt: old }), encode(result.status)));
});
test('successful empty collection replaces records; never-collected seed stays a different state', () => {
  const result = prepare(pair(at, 0));
  assert.equal(result.snapshot.documents.length, 0); assert.equal(result.status.status, 'success');
  assert.equal(result.snapshot.lastSuccessfulAt, at);
  const bootstrap = selectWarningPublication({ published: { state: 'absent' }, artifact: null, seed: emptySeed() });
  assert.equal(bootstrap.snapshot.lastSuccessfulAt, null); assert.equal(bootstrap.status.status, 'not_collected');
  assert.equal(bootstrap.status.publication.state, 'delayed');
});
test('failed collection retains newest published normal data even if collector backup was older', () => {
  const retained = pair('2026-11-23T02:00:00Z');
  const result = prepare(pair(old, 1, 'failed', at), retained);
  assert.deepEqual(result.snapshot, retained.snapshot); assert.equal(result.status.status, 'failed');
  assert.equal(result.status.lastSuccessfulAt, retained.snapshot.lastSuccessfulAt);
  assert.equal(result.status.publication.state, 'ready');
});
test('failed initial collection without normal data is not normal zero', () => {
  const result = prepare(pair(null, 0, 'failed', at), emptySeed());
  assert.equal(result.status.status, 'failed'); assert.equal(result.snapshot.lastSuccessfulAt, null);
});
test('missing artifact preserves baseline and marks delivery delay without inventing API failure', () => {
  const result = prepare(null);
  assert.deepEqual(result.snapshot, pair(old).snapshot); assert.equal(result.status.status, 'success');
  assert.equal(result.status.publication.state, 'delayed'); assert.equal(result.status.publication.reason, 'artifact_unavailable');
});
test('superseded artifact cannot roll data or a newer failure status backward', () => {
  const baseline = pair(at, 1, 'failed', '2026-11-23T04:00:00Z');
  const result = prepare(pair(old), baseline);
  assert.deepEqual(result.snapshot, baseline.snapshot); assert.equal(result.status.status, 'failed');
  assert.equal(result.status.publication.reason, 'superseded_artifact');
});
test('unavailable published baseline blocks all replacement, including a seemingly valid artifact', () => {
  assert.throws(() => selectWarningPublication({ published: { state: 'unavailable' }, artifact: pair(), seed: emptySeed() }));
});
test('Pages recovery respects subpath, explicit absence, corrupt/mixed pairs and HTTP failure', async () => {
  const baseline = pair(old), urls: string[] = [];
  const result = await readPublishedWarnings('https://owner.github.io/badakkomkkomi', async (url: URL, init: RequestInit) => {
    urls.push(url.pathname); assert.equal(init.cache, 'no-store'); assert.ok(url.searchParams.has('revalidate'));
    return new Response(encode(url.pathname.endsWith('latest.json') ? baseline.snapshot : baseline.status));
  });
  assert.equal(result.state, 'valid'); assert.deepEqual(urls, ['/badakkomkkomi/data/navigational-warnings/latest.json', '/badakkomkkomi/data/navigational-warnings/status.json']);
  assert.equal((await readPublishedWarnings('http://owner.test', () => assert.fail('HTTPS required'))).state, 'unavailable');
  assert.equal((await readPublishedWarnings('https://owner.test/', async () => new Response('', { status: 404 }))).state, 'absent');
  assert.equal((await readPublishedWarnings('https://owner.test/', async () => new Response('', { status: 503 }))).state, 'unavailable');
  assert.equal((await readPublishedWarnings('https://owner.test/', async () => new Response('{}'))).state, 'unavailable');
  assert.equal((await readPublishedWarnings('https://owner.test/', async (url: URL) => url.pathname.endsWith('latest.json') ? new Response(encode(baseline.snapshot)) : new Response('', { status: 404 }))).state, 'unavailable');
});
test('missing, damaged and expired/unavailable local artifacts safely fall back; tides remain untouched', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-publication-'));
  try {
    const output = path.join(directory, 'warnings'), artifact = path.join(directory, 'artifact');
    await mkdir(output); await mkdir(artifact);
    await writeFile(path.join(directory, 'tides.json'), 'preserved tide bytes');
    const baseline = pair(old);
    for (const name of ['latest', 'status']) await writeFile(path.join(output, name + '.json'), encode(emptySeed()[name === 'latest' ? 'snapshot' : 'status']));
    assert.equal(await readWarningArtifact(artifact), null);
    await writeFile(path.join(artifact, 'latest.json'), 'damaged'); await writeFile(path.join(artifact, 'status.json'), '{}');
    assert.equal(await readWarningArtifact(artifact), null);
    const result = await prepareWarningPublication({ outputDirectory: output, artifactDirectory: artifact, pagesUrl: 'https://owner.test/badakkomkkomi/',
      fetcher: async (url: URL) => new Response(encode(url.pathname.endsWith('latest.json') ? baseline.snapshot : baseline.status)) });
    assert.equal(result.publication, 'delayed');
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8')), baseline.snapshot);
    assert.equal(await readFile(path.join(directory, 'tides.json'), 'utf8'), 'preserved tide bytes');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('network failure leaves existing output bytes intact instead of bootstrapping zeros', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bada-publication-'));
  try {
    const normal = pair(old);
    await writeFile(path.join(directory, 'latest.json'), encode(normal.snapshot));
    await writeFile(path.join(directory, 'status.json'), encode(normal.status));
    const before = await readFile(path.join(directory, 'latest.json'), 'utf8');
    await assert.rejects(prepareWarningPublication({ outputDirectory: directory, pagesUrl: 'https://owner.test/', fetcher: async () => { throw Error('no network'); } }));
    assert.equal(await readFile(path.join(directory, 'latest.json'), 'utf8'), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('one Pages entry point serializes all events and never collects tides for warning events', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  const collector = readFileSync(new URL('../../.github/workflows/collect-navigational-warnings.yml', import.meta.url), 'utf8');
  assert.equal((workflow.match(/uses: actions\/deploy-pages@/g) ?? []).length, 1);
  assert.match(workflow, /group: 'pages'\s+cancel-in-progress: false/);
  assert.match(workflow, /workflow_run:[\s\S]*types: \[completed\]/);
  assert.match(workflow, /if: github.event_name != 'workflow_run' && \(github.event_name != 'push'/);
  assert.match(workflow, /head_repository.full_name == github.repository/);
  assert.match(workflow, /eventRun.run_attempt/);
  assert.match(collector, /cron: '23 \* \* \* \*'/);
  assert.match(collector, /secrets.KHOA_NAV_WARNING_SERVICE_KEY/);
  assert.ok(!collector.includes('actions/deploy-pages'));
});

test('actual workflow selector rejects forks, PRs, expired attempts and spoofed artifact names', async () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  const block = workflow.slice(workflow.indexOf('      - name: Find trusted navigational'), workflow.indexOf('      - name: Download navigational'));
  const script = block.slice(block.indexOf('          script: |') + '          script: |'.length).split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = { id: 100, path: '.github/workflows/collect-navigational-warnings.yml', head_branch: 'main', status: 'completed', event: 'schedule', run_attempt: 2 };
  const invoke = async ({ fork = false, event = 'schedule', expired = false, attempt = 2, push = false } = {}) => {
    const outputs: Record<string, string> = {}; const errors: string[] = [];
    const context = { repo: { owner: 'owner', repo: 'repo' }, eventName: push ? 'push' : 'workflow_run', payload: { workflow_run: { id: 100, run_attempt: attempt, head_repository: { full_name: fork ? 'fork/repo' : 'owner/repo' } } } };
    const github = { rest: { actions: {
      getWorkflowRun: async () => ({ data: { ...run, event } }),
      listWorkflowRunArtifacts: async () => ({ data: { artifacts: [{ id: 1, name: 'khoa-navigation-100-1', expired: false }, { id: 2, name: 'khoa-navigation-100-2', expired }] } }),
      listArtifactsForRepo: async () => ({ data: { artifacts: [{ id: 99, name: 'khoa-navigation-100-2', expired: false, workflow_run: { id: 200, head_branch: 'main' } }, { id: 2, name: 'khoa-navigation-100-2', expired: false, workflow_run: { id: 100, head_branch: 'main' } }] } }),
    } } };
    await new AsyncFunction('github', 'core', 'context', script)(github, { setOutput: (key: string, value: string) => { outputs[key] = value; }, setFailed: (error: string) => errors.push(error) }, context);
    return { outputs, rejected: errors.length > 0 };
  };
  assert.equal((await invoke()).outputs.id, '2');
  assert.equal((await invoke({ fork: true })).rejected, true);
  assert.equal((await invoke({ event: 'pull_request' })).rejected, true);
  assert.equal((await invoke({ expired: true })).outputs.id, undefined);
  assert.equal((await invoke({ attempt: 1 })).rejected, true);
  assert.equal((await invoke({ push: true })).outputs.id, '2');
});

function workflowGuard(file: string, step: string) {
  const workflow = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const block = workflow.slice(workflow.indexOf(`      - name: ${step}`));
  const code = block.match(/node --input-type=module <<'NODE'\n([\s\S]*?)^          NODE/m)?.[1];
  assert.ok(code, 'The actual workflow guard must be present');
  return code.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n').replace(/^import .*;$/gm, '');
}

test('collector workflow fails missing-key skips instead of reporting a successful collection', async () => {
  const code = workflowGuard('collect-navigational-warnings.yml', 'Collect official XML');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const status of ['not_configured', 'not_collected', 'failed', 'success']) {
    const process = { exitCode: 0 }; const errors: string[] = [];
    await new AsyncFunction('readFile', 'process', 'console', code)(async () => JSON.stringify({ status }), process, { error: (s: string) => errors.push(s) });
    assert.equal(process.exitCode, status === 'success' ? 0 : 1);
    if (status === 'not_configured') assert.match(errors[0], /KHOA_NAV_WARNING_SERVICE_KEY/);
  }
});

test('Pages workflow blocks missing, invalid and unconfigured collection artifacts before preparation', async () => {
  const code = workflowGuard('deploy-pages.yml', 'Prepare complete warning data');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const status of [null, 'not_configured', 'not_collected', 'failed', 'success']) {
    const process = { env: { NAV_WARNING_REQUIRE_ARTIFACT: 'true', NAV_WARNING_ARTIFACT_DIR: '/isolated' }, exitCode: 0 };
    await new AsyncFunction('readWarningArtifact', 'process', 'console', code)(async () => status && { status: { status } }, process, { error: () => {} });
    assert.equal(process.exitCode, status === 'failed' || status === 'success' ? 0 : 1);
  }
  const process = { env: { NAV_WARNING_REQUIRE_ARTIFACT: 'false' }, exitCode: 0 };
  await new AsyncFunction('readWarningArtifact', 'process', 'console', code)(async () => { throw Error('bootstrap must not require an artifact'); }, process, { error: () => {} });
  assert.equal(process.exitCode, 0);
});

test('downloaded missing-key artifact is not a normal zero-warning collection', () => {
  const skipped = pair(null, 0, 'not_configured', at);
  const parsed = validateWarningPair(encode(skipped.snapshot), encode(skipped.status));
  assert.equal(parsed.snapshot.lastSuccessfulAt, null);
  assert.equal(parsed.status.status, 'not_configured');
  const empty = pair(at, 0);
  assert.equal(validateWarningPair(encode(empty.snapshot), encode(empty.status)).snapshot.lastSuccessfulAt, at);
});
