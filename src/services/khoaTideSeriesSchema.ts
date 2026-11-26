export interface TideSeriesDay {
  schemaVersion: 1;
  date: string;
  generatedAt: string;
  unit: 'cm';
  intervalMinutes: 5;
  reference: { verticalDatumVerified: false; timeZoneVerified: false };
  stations: { code: 'DT_0014' | 'SO_0552'; heightsCm: number[]; nextMidnightCm: number }[];
}

export function validTideSeriesDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
}

// Self-contained: Workbox serializes this function into the service worker.
export function validTideSeriesDay(value: unknown, expectedDate?: string): value is TideSeriesDay {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).sort().join() === names.sort().join();
  if (!record(value) || !keys(value,['schemaVersion','date','generatedAt','unit','intervalMinutes','reference','stations'])
    || value.schemaVersion !== 1 || value.unit !== 'cm' || value.intervalMinutes !== 5
    || typeof value.date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value.date)
    || !Number.isFinite(Date.parse(value.date+'T00:00:00Z'))
    || new Date(value.date+'T00:00:00Z').toISOString().slice(0,10) !== value.date
    || (expectedDate !== undefined && value.date !== expectedDate)
    || typeof value.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.generatedAt)
    || !Number.isFinite(Date.parse(value.generatedAt)) || new Date(value.generatedAt).toISOString() !== value.generatedAt
    || Date.parse(value.generatedAt) > Date.now()+300000
    || !record(value.reference) || !keys(value.reference,['verticalDatumVerified','timeZoneVerified'])
    || value.reference.verticalDatumVerified !== false || value.reference.timeZoneVerified !== false
    || !Array.isArray(value.stations) || value.stations.length !== 2) return false;
  for (const [index,code] of ['DT_0014','SO_0552'].entries()) {
    const station = value.stations[index];
    if (!record(station) || !keys(station,['code','heightsCm','nextMidnightCm']) || station.code !== code
      || !Array.isArray(station.heightsCm) || station.heightsCm.length !== 288
      || Array.from(station.heightsCm).some(h => typeof h !== 'number' || !Number.isFinite(h))
      || typeof station.nextMidnightCm !== 'number' || !Number.isFinite(station.nextMidnightCm)) return false;
  }
  return true;
}

export function tideSeriesFreshness(day: TideSeriesDay, now = Date.now()) {
  const ageMs = now-Date.parse(day.generatedAt);
  return { ageMs, stale: ageMs < 0 || ageMs > 36*3600000 };
}

// Return source samples, not a tide/safety judgment. 1440 is the next day's 00:00.
export function tideSeriesBracket(day: TideSeriesDay, code: TideSeriesDay['stations'][number]['code'], minute: number) {
  if (!Number.isFinite(minute) || minute < 0 || minute >= 1440) throw Error('Invalid minute');
  const station = day.stations.find(s => s.code === code);
  if (!station) throw Error('Unknown tide station');
  const index = Math.floor(minute/5);
  return { fromMinute:index*5, throughMinute:(index+1)*5,
    fromCm:station.heightsCm[index], throughCm:index===287?station.nextMidnightCm:station.heightsCm[index+1] };
}
