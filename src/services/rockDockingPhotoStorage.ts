import { ref, getBytes, getMetadata, uploadBytes, deleteObject, type FirebaseStorage } from 'firebase/storage';
import { validateRockPhotoData, isFixedRockPhoto, rockSaveStep, type RockPhotoStore } from './rockDockingPhotoPlan.ts';
import type { RockPhoto } from './rockDockingModel.ts';
import { ROCK_DOCKING_PHOTO_MAX_BYTES } from '../config/rockDocking.ts';
function address(photo: RockPhoto) {
  const parts = photo.path.split('/');
  if (parts.length !== 4 || parts[0] !== 'rockDocking' || !parts[1] || !parts[2] || parts[3] !== photo.id + '.webp' || !/^[0-9a-f-]{36}$/.test(photo.id)) throw Error('사진 저장 경로를 확인해 주세요.');
  return { pointId: parts[1], ownerUid: parts[2] };
}
export async function putStoredRockPhoto(storage: FirebaseStorage, photo: RockPhoto, blob: Blob) {
  const { pointId, ownerUid } = address(photo);
  if (!isFixedRockPhoto(photo.id)) throw Error('고정 사진 슬롯만 저장할 수 있습니다.');
  validateRockPhotoData({ blob, width: photo.width, height: photo.height });
  await rockSaveStep('사진 업로드',photo.path,() => uploadBytes(ref(storage,photo.path),blob,{ contentType:'image/webp', cacheControl:'private, no-store', customMetadata:{ pointId, ownerUid, photoId:photo.id } }));
}
export async function removeStoredRockPhoto(storage: FirebaseStorage, photo: RockPhoto) {
  address(photo);
  await rockSaveStep('사진 삭제',photo.path,async () => {
    try { await deleteObject(ref(storage,photo.path)); } catch (e) { if ((e as {code?:string}).code !== 'storage/object-not-found') throw e; }
  });
}
export function createRockPhotoStore(storage: FirebaseStorage, unchanged: () => Promise<boolean>): RockPhotoStore {
  return {
    async read(photo) {
      address(photo);
      return rockSaveStep('사진 백업',photo.path,async () => {
        const file = ref(storage,photo.path);
        let metadata;
        try { metadata = await getMetadata(file); }
        catch (e) { if ((e as {code?:string}).code === 'storage/object-not-found') return null; throw e; }
        // New slots have no bytes to back up. Never issue a media download for a missing object.
        const bytes = await getBytes(file,ROCK_DOCKING_PHOTO_MAX_BYTES);
        const blob = new Blob([bytes],{type:metadata.contentType ?? ''});
        if (blob.type !== 'image/webp' || !blob.size) throw Error('기존 사진을 안전하게 백업하지 못했습니다.'); return blob;
      });
    },
    write: (photo,data) => putStoredRockPhoto(storage,photo,data.blob),
    restore: (photo,blob) => putStoredRockPhoto(storage,photo,blob),
    remove: photo => removeStoredRockPhoto(storage,photo),
    unchanged,
  };
}
