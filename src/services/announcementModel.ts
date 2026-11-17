import type { EntryTimestamp } from './sharedCalendarModel.ts';

export interface AnnouncementInput { title: string; body: string; published: boolean; sortOrder: number }
export interface Announcement extends AnnouncementInput {
  id: string;
  schemaVersion: 1;
  createdBy: string;
  updatedBy: string;
  createdAt: EntryTimestamp;
  updatedAt: EntryTimestamp;
  revision: number;
}

export function validateAnnouncement(input: AnnouncementInput): AnnouncementInput {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 120
    || typeof input.body !== 'string' || !input.body.trim() || input.body.length > 10000
    || typeof input.published !== 'boolean' || !Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) {
    throw new Error('notice/invalid');
  }
  return { title: input.title.trim(), body: input.body.trim(), published: input.published, sortOrder: input.sortOrder };
}

export function parseAnnouncement(id: string, value: unknown): Announcement {
  const d = value as Announcement;
  validateAnnouncement(d);
  const timestamp = (v: EntryTimestamp) => v && Number.isInteger(v.seconds) && Number.isInteger(v.nanoseconds);
  if (d.schemaVersion !== 1 || typeof d.createdBy !== 'string' || !d.createdBy || typeof d.updatedBy !== 'string' || !d.updatedBy
    || !timestamp(d.createdAt) || !timestamp(d.updatedAt) || !Number.isInteger(d.revision) || d.revision < 1) throw new Error('notice/invalid');
  return { ...d, id };
}

export function sortAnnouncements(entries: Announcement[]): Announcement[] {
  return [...entries].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.seconds - b.createdAt.seconds
    || a.createdAt.nanoseconds - b.createdAt.nanoseconds || a.id.localeCompare(b.id));
}

export function publishedAnnouncements(entries: Announcement[]): Announcement[] {
  return sortAnnouncements(entries.filter((entry) => entry.published));
}

export function nextAnnouncementId(entries: Announcement[], currentId: string): string {
  if (!entries.length) return '';
  const index = Math.max(0, entries.findIndex((entry) => entry.id === currentId));
  return entries[(index + 1) % entries.length].id;
}

export function isAnnouncementAdmin(uid: string, settings: unknown): boolean {
  return Boolean(uid) && Boolean(settings) && typeof settings === 'object'
    && (settings as { adminUid?: unknown }).adminUid === uid;
}

export function announcementError(error: unknown): string {
  if (error instanceof Error && error.message === 'notice/invalid') return '제목 1~120자, 본문 1~10,000자, 정렬 순서 0~9999를 확인해 주세요.';
  if (error instanceof Error && error.message === 'notice/conflict') return '다른 화면에서 변경되었거나 삭제된 공지입니다. 입력을 복사해 보관한 뒤 최신 공지를 다시 열어 주세요.';
  if ((error as { code?: string })?.code === 'permission-denied') return '공지 접근 권한을 확인할 수 없습니다. 로그인·관리자 UID 설정과 공지 보안 규칙 적용 여부를 확인해 주세요.';
  return '공지를 처리하지 못했습니다. 연결을 확인하고 다시 시도해 주세요. 작성 내용은 유지됩니다.';
}
