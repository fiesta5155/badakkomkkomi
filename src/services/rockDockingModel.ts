import { ROCK_DOCKING_BOUNDARY_CM, ROCK_DOCKING_TIDE_REFERENCE } from '../config/rockDocking.ts';
import { validCalendarDate, type EntryTimestamp } from './sharedCalendarModel.ts';
import { tideFreshness, type TideSnapshot } from './khoaTideSchema.ts';

export type RockVessel = '101' | '103';
export type RockState = 'inside' | 'boundary' | 'outside' | 'unknown';
export const ROCK_STATES = {
  inside: { label: '범위 내', color: '#00846c' }, boundary: { label: '경계', color: '#b45309' },
  outside: { label: '범위 밖', color: '#b2415f' }, unknown: { label: '미확인', color: '#64748b' },
} as const;
export interface RockIsland { id: string; name: string }
export interface RockRange { min: number; max: number }
export interface RockPhoto { id: string; path: string; role: 'wide' | 'close' | 'extra'; size: number; width: number; height: number }
export interface RockInput {
  islandId: string; name: string; lat: number; lng: number; stationCode: 'DT_0014' | 'SO_0552';
  datum: 'DL' | 'unverified'; ranges: Record<RockVessel, RockRange | null>; confirmedOn: string; photos: RockPhoto[];
}
export interface RockPoint extends RockInput {
  id: string; schemaVersion: 1; authorUid: string; authorName: string; updatedBy: string;
  createdAt: EntryTimestamp; updatedAt: EntryTimestamp; revision: number; deleted: boolean;
}
export interface RockNote {
  id: string; text: string; pinned: boolean; authorUid: string; authorName: string;
  createdAt: EntryTimestamp; updatedAt: EntryTimestamp; revision: number;
}
export interface RockMapPoint { id: string; name: string; lat: number; lng: number; state: RockState }
export const EMPTY_ROCK_POINTS: readonly RockMapPoint[] = [];
export function rockIslandName(value: string) { return value.normalize('NFKC').replace(/\s/g, ''); }
export function rockIslandId(value: string) {
  const name = rockIslandName(value);
  if (!/^[가-힣A-Za-z0-9·()_-]{1,40}$/.test(name)) throw Error('섬 이름을 확인해 주세요.');
  return name.toLowerCase();
}
export function validateRock(input: RockInput, pointId?: string, authorUid?: string) {
  if (!input || !/^[가-힣a-z0-9·()_-]{1,40}$/.test(input.islandId) || !input.name?.trim() || input.name.trim().length > 80
    || !Number.isFinite(input.lat) || Math.abs(input.lat) > 90 || !Number.isFinite(input.lng) || Math.abs(input.lng) > 180
    || !['DT_0014', 'SO_0552'].includes(input.stationCode) || !['DL', 'unverified'].includes(input.datum)
    || !validCalendarDate(input.confirmedOn) || !input.ranges) throw Error('지점명·지도 위치·조위 기준·확인일을 확인해 주세요.');
  for (const vessel of ['101', '103'] as const) {
    const r = input.ranges[vessel];
    if (r !== null && (!r || !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min < -2000 || r.max > 2000 || r.min > r.max)) throw Error(`${vessel}호 최저·최고 조위를 확인해 주세요.`);
  }
  if (!Array.isArray(input.photos) || input.photos.length > 4 || new Set(input.photos.map(p => p.id)).size !== input.photos.length
    || input.photos.filter(p => p.role === 'wide').length > 1 || input.photos.filter(p => p.role === 'close').length > 1 || input.photos.filter(p => p.role === 'extra').length > 2) throw Error('사진은 원경·근경과 추가 2장까지 등록할 수 있습니다.');
  for (const p of input.photos) {
    if (!/^[0-9a-f-]{36}$/.test(p.id) || !['wide', 'close', 'extra'].includes(p.role) || !Number.isInteger(p.size) || p.size < 1 || p.size > 512000
      || !Number.isInteger(p.width) || !Number.isInteger(p.height) || Math.min(p.width, p.height) < 1 || Math.max(p.width, p.height) > 1600
      || (pointId && authorUid && p.path !== `rockDocking/${pointId}/${authorUid}/${p.id}.webp`)) throw Error('사진 정보를 확인해 주세요.');
  }
}
export function validateRockNote(text: string) { if (!text.trim() || text.trim().length > 4000) throw Error('메모를 4,000자 이내로 입력해 주세요.'); }
export function rockComparison(height: number | null, range: RockRange | null): RockState {
  if (height === null || !Number.isFinite(height) || !range || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) return 'unknown';
  if (height < range.min || height > range.max) return 'outside';
  return Math.min(height - range.min, range.max - height) <= ROCK_DOCKING_BOUNDARY_CM ? 'boundary' : 'inside';
}
export function estimateRockTide(snapshot: TideSnapshot | null, point: Pick<RockInput, 'stationCode' | 'datum'>, selectedKst: string,
  reference = ROCK_DOCKING_TIDE_REFERENCE, now = Date.now()): number | null {
  if (!snapshot || !reference?.source || reference.datum !== 'DL' || reference.timeZone !== 'Asia/Seoul' || point.datum !== reference.datum
    || tideFreshness(snapshot, now).stale || !/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d$/.test(selectedKst) || !validCalendarDate(selectedKst.slice(0, 10))) return null;
  const station = snapshot.stations.find(s => s.code === point.stationCode);
  const target = Date.parse(selectedKst + ':00+09:00');
  const events = station?.days.flatMap(day => day.events.map(e => ({ ...e, at: Date.parse(`${day.date}T${e.time}:00+09:00`) }))).sort((a, b) => a.at - b.at) ?? [];
  const exact = events.find(e => e.at === target); if (exact) return exact.heightCm;
  const next = events.findIndex(e => e.at > target);
  if (next <= 0) return null;
  const a = events[next - 1], b = events[next];
  if (a.kind === b.kind || b.at <= a.at || b.at - a.at > 12 * 3600000) return null;
  return Math.round(a.heightCm + (b.heightCm - a.heightCm) * (target - a.at) / (b.at - a.at));
}

// Only known SDK codes are displayed; raw messages may contain request/user details.
export function rockReadErrorMessage(cause: unknown): string {
  const raw = cause && typeof cause === 'object' && 'code' in cause ? cause.code : null;
  const code = typeof raw === 'string' ? raw.replace(/^firestore\//, '') : '';
  const messages: Record<string, string> = {
    'permission-denied': '접안정보 읽기 권한이 없습니다. 보안 규칙을 확인해 주세요.',
    'unauthenticated': '로그인 상태를 확인해 주세요.',
    'unavailable': '접안정보 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.',
    'deadline-exceeded': '접안정보 요청 시간이 초과되었습니다. 다시 시도해 주세요.',
    'failed-precondition': '접안정보 조회 조건 또는 색인 설정을 확인해 주세요.',
    'resource-exhausted': '접안정보 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
  };
  return Object.hasOwn(messages, code) ? messages[code] + ' (' + code + ')' : '접안정보를 읽지 못했습니다. 연결 또는 자료 형식을 확인해 주세요.';
}
