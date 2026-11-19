import { buildEcmwfWeatherUrls } from './ecmwfWeatherService.ts';
import { fetchKhoaTides } from './khoaTideService.ts';
import type { TideSnapshot } from './khoaTideSchema.ts';
import { koreaToday, validCalendarDate } from './sharedCalendarModel.ts';
import type { CalendarRegion } from '../components/calendar/calendarConditions.ts';

export const CALENDAR_NOON_PROVENANCE = {
  atmosphere: 'ecmwf_ifs', wave: 'ecmwf_wam',
  probability: 'ecmwf_ifs_ensemble_0.25',
  precipitationInterval: '11:00–12:00 Asia/Seoul',
} as const;
export const CALENDAR_TIDE_STATIONS = { tongyeong: 'DT_0014', geoje: 'SO_0552' } as const;
const LOCATIONS = { tongyeong: { lat: 34.8333, lng: 128.4333 }, geoje: { lat: 34.9, lng: 128.6167 } };
const HOURS = 3 * 3600000;
const RETRY = 5 * 60000;
const DAYS = 15;
export type NoonSource = 'atmosphere' | 'wave';
export interface NoonWeather {
  code: number | null; temperature: number | null; direction: number | null;
  speed: number | null; wave: number | null; precipitation: number | null; probability: number | null;
}
export const EMPTY_NOON: NoonWeather = { code: null, temperature: null, direction: null, speed: null, wave: null, precipitation: null, probability: null };
type NoonDays = Record<string, Partial<NoonWeather>>;
const variables = {
  code: ['weather_code', 'wmo code'], temperature: ['temperature_2m', '°C'],
  direction: ['wind_direction_10m', '°'], speed: ['wind_speed_10m', 'm/s'],
  precipitation: ['precipitation', 'mm'], probability: ['precipitation_probability', '%'], wave: ['wave_height', 'm'],
} as const;

