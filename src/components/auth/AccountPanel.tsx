import { useRef, useState } from 'react';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';

function UidDisclosure({ uid, allowCopy }: { uid: string; allowCopy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uid);
      setMessage('UID를 복사했습니다.');
    } catch {
      input.current?.focus();
      input.current?.select();
      setMessage('자동 복사를 사용할 수 없습니다. 선택된 UID를 길게 눌러 복사해 주세요.');
    }
  };
  return <details className="mt-1 text-xs">
    <summary className={`cursor-pointer ${allowCopy ? 'min-h-11 py-3' : 'py-1'}`}>내 Firebase UID 확인</summary>
    <p className="mt-1">현재 로그인 계정의 UID입니다. 관리자 지정은 이 값으로 확인합니다.</p>
    <input ref={input} aria-label="내 Firebase Auth UID" readOnly value={uid} onFocus={(event) => event.target.select()}
      className={`mt-1 min-h-9 w-full rounded-lg border border-sky-200 bg-sky-50 px-2 font-mono select-text ${allowCopy ? 'text-base' : 'text-xs'}`} />
    {allowCopy && <>
      <button type="button" onClick={() => void copy()} className="mt-2 min-h-11 rounded-lg border border-sky-200 bg-white px-3 text-sm font-bold">UID 복사</button>
      <p role="status" className="mt-1 leading-relaxed">{message}</p>
    </>}
  </details>;
}

export function AccountPanel({ showUidCopy = false }: { showUidCopy?: boolean }) {
  const auth = useFirebaseAuth();
  return (
    <section aria-label="사용자 계정" className="mb-2 rounded-xl border border-white/90 bg-white/95 px-3 py-2 text-[#003360] shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold" aria-live="polite">
          {auth.status === 'ready' ? `${auth.profile?.realName}님` : auth.user ? 'Google 로그인됨' : '바다꼼꼬미 계정'}
          {auth.status === 'loading' && ' · 확인 중…'}
        </span>
        <div className="flex items-center gap-2 text-xs font-bold">
          {auth.status === 'ready' && <button type="button" onClick={auth.editName} disabled={auth.busy} className="min-h-9 rounded-lg border border-sky-200 px-2 disabled:opacity-50">이름 변경</button>}
          {auth.user ? <button type="button" onClick={() => void auth.logout()} disabled={auth.busy} className="min-h-9 rounded-lg border border-sky-200 px-2 disabled:opacity-50">로그아웃</button>
            : <button type="button" onClick={() => void auth.login()} disabled={auth.busy || auth.status === 'loading' || auth.status === 'unconfigured'} className="min-h-9 rounded-lg bg-[#0066b3] px-3 text-white disabled:opacity-50">{auth.busy ? '로그인 중…' : 'Google 로그인'}</button>}
          {auth.status === 'profile-error' && <button type="button" onClick={() => void auth.retryProfile()} className="min-h-9 rounded-lg border border-sky-200 px-2">다시 확인</button>}
        </div>
      </div>
      {auth.error && <p role="alert" className="mt-1 text-xs leading-relaxed text-rose-700">{auth.error}</p>}
      {auth.user && <UidDisclosure key={auth.user.uid} uid={auth.user.uid} allowCopy={showUidCopy} />}
    </section>
  );
}
