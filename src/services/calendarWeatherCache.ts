import { fetchCalendarWeather, weatherDescription } from '../components/calendar/calendarConditions.ts';
import type { CalendarRegion } from '../components/calendar/calendarConditions.ts';
import { koreaToday, validCalendarDate } from './sharedCalendarModel.ts';

export const CALENDAR_WEATHER_REFRESH_MS = 3 * 60 * 60 * 1000;
export const CALENDAR_WEATHER_RETRY_MS = 5 * 60 * 1000;
export const calendarWeatherCacheKey = (region: CalendarRegion) => `bada_kkomkkomi_calendar_weather_v1_${region}`;

export interface CalendarWeatherCache {
  version: 1;
  model: 'ecmwf_ifs';
  region: CalendarRegion;
  savedAt: number;
  // API에 모델 발표 시각이 없으므로 조회 요청 시작 시각을 별도 기준으로 저장한다.
  forecastReferenceAt: number;
  referenceKind: 'request-start';
  values: Record<string, number>;
}
export interface CalendarWeatherState {
  cache: CalendarWeatherCache | null;
  refreshing: boolean;
  error: string;
  storageError: boolean;
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;

export function weatherRefreshDue(cache: CalendarWeatherCache | null, now: number): boolean {
  return !cache || now < cache.savedAt || now < cache.forecastReferenceAt
    || koreaToday(new Date(cache.forecastReferenceAt)) !== koreaToday(new Date(now))
    || now - cache.savedAt >= CALENDAR_WEATHER_REFRESH_MS;
}

export function parseWeatherCache(raw: string, region: CalendarRegion): CalendarWeatherCache | null {
  try {
    const d = JSON.parse(raw) as CalendarWeatherCache;
    if (!d || d.version !== 1 || d.model !== 'ecmwf_ifs' || d.region !== region || d.referenceKind !== 'request-start'
      || !Number.isFinite(d.savedAt) || !Number.isFinite(d.forecastReferenceAt) || d.forecastReferenceAt <= 0
      || d.savedAt < d.forecastReferenceAt || d.savedAt > 8640000000000000
      || !d.values || typeof d.values !== 'object' || Array.isArray(d.values)) return null;
    const entries = Object.entries(d.values);
    if (!entries.length || entries.length > 16 || entries.some(([date, code]) => !validCalendarDate(date)
      || typeof code !== 'number' || !weatherDescription(code))) return null;
    const start = koreaToday(new Date(d.forecastReferenceAt));
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 15);
    if (entries.some(([date]) => date < start || date > end.toISOString().slice(0, 10))) return null;
    return { version: 1, model: 'ecmwf_ifs', region, savedAt: d.savedAt, forecastReferenceAt: d.forecastReferenceAt,
      referenceKind: 'request-start', values: Object.fromEntries(entries) };
  } catch { return null; }
}

