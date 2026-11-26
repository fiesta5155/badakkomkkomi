import { validTideSeriesDate, validTideSeriesDay, type TideSeriesDay } from './khoaTideSeriesSchema.ts';

export function createTideSeriesReader({ base = '/', fetchImpl = fetch, now = Date.now, ttlMs = 3600000, maxEntries = 8 } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries<1 || !Number.isFinite(ttlMs) || ttlMs<0) throw Error('Invalid tide series cache options');
  const cache = new Map<string,{day:TideSeriesDay; checkedAt:number}>();
  const pending = new Map<string,Promise<TideSeriesDay>>();
  const remember = (date:string,day:TideSeriesDay) => {
    for (const station of day.stations) { Object.freeze(station.heightsCm); Object.freeze(station); }
    Object.freeze(day.stations); Object.freeze(day.reference); Object.freeze(day);
    cache.delete(date); cache.set(date,{day,checkedAt:now()});
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return day;
  };
  return {
    load(date:string):Promise<TideSeriesDay> {
      if (!validTideSeriesDate(date)) return Promise.reject(Error('Invalid tide series date'));
      const previous = cache.get(date);
      if (previous && now()-previous.checkedAt >= 0 && now()-previous.checkedAt < ttlMs) {
        cache.delete(date); cache.set(date,previous); return Promise.resolve(previous.day);
      }
      const active = pending.get(date); if (active) return active;
      const request = (async () => {
        await Promise.resolve(); // Register the shared promise before even a synchronous adapter failure.
        try {
          const response = await fetchImpl(base.replace(/\/?$/,'/')+'data/tide-series/'+date+'.json',{
            cache:'no-store',signal:AbortSignal.timeout(15000),
          });
          if (!response.ok) throw Error('Tide series unavailable');
          const text = await response.text();
          if (text.length > 65536) throw Error('Tide series response too large');
          const day:unknown = JSON.parse(text);
          if (!validTideSeriesDay(day,date)) throw Error('Invalid tide series data');
          // An older CDN/SW response must not roll back an already validated generation.
          return remember(date,previous && Date.parse(previous.day.generatedAt)>Date.parse(day.generatedAt)?previous.day:day);
        } finally { pending.delete(date); }
      })();
      pending.set(date,request); return request;
    },
  };
}

// Construct readers only on explicit demand. No import-time/app/map requests.
const readers = new Map<string,ReturnType<typeof createTideSeriesReader>>();
export function loadTideSeriesDay(date:string,base = import.meta.env.BASE_URL) {
  let reader = readers.get(base);
  if (!reader) { reader=createTideSeriesReader({base}); readers.set(base,reader); }
  return reader.load(date);
}
