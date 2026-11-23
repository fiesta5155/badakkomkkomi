import { NAV_WARNING_MEMORY_CACHE_MS, NAV_WARNING_STALE_AFTER_SECONDS, NAV_WARNING_UPDATE_DELAY_SECONDS } from '../config/navigationalWarnings.ts';

export type WarningRaw = Record<string, string>;
export interface WarningDocument {
  docNum: string;
  issuedAt: string | null;
  observations: { queryDate: string; raw: WarningRaw }[];
  areas: { raw: WarningRaw; coordinates?: { pairs?: { latitude: number; longitude: number }[] } }[];
}
export interface WarningSnapshot {
  lastSuccessfulAt: string | null;
  generatedAt?: string | null;
  freshness?: { staleAfterSeconds: number };
  coverage: { queryDates: string[] };
  documents: WarningDocument[];
}
export interface WarningAttempt {
  status: 'not_collected' | 'not_configured' | 'success' | 'failed';
  lastSuccessfulAt: string | null;
  lastAttemptAt: string | null;
  publication?: { state: 'ready' | 'delayed'; preparedAt: string; snapshotSha256: string; reason: string };
}
export interface WarningData {
  snapshot: WarningSnapshot | null;
  attempt: WarningAttempt | null;
  errors: string[];
  publicationVerified?: boolean;
  publicationDelayed?: boolean;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const raw = (v: unknown): v is WarningRaw => record(v) && Object.values(v).every(x => typeof x === 'string');
export const isWarningTimestamp = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const day = new Date(v.slice(0, 10));
  return Number.isFinite(day.getTime()) && day.toISOString().startsWith(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24;
};
const optionalTime = (v: unknown) => v === null || isWarningTimestamp(v);
const queryDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{8}$/.test(v)) return false;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(iso);
};

export function parseWarningSnapshot(value: unknown): WarningSnapshot {
  if (!record(value) || value.schemaVersion !== 1 || value.source !== 'https://www.data.go.kr/data/15057792/openapi.do'
    || value.apiBase !== 'https://apis.data.go.kr/1192136/NavigationalWarning/' || !optionalTime(value.lastSuccessfulAt)
    || !record(value.coverage) || !Array.isArray(value.coverage.queryDates) || !value.coverage.queryDates.every(queryDate)
    || !Array.isArray(value.documents) || value.documents.length > 10000
    || (value.generatedAt !== undefined && !optionalTime(value.generatedAt))) throw Error('invalid_snapshot');
  if (value.freshness !== undefined && (!record(value.freshness) || typeof value.freshness.staleAfterSeconds !== 'number'
    || !Number.isFinite(value.freshness.staleAfterSeconds) || value.freshness.staleAfterSeconds <= 0)) throw Error('invalid_snapshot');
  const documents: WarningDocument[] = [];
  for (const d of value.documents) {
    if (!record(d) || typeof d.docNum !== 'string' || !d.docNum.trim() || !(d.issuedAt === null || typeof d.issuedAt === 'string')
      || !Array.isArray(d.observations) || !d.observations.length || !Array.isArray(d.areas)
      || !d.observations.every(o => record(o) && queryDate(o.queryDate) && raw(o.raw) && o.raw.doc_num === d.docNum)
      || !d.areas.every(a => record(a) && raw(a.raw) && a.raw.doc_num === d.docNum && !!a.raw.area?.trim())) throw Error('invalid_snapshot');
    const document = d as unknown as WarningDocument;
    const areas: WarningDocument['areas'] = [];
    for (const a of document.areas) {
      const previous = areas.find(other => other.raw.area === a.raw.area);
      if (previous && JSON.stringify(previous.raw) !== JSON.stringify(a.raw)) throw Error('conflicting_area');
      if (!previous) areas.push(a);
    }
    const existing = documents.find(other => other.docNum === document.docNum);
    if (existing) {
      existing.observations.push(...document.observations);
      if (existing.issuedAt !== document.issuedAt) throw Error('conflicting_document');
      for (const a of areas) {
        const previous = existing.areas.find(other => other.raw.area === a.raw.area);
        if (previous && JSON.stringify(previous.raw) !== JSON.stringify(a.raw)) throw Error('conflicting_area');
        if (!previous) existing.areas.push(a);
      }
    } else documents.push({ ...document, observations: [...document.observations], areas });
  }
  if (value.lastSuccessfulAt === null && documents.length) throw Error('invalid_snapshot');
  // Only sort when every document has an explicit, unambiguous issuance timestamp.
  if (documents.every(d => isWarningTimestamp(d.issuedAt))) documents.sort((a, b) => Date.parse(b.issuedAt!) - Date.parse(a.issuedAt!));
  return { ...value, documents } as unknown as WarningSnapshot;
}

