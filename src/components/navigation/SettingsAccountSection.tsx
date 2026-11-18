import { useState } from 'react';
import { AccountPanel } from '../auth/AccountPanel';
import { installationInstructions } from '../../services/pwaInstallation';

export function SettingsAccountSection({ isStandalone, canInstall, onInstall }: {
  isStandalone: boolean;
  canInstall: boolean;
  onInstall: () => Promise<void>;
}) {
  const [showGuide, setShowGuide] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const install = async () => {
    if (installing || isStandalone) return;
    if (!canInstall) { setShowGuide((value) => !value); return; }
    setInstalling(true); setError('');
    try { await onInstall(); }
    catch { setError('설치 창을 열지 못했습니다. 아래 안내에 따라 브라우저 메뉴에서 추가해 주세요.'); setShowGuide(true); }
    finally { setInstalling(false); }
  };
  return <section aria-labelledby="settings-account-title" className="space-y-3">
    <h3 id="settings-account-title" className="text-sm font-black text-[#003360]">계정 관리</h3>
    <AccountPanel showUidCopy />
    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-[#003360]">
      <h4 className="text-sm font-black">홈 화면에 추가</h4>
      {isStandalone ? <p role="status" className="mt-2 text-sm">설치된 앱으로 사용 중입니다.</p> : <>
        <p className="mt-2 text-xs leading-relaxed">휴대폰 홈 화면에서 바다꼼꼬미를 바로 열 수 있습니다.</p>
        <button type="button" disabled={installing} onClick={() => void install()}
          aria-expanded={!canInstall ? showGuide : undefined}
          className="mt-3 min-h-11 rounded-xl bg-[#0066b3] px-3 text-sm font-bold text-white disabled:opacity-50">
          {installing ? '설치 창 여는 중…' : '홈 화면에 추가'}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
        {showGuide && <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {installationInstructions(navigator).map((step) => <li key={step}>{step}</li>)}
        </ol>}
      </>}
    </div>
  </section>;
}
