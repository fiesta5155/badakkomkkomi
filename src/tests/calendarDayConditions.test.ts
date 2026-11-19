import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CALENDAR_NOON_PROVENANCE, CALENDAR_TIDE_STATIONS, createCalendarDayStore, EMPTY_NOON, fetchNoonWeather, noonWeatherUrls, parseNoonWeather, windCompass } from '../services/calendarDayConditions.ts';
import type { TideSnapshot } from '../services/khoaTideSchema.ts';

const today = '2026-01-19';
function payload() {
  return { utc_offset_seconds: 32400, hourly: {
    time: [`${today}T11:00`, `${today}T12:00`, `${today}T13:00`, '2026-01-20T12:00'],
    weather_code: [0, 61, 3, 1], temperature_2m: [3, -2, 4, 5], wind_direction_10m: [0, 337.5, 180, 90],
    wind_speed_10m: [1, 2.5, 4, 0], wave_height: [1, 0.4, 3, 0], precipitation: [9, 1.7, 8, 0], precipitation_probability: [10, 77, 20, 0],
  }, hourly_units: { weather_code: 'wmo code', temperature_2m: '°C', wind_direction_10m: '°', wind_speed_10m: 'm/s', wave_height: 'm', precipitation: 'mm', precipitation_probability: '%' } };
}
const snapshot = {
  schemaVersion: 1, source: 'KHOA', generatedAt: '2026-01-19T00:00:00.000Z', unit: 'cm',
  stations: [
    { code: 'DT_0014', name: '통영', days: [{ date: today, events: [
      { time: '04:00', kind: 'high', heightCm: 120, extrSe: 1 },
      { time: '10:00', kind: 'low', heightCm: 20, extrSe: 2 },
      { time: '16:00', kind: 'high', heightCm: 130, extrSe: 3 },
    ] }] },
    { code: 'SO_0552', name: '고현항', days: [{ date: today, events: [
      { time: '04:10', kind: 'high', heightCm: 100, extrSe: 1 },
      { time: '10:10', kind: 'low', heightCm: 10, extrSe: 2 },
      { time: '16:10', kind: 'high', heightCm: 110, extrSe: 3 },
      { time: '22:10', kind: 'low', heightCm: 0, extrSe: 4 },
    ] }] },
  ],
} as TideSnapshot;

test('detail URLs fix IFS/WAM, KST, m/s, mm and 15-day range while locations follow existing regions', () => {
  const urls = noonWeatherUrls('tongyeong');
  const ifs = new URL(urls.atmosphere), wam = new URL(urls.wave);
  assert.equal(ifs.searchParams.get('models'), 'ecmwf_ifs');
  assert.equal(wam.searchParams.get('models'), 'ecmwf_wam');
  assert.equal(ifs.searchParams.get('wind_speed_unit'), 'ms');
  assert.equal(ifs.searchParams.get('precipitation_unit'), 'mm');
  for (const url of [ifs, wam]) {
    assert.equal(url.searchParams.get('timezone'), 'Asia/Seoul');
    assert.equal(url.searchParams.get('forecast_days'), '15');
    assert.equal(url.searchParams.has('past_days'), false);
  }
  assert.notEqual(urls.atmosphere, noonWeatherUrls('geoje').atmosphere);
  assert.equal(CALENDAR_NOON_PROVENANCE.probability, 'ecmwf_ifs_ensemble_0.25');
  assert.equal(CALENDAR_NOON_PROVENANCE.precipitationInterval, '11:00–12:00 Asia/Seoul');
  assert.deepEqual(CALENDAR_TIDE_STATIONS, { tongyeong: 'DT_0014', geoje: 'SO_0552' });
});

test('exact noon keys join weather and waves; rainfall stays at 12:00, not 11:00 or 13:00', () => {
  const data = payload();
  const atmosphere = parseNoonWeather(data, 'atmosphere', today);
  assert.deepEqual(atmosphere[today], { code: 61, temperature: -2, direction: 337.5, speed: 2.5, precipitation: 1.7, probability: 77 });
  data.hourly.time.reverse(); data.hourly.wave_height.reverse();
  assert.deepEqual(parseNoonWeather(data, 'wave', today)[today], { wave: 0.4 });
  assert.equal(atmosphere['2026-01-20'].precipitation, 0);
});

test('partial, nonnumeric, out-of-range or wrong-unit variables are missing independently', () => {
  const data: any = payload();
  data.hourly.temperature_2m[1] = null;
  data.hourly.wind_speed_10m[1] = '2.5';
  data.hourly.precipitation_probability[1] = 101;
  data.hourly.wind_direction_10m[1] = 400;
  data.hourly_units.precipitation = 'inch';
  assert.deepEqual(parseNoonWeather(data, 'atmosphere', today)[today],
    { code: 61, temperature: null, direction: null, speed: null, precipitation: null, probability: null });
  data.hourly.weather_code.pop();
  assert.equal(parseNoonWeather(data, 'atmosphere', today)[today].code, null);
  assert.deepEqual(parseNoonWeather({ ...data, hourly: { time: [] } }, 'wave', today), {});
  assert.throws(() => parseNoonWeather({ ...data, utc_offset_seconds: 0 }, 'wave', today));
  assert.throws(() => parseNoonWeather({ ...data, error: true }, 'wave', today));
});

