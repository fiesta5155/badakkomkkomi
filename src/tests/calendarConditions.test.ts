import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCalendarWeather, tideNameForDate, weatherDescription } from '../components/calendar/calendarConditions.ts';

test('South Sea tide labels follow the published lunar eight-tide cycle', () => {
  assert.equal(tideNameForDate('2026-11-02'), '조금');
  assert.equal(tideNameForDate('2026-11-03'), '1물');
  assert.equal(tideNameForDate('2026-11-16'), '조금');
  assert.equal(tideNameForDate('2026-11-17'), '1물');
  assert.equal(tideNameForDate('2026-02-30'), null);
});

test('only recognized forecast codes produce calendar conditions', () => {
  assert.equal(weatherDescription(0), '맑음');
  assert.equal(weatherDescription(3), '흐림');
  assert.equal(weatherDescription(63), '비');
  assert.equal(weatherDescription(73), '눈');
  assert.equal(weatherDescription(999), null);
  assert.equal(weatherDescription(undefined as unknown as number), null);
});

test('weather lookup keeps only actual forecast days and changes coordinates by region', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ daily: { time: ['2026-11-17', '2026-11-18', '2026-11-19'], weather_code: [0, null, 73] } }), { status: 200 });
  };
  try {
    assert.deepEqual(await fetchCalendarWeather('tongyeong'), { '2026-11-17': 0, '2026-11-19': 73 });
    assert.deepEqual(await fetchCalendarWeather('geoje'), { '2026-11-17': 0, '2026-11-19': 73 });
    assert.ok(urls[0].includes('daily=weather_code'));
    assert.ok(urls[0].includes('models=ecmwf_ifs'));
    assert.notEqual(new URL(urls[0]).searchParams.get('longitude'), new URL(urls[1]).searchParams.get('longitude'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