export function noonWeatherUrls(region: CalendarRegion) {
  const { lat, lng } = LOCATIONS[region];
  const original = buildEcmwfWeatherUrls(lat, lng);
  const atmosphere = new URL(original.windForecastUrl);
  const wave = new URL(original.waveMarineUrl);
  atmosphere.searchParams.set('hourly', 'weather_code,temperature_2m,wind_direction_10m,wind_speed_10m,precipitation,precipitation_probability');
  atmosphere.searchParams.set('wind_speed_unit', 'ms');
  atmosphere.searchParams.set('temperature_unit', 'celsius');
  atmosphere.searchParams.set('precipitation_unit', 'mm');
  for (const url of [atmosphere, wave]) url.searchParams.set('forecast_days', String(DAYS));
  return { atmosphere: atmosphere.href, wave: wave.href };
}
function inForecastRange(date: string, today: string) {
  return validCalendarDate(date) && date >= today && date <= new Date(Date.parse(`${today}T00:00:00Z`) + (DAYS - 1) * 86400000).toISOString().slice(0, 10);
}
// A broken variable is missing independently; never shift arrays or substitute a
// neighbouring hour. 12:00 precipitation is the preceding hour's API sum.
export function parseNoonWeather(payload: unknown, source: NoonSource, today: string): NoonDays {
  const p = payload as { error?: boolean; utc_offset_seconds?: number; hourly?: Record<string, unknown>; hourly_units?: Record<string, unknown> };
  if (!p || p.error || p.utc_offset_seconds !== 32400 || !Array.isArray(p.hourly?.time)) throw new Error('Invalid noon weather response');
  const times = p.hourly.time;
  const result: NoonDays = {};
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  times.forEach((time, index) => {
    if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T12:00$/.test(time)) return;
    const date = time.slice(0, 10);
    if (!inForecastRange(date, today)) return;
    if (seen.has(date)) { duplicates.add(date); delete result[date]; return; }
    seen.add(date);
    const day: Partial<NoonWeather> = {};
    for (const key of Object.keys(variables) as (keyof NoonWeather)[]) {
      if ((key === 'wave') !== (source === 'wave')) continue;
      const [variable, unit] = variables[key];
      const values = p.hourly?.[variable];
      const value = Array.isArray(values) && values.length === times.length && p.hourly_units?.[variable] === unit ? values[index] : null;
      day[key] = typeof value === 'number' && Number.isFinite(value)
        && (key === 'temperature' || value >= 0)
        && (key !== 'direction' || value <= 360) && (key !== 'probability' || value <= 100)
        && (key !== 'code' || Number.isInteger(value)) ? value : null;
    }
    if (!duplicates.has(date)) result[date] = day;
  });
  return result;
}
export async function fetchNoonWeather(region: CalendarRegion, source: NoonSource, today: string): Promise<NoonDays> {
  const response = await fetch(noonWeatherUrls(region)[source], { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Noon weather unavailable');
  return parseNoonWeather(await response.json(), source, today);
}

interface Resource<T> { value: T | null; loadedAt: number; retryAt: number; pending?: Promise<void> }
const resource = <T>(): Resource<T> => ({ value: null, loadedAt: 0, retryAt: 0 });
export function createCalendarDayStore(options: {
  now?: () => number;
  tides?: () => Promise<{ snapshot: TideSnapshot }>;
  weather?: (region: CalendarRegion, source: NoonSource, today: string) => Promise<NoonDays>;
} = {}) {
  const now = options.now ?? Date.now;
  const tides = resource<TideSnapshot>();
  const weather = new Map<string, Resource<NoonDays>>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => { version++; listeners.forEach(listener => listener()); };
  const weatherResource = (region: CalendarRegion, source: NoonSource) => {
    const key = `${region}:${source}`;
    if (!weather.has(key)) weather.set(key, resource<NoonDays>());
    return weather.get(key)!;
  };
  function fresh<T>(r: Resource<T>, tide = false) {
    return r.value !== null && now() >= r.loadedAt && koreaToday(new Date(r.loadedAt)) === koreaToday(new Date(now()))
      && (tide || now() - r.loadedAt < HOURS);
  }
  function load<T>(r: Resource<T>, fetcher: () => Promise<T>, tide = false): Promise<void> {
    if (r.pending) return r.pending;
    if (fresh(r, tide) || now() < r.retryAt) return Promise.resolve();
    if (!tide) r.value = null;
    const started = now();
    r.pending = Promise.resolve().then(fetcher).then(value => {
      r.value = value; r.loadedAt = started; r.retryAt = 0;
    }).catch(() => { r.retryAt = now() + RETRY; }).finally(() => { r.pending = undefined; notify(); });
    notify();
    return r.pending;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    async ensure(region: CalendarRegion, date: string) {
      if (!validCalendarDate(date)) return;
      const jobs = [load(tides, async () => (await (options.tides ?? fetchKhoaTides)()).snapshot, true)];
      const today = koreaToday(new Date(now()));
      if (inForecastRange(date, today)) for (const source of ['atmosphere', 'wave'] as const) {
        jobs.push(load(weatherResource(region, source), () => (options.weather ?? fetchNoonWeather)(region, source, today)));
      }
      await Promise.all(jobs);
    },
    events(region: CalendarRegion, date: string) {
      return tides.value?.stations.find(s => s.code === CALENDAR_TIDE_STATIONS[region])?.days.find(d => d.date === date)?.events ?? [];
    },
    noon(region: CalendarRegion, date: string): NoonWeather {
      const value = { ...EMPTY_NOON };
      if (!inForecastRange(date, koreaToday(new Date(now())))) return value;
      for (const source of ['atmosphere', 'wave'] as const) {
        const r = weatherResource(region, source);
        if (fresh(r)) Object.assign(value, r.value?.[date]);
      }
      return value;
    },
  };
}
export const calendarDayStore = createCalendarDayStore();

export function windCompass(direction: number | null) {
  return direction === null || !Number.isFinite(direction) || direction < 0 || direction > 360 ? '—'
    : ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][Math.round(direction / 22.5) % 16];
}
