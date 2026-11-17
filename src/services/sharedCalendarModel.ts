import type { CalendarVessel, VoyageKind } from './calendarRepository.ts';

export type EntryKind = VoyageKind | 'memo';
export interface EntryTimestamp { seconds: number; nanoseconds: number }
export interface SharedEntry {
  id: string;
  schemaVersion: 1;
  date: string;
  kind: EntryKind;
  content: string;
  authorUid: string;
  authorName: string;
  createdAt: EntryTimestamp;
  updatedAt: EntryTimestamp;
  revision: number;
}
export interface SharedDay { status?: SharedEntry; memos: SharedEntry[] }
export const LEGACY_CALENDAR_KEY = 'bada_kkomkkomi_calendar_v1';

export function koreaToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validCalendarDate(value: string): boolean {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validEntryId(id: string, date: string, kind: EntryKind): boolean {
  return kind === 'memo'
    ? /^memo_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)
    : id === `status_${date}`;
}

export function parseSharedEntry(id: string, raw: unknown): SharedEntry {
  const d = raw as SharedEntry;
  const timestamp = (value: EntryTimestamp) => value && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds);
  if (!d || d.schemaVersion !== 1 || typeof d.date !== 'string' || !validCalendarDate(d.date)
    || !['planned', 'unavailable', 'memo'].includes(d.kind) || !validEntryId(id, d.date, d.kind)
    || typeof d.content !== 'string' || !d.content.trim() || d.content.length > 2000
    || typeof d.authorUid !== 'string' || !d.authorUid || !/^[가-힣]{2}$/.test(d.authorName)
    || !Number.isSafeInteger(d.revision) || d.revision < 1 || !timestamp(d.createdAt) || !timestamp(d.updatedAt)) {
    throw new Error('calendar/invalid-data');
  }
  return { ...d, id };
}

export function entriesForDay(entries: SharedEntry[], date: string): SharedDay {
  return {
    status: entries.find((entry) => entry.date === date && entry.kind !== 'memo'),
    memos: entries.filter((entry) => entry.date === date && entry.kind === 'memo').sort((a, b) =>
      a.createdAt.seconds - b.createdAt.seconds || a.createdAt.nanoseconds - b.createdAt.nanoseconds || a.id.localeCompare(b.id)),
  };
}

export function assertExpectedEntry(current: SharedEntry | null, expected: SharedEntry): void {
  if (!current) throw new Error('calendar/deleted');
  if (current.revision !== expected.revision || current.authorUid !== expected.authorUid
    || current.createdAt.seconds !== expected.createdAt.seconds || current.createdAt.nanoseconds !== expected.createdAt.nanoseconds) {
    throw new Error('calendar/conflict');
  }
}

export function calendarErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'calendar/conflict') return '다른 곳에서 일정이 변경되었습니다. 작성 내용은 유지됩니다. 최신 일정 확인 후 다시 편집해 주세요.';
  if (message === 'calendar/deleted') return '이 일정은 이미 삭제되었습니다. 작성 내용은 유지되며 자동 재등록하지 않습니다.';
  if (message === 'calendar/exists') return '이 날짜의 운항상태가 이미 등록되었습니다. 최신 일정을 확인해 주세요.';
  if (message === 'calendar/forbidden') return '작성자 본인만 일정을 수정할 수 있습니다. 입력 내용은 유지됩니다.';
  if (message === 'calendar/invalid-data') return '일정 데이터 형식을 확인하지 못했습니다. 일정이 없는 것으로 처리하지 않습니다.';
  const code = (error as { code?: string })?.code;
  if (code === 'permission-denied') return '공유 달력 접근이 거부되었습니다. 로그인·실명 및 공유 달력 보안 규칙 게시 여부를 확인해 주세요.';
  if (code === 'failed-precondition') return '공유 달력 조회 설정을 확인해 주세요. 필요한 Firestore 인덱스가 있는지 확인해 주세요.';
  return '서버와 연결하지 못했습니다. 입력 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.';
}

// 원본 문자열을 파싱/정규화하지 않아 손상된 자료도 그대로 보존한다.
export function legacyBackup(storage: Pick<Storage, 'getItem'>): string | null {
  return storage.getItem(LEGACY_CALENDAR_KEY);
}

export function calendarScope(uid: string, vessel: CalendarVessel, month: string): string {
  return `${uid}/${vessel}/${month}`;
}

// 이미 큐에 들어온 이전 계정/월의 콜백도 정리 후에는 전달하지 않는다.
export function guardedSubscription<T>(subscribe: (next: (value: T) => void, error: (cause: unknown) => void) => () => void,
  next: (value: T) => void, error: (cause: unknown) => void): () => void {
  let active = true;
  const unsubscribe = subscribe((value) => { if (active) next(value); }, (cause) => { if (active) error(cause); });
  return () => { if (active) { active = false; unsubscribe(); } };
}