export function parseWarningAttempt(value: unknown): WarningAttempt {
  if (!record(value) || value.schemaVersion !== 1 || !['not_collected', 'not_configured', 'success', 'failed'].includes(String(value.status))
    || !optionalTime(value.lastSuccessfulAt) || !optionalTime(value.lastAttemptAt)
    || (value.status === 'success' && value.lastSuccessfulAt === null)) throw Error('invalid_status');
  if (value.publication !== undefined) {
    const p = value.publication;
    if (!record(p) || !['ready', 'delayed'].includes(String(p.state)) || !isWarningTimestamp(p.preparedAt)
      || typeof p.snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.snapshotSha256)
      || typeof p.reason !== 'string' || p.reason.length > 100) throw Error('invalid_publication');
  }
  return value as unknown as WarningAttempt;
}

async function loadWarningData(base: string, signal: AbortSignal, fetcher: typeof fetch, nonce: string): Promise<WarningData> {
  const load = async (name: string, maxBytes: number) => {
    const response = await fetcher(`${base}data/navigational-warnings/${name}.json?v=${nonce}`, { cache: 'no-store', redirect: 'error', signal });
    if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) throw Error('load_failed');
    const text = await response.text();
    if (text.length > maxBytes) throw Error('load_failed');
    return { value: JSON.parse(text) as unknown, text };
  };
  const [snapshot, attempt] = await Promise.allSettled([
    load('latest', 5_000_000).then(({ value, text }) => ({ value: parseWarningSnapshot(value), text })),
    load('status', 100_000).then(({ value }) => parseWarningAttempt(value)),
  ]);
  const data: WarningData = { snapshot: snapshot.status === 'fulfilled' ? snapshot.value.value : null,
    attempt: attempt.status === 'fulfilled' ? attempt.value : null,
    errors: [snapshot.status === 'rejected' ? '경보 자료를 불러오지 못했습니다.' : '', attempt.status === 'rejected' ? '수집 상태를 불러오지 못했습니다.' : ''].filter(Boolean) };
  if (snapshot.status === 'fulfilled' && data.attempt?.publication) {
    try {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot.value.text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (hash !== data.attempt.publication.snapshotSha256 || data.snapshot?.lastSuccessfulAt !== data.attempt.lastSuccessfulAt) throw Error();
      data.publicationVerified = true;
    } catch {
      return { snapshot: null, attempt: data.attempt, errors: ['경보 자료와 수집 상태가 일치하지 않습니다. 다시 불러와 주세요.'], publicationDelayed: true };
    }
  }
  return data;
}

export function createWarningDataLoader(fetcher: typeof fetch = fetch, clock: () => number = Date.now, cacheMs = NAV_WARNING_MEMORY_CACHE_MS) {
  const cache = new Map<string, { data: WarningData; time: number }>();
  const pending = new Map<string, Promise<WarningData>>();
  let sequence = 0;
  return async (base: string, signal?: AbortSignal): Promise<WarningData> => {
    const cancelled = (): WarningData => ({ snapshot: null, attempt: null, errors: ['경보 자료를 불러오지 못했습니다.'] });
    if (signal?.aborted) return cancelled();
    const previous = cache.get(base);
    if (previous && clock() - previous.time >= 0 && clock() - previous.time < cacheMs) return previous.data;
    let task = pending.get(base);
    if (!task) {
      task = loadWarningData(base, AbortSignal.timeout(15000), fetcher, `${clock()}-${sequence++}`).then(data => {
        const old = cache.get(base);
        const oldTime = Date.parse(old?.data.snapshot?.lastSuccessfulAt ?? '');
        const newTime = Date.parse(data.snapshot?.lastSuccessfulAt ?? '');
        const oldAttempt = Date.parse(old?.data.attempt?.lastAttemptAt ?? '');
        const newAttempt = Date.parse(data.attempt?.lastAttemptAt ?? '');
        const olderStatus = oldTime === newTime && Number.isFinite(oldAttempt) && (!Number.isFinite(newAttempt) || newAttempt < oldAttempt);
        if (old && (data.errors.length || olderStatus || (Number.isFinite(oldTime) && (!Number.isFinite(newTime) || newTime < oldTime)))) {
          return { ...old.data, errors: data.errors.length ? data.errors : ['이전 수집 자료가 응답되어 보관 중인 자료를 표시합니다.'], publicationDelayed: true };
        }
        if (!data.errors.length && !warningDataState(data, clock()).mismatch) cache.set(base, { data, time: clock() });
        return data;
      }).finally(() => { pending.delete(base); });
      pending.set(base, task);
    }
    if (!signal) return task;
    return new Promise(resolve => {
      const abort = () => resolve(cancelled());
      signal.addEventListener('abort', abort, { once: true });
      void task!.then(resolve).finally(() => signal.removeEventListener('abort', abort));
    });
  };
}

