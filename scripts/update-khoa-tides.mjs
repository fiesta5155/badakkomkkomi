import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validTideSnapshot } from '../src/services/khoaTideSchema.ts';

export const OUTPUT = 'public/data/tides/latest.json';
export const STATIONS = [{ code: 'DT_0014', name: '통영' }, { code: 'SO_0552', name: '고현항' }];
const REASONS = {
  KEY_MISSING: 'KHOA_SERVICE_KEY missing; previous file retained',
  KEY_ENCODING: 'Invalid credential encoding',
  REQUEST_BUDGET: 'API call budget exhausted',
  FETCH_FAILED: 'KHOA network failure', BODY_READ: 'KHOA response read failure',
  HTTP_STATUS: 'KHOA HTTP failure', API_AUTH_CODE: 'KHOA authentication or permission failure',
  XML_RESPONSE: 'KHOA non-JSON or XML error', INVALID_JSON: 'KHOA non-JSON response',
  RESPONSE_SIZE: 'KHOA response size limit exceeded', API_RESULT: 'KHOA internal failure',
  PAGE_LIMIT: 'Pagination limit exceeded', PAGE_METADATA: 'Invalid pagination metadata',
  PAGE_ITEMS: 'Missing or extra page items', EVENT_FIELD: 'Invalid tide event',
  SNAPSHOT: 'Snapshot validation failed; previous file retained',
  STORAGE_FAILURE: 'Tide storage failure; previous file retained when replacement did not complete',
  UNEXPECTED: 'Unclassified tide collection failure',
};
const NETWORK_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID']);
const STORAGE_CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EEXIST', 'EBUSY', 'ENOTDIR', 'EROFS', 'EMFILE', 'ENFILE']);
const FIELDS = new Set(['header.resultCode', 'body', 'body.type', 'body.pageNo', 'body.numOfRows',
  'body.totalCount', 'body.items.item', 'obsvtrNm', 'predcDt', 'predcTdlvVl', 'extrSe', 'snapshot', 'xml.errorCode']);