test('duplicate noon dates and past/out-of-range dates never receive a substituted forecast', () => {
  const data = payload();
  data.hourly.time[0] = `${today}T12:00`;
  assert.equal(parseNoonWeather(data, 'atmosphere', today)[today], undefined);
  data.hourly.time = ['2026-01-18T12:00', '2026-02-03T12:00', '2026-02-30T12:00', '2026-02-02T12:00'];
  assert.deepEqual(Object.keys(parseNoonWeather(data, 'atmosphere', today)), ['2026-02-02']);
});

test('network error cannot masquerade as weather; request uses no-store and an abort signal', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
      return new Response(JSON.stringify(payload()));
    };
    assert.equal((await fetchNoonWeather('tongyeong', 'atmosphere', today))[today].probability, 77);
    globalThis.fetch = async () => new Response('{}', { status: 503 });
    await assert.rejects(fetchNoonWeather('geoje', 'wave', today));
    globalThis.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(fetchNoonWeather('geoje', 'wave', today));
  } finally { globalThis.fetch = original; }
});

test('tides load once across dates, regions and concurrent re-entry; 3/4 events are retained', async () => {
  let tideCalls = 0, weatherCalls = 0;
  const store = createCalendarDayStore({ now: () => Date.parse(`${today}T00:00Z`),
    tides: async () => { tideCalls++; return { snapshot }; },
    weather: async (_region, source) => { weatherCalls++; return parseNoonWeather(payload(), source, today); } });
  await Promise.all([store.ensure('tongyeong', today), store.ensure('tongyeong', today), store.ensure('tongyeong', '2026-01-20')]);
  assert.equal(tideCalls, 1); assert.equal(weatherCalls, 2);
  assert.equal(store.events('tongyeong', today).length, 3);
  await store.ensure('geoje', today);
  assert.equal(tideCalls, 1); assert.equal(weatherCalls, 4);
  assert.equal(store.events('geoje', today).length, 4);
  assert.equal(store.events('geoje', '2026-02-20').length, 0);
  assert.equal(store.noon('geoje', today).probability, 77);
  assert.deepEqual(store.noon('geoje', '2025-12-01'), EMPTY_NOON);
  assert.deepEqual(store.noon('geoje', '2026-02-03'), EMPTY_NOON);
});

test('only failed source retries after five minutes; successful source remains reusable', async () => {
  let clock = Date.parse(`${today}T00:00Z`), atmosphere = 0, wave = 0;
  const store = createCalendarDayStore({ now: () => clock, tides: async () => ({ snapshot }), weather: async (_r, source) => {
    if (source === 'wave') { wave++; throw new Error('offline'); }
    atmosphere++; return parseNoonWeather(payload(), source, today);
  } });
  await store.ensure('tongyeong', today);
  assert.equal(store.noon('tongyeong', today).temperature, -2);
  assert.equal(store.noon('tongyeong', today).wave, null);
  await store.ensure('tongyeong', today); assert.equal(wave, 1);
  clock += 5 * 60000;
  await store.ensure('tongyeong', today); assert.equal(wave, 2); assert.equal(atmosphere, 1);
  clock += 3 * 3600000;
  assert.deepEqual(store.noon('tongyeong', today), EMPTY_NOON);
  await store.ensure('tongyeong', today); assert.equal(atmosphere, 2);
});

test('late old-region response cannot replace selected-region weather; tide failure retains good data', async () => {
  let clock = Date.parse(`${today}T00:00Z`), tideCalls = 0;
  let finish: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const store = createCalendarDayStore({ now: () => clock, tides: async () => { if (++tideCalls > 1) throw new Error(); return { snapshot }; },
    weather: async (r, source) => { if (r === 'tongyeong') await gate; return { [today]: source === 'wave' ? { wave: r === 'geoje' ? 0.9 : 0.1 } : { temperature: r === 'geoje' ? 15 : 3 } }; } });
  const first = store.ensure('tongyeong', today);
  await store.ensure('geoje', today);
  assert.equal(store.noon('geoje', today).temperature, 15);
  finish!(); await first;
  assert.equal(store.noon('geoje', today).temperature, 15);
  assert.equal(store.noon('tongyeong', today).temperature, 3);
  clock += 86400000;
  await store.ensure('geoje', '2026-01-20');
  assert.equal(store.events('geoje', today).length, 4);
});

test('past/far-future details do not trigger weather calls and wind compass handles null/north', async () => {
  let calls = 0;
  const store = createCalendarDayStore({ now: () => Date.parse(`${today}T00:00Z`), tides: async () => ({ snapshot }), weather: async () => { calls++; return {}; } });
  await store.ensure('tongyeong', '2026-01-18'); await store.ensure('geoje', '2026-03-01');
  assert.equal(calls, 0);
  assert.equal(windCompass(360), '북'); assert.equal(windCompass(337.5), '북북서');
  assert.equal(windCompass(null), '—'); assert.equal(windCompass(-1), '—');
});

test('integration lives only between detail heading and voyage status; monthly markup stays isolated', async () => {
  const screen = await readFile('src/components/calendar/CalendarScreen.tsx', 'utf8');
  const detail = screen.indexOf("{view === 'detail' &&");
  const card = screen.indexOf('<CalendarDetailConditions region={region} date={selectedDate} dateLabel={fullDateLabel(selectedDate)} vessel={vessel} />');
  assert.ok(card > detail && card < screen.indexOf('>운항 상태</h3>', detail));
  assert.equal((screen.match(/<CalendarDetailConditions/g) ?? []).length, 1);
  assert.equal(screen.slice(screen.indexOf("{view === 'month' &&"), detail).includes('CalendarDetailConditions'), false);
});