const warningDataLoader = createWarningDataLoader();
export function fetchWarningData(base: string, signal?: AbortSignal, fetcher?: typeof fetch): Promise<WarningData> {
  return (fetcher ? createWarningDataLoader(fetcher) : warningDataLoader)(base, signal);
}

export function warningDataState(data: WarningData, now = Date.now()) {
  const { snapshot, attempt } = data;
  const available = !!snapshot?.lastSuccessfulAt;
  const staleAfter = snapshot?.freshness?.staleAfterSeconds ?? NAV_WARNING_STALE_AFTER_SECONDS;
  const timestamp = Date.parse(snapshot?.lastSuccessfulAt ?? '');
  const mismatch = !!(snapshot && attempt && (Date.parse(snapshot.lastSuccessfulAt ?? '') !== Date.parse(attempt.lastSuccessfulAt ?? ''))
    && !(snapshot.lastSuccessfulAt === null && attempt.lastSuccessfulAt === null));
  const stale = available && (now - timestamp > staleAfter * 1000 || timestamp > now);
  const publicationDelayed = data.publicationDelayed === true || attempt?.publication?.state === 'delayed'
    || !!(attempt?.publication && isWarningTimestamp(attempt.lastAttemptAt) && now - Date.parse(attempt.lastAttemptAt) > NAV_WARNING_UPDATE_DELAY_SECONDS * 1000);
  let message = '아직 수집된 항행경보 자료가 없습니다.';
  if (!snapshot) message = '경보 자료를 불러오지 못했습니다.';
  else if (attempt?.status === 'failed') message = available ? '마지막 수집에 실패했습니다. 이전 정상 자료입니다.' : '마지막 수집에 실패했습니다. 정상 자료가 없습니다.';
  else if (attempt?.status === 'not_configured' && available) message = '수집이 설정되지 않았습니다. 이전 정상 자료입니다.';
  else if (available) message = snapshot.documents.length ? `수집 자료 ${snapshot.documents.length}건입니다.` : '정상 수집 결과가 0건입니다.';
  if (stale) message += ' 마지막 정상 수집 이후 시간이 지나 오래된 자료입니다.';
  if (mismatch) message += ' 자료와 수집 상태의 시각이 달라 갱신 여부를 확인할 수 없습니다.';
  let briefMessage = '아직 수집된 항행경보 자료가 없습니다.';
  if (!snapshot) briefMessage = '경보 자료를 불러오지 못했습니다.';
  else if (available) briefMessage = snapshot.documents.length ? `수집 자료 ${snapshot.documents.length}건입니다.` : '정상 수집 결과가 0건입니다.';
  if (attempt?.status === 'failed') briefMessage = available ? `수집 자료 ${snapshot!.documents.length}건 · 수집 실패 · 이전 정상 자료` : '수집 실패 · 정상 자료 없음';
  else if (attempt?.status === 'not_configured' && available) briefMessage = `수집 자료 ${snapshot!.documents.length}건 · 수집 중단 · 이전 정상 자료`;
  if (available && stale) briefMessage += ' · 오래된 자료';
  if (mismatch) briefMessage += ' · 수집 상태 미확인';
  if (publicationDelayed) briefMessage += ' · 갱신 지연';
  return { message, available, stale, mismatch,
    publicationState: publicationDelayed ? 'delayed' : data.publicationVerified ? 'received' : 'unverified',
    briefMessage,
    uncollected: !!snapshot && !available && !mismatch && attempt?.status !== 'failed' && data.errors.length === 0 };
}

export function formatWarningTime(value: string | null | undefined) {
  if (!isWarningTimestamp(value)) return '미제공';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const get = (key: string) => parts.find(p => p.type === key)?.value;
  return `${get('year')}.${get('month')}.${get('day')}. ${get('hour')}:${get('minute')} KST`;
}
