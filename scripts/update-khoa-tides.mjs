import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validTideSnapshot } from '../src/services/khoaTideSchema.ts';

export const OUTPUT = 'public/data/tides/latest.json';
export const STATIONS = [{ code: 'DT_0014', name: '통영' }, { code: 'SO_0552', name: '고현항' }];
export function forecastDates(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = type => parts.find(v => v.type === type).value;
  const start = Date.parse(`${p('year')}-${p('month')}-${p('day')}T00:00:00Z`);
  return Array.from({ length: 32 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
export async function atomicSave(snapshot, output = OUTPUT) {
  if (!validTideSnapshot(snapshot)) throw new Error('Invalid tide snapshot; previous file retained');
  await mkdir(dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(snapshot)}\n`, { flag: 'wx' });
    await rename(temp, output);
  } finally { await rm(temp, { force: true }); }
}
export async function readSnapshot(file) {
  try {
    const data = await readFile(file, 'utf8');
    if (Buffer.byteLength(data) > 1024 * 1024) return null;
    const value = JSON.parse(data);
    return validTideSnapshot(value) ? value : null;
  } catch { return null; }
}

export async function collectTides({ key = process.env.KHOA_SERVICE_KEY, fetchImpl = fetch, now = new Date(),
  sleep = ms => new Promise(r => setTimeout(r, ms)), maxCalls = 140 } = {}) {
  if (typeof key !== 'string' || !key.trim()) throw new Error('KHOA_SERVICE_KEY missing; previous file retained');
  let credential;
  try { credential = decodeURIComponent(key.trim()); } catch { throw new Error('Invalid credential encoding'); }
  let calls = 0;
  const dates = forecastDates(now);
  const snapshot = { schemaVersion: 1, source: 'KHOA', generatedAt: now.toISOString(), unit: 'cm', stations: [] };
  for (const station of STATIONS) {
    const days = [];
    for (const date of dates) {
      const events = [];
      let total;
      for (let page = 1; ; page++) {
        if (page > 3) throw new Error('Pagination limit exceeded');
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (++calls > maxCalls) throw new Error('API call budget exhausted');
          await sleep(150);
          const url = new URL('https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService');
          for (const [name, value] of Object.entries({ serviceKey: credential, obsCode: station.code,
            reqDate: date.replaceAll('-', ''), type: 'json', pageNo: String(page), numOfRows: '100' })) url.searchParams.set(name, value);
          try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
          catch { response = null; }
          if (response && response.status !== 429 && response.status < 500) break;
          if (attempt === 0) await sleep(1000);
        }
        if (!response?.ok) throw new Error(`KHOA HTTP failure: ${station.code} ${date}`);
        let payload;
        try {
          const text = await response.text();
          if (text.length > 1024 * 1024) throw new Error();
          if (text.trimStart().startsWith('<')) throw new Error();
          payload = JSON.parse(text);
        } catch { throw new Error(`KHOA non-JSON or XML error: ${station.code} ${date}`); }
        if (payload?.header?.resultCode !== '00') throw new Error(`KHOA internal failure: ${station.code} ${date}`);
        const body = payload.body;
        if (!body || body.type !== 'json' || body.pageNo !== page || body.numOfRows !== 100
          || !Number.isInteger(body.totalCount) || body.totalCount < 1 || body.totalCount > 300
          || (total !== undefined && total !== body.totalCount)) throw new Error('Invalid pagination metadata');
        total = body.totalCount;
        const raw = body.items?.item;
        const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
        if (items.length !== Math.min(100, total - events.length)) throw new Error('Missing or extra page items');
        for (const item of items) {
          if (item.obsvtrNm !== station.name || typeof item.predcDt !== 'string'
            || !item.predcDt.startsWith(`${date} `) || item.predcDt.length !== 16
            || typeof item.predcTdlvVl !== 'number' || !Number.isFinite(item.predcTdlvVl)
            || ![1, 2, 3, 4, '1', '2', '3', '4'].includes(item.extrSe)) throw new Error('Invalid tide event');
          const extrSe = Number(item.extrSe);
          events.push({ time: item.predcDt.slice(11), kind: [1, 3].includes(extrSe) ? 'high' : 'low', heightCm: item.predcTdlvVl, extrSe });
        }
        if (events.length === total) break;
      }
      events.sort((a, b) => a.time.localeCompare(b.time));
      days.push({ date, events });
    }
    snapshot.stations.push({ ...station, days });
  }
  if (!validTideSnapshot(snapshot)) throw new Error('Snapshot validation failed; previous file retained');
  return { snapshot, calls };
}

export async function updateTides(options = {}) {
  const { snapshot, calls } = await collectTides(options);
  await atomicSave(snapshot, options.output ?? OUTPUT);
  return { calls, dates: 32, stations: 2, generatedAt: snapshot.generatedAt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await updateTides())); }
  catch { console.error('KHOA collection failed. No new snapshot published; previous data retained. Check key, API availability and response contract.'); process.exitCode = 1; }
}
