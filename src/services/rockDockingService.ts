import { collection, doc, getDoc, getDocFromServer, onSnapshot, query, where, orderBy, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { rockIslandId, rockIslandName, validateRock, validateRockNote, type RockPoint, type RockInput, type RockIsland, type RockNote } from './rockDockingModel.ts';
import type { UserProfile } from './userProfileService.ts';
const stamp = (v: unknown) => Boolean(v && typeof (v as { seconds: number }).seconds === 'number');
const online = () => { if (typeof navigator !== 'undefined' && navigator.onLine === false) throw Error('오프라인에서는 저장할 수 없습니다.'); };
export async function getRockPoint(db: Firestore, id: string, serverOnly = false) { const s = await (serverOnly ? getDocFromServer : getDoc)(doc(db, 'rockDockingPoints', id)); if (!s.exists()) throw Error('접안정보를 찾을 수 없습니다.'); return parseRockPoint(id, s.data()); }
export function parseRockPoint(id: string, value: unknown): RockPoint {
  const p = value as RockPoint; validateRock(p, id, p.authorUid);
  if (p.schemaVersion !== 1 || !p.authorUid || !/^[가-힣]{2}$/.test(p.authorName) || !p.updatedBy || !stamp(p.createdAt) || !stamp(p.updatedAt) || !Number.isInteger(p.revision) || p.revision < 1 || typeof p.deleted !== 'boolean') throw Error('접안정보 형식 오류');
  return { ...p, id };
}
export function parseRockNote(id: string, value: unknown): RockNote {
  const n = value as RockNote; validateRockNote(n.text);
  if (!n.authorUid || !/^[가-힣]{2}$/.test(n.authorName) || !stamp(n.createdAt) || !stamp(n.updatedAt) || !Number.isInteger(n.revision) || n.revision < 1 || typeof n.pinned !== 'boolean') throw Error('메모 형식 오류');
  return { ...n, id };
}
export function subscribeRockPoints(db: Firestore, next: (rows: RockPoint[], cache: boolean) => void, error: (e: unknown) => void) {
  return onSnapshot(query(collection(db, 'rockDockingPoints'), where('deleted', '==', false)), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.hasPendingWrites) return;
    try { next(snap.docs.map(d => parseRockPoint(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name, 'ko')), snap.metadata.fromCache); } catch (e) { error(e); }
  }, error);
}
export function subscribeRockIslands(db: Firestore, next: (rows: RockIsland[], cache: boolean) => void, error: (e: unknown) => void) {
  return onSnapshot(collection(db, 'rockDockingIslands'), { includeMetadataChanges: true }, snap => {
    if (snap.metadata.hasPendingWrites) return;
    try { const rows = snap.docs.map(d => { const name = d.data().name; if (typeof name !== 'string' || rockIslandId(name) !== d.id) throw Error('섬 이름 형식 오류'); return { id: d.id, name }; }); next(rows.sort((a, b) => a.name.localeCompare(b.name, 'ko')), snap.metadata.fromCache); } catch (e) { error(e); }
  }, error);
}
export function subscribeRockNotes(db: Firestore, pointId: string, next: (notes: RockNote[]) => void, error: (e: unknown) => void) {
  return onSnapshot(query(collection(db, 'rockDockingPoints', pointId, 'notes'), orderBy('createdAt', 'desc')), snap => {
    if (snap.metadata.hasPendingWrites) return;
    try { next(snap.docs.map(d => parseRockNote(d.id, d.data())).sort((a, b) => Number(b.pinned) - Number(a.pinned))); } catch (e) { error(e); }
  }, error);
}
export async function ensureRockIsland(db: Firestore, profile: UserProfile, value: string) {
  online(); const name = rockIslandName(value), id = rockIslandId(value), ref = doc(db, 'rockDockingIslands', id);
  await runTransaction(db, async tx => { const s = await tx.get(ref); if (!s.exists()) tx.set(ref, { name, createdBy: profile.uid, createdAt: serverTimestamp() }); });
  return id;
}
function requireRevision(current: RockPoint | RockNote | null, expected: RockPoint | RockNote) {
  if (!current || current.revision !== expected.revision || current.authorUid !== expected.authorUid) throw Error('다른 변경이 반영되었습니다. 다시 열어 주세요.');
}
export async function saveRockPoint(db: Firestore, profile: UserProfile, input: RockInput, expected?: RockPoint, memo?: { text: string; pinned: boolean }) {
  online(); const id = expected?.id ?? crypto.randomUUID(), ref = doc(db, 'rockDockingPoints', id);
  validateRock(input, id, expected?.authorUid ?? profile.uid); if (memo?.text.trim()) validateRockNote(memo.text);
  const noteRef = doc(collection(ref, 'notes'));
  await runTransaction(db, async tx => {
    const [s, island] = await Promise.all([tx.get(ref), tx.get(doc(db, 'rockDockingIslands', input.islandId))]);
    if (!island.exists()) throw Error('섬을 먼저 선택해 주세요.');
    const current = s.exists() ? parseRockPoint(s.id, s.data()) : null;
    if (expected) { requireRevision(current, expected); if (current!.authorUid !== profile.uid || current!.deleted) throw Error('본인 자료만 수정할 수 있습니다.'); }
    else if (current) throw Error('이미 등록된 지점입니다.');
    const values = { ...input, name: input.name.trim(), updatedBy: profile.realName, updatedAt: serverTimestamp(), revision: (current?.revision ?? 0) + 1 };
    if (expected) tx.update(ref, values);
    else tx.set(ref, { ...values, deleted: false, schemaVersion: 1, authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp() });
    if (memo?.text.trim()) tx.set(noteRef, { text: memo.text.trim(), pinned: memo.pinned, authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 });
  });
  return id;
}
// A tombstone hides the point AND its notes immediately, before photo cleanup.
// Child notes remain inaccessible; no other employee's notes are silently erased.
export async function deleteRockPoint(db: Firestore, profile: UserProfile, expected: RockPoint) {
  online(); const ref = doc(db, 'rockDockingPoints', expected.id);
  await runTransaction(db, async tx => { const s = await tx.get(ref); const current = s.exists() ? parseRockPoint(s.id, s.data()) : null; requireRevision(current, expected);
    tx.update(ref, { deleted: true, updatedBy: profile.realName, updatedAt: serverTimestamp(), revision: expected.revision + 1 }); });
}
export async function saveRockNote(db: Firestore, profile: UserProfile, pointId: string, text: string, pinned: boolean, expected?: RockNote) {
  online(); validateRockNote(text); const ref = doc(db, 'rockDockingPoints', pointId, 'notes', expected?.id ?? crypto.randomUUID());
  await runTransaction(db, async tx => { const s = await tx.get(ref); const current = s.exists() ? parseRockNote(s.id, s.data()) : null;
    if (expected) { requireRevision(current, expected); if (expected.authorUid !== profile.uid) throw Error('본인 메모만 수정할 수 있습니다.'); }
    else if (current) throw Error('이미 등록된 메모입니다.');
    const fields = { text: text.trim(), pinned, updatedAt: serverTimestamp(), revision: (current?.revision ?? 0) + 1 };
    if (expected) tx.update(ref, fields); else tx.set(ref, { ...fields, authorUid: profile.uid, authorName: profile.realName, createdAt: serverTimestamp() });
  });
}
export async function deleteRockNote(db: Firestore, pointId: string, expected: RockNote) {
  online(); const ref = doc(db, 'rockDockingPoints', pointId, 'notes', expected.id);
  await runTransaction(db, async tx => { const s = await tx.get(ref); requireRevision(s.exists() ? parseRockNote(s.id, s.data()) : null, expected); tx.delete(ref); });
}
