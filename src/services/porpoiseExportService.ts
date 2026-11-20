import type { PorpoiseRecord } from '../types/porpoise.ts';
import { isValidRealName } from './userProfileService.ts';

export const PORPOISE_CSV_HEADERS = [
  '구분', '국립공원', '사무소', '과제명', '과제연차', '국명', '학명',
  '경도', '위도', '조사일자', '조사시각(시점)', '조사자', '개체수', '비고',
] as const;

export function escapeCsvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function observationTime(value: string) {
  // Read the stored wall clock directly, including legacy ISO suffixes. Never convert to UTC.
  const m = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value);
  if (!m) throw new Error('관찰일시가 올바르지 않은 기록이 있습니다. 해당 기록을 확인해 주세요.');
  const [, year, month, day, hour, minute, second = '00', fraction = ''] = m;
  const y = Number(year), mo = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > days[mo - 1]
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new Error('관찰일시가 올바르지 않은 기록이 있습니다. 해당 기록을 확인해 주세요.');
  }
  const date = `${year}-${month}-${day}`, time = `${hour}:${minute}`;
  return { year, date, time, sortKey: `${date}T${time}:${second}.${fraction.padEnd(9, '0')}` };
}

export function buildPorpoiseCsv(records: readonly PorpoiseRecord[], realName: string): string {
  if (!isValidRealName(realName)) throw new Error('실명 등록을 완료한 뒤 관찰기록을 내보내 주세요.');
  if (!records.length) throw new Error('내보낼 상괭이 관찰기록이 없습니다.');
  const sorted = records.map((record) => {
    if (!record || typeof record.id !== 'string' || !record.id.trim()
      || !Number.isFinite(record.lat) || Math.abs(record.lat) > 90
      || !Number.isFinite(record.lng) || Math.abs(record.lng) > 180
      || !Number.isSafeInteger(record.count) || record.count < 1
      || !Number.isFinite(record.createdAt) || record.createdAt < 0) {
      throw new Error('위치 또는 개체수 등 저장 정보가 올바르지 않은 기록이 있습니다. 기록을 확인해 주세요.');
    }
    return { record, ...observationTime(record.observedAt) };
  }).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const rows: (string | number)[][] = [Array.from(PORPOISE_CSV_HEADERS)];
  sorted.forEach(({ record, year, date, time }, index) => rows.push([
    index + 1, '한려해상', '한려', '상괭이모니터링', year, '상괭이',
    'Neophocaena asiaeorientalis', record.lng, record.lat, date, time, realName, record.count, '',
  ]));
  return '\uFEFF' + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function createPorpoiseCsvFile(records: readonly PorpoiseRecord[], realName: string, now = new Date()): File {
  const csv = buildPorpoiseCsv(records, realName);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const stamp = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('');
  return new File([csv], `상괭이모니터링_${stamp}.csv`, { type: 'text/csv;charset=utf-8' });
}

interface FileSharePlatform {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export async function sharePorpoiseCsv(file: File, platform: FileSharePlatform = navigator): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const files = [file];
  let supported = false;
  try { supported = Boolean(platform.share && platform.canShare?.({ files })); } catch { /* Treat unavailable capability checks as unsupported. */ }
  if (!supported) return 'unsupported';
  try {
    await platform.share!({ files, title: '상괭이 관찰기록', text: '상괭이모니터링 관찰기록 CSV' });
    return 'shared';
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
    throw new Error('공유창을 열지 못했습니다. CSV 파일 다운로드를 이용해 주세요.');
  }
}

export function downloadPorpoiseCsv(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Give mobile browsers time to consume the download before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
