import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALENDAR_WEATHER_REFRESH_MS, CALENDAR_WEATHER_RETRY_MS, calendarWeatherCacheKey, createCalendarWeatherStore, parseWeatherCache, weatherRefreshDue } from '../services/calendarWeatherCache.ts';
import type { CalendarWeatherCache } from '../services/calendarWeatherCache.ts';

const start = Date.parse('2026-11-17T01:00:00Z');
function cache(at = start): CalendarWeatherCache {
  return { version: 1, model: 'ecmwf_ifs', region: 'tongyeong', savedAt: at, forecastReferenceAt: at,
    referenceKind: 'request-start', values: { '2026-11-17': 0, '2026-11-18': 63 } };
}
function memoryStorage(initial?: CalendarWeatherCache) {
  const values = new Map<string, string>();
  if (initial) values.set(calendarWeatherCacheKey(initial.region), JSON.stringify(initial));
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('shows persisted exact date forecasts synchronously and skips fresh network requests', async () => {
  const storage = memoryStorage(cache());
  let requests = 0;
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => start + 1000,
    fetchWeather: async () => { requests++; return {}; } });
  const first = store.getSnapshot('tongyeong');
  assert.equal(first.cache?.values['2026-11-17'], 0);
  assert.equal(first.cache?.values['2026-11-19'], undefined);
  assert.equal(store.getSnapshot('geoje').cache, null);
  await store.refresh('tongyeong');
  assert.equal(requests, 0);
  assert.equal(store.getSnapshot('tongyeong'), first);
});

test('refreshes after three hours or the first KST visit of a new date, independently of login', () => {
  assert.equal(weatherRefreshDue(cache(), start + CALENDAR_WEATHER_REFRESH_MS - 1), false);
  assert.equal(weatherRefreshDue(cache(), start + CALENDAR_WEATHER_REFRESH_MS), true);
  const beforeMidnight = Date.parse('2026-11-17T14:59:00Z');
  assert.equal(weatherRefreshDue(cache(beforeMidnight), Date.parse('2026-11-17T15:00:00Z')), true);
  assert.equal(weatherRefreshDue(cache(), start - 1), true);
  assert.equal(weatherRefreshDue(null, start), true);
});

test('keeps icons during refresh, shares requests across re-entry, and records both timestamps', async () => {
  const storage = memoryStorage(cache());
  let now = start + CALENDAR_WEATHER_REFRESH_MS;
  const response = deferred<Record<string, number>>();
  let requests = 0;
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => now,
    fetchWeather: () => { requests++; return response.promise; } });
  let emissions = 0;
  const unsubscribe = store.subscribe('tongyeong', () => { emissions++; });
  const first = store.refresh('tongyeong');
  await Promise.resolve();
  assert.equal(store.getSnapshot('tongyeong').refreshing, true);
  assert.equal(store.getSnapshot('tongyeong').cache?.values['2026-11-17'], 0);
  unsubscribe();
  const same = store.refresh('tongyeong');
  assert.equal(first, same);
  const before = emissions;
  now += 4000;
  response.resolve({ '2026-11-17': 73 });
  await first;
  const latest = store.getSnapshot('tongyeong');
  assert.equal(requests, 1);
  assert.equal(emissions, before);
  assert.equal(latest.cache?.forecastReferenceAt, now - 4000);
  assert.equal(latest.cache?.savedAt, now);
  assert.equal(latest.cache?.values['2026-11-17'], 73);
  assert.equal(latest.cache?.values['2026-11-18'], undefined, 'do not retain a date absent in the successful new forecast');
  const reloaded = createCalendarWeatherStore({ storage: () => storage, now: () => now });
  assert.deepEqual(reloaded.getSnapshot('tongyeong').cache, latest.cache);
});

test('failed refresh preserves data and timestamps, marks error, and backs off for five minutes', async () => {
  const storage = memoryStorage(cache());
  const original = storage.getItem(calendarWeatherCacheKey('tongyeong'));
  let now = start + CALENDAR_WEATHER_REFRESH_MS;
  let requests = 0;
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => now,
    fetchWeather: async () => { requests++; throw new Error('network'); } });
  await store.refresh('tongyeong');
  assert.equal(store.getSnapshot('tongyeong').cache?.savedAt, start);
  assert.equal(store.getSnapshot('tongyeong').cache?.values['2026-11-17'], 0);
  assert.ok(store.getSnapshot('tongyeong').error);
  assert.equal(storage.getItem(calendarWeatherCacheKey('tongyeong')), original);
  await store.refresh('tongyeong');
  assert.equal(requests, 1);
  now += CALENDAR_WEATHER_RETRY_MS;
  await store.refresh('tongyeong');
  assert.equal(requests, 2);
});

test('region responses arriving in reverse order cannot replace each other', async () => {
  const tongyeong = deferred<Record<string, number>>(), geoje = deferred<Record<string, number>>();
  const memory = memoryStorage();
  const store = createCalendarWeatherStore({ storage: () => memory, now: () => start,
    fetchWeather: (region) => region === 'tongyeong' ? tongyeong.promise : geoje.promise });
  const a = store.refresh('tongyeong'), b = store.refresh('geoje');
  geoje.resolve({ '2026-11-17': 63 }); await b;
  tongyeong.resolve({ '2026-11-17': 0 }); await a;
  assert.equal(store.getSnapshot('geoje').cache?.values['2026-11-17'], 63);
  assert.equal(store.getSnapshot('tongyeong').cache?.values['2026-11-17'], 0);
  assert.notEqual(memory.getItem(calendarWeatherCacheKey('geoje')), memory.getItem(calendarWeatherCacheKey('tongyeong')));
});

