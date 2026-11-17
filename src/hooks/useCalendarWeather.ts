import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { CalendarRegion } from '../components/calendar/calendarConditions';
import { calendarWeatherCacheKey, calendarWeatherStore, weatherRefreshDue } from '../services/calendarWeatherCache';

export function useCalendarWeather(region: CalendarRegion) {
  const [now, setNow] = useState(Date.now);
  const subscribe = useCallback((listener: () => void) => calendarWeatherStore.subscribe(region, () => {
    setNow(Date.now());
    listener();
  }), [region]);
  const getSnapshot = useCallback(() => calendarWeatherStore.getSnapshot(region), [region]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    const check = () => {
      setNow(Date.now());
      if (document.visibilityState !== 'hidden') void calendarWeatherStore.refresh(region);
    };
    const receive = (event: StorageEvent) => {
      if (event.key === calendarWeatherCacheKey(region)) calendarWeatherStore.receiveStorage(region, event.newValue);
    };
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('storage', receive);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('storage', receive);
      document.removeEventListener('visibilitychange', check);
      // 공유 요청은 중단하지 않고 완료 결과를 재진입 때도 재사용한다.
    };
  }, [region]);
  return { ...state, stale: Boolean(state.cache && (state.error || weatherRefreshDue(state.cache, now))),
    refresh: () => calendarWeatherStore.refresh(region) };
}
