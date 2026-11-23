import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const API_BASE = 'https://apis.data.go.kr/1192136/NavigationalWarning/';
export const SOURCE = 'https://www.data.go.kr/data/15057792/openapi.do';
const parser = new XMLParser({ parseTagValue: false, trimValues: false, ignoreAttributes: false, htmlEntities: true,
  isArray: (_name, path) => path === 'response.body.items.item' });
const INTERNAL_CODES = new Set(['invalid_pagination', 'invalid_xml', 'api_error', 'invalid_response', 'invalid_items', 'invalid_dates', 'invalid_key_encoding', 'invalid_operation', 'response_too_large', 'credential_in_response', 'pagination_changed', 'incomplete_page', 'page_limit', 'invalid_document', 'conflicting_document', 'area_limit', 'area_mismatch', 'conflicting_area', 'missing_area', 'request_limit', 'http_error', 'timeout', 'network_error', 'collection_error', 'invalid_request_policy', 'concurrent_request']);
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH']);
export class WarningError extends Error {
  constructor(code, { httpStatus, apiCode, networkCode, retryable = false } = {}) {
    super(INTERNAL_CODES.has(code) ? code : 'collection_error');
    this.name = 'WarningError';
    this.code = this.message;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
    if (typeof apiCode === 'string' && /^\d{2}$/.test(apiCode)) this.apiCode = apiCode;
    if (NETWORK_CODES.has(networkCode)) this.networkCode = networkCode;
    this.retryable = retryable === true;
  }
}
const fail = code => { throw new WarningError(code); };
const signature = raw => JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)));
export function safeDiagnostic(error) {
  if (!(error instanceof WarningError)) return { code: 'collection_error' };
  return { code: error.code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}),
    ...(error.apiCode ? { apiCode: error.apiCode } : {}), ...(error.networkCode ? { networkCode: error.networkCode } : {}) };
}
const integer = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : fail('invalid_pagination');

export function parsePage(xml) {
  if (typeof xml !== 'string' || xml.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail('invalid_xml');
  if (XMLValidator.validate(xml) !== true) fail('invalid_xml');
  let parsed;
  try { parsed = parser.parse(xml); } catch { fail('invalid_xml'); }
  const apiCode = parsed?.response?.header?.resultCode ?? parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode;
  if (apiCode !== '00') throw new WarningError('api_error', { apiCode, retryable: ['01', '05'].includes(apiCode) });
  const body = parsed.response.body;
  if (!body) fail('invalid_response');
  const items = body.items?.item ?? [];
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || Object.values(item).some(v => typeof v !== 'string'))) fail('invalid_items');
  const result = { items, totalCount: integer(body.totalCount), pageNo: integer(body.pageNo), numOfRows: integer(body.numOfRows) };
  if (result.numOfRows < 1 || result.pageNo < 1 || result.totalCount > 100_000 || items.length > result.numOfRows) fail('invalid_pagination');
  return result;
}

// Only angular syntax is interpreted. No datum, geometry or polygon is inferred.
export function inspectCoordinates(position) {
  if (!position?.trim()) return { status: 'missing', format: null, pairCount: 0, pairs: [], datum: null, geometry: null };
  const coordinate = '(\\d{1,3})-(\\d{1,2})-(\\d{1,2}(?:\\.\\d+)?)([NSEW])';
  const regex = new RegExp(`${coordinate}\\s*,\\s*${coordinate}`, 'g');
  const matches = [...position.matchAll(regex)];
  const residue = position.replace(regex, '').replace(/[\s,]/g, '');
  if (!matches.length || residue) return { status: 'unparsed', format: null, pairCount: matches.length, pairs: [], datum: null, geometry: null };
  const pairs = [];
  for (const m of matches) {
    const [latD, latM, latS, lngD, lngM, lngS] = [m[1], m[2], m[3], m[5], m[6], m[7]].map(Number);
    if (!/[NS]/.test(m[4]) || !/[EW]/.test(m[8]) || latM >= 60 || lngM >= 60 || latS >= 60 || lngS >= 60 || latD + latM / 60 + latS / 3600 > 90 || lngD + lngM / 60 + lngS / 3600 > 180) {
      return { status: 'invalid_dms', format: 'latitude-longitude-dms', pairCount: matches.length, pairs: [], datum: null, geometry: null };
    }
    pairs.push({ latitude: (latD + latM / 60 + latS / 3600) * (m[4] === 'S' ? -1 : 1), longitude: (lngD + lngM / 60 + lngS / 3600) * (m[8] === 'W' ? -1 : 1) });
  }
  return { status: 'datum_unverified', format: 'latitude-longitude-dms', pairCount: pairs.length, pairs, datum: null, geometry: null };
}

