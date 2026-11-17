import { useEffect, useRef, useState } from 'react';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';
import { isValidRealName, REAL_NAME_HELP } from '../../services/userProfileService';

export function RealNameDialog() {
  const auth = useFirebaseAuth();
  const open = auth.status === 'needs-name' || auth.editingName;
  return open ? <RealNameForm key={auth.user?.uid} /> : null;
}

function RealNameForm() {
  const auth = useFirebaseAuth();
  const [name, setName] = useState(() => auth.profile?.realName ?? '');
  const [composing, setComposing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} aria-labelledby="real-name-title" aria-describedby="real-name-help" onCancel={(event) => {
      event.preventDefault();
      if (auth.editingName && !auth.busy) auth.cancelEditName();
    }} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-sky-200 bg-white p-5 text-[#003360] shadow-2xl backdrop:bg-slate-950/50">
      <h2 id="real-name-title" className="text-lg font-black">{auth.editingName ? '실명 변경' : '처음 오셨네요. 실명을 등록해 주세요.'}</h2>
      <p id="real-name-help" className="mt-2 text-sm leading-relaxed">{REAL_NAME_HELP}</p>
      <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!composing && isValidRealName(name)) void auth.saveName(name); }}>
        <label className="block text-sm font-bold">실명
          <input ref={input} value={name} onChange={(event) => setName(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }} required minLength={2} maxLength={2} pattern="[가-힣]{2}" autoComplete="name" disabled={auth.busy} className="mt-1 min-h-11 w-full rounded-xl border border-sky-300 bg-white px-3 outline-none focus:border-[#008ca3]" />
        </label>
        {name && !isValidRealName(name) && <p className="text-xs text-rose-700">한글 완성형 두 글자만 사용할 수 있습니다.</p>}
        {auth.error && <p role="alert" className="text-sm text-rose-700">{auth.error}</p>}
        <button type="submit" disabled={auth.busy || composing || !isValidRealName(name)} className="min-h-11 w-full rounded-xl bg-[#008ca3] text-sm font-black text-white disabled:opacity-50">{auth.busy ? '저장 중…' : '이름 저장'}</button>
        {auth.editingName && <button type="button" onClick={auth.cancelEditName} disabled={auth.busy} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">취소</button>}
        <button type="button" onClick={() => void auth.logout()} disabled={auth.busy} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold disabled:opacity-50">로그아웃</button>
      </form>
    </dialog>
  );
}
