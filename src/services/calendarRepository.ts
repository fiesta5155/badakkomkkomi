export type CalendarVessel = '101' | '103';
export type VoyageKind = 'planned' | 'unavailable';

export interface VoyageStatus {
  kind: VoyageKind;
  content: string;
}

export interface CalendarMemo {
  id: string;
  author: string;
  content: string;
}

export interface CalendarDay {
  status?: VoyageStatus;
  memos: CalendarMemo[];
}

export interface CalendarSnapshot {
  version: 1;
  vessels: Record<CalendarVessel, Record<string, CalendarDay>>;
}

export interface CalendarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CalendarRepository {
  load(): CalendarSnapshot;
  save(snapshot: CalendarSnapshot): void;
  getLastVessel(): CalendarVessel;
  setLastVessel(vessel: CalendarVessel): void;
}

const DATA_KEY = 'bada_kkomkkomi_calendar_v1';
const VESSEL_KEY = 'bada_kkomkkomi_calendar_last_vessel_v1';

export function emptyCalendar(): CalendarSnapshot {
  return { version: 1, vessels: { '101': {}, '103': {} } };
}

export function getCalendarDay(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string): CalendarDay {
  return snapshot.vessels[vessel][date] ?? { memos: [] };
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function normalizeSnapshot(value: unknown): CalendarSnapshot {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return emptyCalendar();
  const vessels = (value as { vessels?: unknown }).vessels;
  if (!vessels || typeof vessels !== 'object') return emptyCalendar();
  const snapshot = emptyCalendar();
  for (const vessel of ['101', '103'] as const) {
    const days = (vessels as Record<string, unknown>)[vessel];
    if (!days || typeof days !== 'object') continue;
    for (const [date, rawDay] of Object.entries(days)) {
      if (!isValidDateKey(date) || !rawDay || typeof rawDay !== 'object') continue;
      const candidate = rawDay as { status?: unknown; memos?: unknown };
      const day: CalendarDay = { memos: [] };
      if (candidate.status && typeof candidate.status === 'object') {
        const status = candidate.status as Partial<VoyageStatus>;
        if ((status.kind === 'planned' || status.kind === 'unavailable') && typeof status.content === 'string') {
          day.status = { kind: status.kind, content: status.content };
        }
      }
      if (Array.isArray(candidate.memos)) {
        day.memos = candidate.memos.filter((memo): memo is CalendarMemo =>
          Boolean(memo) && typeof memo.id === 'string' && typeof memo.author === 'string' && typeof memo.content === 'string',
        ).map(({ id, author, content }) => ({ id, author, content }));
      }
      if (day.status || day.memos.length > 0) snapshot.vessels[vessel][date] = day;
    }
  }
  return snapshot;
}

export function createCalendarRepository(storage: CalendarStorage): CalendarRepository {
  return {
    load() {
      try {
        const raw = storage.getItem(DATA_KEY);
        return raw ? normalizeSnapshot(JSON.parse(raw)) : emptyCalendar();
      } catch {
        return emptyCalendar();
      }
    },
    save(snapshot) {
      storage.setItem(DATA_KEY, JSON.stringify(snapshot));
    },
    getLastVessel() {
      try { return storage.getItem(VESSEL_KEY) === '103' ? '103' : '101'; }
      catch { return '101'; }
    },
    setLastVessel(vessel) {
      storage.setItem(VESSEL_KEY, vessel);
    },
  };
}

function replaceDay(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string, day: CalendarDay): CalendarSnapshot {
  if (!isValidDateKey(date)) throw new Error('올바르지 않은 날짜입니다.');
  const days = { ...snapshot.vessels[vessel] };
  if (day.status || day.memos.length > 0) days[date] = day;
  else delete days[date];
  return { version: 1, vessels: { ...snapshot.vessels, [vessel]: days } };
}

export function setVoyageStatus(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string, status: VoyageStatus): CalendarSnapshot {
  return replaceDay(snapshot, vessel, date, { ...getCalendarDay(snapshot, vessel, date), status });
}

export function deleteVoyageStatus(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string): CalendarSnapshot {
  const { memos } = getCalendarDay(snapshot, vessel, date);
  return replaceDay(snapshot, vessel, date, { memos });
}

export function setCalendarMemo(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string, memo: CalendarMemo): CalendarSnapshot {
  const day = getCalendarDay(snapshot, vessel, date);
  const exists = day.memos.some((item) => item.id === memo.id);
  const memos = exists ? day.memos.map((item) => item.id === memo.id ? memo : item) : [...day.memos, memo];
  return replaceDay(snapshot, vessel, date, { ...day, memos });
}

export function deleteCalendarMemo(snapshot: CalendarSnapshot, vessel: CalendarVessel, date: string, id: string): CalendarSnapshot {
  const day = getCalendarDay(snapshot, vessel, date);
  return replaceDay(snapshot, vessel, date, { ...day, memos: day.memos.filter((item) => item.id !== id) });
}

export function dateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthCells(year: number, monthIndex: number): Array<string | null> {
  const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(dateKey(year, monthIndex, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