export function defaultDates(now = new Date()) {
  const kstDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const midnight = new Date(`${kstDay}T00:00:00Z`);
  return [-1, 0, 1].map(offset => new Date(midnight.getTime() + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', ''));
}

export function validateDates(dates) {
  if (!Array.isArray(dates) || !dates.length || dates.length > 31) fail('invalid_dates');
  for (const date of dates) {
    if (!/^\d{8}$/.test(date)) fail('invalid_dates');
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`;
    const parsed = new Date(iso);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) fail('invalid_dates');
  }
  return [...new Set(dates)].sort();
}

export function decodeServiceKey(key) {
  // The portal offers both encoded and decoded keys. URLSearchParams encodes once.
  try { return key.includes('%') ? decodeURIComponent(key) : key; } catch { fail('invalid_key_encoding'); }
}

export function createRequester(key, fetcher = fetch, { intervalMs = 1000, maxAttempts = 3, backoffMs = 2000, timeoutMs = 20000,
  maxRequests = 100, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), clock = Date.now } = {}) {
  if (![intervalMs, backoffMs, timeoutMs, maxRequests, maxAttempts].every(Number.isFinite)
    || intervalMs < 0 || backoffMs < 0 || timeoutMs <= 0 || !Number.isInteger(maxRequests) || maxRequests < 1
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) fail('invalid_request_policy');
  const decodedKey = decodeServiceKey(key);
  const stats = { logicalRequests: 0, requests: 0, retries: 0, responseBytes: 0, waitMs: 0, failures: [] };
  let nextAllowedAt = 0;
  let pending = false;
  const request = async (operation, parameters) => {
    if (pending) fail('concurrent_request');
    if (!['getNavigationalWarningInfo', 'getNavigationalWarningDetailInfo'].includes(operation)) fail('invalid_operation');
    const url = new URL(operation, API_BASE);
    url.search = new URLSearchParams({ ...parameters, ServiceKey: decodedKey }).toString();
    stats.logicalRequests++;
    pending = true;
    try {
      let retryAfterMs = 0;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (stats.requests >= maxRequests) fail('request_limit');
        const wait = Math.max(0, nextAllowedAt - clock(), attempt ? Math.max(backoffMs * 2 ** (attempt - 1), retryAfterMs) : 0);
        if (wait) { stats.waitMs += wait; await sleep(wait); }
        stats.requests++;
        if (attempt) stats.retries++;
        const signal = AbortSignal.timeout(timeoutMs);
        try {
          const response = await fetcher(url, { signal, redirect: 'error' });
          if (!response.ok) {
            const retryAfter = response.headers.get('retry-after');
            retryAfterMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - clock())) : 0;
            if (!Number.isFinite(retryAfterMs)) retryAfterMs = 0;
            await response.body?.cancel();
            throw new WarningError('http_error', { httpStatus: response.status,
              retryable: [408, 429, 500, 502, 503, 504].includes(response.status) && retryAfterMs <= 30000 });
          }
          if (Number(response.headers.get('content-length')) > 4_000_000) { await response.body?.cancel(); fail('response_too_large'); }
          if (!response.body) fail('invalid_response');
          const reader = response.body.getReader();
          const chunks = []; let size = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              stats.responseBytes += value.byteLength;
              if (size > 4_000_000) { await reader.cancel(); fail('response_too_large'); }
              chunks.push(value);
            }
          } finally { reader.releaseLock(); }
          const xml = new TextDecoder().decode(Buffer.concat(chunks));
          if ([key, decodedKey, encodeURIComponent(decodedKey)].some(secret => secret && xml.includes(secret))) fail('credential_in_response');
          return parsePage(xml);
        } catch (error) {
          const networkCode = error?.cause?.code ?? error?.code;
          const safeError = error instanceof WarningError ? error
            : signal.aborted || error?.name === 'TimeoutError' ? new WarningError('timeout', { retryable: true })
              : new WarningError('network_error', { networkCode,
                retryable: ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH'].includes(networkCode) });
          stats.failures.push(safeDiagnostic(safeError));
          if (!safeError.retryable || attempt === maxAttempts - 1) throw safeError;
        } finally {
          nextAllowedAt = clock() + intervalMs;
        }
      }
    } finally {
      pending = false;
    }
  };
  request.stats = stats;
  return request;
}

export async function allPages(request, operation, parameters) {
  const rows = 100; const items = []; let expected;
  const pageSignatures = new Set();
  for (let pageNo = 1; pageNo <= 1000; pageNo++) {
    const page = await request(operation, { ...parameters, pageNo: String(pageNo), numOfRows: String(rows) });
    if (page.pageNo !== pageNo || page.numOfRows !== rows || (expected !== undefined && expected !== page.totalCount)) fail('pagination_changed');
    expected = page.totalCount;
    const pageSignature = JSON.stringify(page.items.map(signature));
    if (page.items.length && pageSignatures.has(pageSignature)) fail('pagination_changed');
    pageSignatures.add(pageSignature);
    items.push(...page.items);
    if (items.length > expected || (items.length < expected && page.items.length !== rows)) fail('incomplete_page');
    if (items.length === expected) return items;
  }
  fail('page_limit');
}

export async function collectWarnings(request, dates, collectedAt = new Date().toISOString()) {
  dates = validateDates(dates);
  const documents = new Map();
  const duplicatesRemoved = { documents: 0, areas: 0 };
  for (const date of dates) {
    const items = await allPages(request, 'getNavigationalWarningInfo', { date });
    const seen = new Map();
    for (const raw of items) {
      if (!raw.doc_num?.trim() || !raw.area?.trim()) fail('invalid_document');
      const rowSignature = signature(raw);
      if (seen.has(raw.doc_num)) {
        if (seen.get(raw.doc_num) !== rowSignature) fail('conflicting_document');
        duplicatesRemoved.documents++; continue;
      }
      seen.set(raw.doc_num, rowSignature);
      let doc = documents.get(raw.doc_num);
      if (!doc) { doc = { docNum: raw.doc_num, issuedAt: null, observations: [], areas: [] }; documents.set(raw.doc_num, doc); }
      doc.observations.push({ queryDate: date, raw });
    }
  }
  // The live API returns numeric area IDs but rejects numeric area parameters.
  // Omit area and paginate ALL details per document; never guess letter/number mappings.
  for (const doc of documents.values()) {
    const areaIds = new Set(doc.observations.flatMap(o => o.raw.area.split(',').map(s => s.trim()).filter(Boolean)));
    if (areaIds.size > 1000) fail('area_limit');
    const details = await allPages(request, 'getNavigationalWarningDetailInfo', { doc_num: doc.docNum });
    const received = new Set();
    const detailRows = new Map();
    for (const raw of details) {
      if (raw.doc_num !== doc.docNum || !raw.area?.trim()) fail('area_mismatch');
      const rowSignature = signature(raw);
      if (detailRows.has(raw.area)) {
        if (detailRows.get(raw.area) !== rowSignature) fail('conflicting_area');
        duplicatesRemoved.areas++; continue;
      }
      detailRows.set(raw.area, rowSignature);
      received.add(raw.area);
      doc.areas.push({ id: JSON.stringify([doc.docNum, raw.area]), raw, coordinates: inspectCoordinates(raw.position) });
    }
    if ([...areaIds].some(area => !received.has(area))) fail('missing_area');
  }
  return { schemaVersion: 1, source: SOURCE, apiBase: API_BASE, lastSuccessfulAt: collectedAt, generatedAt: collectedAt,
    freshness: { staleAfterSeconds: 10800 }, duplicatesRemoved,
    coverage: { queryDates: dates, region: 'nationwide-unfiltered', activeSetCompleteness: 'unverified', dateSemantics: 'unverified', datum: null,
      limitations: ['query_dates_only', 'permanent_and_cancelled_coverage_unverified', 'schedule_timezone_unverified', 'datum_unverified'] },
    documents: [...documents.values()] };
}

export function dataState(snapshot, attempt, now = new Date(), staleAfterMs = (snapshot?.freshness?.staleAfterSeconds ?? 10800) * 1000) {
  const time = Date.parse(snapshot?.lastSuccessfulAt);
  const available = Number.isFinite(time);
  return { availability: available ? (snapshot.documents.length ? 'records' : 'empty_query_result') : 'not_collected',
    lastAttempt: attempt?.status ?? 'not_collected', lastSuccessfulAt: available ? snapshot.lastSuccessfulAt : null,
    generatedAt: snapshot?.generatedAt ?? null, statusGeneratedAt: attempt?.generatedAt ?? null,
    stale: available && (now.getTime() - time > staleAfterMs || time > now.getTime()),
    activeSetCompleteness: snapshot?.coverage?.activeSetCompleteness ?? 'unverified' };
}

export function isSnapshot(value) {
  return value?.schemaVersion === 1 && value.source === SOURCE && value.apiBase === API_BASE
    && (value.lastSuccessfulAt === null || (typeof value.lastSuccessfulAt === 'string' && Number.isFinite(Date.parse(value.lastSuccessfulAt))))
    && value.coverage?.activeSetCompleteness === 'unverified' && value.coverage?.datum === null
    && Array.isArray(value.coverage.queryDates) && Array.isArray(value.documents)
    && (value.lastSuccessfulAt !== null || value.documents.length === 0)
    && value.documents.every(doc => doc && typeof doc.docNum === 'string' && Array.isArray(doc.observations) && Array.isArray(doc.areas)
      && doc.observations.every(o => o && typeof o.queryDate === 'string' && o.raw?.doc_num === doc.docNum)
      && doc.areas.every(a => a?.raw?.doc_num === doc.docNum && typeof a.raw.area === 'string' && a.coordinates?.geometry === null && a.coordinates.datum === null));
}