export function createCalendarWeatherStore(options: {
  storage: () => StoragePort | null;
  fetchWeather?: typeof fetchCalendarWeather;
  now?: () => number;
  runExclusive?: (key: string, work: () => Promise<void>) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const fetchWeather = options.fetchWeather ?? fetchCalendarWeather;
  const states = new Map<CalendarRegion, CalendarWeatherState>();
  const listeners = new Map<CalendarRegion, Set<() => void>>();
  const pending = new Map<CalendarRegion, Promise<void>>();
  const retryAfter = new Map<CalendarRegion, number>();

  const getSnapshot = (region: CalendarRegion): CalendarWeatherState => {
    if (!states.has(region)) {
      let cache: CalendarWeatherCache | null = null;
      let storageError = false;
      try {
        const storage = options.storage();
        if (!storage) storageError = true;
        const raw = storage?.getItem(calendarWeatherCacheKey(region));
        if (raw) cache = parseWeatherCache(raw, region);
      } catch { storageError = true; }
      states.set(region, { cache, refreshing: false, error: '', storageError });
    }
    return states.get(region)!;
  };
  const publish = (region: CalendarRegion, next: CalendarWeatherState) => {
    states.set(region, next);
    listeners.get(region)?.forEach((listener) => listener());
  };
  const receiveStorage = (region: CalendarRegion, raw: string | null) => {
    if (!raw) return;
    const cache = parseWeatherCache(raw, region);
    const current = getSnapshot(region);
    if (cache && (!current.cache || cache.forecastReferenceAt > current.cache.forecastReferenceAt)) {
      publish(region, { ...current, cache, error: '', storageError: false });
      retryAfter.delete(region);
    }
  };

  const refresh = (region: CalendarRegion): Promise<void> => {
    // 컴포넌트 재진입·StrictMode·같은 지역의 여러 구독자는 한 요청을 공유한다.
    const inflight = pending.get(region);
    if (inflight) return inflight;
    // 화면이 닫힌 동안 놓친 다른 탭의 갱신도 재진입 때 확인한다.
    try { receiveStorage(region, options.storage()?.getItem(calendarWeatherCacheKey(region)) ?? null); }
    catch { /* 기존 메모리 예보를 유지한다. */ }
    const state = getSnapshot(region);
    if (!weatherRefreshDue(state.cache, now()) || now() < (retryAfter.get(region) ?? 0)) return Promise.resolve();
    const work = async () => {
      // 다른 탭의 요청이 잠금을 먼저 사용했다면 그 결과를 재사용한다.
      try { receiveStorage(region, options.storage()?.getItem(calendarWeatherCacheKey(region)) ?? null); }
      catch { /* 저장소 차단 시 메모리 캐시를 사용한다. */ }
      const startedAt = now();
      if (!weatherRefreshDue(getSnapshot(region).cache, startedAt) || startedAt < (retryAfter.get(region) ?? 0)) return;
      publish(region, { ...getSnapshot(region), refreshing: true, error: '' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const values = await fetchWeather(region, controller.signal);
        const savedAt = now();
        const cache = parseWeatherCache(JSON.stringify({ version: 1, model: 'ecmwf_ifs', region, savedAt,
          forecastReferenceAt: startedAt, referenceKind: 'request-start', values }), region);
        if (!cache) throw new Error('Invalid calendar forecast');
        const current = getSnapshot(region).cache;
        if (current && current.forecastReferenceAt > startedAt) {
          publish(region, { ...getSnapshot(region), refreshing: false, error: '' });
          return;
        }
        let storageError = false;
        try {
          const storage = options.storage();
          if (!storage) throw new Error('Storage unavailable');
          // 다른 탭의 더 최신 결과를 오래된 응답으로 덮어쓰지 않는다.
          const raw = storage.getItem(calendarWeatherCacheKey(region));
          const stored = raw ? parseWeatherCache(raw, region) : null;
          if (stored && stored.forecastReferenceAt > startedAt) {
            publish(region, { cache: stored, refreshing: false, error: '', storageError: false });
            return;
          }
          storage.setItem(calendarWeatherCacheKey(region), JSON.stringify(cache));
        } catch { storageError = true; }
        publish(region, { cache, refreshing: false, error: '', storageError });
        retryAfter.delete(region);
      } catch {
        const current = getSnapshot(region).cache;
        if (current && current.forecastReferenceAt > startedAt) {
          publish(region, { ...getSnapshot(region), refreshing: false, error: '' });
          return;
        }
        retryAfter.set(region, now() + CALENDAR_WEATHER_RETRY_MS);
        publish(region, { ...getSnapshot(region), refreshing: false,
          error: '날씨 갱신에 실패했습니다. 저장된 예보가 있으면 유지합니다. 5분 뒤 다시 확인합니다.' });
      } finally { clearTimeout(timeout); }
    };
    const operation = Promise.resolve().then(() => options.runExclusive
      ? options.runExclusive(calendarWeatherCacheKey(region), work) : work())
      .catch(() => {
        retryAfter.set(region, now() + CALENDAR_WEATHER_RETRY_MS);
        publish(region, { ...getSnapshot(region), refreshing: false, error: '날씨 갱신을 시작하지 못했습니다. 5분 뒤 다시 확인합니다.' });
      }).finally(() => pending.delete(region));
    pending.set(region, operation);
    return operation;
  };
  return {
    getSnapshot, refresh,
    subscribe(region: CalendarRegion, listener: () => void) {
      const set = listeners.get(region) ?? new Set<() => void>();
      listeners.set(region, set); set.add(listener);
      return () => { set.delete(listener); };
    },
    // storage 이벤트는 다른 탭에서 온 같은 지역의 새 결과만 반영한다.
    receiveStorage,
  };
}

export const calendarWeatherStore = createCalendarWeatherStore({
  storage: () => typeof window === 'undefined' ? null : window.localStorage,
  runExclusive: (key, work) => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(key, work) : work(),
});
