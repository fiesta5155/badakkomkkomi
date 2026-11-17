import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  realName: string;
}

export const REAL_NAME_HELP = '이름은 한글 완성형 정확히 2글자로 입력해 주세요. (예: 범진, 승환)';

export function isValidRealName(value: unknown): value is string {
  return typeof value === 'string' && value.length === 2 && /^[가-힣]{2}$/u.test(value);
}

export function parseUserProfile(value: unknown, uid: string): UserProfile | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<UserProfile>;
  if (candidate.uid !== uid || !isValidRealName(candidate.realName)) return null;
  return { uid, realName: candidate.realName };
}

export async function loadUserProfile(db: Firestore, uid: string): Promise<UserProfile | null> {
  // 서버 조회 오류를 '프로필 없음'으로 취급해 기존 프로필을 덮어쓰지 않는다.
  const snapshot = await getDocFromServer(doc(db, 'users', uid));
  if (!snapshot.exists()) return null;
  const profile = parseUserProfile(snapshot.data(), uid);
  if (!profile) throw new Error('profile/invalid');
  return profile;
}

export async function saveUserProfile(db: Firestore, uid: string, realName: string): Promise<UserProfile> {
  if (!isValidRealName(realName)) throw new Error('profile/invalid-name');
  const ref = doc(db, 'users', uid);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists() && !parseUserProfile(existing.data(), uid)) {
      throw new Error('profile/invalid');
    }
    transaction.set(ref, {
      uid,
      realName,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return { uid, realName };
}

export function firebaseErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'auth/popup-closed-by-user': return '로그인을 취소했습니다.';
    case 'auth/cancelled-popup-request': return '이미 로그인 창이 열려 있습니다.';
    case 'auth/popup-blocked': return '로그인 팝업을 허용한 뒤 다시 시도해 주세요. 일반 Chrome 또는 Edge에서도 이용할 수 있습니다.';
    case 'auth/unauthorized-domain': return '이 접속 주소가 Firebase 로그인 허용 도메인에 등록되지 않았습니다.';
    case 'auth/operation-not-allowed': return 'Firebase 콘솔에서 Google 로그인을 활성화해 주세요.';
    case 'auth/network-request-failed':
    case 'unavailable': return '인터넷 연결을 확인한 뒤 다시 시도해 주세요.';
    case 'permission-denied': return '프로필 접근 권한을 확인할 수 없습니다. Firestore Rules 설정을 확인해 주세요.';
    default: return '계정 정보를 처리하지 못했습니다. 연결 및 Firebase 설정을 확인한 뒤 다시 시도해 주세요.';
  }
}
