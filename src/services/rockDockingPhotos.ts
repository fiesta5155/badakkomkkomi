import { getStorage, ref, getBlob } from 'firebase/storage';
import { getFirebaseClient } from './firebaseClient';
import { ROCK_DOCKING_PHOTO_MAX_BYTES, ROCK_DOCKING_STORAGE_ENABLED } from '../config/rockDocking';
import { createRockPhotoStore, putStoredRockPhoto, removeStoredRockPhoto } from './rockDockingPhotoStorage';
import { isFixedRockPhoto, validateRockPhotoData, rockSaveStep } from './rockDockingPhotoPlan';
import type { RockPhoto } from './rockDockingModel';

export function rockStorageReady() { return ROCK_DOCKING_STORAGE_ENABLED && Boolean(getFirebaseClient()?.db.app.options.storageBucket); }
function storage() { const client = getFirebaseClient(); if (!rockStorageReady() || !client) throw Error('사진 저장소가 연결되지 않았습니다.'); return getStorage(client.db.app); }
export async function compressRockPhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25 * 1024 * 1024) throw Error('25MB 이하 JPG·PNG·WebP 사진을 선택해 주세요.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 80000000) throw Error('사진 크기를 확인해 주세요.');
    for (const max of [1600, 1280, 960, 640]) {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d'); if (!context) throw Error('사진 변환을 지원하지 않는 브라우저입니다.'); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [.85, .7, .55, .4]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob || blob.type !== 'image/webp') throw Error('WebP 사진 변환을 지원하지 않는 브라우저입니다.');
        if (blob.size <= ROCK_DOCKING_PHOTO_MAX_BYTES) return { blob, width: canvas.width, height: canvas.height };
      }
    }
    throw Error('사진을 더 작은 크기로 선택해 주세요.');
  } finally { bitmap.close(); }
}
export async function uploadRockPhoto(pointId: string, ownerUid: string, role: RockPhoto['role'], data: { blob: Blob; width: number; height: number }, photoId: string): Promise<RockPhoto> {
  if (!isFixedRockPhoto(photoId)) throw Error('고정 사진 슬롯을 확인해 주세요.');
  validateRockPhotoData(data);
  const photo: RockPhoto = { id:photoId, path:'rockDocking/'+pointId+'/'+ownerUid+'/'+photoId+'.webp', role, size:data.blob.size, width:data.width, height:data.height };
  await putStoredRockPhoto(storage(),photo,data.blob); return photo;
}
// Authenticated blob reads: never create public download-token URLs.
export async function loadRockPhoto(photo: RockPhoto) { return rockSaveStep('사진 조회',photo.path,() => getBlob(ref(storage(), photo.path), ROCK_DOCKING_PHOTO_MAX_BYTES)); }
export async function removeRockPhoto(photo: RockPhoto) { return removeStoredRockPhoto(storage(),photo); }
export function rockPhotoStore(unchanged: () => Promise<boolean>) { return createRockPhotoStore(storage(),unchanged); }