// Never serialize an exception, URL, response, field value, message or stack.
// Re-apply the allowlist at the final output boundary, even for our own errors.
function diagnosticRecord(category, reason, details = {}) {
  const result = {
    category: ['CONFIG', 'API_AUTH', 'HTTP', 'NETWORK', 'FORMAT', 'DATA_VALIDATION', 'STORAGE'].includes(category) ? category : 'DATA_VALIDATION',
    reason: Object.hasOwn(REASONS, reason) ? reason : 'UNEXPECTED',
  };
  if (STATIONS.some(s => s.code === details.station)) result.station = details.station;
  if (typeof details.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(details.date)) result.date = details.date;
  for (const [name, maximum] of [['page', 3], ['attempt', 2], ['requests', 10000], ['elapsedMs', 86400000]]) {
    if (Number.isInteger(details[name]) && details[name] >= 0 && details[name] <= maximum) result[name] = details[name];
  }
  if (Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599) result.httpStatus = details.httpStatus;
  if (typeof details.apiCode === 'string' && /^\d{1,2}$/.test(details.apiCode)) result.apiCode = details.apiCode;
  if (FIELDS.has(details.field)) result.field = details.field;
  if (['null', 'array', 'undefined', 'object', 'string', 'number', 'boolean', 'bigint', 'symbol', 'function'].includes(details.actualType)) result.actualType = details.actualType;
  if (['json', 'xml', 'html', 'other'].includes(details.format)) result.format = details.format;
  if (NETWORK_CODES.has(details.networkCode) || ['AbortError', 'TimeoutError'].includes(details.networkCode)) result.networkCode = details.networkCode;
  if (STORAGE_CODES.has(details.storageCode)) result.storageCode = details.storageCode;
  if (['mkdir', 'write', 'rename', 'cleanup'].includes(details.operation)) result.operation = details.operation;
  return result;
}
export class KhoaDiagnosticError extends Error {
  constructor(category, reason, details = {}) {
    super(Object.hasOwn(REASONS, reason) ? REASONS[reason] : REASONS.UNEXPECTED);
    this.diagnostic = diagnosticRecord(category, reason, details);
  }
}
export function safeTideDiagnostic(error) {
  try {
    return error instanceof KhoaDiagnosticError
      ? diagnosticRecord(error.diagnostic?.category, error.diagnostic?.reason, error.diagnostic)
      : diagnosticRecord('DATA_VALIDATION', 'UNEXPECTED');
  } catch { return diagnosticRecord('DATA_VALIDATION', 'UNEXPECTED'); }
}
function networkCode(error) {
  const code = error?.cause?.code ?? error?.code;
  return NETWORK_CODES.has(code) ? code : ['AbortError', 'TimeoutError'].includes(error?.name) ? error.name : undefined;
}
const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const apiCode = value => (typeof value === 'string' || typeof value === 'number') && /^\d{1,2}$/.test(String(value)) ? String(value) : undefined;
const isAuthCode = code => ['20', '30', '31'].includes(code);
// Extract only a bounded numeric code from known XML fields. No XML evaluation,
// entity expansion, message extraction or raw response logging is performed.
function xmlApiCode(text) {
  for (const tag of ['returnReasonCode', 'resultCode']) {
    const match = text.match(new RegExp(`<${tag}\\b[^>]*>\\s*(\\d{1,2})\\s*</${tag}>`, 'i'));
    if (match) return match[1];
  }
}
export function forecastDates(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = type => parts.find(v => v.type === type).value;
  const start = Date.parse(`${p('year')}-${p('month')}-${p('day')}T00:00:00Z`);
  return Array.from({ length: 32 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
}
export async function atomicSave(snapshot, output = OUTPUT) {
  if (!validTideSnapshot(snapshot)) throw new KhoaDiagnosticError('DATA_VALIDATION', 'SNAPSHOT', { field: 'snapshot' });
  try { await mkdir(dirname(output), { recursive: true }); }
  catch (error) { throw new KhoaDiagnosticError('STORAGE', 'STORAGE_FAILURE', { operation: 'mkdir', storageCode: error?.code }); }
  const temp = `${output}.${process.pid}.tmp`;
  let operation = 'write';
  try {
    await writeFile(temp, `${JSON.stringify(snapshot)}\n`, { flag: 'wx' });
    operation = 'rename';
    await rename(temp, output);
  } catch (error) {
    throw new KhoaDiagnosticError('STORAGE', 'STORAGE_FAILURE', { operation, storageCode: error?.code });
  } finally {
    try { await rm(temp, { force: true }); }
    catch (error) { throw new KhoaDiagnosticError('STORAGE', 'STORAGE_FAILURE', { operation: 'cleanup', storageCode: error?.code }); }
  }
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
  if (typeof key !== 'string' || !key.trim()) throw new KhoaDiagnosticError('CONFIG', 'KEY_MISSING');
  let credential;
  try { credential = decodeURIComponent(key.trim()); } catch { throw new KhoaDiagnosticError('CONFIG', 'KEY_ENCODING'); }
  let calls = 0;
  const startedAt = Date.now();
  const dates = forecastDates(now);
  const snapshot = { schemaVersion: 1, source: 'KHOA', generatedAt: now.toISOString(), unit: 'cm', stations: [] };
  for (const station of STATIONS) {
    const days = [];
    for (const date of dates) {
      const events = [];
      let total;
      for (let page = 1; ; page++) {
        const context = { station: station.code, date, page };
        const fail = (category, reason, details = {}) => new KhoaDiagnosticError(category, reason,
          { ...context, requests: calls, elapsedMs: Date.now() - startedAt, ...details });
        if (page > 3) throw fail('DATA_VALIDATION', 'PAGE_LIMIT');
        let response;
        let lastNetworkCode;
        let lastAttempt;
        for (let attempt = 0; attempt < 2; attempt++) {
          lastAttempt = attempt + 1;
          if (++calls > maxCalls) throw fail('CONFIG', 'REQUEST_BUDGET');
          await sleep(150);
          const url = new URL('https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService');
          for (const [name, value] of Object.entries({ serviceKey: credential, obsCode: station.code,
            reqDate: date.replaceAll('-', ''), type: 'json', pageNo: String(page), numOfRows: '100' })) url.searchParams.set(name, value);
          try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
          catch (error) { response = null; lastNetworkCode = networkCode(error); }
          if (response && response.status !== 429 && response.status < 500) break;
          if (attempt === 0) await sleep(1000);
        }
        if (!response) throw fail('NETWORK', 'FETCH_FAILED', { attempt: lastAttempt, networkCode: lastNetworkCode });
        Object.assign(context, { httpStatus: response.status, attempt: lastAttempt });
        let payload;
        let format = 'other';
        let code;
        let formatFailure;
        try {
          const text = await response.text();
          if (text.length > 1024 * 1024) formatFailure = 'RESPONSE_SIZE';
          else if (text.trimStart().startsWith('<')) {
            format = /^\s*(?:<!doctype\s+html|<html\b)/i.test(text) ? 'html' : 'xml';
            code = xmlApiCode(text);
            formatFailure = 'XML_RESPONSE';
          } else {
            try { payload = JSON.parse(text); format = 'json'; code = apiCode(payload?.header?.resultCode); }
            catch { formatFailure = 'INVALID_JSON'; }
          }
        } catch (error) {
          throw fail(response.ok ? 'NETWORK' : 'HTTP', response.ok ? 'BODY_READ' : 'HTTP_STATUS', { networkCode: networkCode(error) });
        }
        Object.assign(context, { format, apiCode: code });
        if (isAuthCode(code)) throw fail('API_AUTH', 'API_AUTH_CODE', { field: format === 'json' ? 'header.resultCode' : 'xml.errorCode' });
        if (!response.ok) throw fail('HTTP', 'HTTP_STATUS');
        if (formatFailure) throw fail('FORMAT', formatFailure);
        if (payload?.header?.resultCode !== '00') throw fail('DATA_VALIDATION', 'API_RESULT',
          { field: 'header.resultCode', actualType: valueType(payload?.header?.resultCode) });
        const body = payload.body;
        const invalidPageField = !body ? 'body' : body.type !== 'json' ? 'body.type' : body.pageNo !== page ? 'body.pageNo'
          : body.numOfRows !== 100 ? 'body.numOfRows' : !Number.isInteger(body.totalCount) || body.totalCount < 1 || body.totalCount > 300
            || (total !== undefined && total !== body.totalCount) ? 'body.totalCount' : undefined;
        if (invalidPageField) throw fail('DATA_VALIDATION', 'PAGE_METADATA',
          { field: invalidPageField, actualType: valueType(invalidPageField === 'body' ? body : body?.[invalidPageField.slice(5)]) });
        total = body.totalCount;
        const raw = body.items?.item;
        const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
        if (items.length !== Math.min(100, total - events.length)) throw fail('DATA_VALIDATION', 'PAGE_ITEMS', { field: 'body.items.item', actualType: valueType(raw) });
        for (const item of items) {
          const invalidEventField = item?.obsvtrNm !== station.name ? 'obsvtrNm' : typeof item.predcDt !== 'string'
            || !item.predcDt.startsWith(`${date} `) || item.predcDt.length !== 16 ? 'predcDt'
              : typeof item.predcTdlvVl !== 'number' || !Number.isFinite(item.predcTdlvVl) ? 'predcTdlvVl'
                : ![1, 2, 3, 4, '1', '2', '3', '4'].includes(item.extrSe) ? 'extrSe' : undefined;
          if (invalidEventField) throw fail('DATA_VALIDATION', 'EVENT_FIELD', { field: invalidEventField, actualType: valueType(item?.[invalidEventField]) });
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
  if (!validTideSnapshot(snapshot)) throw new KhoaDiagnosticError('DATA_VALIDATION', 'SNAPSHOT', { field: 'snapshot', requests: calls, elapsedMs: Date.now() - startedAt });
  return { snapshot, calls };
}

export async function updateTides(options = {}) {
  const { snapshot, calls } = await collectTides(options);
  await atomicSave(snapshot, options.output ?? OUTPUT);
  return { calls, dates: 32, stations: 2, generatedAt: snapshot.generatedAt };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await updateTides())); }
  catch (error) { console.error(JSON.stringify(safeTideDiagnostic(error))); process.exitCode = 1; }
}
