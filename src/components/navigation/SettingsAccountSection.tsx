import { useState } from 'react';
import { ChevronRight, Download } from 'lucide-react';
import { AccountPanel } from '../auth/AccountPanel';
import { installationInstructions } from '../../services/pwaInstallation';

export function SettingsAccountSection() {
  return <AccountPanel showUidCopy uidLabel="고급 정보" />;
}

export function SettingsInstallMenuItem({ isStandalone, canInstall, onInstall }: {
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
    catch { setError('설치 창을 열지 못했습니다. 브라우저 메뉴에서 추가해 주세요.'); setShowGuide(true); }
    finally { setInstalling(false); }
  };
  return <div className="border-b border-sky-100">
    <button type="button" disabled={installing || isStandalone} onClick={() => void install()}
      aria-expanded={!isStandalone && (!canInstall || showGuide) ? showGuide : undefined}
      aria-controls={!isStandalone ? 'settings-install-guide' : undefined}
      className="flex min-h-20 w-full touch-manipulation items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-sky-50 disabled:cursor-default">
      <Download className="h-5 w-5 shrink-0 text-[#00846c]" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold">홈 화면에 추가</span>
        <span className="mt-1 block text-xs text-slate-600" role="status">{isStandalone ? '홈 화면에서 사용 중' : installing ? '설치 창 여는 중…' : '휴대폰 홈 화면에서 바로 열기'}</span></span>
      {!isStandalone && <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
    {!isStandalone && <div id="settings-install-guide">
      {error && <p role="alert" className="px-2 pb-2 text-sm text-rose-700">{error}</p>}
      {showGuide && <ol className="list-decimal space-y-2 pr-2 pb-4 pl-8 text-sm leading-relaxed text-slate-700">
        {installationInstructions(navigator).map((step) => <li key={step}>{step}</li>)}
      </ol>}
    </div>}
  </div>;
}
