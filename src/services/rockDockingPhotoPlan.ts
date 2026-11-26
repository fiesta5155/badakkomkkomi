import { ROCK_DOCKING_PHOTO_IDS, ROCK_DOCKING_PHOTO_MAX_BYTES } from '../config/rockDocking.ts';
import type { RockPhoto } from './rockDockingModel.ts';
export interface RockPhotoData { blob: Blob; width: number; height: number }
export interface RockPhotoDraft { role: RockPhoto['role']; photo?: RockPhoto; data?: RockPhotoData }
export interface RockPhotoPlan { photos: RockPhoto[]; writes: { photo: RockPhoto; data: RockPhotoData }[]; removals: RockPhoto[] }
export function sameRockPhotos(a: readonly RockPhoto[], b: readonly RockPhoto[]) {
  const fields = ['id','path','role','size','width','height'] as const;
  return a.length === b.length && a.every((photo,index) => fields.every(key => photo[key] === b[index][key]));
}
export const isFixedRockPhoto = (id: string) => (ROCK_DOCKING_PHOTO_IDS as readonly string[]).includes(id);
export function validateRockPhotoData(data: RockPhotoData) {
  if (data.blob.type !== 'image/webp' || !data.blob.size || data.blob.size > ROCK_DOCKING_PHOTO_MAX_BYTES
    || !Number.isInteger(data.width) || !Number.isInteger(data.height) || Math.min(data.width,data.height) < 1 || Math.max(data.width,data.height) > 1600) throw Error('사진 크기와 WebP 형식을 확인해 주세요.');
}
export function planRockPhotos(pointId: string, ownerUid: string, drafts: RockPhotoDraft[], current: RockPhoto[]): RockPhotoPlan {
  if (!pointId || !ownerUid || /[/\\]/.test(pointId + ownerUid) || drafts.length > 4) throw Error('사진은 지점당 최대 4장입니다.');
  const items = drafts.filter(d => d.data || d.photo);
  const reserved = items.flatMap(d => d.photo && (!d.data || isFixedRockPhoto(d.photo.id)) ? [d.photo.id] : []);
  if (new Set(reserved).size !== reserved.length) throw Error('사진 슬롯이 중복되었습니다.');
  const used = new Set(reserved), writes: RockPhotoPlan['writes'] = [];
  const photos = items.map(d => {
    if (!['wide','close','extra'].includes(d.role)) throw Error('사진 구분을 확인해 주세요.');
    if (d.photo && d.photo.path !== 'rockDocking/' + pointId + '/' + ownerUid + '/' + d.photo.id + '.webp') throw Error('다른 지점의 사진은 사용할 수 없습니다.');
    if (!d.data) return { ...d.photo!, role: d.role };
    validateRockPhotoData(d.data);
    const id = d.photo && isFixedRockPhoto(d.photo.id) ? d.photo.id : ROCK_DOCKING_PHOTO_IDS.find(v => !used.has(v));
    if (!id) throw Error('사진 슬롯이 부족합니다.'); used.add(id);
    const photo: RockPhoto = { id, path: 'rockDocking/' + pointId + '/' + ownerUid + '/' + id + '.webp', role: d.role, size: d.data.blob.size, width: d.data.width, height: d.data.height };
    writes.push({ photo, data: d.data }); return photo;
  });
  if (photos.filter(p => p.role === 'wide').length > 1 || photos.filter(p => p.role === 'close').length > 1 || photos.filter(p => p.role === 'extra').length > 2) throw Error('원경·근경과 추가 사진 2장까지 등록할 수 있습니다.');
  return { photos, writes, removals: current.filter(p => !photos.some(next => next.path === p.path)) };
}
export interface RockPhotoStore {
  read(photo: RockPhoto): Promise<Blob | null>;
  write(photo: RockPhoto, data: RockPhotoData): Promise<void>;
  restore(photo: RockPhoto, blob: Blob): Promise<void>;
  remove(photo: RockPhoto): Promise<void>;
  unchanged(): Promise<boolean>;
}
// Keep diagnostic context, never Firebase response bodies/URLs (which may contain tokens).
export class RockSaveStageError extends Error {
  readonly stage: string;
  readonly path: string;
  readonly code: string | undefined;
  constructor(stage: string, path: string, cause: unknown) {
    const code = rockSaveDiagnostic(cause).code;
    super(stage + ' 단계에서 실패했습니다.' + (code ? ` (${code})` : ''), { cause }); this.stage = stage; this.path = path; this.code = code;
  }
}
export async function rockSaveStep<T>(stage: string, path: string, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (cause) { throw new RockSaveStageError(stage,path,cause); }
}
export function rockSaveDiagnostic(error: unknown) {
  let value = error, stage: string | undefined, path: string | undefined, code: string | undefined;
  for (let depth = 0; depth < 12 && value && typeof value === 'object'; depth++) {
    if (value instanceof RockSaveStageError) { stage = value.stage; path = value.path; }
    const item = value as { code?: unknown; cause?: unknown };
    if (typeof item.code === 'string' && /^(?:storage\/|firestore\/)?[a-z][a-z-]+$/.test(item.code)) code = item.code;
    value = item.cause;
  }
  return { stage, path, code };
}
export class RockPhotoSaveError extends Error {
  readonly needsReload: boolean;
  constructor(message: string, needsReload: boolean, cause?: unknown) { super(message, { cause }); this.needsReload = needsReload; }
}
export class RockPhotoCommitUncertain extends RockPhotoSaveError {
  constructor(cause?: unknown) { super('사진 저장 결과를 확인하지 못했습니다. 다시 열어 확인해 주세요.', true, cause); }
}
// Storage and Firestore cannot form one atomic transaction. Back up affected blobs,
// mutate fixed slots, commit metadata, and compensate only while the revision is unchanged.
export async function applyRockPhotoPlan(plan: RockPhotoPlan, store: RockPhotoStore, commit: (photos: RockPhoto[]) => Promise<void>) {
  const fixedRemovals = plan.removals.filter(p => isFixedRockPhoto(p.id));
  const changed = [...plan.writes.map(w => w.photo), ...fixedRemovals];
  if (new Set(changed.map(p => p.path)).size !== changed.length) throw Error('사진 작업 경로가 중복되었습니다.');
  const backups = new Map(await Promise.all(changed.map(async p => [p.path, await store.read(p)] as const)));
  if (!await store.unchanged()) throw new RockPhotoSaveError('다른 변경이 반영되었습니다. 다시 열어 주세요.',true);
  const attempted: RockPhoto[] = [];
  try {
    for (const { photo, data } of plan.writes) { attempted.push(photo); await store.write(photo,data); }
    for (const photo of fixedRemovals) { attempted.push(photo); await store.remove(photo); }
    await commit(plan.photos);
  } catch (cause) {
    if (cause instanceof RockPhotoCommitUncertain) throw cause;
    let safe = false; try { safe = await store.unchanged(); } catch { /* unknown server state: do not overwrite newer work */ }
    if (!safe) throw new RockPhotoCommitUncertain(cause);
    const results = await Promise.allSettled([...attempted].reverse().map(photo => {
      const original = backups.get(photo.path); return original ? store.restore(photo,original) : store.remove(photo);
    }));
    if (results.some(r => r.status === 'rejected')) throw new RockPhotoSaveError('일부 사진을 복구하지 못했습니다. 다시 열어 확인해 주세요.',true,cause);
    throw new RockPhotoSaveError('사진을 저장하지 못해 이전 상태로 되돌렸습니다. 다시 시도해 주세요.',false,cause);
  }
  // Legacy random names remain readable/deletable, but cannot be recreated by the new
  // rules. Remove them only after metadata commits, preserving rollback before commit.
  const legacy = plan.removals.filter(p => !isFixedRockPhoto(p.id));
  const cleanup = await Promise.allSettled(legacy.map(p => store.remove(p)));
  return { cleanupFailed: legacy.filter((_,i) => cleanup[i].status === 'rejected') };
}
