import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { CalendarVessel } from './calendarRepository.ts';
import type { UserProfile } from './userProfileService.ts';
import { assertExpectedEntry, parseSharedEntry, validCalendarDate, validEntryId } from './sharedCalendarModel.ts';
import type { EntryKind, SharedEntry } from './sharedCalendarModel.ts';

function assertOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('calendar/offline');
}

export function subscribeCalendar(db: Firestore, vessel: CalendarVessel, month: string,
  next: (entries: SharedEntry[], fromCache: boolean) => void, error: (cause: unknown) => void) {
  const q = query(collection(db, 'calendarVessels', vessel, 'entries'),
    where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`), orderBy('date'));
  return onSnapshot(q, { includeMetadataChanges: true }, (snapshot) => {
    // 미확정 로컬 쓰기를 서버 저장 완료로 취급하지 않는다.
    if (snapshot.metadata.hasPendingWrites) return;
    try { next(snapshot.docs.map((item) => parseSharedEntry(item.id, item.data())), snapshot.metadata.fromCache); }
    catch (cause) { error(cause); }
  }, error);
}

export function subscribeCalendarAdmin(db: Firestore, uid: string, next: (admin: boolean) => void, error: (cause: unknown) => void) {
  return onSnapshot(doc(db, 'calendarAdmins', uid), { includeMetadataChanges: true },
    (snapshot) => next(!snapshot.metadata.fromCache && snapshot.exists() && snapshot.data().enabled === true), error);
}

export async function saveSharedEntry(db: Firestore, vessel: CalendarVessel, profile: UserProfile,
  input: { id: string; date: string; kind: EntryKind; content: string; expected?: SharedEntry }) {
  assertOnline();
  const content = input.content.trim();
  if (!validCalendarDate(input.date) || !validEntryId(input.id, input.date, input.kind) || !content || content.length > 2000) {
    throw new Error('calendar/invalid-data');
  }
  const ref = doc(db, 'calendarVessels', vessel, 'entries', input.id);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists() ? parseSharedEntry(snapshot.id, snapshot.data()) : null;
    if (input.expected) {
      assertExpectedEntry(current, input.expected);
      if (current!.authorUid !== profile.uid) throw new Error('calendar/forbidden');
      tx.update(ref, { kind: input.kind, content, revision: current!.revision + 1, updatedAt: serverTimestamp() });
    } else {
      if (current) throw new Error('calendar/exists');
      tx.set(ref, { schemaVersion: 1, date: input.date, kind: input.kind, content,
        authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 });
    }
  });
}

export async function deleteSharedEntry(db: Firestore, vessel: CalendarVessel, expected: SharedEntry) {
  assertOnline();
  const ref = doc(db, 'calendarVessels', vessel, 'entries', expected.id);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    assertExpectedEntry(snapshot.exists() ? parseSharedEntry(snapshot.id, snapshot.data()) : null, expected);
    tx.delete(ref);
  });
}
