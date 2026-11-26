import { useEffect, useMemo, useState } from 'react';
import { loadTideSeriesDay } from '../services/khoaTideSeriesService';
import type { TideSeriesDay } from '../services/khoaTideSeriesSchema';
import { rockTrialDate, trialRockTides } from '../services/rockDockingTrialTides';

export function useRockTrialTides(enabled: boolean) {
  const [now, setNow] = useState(Date.now);
  const [day, setDay] = useState<TideSeriesDay | null>(null);
  const date = rockTrialDate(now);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      timer = setTimeout(tick, 60000 - Date.now() % 60000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => {
      // Read the actual current date on resume, not yesterday's effect closure.
      const current = Date.now(), requestedDate = rockTrialDate(current);
      setNow(current);
      void loadTideSeriesDay(requestedDate).then(value => { if (live) setDay(value); })
        .catch(() => { if (live) setDay(null); });
    };
    const resume = () => { if (document.visibilityState === 'visible') load(); };
    load();
    window.addEventListener('focus', resume);
    window.addEventListener('online', load);
    document.addEventListener('visibilitychange', resume);
    return () => {
      live = false;
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', load);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, date]);
  return useMemo(() => enabled ? trialRockTides(day, now) : {}, [enabled, day, now]);
}
