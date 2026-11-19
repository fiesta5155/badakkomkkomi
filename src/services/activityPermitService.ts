import { collection, doc, getDoc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, Timestamp, where, type Firestore } from 'firebase/firestore';
import { MAX_PERMIT_SELECTION, validatePermit, validPermitPolygon, permitExpiryDate, permitSnapshot, type ActivityPermit, type PermitInput, type PermitInvestigation } from './activityPermitModel.ts';
import { validCalendarDate, type EntryTimestamp } from './sharedCalendarModel.ts';
import type { UserProfile } from './userProfileService.ts';
const online = () => { if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('오프라인에서는 저장할 수 없습니다.'); };
const timestamp = (v: unknown) => Boolean(v && typeof (v as Timestamp).seconds === 'number' && typeof (v as Timestamp).nanoseconds === 'number');
export function parsePermit(id: string, value: unknown): ActivityPermit {
  const p = value as ActivityPermit; validatePermit(p);
  if (p.schemaVersion !== 1 || !p.authorUid || !/^[가-힣]{2}$/.test(p.authorName) || !Number.isInteger(p.revision) || p.revision < 1
    || !timestamp(p.createdAt) || !timestamp(p.updatedAt) || !timestamp(p.expiresAt)
    || p.expiresAt.seconds * 1000 + p.expiresAt.nanoseconds / 1e6 !== permitExpiryDate(p.endDate).getTime()) throw new Error('행위허가 자료 검증 실패');
  return { ...p, id };
}
export function parseInvestigation(id: string, value: unknown): PermitInvestigation {
  const s = value as PermitInvestigation;
  if (!s || s.schemaVersion !== 1 || !validCalendarDate(s.date) || !['101', '103'].includes(s.vessel) || !['planned', 'completed'].includes(s.status)
    || !s.permitId || !s.authorUid || !/^[가-힣]{2}$/.test(s.authorName) || !Number.isInteger(s.revision) || s.revision < 1 || !timestamp(s.createdAt) || !timestamp(s.updatedAt)
    || !s.permitSnapshot || !validPermitPolygon(s.permitSnapshot.vertices) || s.permitSnapshot.sourceCrs !== 'EPSG:4326'
    || !s.permitSnapshot.permitNumber || !s.permitSnapshot.target || !validCalendarDate(s.permitSnapshot.startDate) || !validCalendarDate(s.permitSnapshot.endDate)
    || s.date < s.permitSnapshot.startDate || s.date > s.permitSnapshot.endDate) throw new Error('조사 일정 자료 검증 실패');
  return { ...s, id };
}
export function subscribePermits(db: Firestore, next: (records: ActivityPermit[], cache: boolean) => void, error: (e: unknown) => void) {
  return onSnapshot(query(collection(db, 'activityPermits'), orderBy('endDate', 'desc')), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.hasPendingWrites) return;
    try { next(snap.docs.map(d => parsePermit(d.id, d.data())), snap.metadata.fromCache); } catch (e) { error(e); }
  }, error);
}
export function subscribeInvestigations(db: Firestore, vessel: string, month: string, next: (rows: PermitInvestigation[], cache: boolean) => void, error: (e: unknown) => void) {
  return onSnapshot(query(collection(db, 'permitInvestigations'), where('vessel', '==', vessel), where('date', '>=', `${month}-01`), where('date', '<=', `${month}-31`), orderBy('date')),
    { includeMetadataChanges: true }, snap => {
      if (snap.metadata.hasPendingWrites) return;
      try { next(snap.docs.map(d => parseInvestigation(d.id, d.data())), snap.metadata.fromCache); } catch (e) { error(e); }
    }, error);
}
const conflict = (current: {revision: number; authorUid: string; createdAt: EntryTimestamp} | null, expected: {revision: number; authorUid: string; createdAt: EntryTimestamp}) => {
  if (!current || current.revision !== expected.revision || current.authorUid !== expected.authorUid
    || current.createdAt.seconds !== expected.createdAt.seconds || current.createdAt.nanoseconds !== expected.createdAt.nanoseconds) throw new Error('다른 변경이 반영되었습니다. 화면을 다시 열어 주세요.');
};
export async function savePermit(db: Firestore, profile: UserProfile, input: PermitInput, expected?: ActivityPermit) {
  online(); validatePermit(input);
  const ref = doc(db, 'activityPermits', expected?.id ?? crypto.randomUUID());
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref), current = snap.exists() ? parsePermit(snap.id, snap.data()) : null;
    if (expected) { conflict(current, expected); if (current!.authorUid !== profile.uid) throw new Error('본인 자료만 수정할 수 있습니다.'); }
    else if (current) throw new Error('이미 등록된 자료입니다.');
    const fields = { ...input, permitNumber: input.permitNumber.trim(), target: input.target.trim(), notes: input.notes.trim(),
      expiresAt: Timestamp.fromDate(permitExpiryDate(input.endDate)), updatedAt: serverTimestamp(), revision: (current?.revision ?? 0) + 1 };
    if (expected) tx.update(ref, fields);
    else tx.set(ref, { ...fields, schemaVersion: 1, authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp() });
  });
  return ref.id;
}
export async function deletePermit(db: Firestore, expected: ActivityPermit) {
  online(); const ref = doc(db, 'activityPermits', expected.id);
  await runTransaction(db, async tx => { const d = await tx.get(ref); conflict(d.exists() ? parsePermit(d.id, d.data()) : null, expected); tx.delete(ref); });
}
export async function addInvestigations(db: Firestore, profile: UserProfile, ids: string[], vessel: string, date: string) {
  online(); if (!['101', '103'].includes(vessel) || !validCalendarDate(date) || !ids.length || ids.length > MAX_PERMIT_SELECTION || new Set(ids).size !== ids.length) throw new Error('조사 대상·날짜·선박을 확인해 주세요. 한 번에 5개까지 등록할 수 있습니다.');
  await runTransaction(db, async tx => {
    const docs = await Promise.all(ids.map(id => tx.get(doc(db, 'activityPermits', id))));
    const records = docs.map(d => { if (!d.exists()) throw new Error('삭제된 조사구역입니다.'); return parsePermit(d.id, d.data()); });
    for (const p of records) {
      if (date < p.startDate || date > p.endDate) throw new Error('선택한 날짜가 조사 가능 기간 밖입니다.');
      tx.set(doc(db, 'permitInvestigations', crypto.randomUUID()), { schemaVersion: 1, permitId: p.id, permitSnapshot: permitSnapshot(p),
        date, vessel, status: 'planned', authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 });
    }
  });
}
export async function updateInvestigation(db: Firestore, profile: UserProfile, expected: PermitInvestigation, input: {date: string; vessel: string; status: string}) {
  online(); if (!validCalendarDate(input.date) || !['101', '103'].includes(input.vessel) || !['planned', 'completed'].includes(input.status)) throw new Error('조사 일정 입력을 확인해 주세요.');
  const ref = doc(db, 'permitInvestigations', expected.id);
  await runTransaction(db, async tx => {
    const snap = await tx.get(ref); const current = snap.exists() ? parseInvestigation(snap.id, snap.data()) : null; conflict(current, expected);
    if (current!.authorUid !== profile.uid) throw new Error('본인 일정만 수정할 수 있습니다.');
    const p = await tx.get(doc(db, 'activityPermits', current!.permitId));
    const snapshot = p.exists() ? permitSnapshot(parsePermit(p.id, p.data())) : current!.permitSnapshot;
    if (input.date < snapshot.startDate || input.date > snapshot.endDate) throw new Error('조사 가능 기간 밖입니다.');
    tx.update(ref, { ...input, permitSnapshot: snapshot, revision: current!.revision + 1, updatedAt: serverTimestamp() });
  });
}
export async function deleteInvestigation(db: Firestore, expected: PermitInvestigation) {
  online(); const ref = doc(db, 'permitInvestigations', expected.id);
  await runTransaction(db, async tx => { const d = await tx.get(ref); conflict(d.exists() ? parseInvestigation(d.id, d.data()) : null, expected); tx.delete(ref); });
}
export async function readPermit(db: Firestore, id: string) { const d = await getDoc(doc(db, 'activityPermits', id)); return d.exists() ? parsePermit(d.id, d.data()) : null; }
