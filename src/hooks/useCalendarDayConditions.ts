import { useEffect, useSyncExternalStore } from 'react';
import type { CalendarRegion } from '../components/calendar/calendarConditions.ts';
import { calendarDayStore } from '../services/calendarDayConditions.ts';

export function useCalendarDayConditions(region: CalendarRegion, date: string) {
  useSyncExternalStore(calendarDayStore.subscribe, calendarDayStore.getVersion);
  useEffect(() => {
    const check = () => { if (document.visibilityState !== 'hidden') void calendarDayStore.ensure(region, date); };
    check();
    const timer = window.setInterval(check, 60000);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [region, date]);
  return { events: calendarDayStore.events(region, date), weather: calendarDayStore.noon(region, date) };
}