test('cooperating tabs share an exclusive request and re-entry adopts updates missed while closed', async () => {
  const storage = memoryStorage();
  let requests = 0;
  let queue = Promise.resolve();
  const runExclusive = (_key: string, work: () => Promise<void>) => {
    queue = queue.then(work);
    return queue;
  };
  const options = { storage: () => storage, now: () => start, runExclusive,
    fetchWeather: async () => { requests++; return { '2026-11-17': 63 }; } };
  const a = createCalendarWeatherStore(options), b = createCalendarWeatherStore(options);
  await Promise.all([a.refresh('tongyeong'), b.refresh('tongyeong')]);
  assert.equal(requests, 1);
  assert.deepEqual(a.getSnapshot('tongyeong').cache, b.getSnapshot('tongyeong').cache);
  const updated = { ...cache(start + 1000), values: { '2026-11-17': 73 } };
  storage.setItem(calendarWeatherCacheKey('tongyeong'), JSON.stringify(updated));
  await a.refresh('tongyeong');
  assert.deepEqual(a.getSnapshot('tongyeong').cache, updated);
});

test('a late failed request does not mark a newer successful forecast as stale', async () => {
  const storage = memoryStorage();
  const response = deferred<Record<string, number>>();
  let now = start;
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => now, fetchWeather: () => response.promise });
  const pending = store.refresh('tongyeong');
  await Promise.resolve();
  now += 1000;
  store.receiveStorage('tongyeong', JSON.stringify(cache(now)));
  response.reject(new Error('old request failed')); await pending;
  assert.equal(store.getSnapshot('tongyeong').error, '');
  assert.equal(store.getSnapshot('tongyeong').cache?.savedAt, now);
});

test('timed-out requests preserve icons and release the pending request for a later retry', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let now = start + CALENDAR_WEATHER_REFRESH_MS;
  const store = createCalendarWeatherStore({ storage: () => memoryStorage(cache()), now: () => now,
    fetchWeather: (_region, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('timeout')))) });
  const first = store.refresh('tongyeong');
  await Promise.resolve();
  context.mock.timers.tick(15000);
  await first;
  assert.equal(store.getSnapshot('tongyeong').cache?.values['2026-11-17'], 0);
  assert.equal(store.getSnapshot('tongyeong').refreshing, false);
  now += CALENDAR_WEATHER_RETRY_MS;
  const next = store.refresh('tongyeong');
  assert.notEqual(next, first);
  await Promise.resolve(); context.mock.timers.tick(15000); await next;
});

test('an older response cannot overwrite newer data received from another tab', async () => {
  const storage = memoryStorage();
  const response = deferred<Record<string, number>>();
  let now = start;
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => now, fetchWeather: () => response.promise });
  const pending = store.refresh('tongyeong');
  await Promise.resolve();
  const newer = { ...cache(start + 5000), values: { '2026-11-17': 63 } };
  const raw = JSON.stringify(newer);
  storage.setItem(calendarWeatherCacheKey('tongyeong'), raw);
  store.receiveStorage('tongyeong', raw);
  now = start + 10000;
  response.resolve({ '2026-11-17': 0 }); await pending;
  assert.equal(storage.getItem(calendarWeatherCacheKey('tongyeong')), raw);
  assert.deepEqual(store.getSnapshot('tongyeong').cache, newer);
  store.receiveStorage('tongyeong', JSON.stringify(cache()));
  assert.deepEqual(store.getSnapshot('tongyeong').cache, newer);
});

test('storage failure retains a successful in-memory forecast and reports persistence failure', async () => {
  const store = createCalendarWeatherStore({ storage: () => { throw new Error('denied'); }, now: () => start,
    fetchWeather: async () => ({ '2026-11-17': 0 }) });
  await store.refresh('tongyeong');
  assert.equal(store.getSnapshot('tongyeong').cache?.values['2026-11-17'], 0);
  assert.equal(store.getSnapshot('tongyeong').storageError, true);
  assert.equal(store.getSnapshot('tongyeong').error, '');
  assert.equal(weatherRefreshDue(store.getSnapshot('tongyeong').cache, start), false);
});

test('corrupted, foreign-region, invalid-day and out-of-range caches are never displayed', () => {
  assert.equal(parseWeatherCache('{broken', 'tongyeong'), null);
  assert.equal(parseWeatherCache(JSON.stringify(cache()), 'geoje'), null);
  for (const extra of [{ values: { '2026-02-30': 0 } }, { values: { '2026-12-03': 0 } },
    { values: { '2026-11-16': 0 } }, { values: { '2026-11-17': null } }, { values: {} },
    { model: 'other' }, { savedAt: 0 }, { forecastReferenceAt: null }]) {
    assert.equal(parseWeatherCache(JSON.stringify({ ...cache(), ...extra }), 'tongyeong'), null);
  }
});

test('empty or invalid success payload cannot erase an existing cache', async () => {
  const storage = memoryStorage(cache());
  const store = createCalendarWeatherStore({ storage: () => storage, now: () => start + CALENDAR_WEATHER_REFRESH_MS,
    fetchWeather: async () => ({}) });
  await store.refresh('tongyeong');
  assert.deepEqual(store.getSnapshot('tongyeong').cache, cache());
  assert.ok(store.getSnapshot('tongyeong').error);
});
