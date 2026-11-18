import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAFE_DEFAULT_THRESHOLDS, alignEcmwfWindAndWaveSeries, evaluateHourlyWeatherSeries, judgeSingleWeatherMetric, resolveEffectiveThresholds } from '../services/ecmwfWeatherService.ts';
import { readSavedUserThresholds, resetSavedUserThresholds, saveUserThresholds, STORAGE_KEY_THRESHOLDS } from '../services/weatherThresholdStorage.ts';

const legacy = { windKnot: { good: 14, moderate: 20 }, waveMeter: { good: 1, moderate: 1.8 } };
function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY_THRESHOLDS, initial]]);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('wind rounds to whole knots before inclusive upper-bound classification', () => {
  for (const [value, grade] of [[10, 'good'], [10.4, 'good'], [10.5, 'moderate'], [18, 'moderate'], [18.4, 'moderate'], [18.5, 'bad'], [19, 'bad']] as const) {
    assert.equal(judgeSingleWeatherMetric(value, SAFE_DEFAULT_THRESHOLDS.windKnot, 0), grade, String(value));
  }
});

test('waves round to tenths before inclusive upper-bound classification', () => {
  for (const [value, grade] of [[0.4, 'good'], [0.44, 'good'], [0.45, 'moderate'], [0.7, 'moderate'], [0.74, 'moderate'], [0.75, 'bad'], [0.8, 'bad']] as const) {
    assert.equal(judgeSingleWeatherMetric(value, SAFE_DEFAULT_THRESHOLDS.waveMeter, 1), grade, String(value));
  }
});

test('shared hourly grading rounds both metrics without mutating API or aligned values', () => {
  const times = ['2026-11-18T09:00', '2026-11-18T12:00', '2026-11-18T15:00'];
  const wind = [10.4, 18.4, 18.5];
  const wave = [0.44, 0.74, 0.75];
  const raw = alignEcmwfWindAndWaveSeries({ windTimes: times, windValues: wind, waveTimes: times, waveValues: wave, nowHourPrefix: '2026-11-18T09' });
  const before = structuredClone(raw);
  const result = evaluateHourlyWeatherSeries(raw, SAFE_DEFAULT_THRESHOLDS);
  assert.deepEqual(result.map(row => row.grade), ['good', 'moderate', 'bad']);
  assert.deepEqual(raw, before);
  assert.deepEqual(result.map(row => row.windSpeedKnots), wind);
  assert.deepEqual(result.map(row => row.waveHeightMeters), wave);
  for (const missing of [null, NaN, Infinity]) {
    assert.equal(judgeSingleWeatherMetric(missing, SAFE_DEFAULT_THRESHOLDS.windKnot), 'unknown');
    assert.equal(judgeSingleWeatherMetric(missing, SAFE_DEFAULT_THRESHOLDS.waveMeter, 1), 'unknown');
  }
});

test('custom criteria survive storage and re-entry, including an explicit new save of old standard values', () => {
  for (const custom of [legacy, { windKnot: { good: 12.5, moderate: 19.5 }, waveMeter: { good: 0.6, moderate: 1.1 } }]) {
    const storage = memoryStorage();
    saveUserThresholds(storage, custom);
    assert.deepEqual(readSavedUserThresholds(storage), custom);
    assert.deepEqual(resolveEffectiveThresholds(readSavedUserThresholds(storage)), custom);
    assert.equal(JSON.parse(storage.getItem(STORAGE_KEY_THRESHOLDS)!).criteriaVersion, 2);
  }
});

test('legacy standard and stale static defaults yield new defaults; legacy custom values and presets survive', () => {
  const staleConfig = { wind_threshold_knot: legacy.windKnot, wave_threshold_meter: legacy.waveMeter };
  const storage = memoryStorage(JSON.stringify(legacy));
  assert.equal(readSavedUserThresholds(storage), null);
  assert.deepEqual(resolveEffectiveThresholds(readSavedUserThresholds(storage), staleConfig), SAFE_DEFAULT_THRESHOLDS);
  for (const custom of [
    { windKnot: { good: 10, moderate: 15 }, waveMeter: { good: 0.7, moderate: 1.2 } },
    { windKnot: { good: 18, moderate: 25 }, waveMeter: { good: 1.5, moderate: 2.5 } },
    { windKnot: { good: 13, moderate: 17 }, waveMeter: { good: 0.3, moderate: 0.6 } },
  ]) assert.deepEqual(readSavedUserThresholds(memoryStorage(JSON.stringify(custom))), custom);
});

test('reset removes saved criteria and returns the confirmed common default after re-entry', () => {
  const storage = memoryStorage();
  saveUserThresholds(storage, legacy);
  resetSavedUserThresholds(storage);
  assert.equal(storage.getItem(STORAGE_KEY_THRESHOLDS), null);
  assert.deepEqual(resolveEffectiveThresholds(readSavedUserThresholds(storage)), { windKnot: { good: 10, moderate: 18 }, waveMeter: { good: 0.4, moderate: 0.7 } });
  const config = JSON.parse(readFileSync(new URL('../../public/config/app_config.json', import.meta.url), 'utf8'));
  assert.deepEqual(resolveEffectiveThresholds(null, config.weather_defaults), SAFE_DEFAULT_THRESHOLDS);
});

test('missing, corrupt, invalid and unavailable legacy storage fail safely', () => {
  for (const value of [undefined, '{', 'null', JSON.stringify({ windKnot: { good: 20, moderate: 10 } })]) {
    assert.equal(readSavedUserThresholds(memoryStorage(value)), null);
  }
  const denied = { getItem: () => { throw new Error('denied'); }, setItem: () => {}, removeItem: () => {} };
  assert.equal(readSavedUserThresholds(denied), null);
});
