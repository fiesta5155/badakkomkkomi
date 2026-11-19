export interface TideEvent { time: string; kind: 'high' | 'low'; heightCm: number; extrSe: number }
export interface TideSnapshot {
  schemaVersion: 1; source: 'KHOA'; generatedAt: string; unit: 'cm';
  stations: { code: string; name: string; days: { date: string; events: TideEvent[] }[] }[];
}

// Self-contained: also serialized into the generated SW's validation plugin.
// Strict keys prevent accidental publication of upstream errors or credentials.
export function validTideSnapshot(value: unknown): value is TideSnapshot {
  const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
  const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).sort().join() === expected.sort().join();
  if (!record(value) || !keys(value, ['schemaVersion', 'source', 'generatedAt', 'unit', 'stations'])
    || value.schemaVersion !== 1 || value.source !== 'KHOA' || value.unit !== 'cm'
    || typeof value.generatedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.generatedAt)
    || !Number.isFinite(Date.parse(value.generatedAt)) || new Date(value.generatedAt).toISOString() !== value.generatedAt
    || Date.parse(value.generatedAt) > Date.now() + 300000
    || !Array.isArray(value.stations) || value.stations.length !== 2) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value.generatedAt));
  const part = (type: string) => parts.find(p => p.type === type)?.value;
  const start = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  for (const [index, expected] of [['DT_0014', '통영'], ['SO_0552', '고현항']].entries()) {
    const station = value.stations[index];
    if (!record(station) || !keys(station, ['code', 'name', 'days']) || station.code !== expected[0] || station.name !== expected[1]
      || !Array.isArray(station.days) || station.days.length !== 32) return false;
    for (const [offset, day] of station.days.entries()) {
      if (!record(day) || !keys(day, ['date', 'events']) || day.date !== new Date(start + offset * 86400000).toISOString().slice(0, 10)
        || !Array.isArray(day.events) || day.events.length === 0 || day.events.length > 300) return false;
      let previous = '';
      for (const event of day.events) {
        if (!record(event) || !keys(event, ['time', 'kind', 'heightCm', 'extrSe'])
          || typeof event.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time) || event.time <= previous
          || typeof event.heightCm !== 'number' || !Number.isFinite(event.heightCm)
          || ![1, 2, 3, 4].includes(event.extrSe as number)
          || event.kind !== ([1, 3].includes(event.extrSe as number) ? 'high' : 'low')) return false;
        previous = event.time;
      }
    }
  }
  return true;
}

export function tideFreshness(snapshot: TideSnapshot, now = Date.now()) {
  const ageMs = now - Date.parse(snapshot.generatedAt);
  return { generatedAt: snapshot.generatedAt, ageMs, stale: ageMs < 0 || ageMs > 36 * 3600000,
    from: snapshot.stations[0].days[0].date, through: snapshot.stations[0].days.at(-1)!.date };
}
