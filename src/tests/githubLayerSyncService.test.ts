import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import type { TestContext } from 'node:test';
import {
  commitLayersToGitHubRepository,
  loadGitHubSyncConfig,
  saveGitHubSyncConfig,
} from '../services/githubLayerSyncService.ts';
import type { AppConfig } from '../types/config.ts';

function useMemoryStorage(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => items.set(key, value),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
}

function useOnlineNavigator(t: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { onLine: true },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
}

const baseAppConfig = JSON.parse(
  readFileSync(
    new URL('../../public/config/app_config.json', import.meta.url), 'utf8',
  ),
) as AppConfig;

const customConfig = {
  owner: 'custom-owner',
  repo: 'custom-repo',
  branch: 'operations',
  token: 'test-only-credential',
  autoCommitOnSave: true,
};

const syncParams = {
  baseAppConfig,
  layers: [],
  geoJsonById: {},
  releaseId: 'test-release',
  summary: 'test',
};

it('defaults to fiesta5155/main without credentials and preserves saved repository settings', (t) => {
  useMemoryStorage(t);
  assert.deepEqual(loadGitHubSyncConfig(), {
    owner: 'fiesta5155', repo: 'badakkomkkomi', branch: 'main',
    token: '', autoCommitOnSave: false,
  });
  saveGitHubSyncConfig(customConfig);
  assert.deepEqual(loadGitHubSyncConfig(), customConfig);

  // 명시적으로 저장한 구 저장소도 기본값 변경으로 덮어쓰지 않는다.
  const previousRepo = { ...customConfig, owner: 'gunnysis', repo: 'bada-kkomkkomi' };
  saveGitHubSyncConfig(previousRepo);
  assert.deepEqual(loadGitHubSyncConfig(), previousRepo);
});

it('does not send GitHub requests without a token or explicit automatic sync', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request');
  });
  for (const config of [
    { ...customConfig, token: '' },
    { ...customConfig, autoCommitOnSave: false },
  ]) {
    const result = await commitLayersToGitHubRepository({ ...syncParams, syncConfig: config });
    assert.equal(result.status, 'local_only');
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

it('syncs to the saved repository and branch with credentials only in request headers', async (t) => {
  useMemoryStorage(t);
  useOnlineNavigator(t);
  saveGitHubSyncConfig(customConfig);
  const responses = [
    { object: { sha: 'head-sha' } }, { tree: { sha: 'base-tree' } },
    { sha: 'new-tree' }, { sha: 'new-commit' }, {},
  ];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () =>
    Response.json(responses.shift()),
  );
  const result = await commitLayersToGitHubRepository(syncParams);
  assert.equal(result.status, 'synced');
  assert.equal(result.commitUrl, 'https://github.com/custom-owner/custom-repo/commit/new-commit');
  const calls = fetchMock.mock.calls;
  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map(({ arguments: [url] }) => url), [
    'https://api.github.com/repos/custom-owner/custom-repo/git/ref/heads/operations',
    'https://api.github.com/repos/custom-owner/custom-repo/git/commits/head-sha',
    'https://api.github.com/repos/custom-owner/custom-repo/git/trees',
    'https://api.github.com/repos/custom-owner/custom-repo/git/commits',
    'https://api.github.com/repos/custom-owner/custom-repo/git/refs/heads/operations',
  ]);
  for (const { arguments: [url, options] } of calls) {
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${customConfig.token}`);
    assert.equal(String(url).includes(customConfig.token), false);
    assert.equal(String(options?.body).includes(customConfig.token), false);
  }
  assert.equal(JSON.parse(String(calls[4].arguments[1]?.body)).force, false);
  assert.equal(JSON.stringify(result).includes(customConfig.token), false);
});

it('redacts credentials from synchronization errors', async (t) => {
  useOnlineNavigator(t);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error(`request failed: ${customConfig.token}`);
  });
  const result = await commitLayersToGitHubRepository({ ...syncParams, syncConfig: customConfig });
  assert.equal(result.status, 'failed');
  assert.equal(result.message.includes(customConfig.token), false);
  assert.match(result.message, /\[REDACTED\]/);
});
