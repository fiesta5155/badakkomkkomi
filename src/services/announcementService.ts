import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import { isAnnouncementAdmin, parseAnnouncement, sortAnnouncements, validateAnnouncement } from './announcementModel.ts';
import type { Announcement, AnnouncementInput } from './announcementModel.ts';

export function subscribeAnnouncementAdmin(db: Firestore, uid: string, next: (admin: boolean) => void, error: (cause: unknown) => void) {
  return onSnapshot(doc(db, 'appSettings', 'announcements'), { includeMetadataChanges: true }, (snapshot) => {
    // 캐시만으로 관리자 권한을 활성화하지 않는다.
    next(!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites && snapshot.exists() && isAnnouncementAdmin(uid, snapshot.data()));
  }, error);
}

export function subscribeAnnouncements(db: Firestore, admin: boolean, next: (entries: Announcement[], fromCache: boolean) => void,
  error: (cause: unknown) => void) {
  const ref = collection(db, 'announcements');
  // Rules는 필터가 아니므로 일반 사용자의 조회에는 반드시 게시 조건을 붙인다.
  const source = admin ? query(ref) : query(ref, where('published', '==', true));
  return onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
    if (snapshot.metadata.hasPendingWrites) return;
    try { next(sortAnnouncements(snapshot.docs.map((item) => parseAnnouncement(item.id, item.data()))), snapshot.metadata.fromCache); }
    catch (cause) { error(cause); }
  }, error);
}

function assertCurrent(current: Announcement | null, expected: Announcement) {
  if (!current || current.revision !== expected.revision || current.createdAt.seconds !== expected.createdAt.seconds
    || current.createdAt.nanoseconds !== expected.createdAt.nanoseconds || current.createdBy !== expected.createdBy) throw new Error('notice/conflict');
}

export async function saveAnnouncement(db: Firestore, uid: string, id: string, input: AnnouncementInput, expected?: Announcement) {
  const clean = validateAnnouncement(input);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('notice/offline');
  const ref = doc(db, 'announcements', id);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists() ? parseAnnouncement(snapshot.id, snapshot.data()) : null;
    if (expected) {
      assertCurrent(current, expected);
      tx.update(ref, { ...clean, updatedBy: uid, updatedAt: serverTimestamp(), revision: current!.revision + 1 });
    } else {
      if (current) throw new Error('notice/conflict');
      tx.set(ref, { ...clean, schemaVersion: 1, createdBy: uid, updatedBy: uid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 });
    }
  });
}

export async function deleteAnnouncement(db: Firestore, expected: Announcement) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('notice/offline');
  const ref = doc(db, 'announcements', expected.id);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    assertCurrent(snapshot.exists() ? parseAnnouncement(snapshot.id, snapshot.data()) : null, expected);
    tx.delete(ref);
  });
}
