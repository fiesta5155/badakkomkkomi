import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SettingsAccountSection, SettingsInstallMenuItem } from './SettingsAccountSection';
import { SettingsInformation } from './SettingsInformation';
import { AlertCircle, ArrowLeft, BookOpen, Check, ChevronRight, Compass, Info, RotateCcw, UserRound, X } from 'lucide-react';
import type { WeatherThresholds } from '../../types/weather';
import { SAFE_DEFAULT_THRESHOLDS } from '../../services/ecmwfWeatherService';
import type { SourceCategoryKey } from '../../config/dataSources';

export type SettingsInitialSection = 'main' | 'thresholds' | 'guide' | 'sources';
type SettingsScreen = SettingsInitialSection | 'account';

interface WeatherThresholdSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  thresholds: WeatherThresholds;
  defaultThresholds?: WeatherThresholds;
  isCustomThresholds?: boolean;
  initialSection?: SettingsInitialSection;
  focusSourceId?: SourceCategoryKey | null;
  onSave: (thresholds: WeatherThresholds) => boolean | void;
  onReset?: () => void;
  isStandalone: boolean;
  canInstall: boolean;
  onInstall: () => Promise<void>;
}

export function WeatherThresholdSettings({
  isOpen,
  onClose,
  thresholds,
  defaultThresholds = SAFE_DEFAULT_THRESHOLDS,
  isCustomThresholds = false,
  initialSection = 'main',
  focusSourceId = null,
  onSave,
  onReset,
  isStandalone,
  canInstall,
  onInstall,
}: WeatherThresholdSettingsProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const menuButtonRefs = useRef<Partial<Record<SettingsScreen, HTMLButtonElement | null>>>({});
  const scrollPositions = useRef<Partial<Record<SettingsScreen, number>>>({});
  const returnFocus = useRef<SettingsScreen | null>(null);
  const windGoodInputRef = useRef<HTMLInputElement | null>(null);
  const waveGoodInputRef = useRef<HTMLInputElement | null>(null);
  const [screen, setScreen] = useState<SettingsScreen>(() => focusSourceId ? 'sources' : initialSection);

  const navigate = (next: SettingsScreen) => {
    scrollPositions.current[screen] = contentRef.current?.scrollTop ?? 0;
    returnFocus.current = next === 'main' ? screen : null;
    setScreen(next);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (isOpen && !dialog.open) dialog.showModal();
    else if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useLayoutEffect(() => {
    const button = returnFocus.current ? menuButtonRefs.current[returnFocus.current] : null;
    (button ?? headingRef.current)?.focus({ preventScroll: true });
    if (contentRef.current) contentRef.current.scrollTop = scrollPositions.current[screen] ?? 0;
  }, [screen]);

  // 모바일 키보드에서 백스페이스 삭제 시 '0' 강제 치환을 방지하기 위해 문자열 드래프트 상태 유지
  const [windGoodStr, setWindGoodStr] = useState<string>(() =>
    String(thresholds.windKnot.good),
  );
  const [windModStr, setWindModStr] = useState<string>(() =>
    String(thresholds.windKnot.moderate),
  );
  const [waveGoodStr, setWaveGoodStr] = useState<string>(() =>
    String(thresholds.waveMeter.good),
  );
  const [waveModStr, setWaveModStr] = useState<string>(() =>
    String(thresholds.waveMeter.moderate),
  );

  // modern-web-guidance (validate-input-after-interaction): blur 또는 submit 이후에만 에러 노출, 수정 즉시 해제
  const [windTouched, setWindTouched] = useState<boolean>(false);
  const [waveTouched, setWaveTouched] = useState<boolean>(false);
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);

  const windGoodNum = Number(windGoodStr);
  const windModNum = Number(windModStr);
  const waveGoodNum = Number(waveGoodStr);
  const waveModNum = Number(waveModStr);

  const rawWindError: string | null =
    windGoodStr.trim() === '' ||
    windModStr.trim() === '' ||
    !Number.isFinite(windGoodNum) ||
    !Number.isFinite(windModNum) ||
    windGoodNum <= 0
      ? '풍속 기준치는 0보다 큰 숫자를 입력해야 합니다.'
      : windGoodNum >= windModNum
        ? `풍속 '양호 상한선(${windGoodNum}kn)'은 '보통 상한선(${windModNum}kn)'보다 작아야 합니다.`
        : windModNum > 60
          ? '풍속 상한선은 60kn 이하로 설정하세요.'
          : null;

  const rawWaveError: string | null =
    waveGoodStr.trim() === '' ||
    waveModStr.trim() === '' ||
    !Number.isFinite(waveGoodNum) ||
    !Number.isFinite(waveModNum) ||
    waveGoodNum <= 0
      ? '파고 기준치는 0보다 큰 숫자를 입력해야 합니다.'
      : waveGoodNum >= waveModNum
        ? `파고 '양호 상한선(${waveGoodNum}m)'은 '보통 상한선(${waveModNum}m)'보다 작아야 합니다.`
        : waveModNum > 15
          ? '파고 상한선은 15m 이하로 설정하세요.'
          : null;

  const windError = windTouched || hasSubmitted ? rawWindError : null;
  const waveError = waveTouched || hasSubmitted ? rawWaveError : null;
  const isFormValid = rawWindError === null && rawWaveError === null;

  const isMatchesDefault =
    windGoodNum === defaultThresholds.windKnot.good &&
    windModNum === defaultThresholds.windKnot.moderate &&
    waveGoodNum === defaultThresholds.waveMeter.good &&
    waveModNum === defaultThresholds.waveMeter.moderate;

  const applyThresholdValues = (values: WeatherThresholds) => {
    setWindGoodStr(String(values.windKnot.good));
    setWindModStr(String(values.windKnot.moderate));
    setWaveGoodStr(String(values.waveMeter.good));
    setWaveModStr(String(values.waveMeter.moderate));
    setWindTouched(false);
    setWaveTouched(false);
    setHasSubmitted(false);
  };

  const handleResetToDefault = () => {
    applyThresholdValues(defaultThresholds);
    onReset?.();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setHasSubmitted(true);

    if (rawWindError !== null) {
      windGoodInputRef.current?.focus();
      return;
    }
    if (rawWaveError !== null) {
      waveGoodInputRef.current?.focus();
      return;
    }

    const result = onSave({
      windKnot: { good: windGoodNum, moderate: windModNum },
      waveMeter: { good: waveGoodNum, moderate: waveModNum },
    });

    if (result !== false) {
      onClose();
    }
  };

  if (!isOpen) return null;
  const titles: Record<SettingsScreen, string> = {
    main: '꼬미의 조타실', account: '내 계정', thresholds: '기상 기준 설정', guide: '이용 안내', sources: '앱 정보',
  };
  const menus = [
    { id: 'account', title: '내 계정', description: '이름 변경 · 로그아웃', icon: UserRound },
    { id: 'thresholds', title: '기상 기준 설정', description: '풍속·파고 판정 기준', icon: Compass },
    { id: 'guide', title: '이용 안내', description: '메뉴별 주요 기능', icon: BookOpen },
    { id: 'sources', title: '앱 정보', description: '버전 · 데이터 출처 · 오프라인 이용', icon: Info },
  ] as const;
  return (
    <dialog ref={dialogRef} onClose={onClose} onCancel={(event) => {
      event.preventDefault();
      if (screen === 'main') onClose(); else navigate('main');
    }} onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
      aria-labelledby="threshold-settings-title"
      className="bada-modal-dialog knps-modal-surface fixed inset-0 z-[1400] m-auto flex max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col overflow-hidden rounded-3xl border-2 border-[#00a79d]/65 bg-white p-0 text-[#003360] shadow-2xl">
      <header className="flex shrink-0 items-center gap-2 border-b border-sky-100 bg-gradient-to-r from-sky-50 via-teal-50/70 to-white px-3.5 py-3 sm:px-5">
        {screen !== 'main' ? <button type="button" onClick={() => navigate('main')} aria-label="조타실 메인으로 돌아가기"
          className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl active:bg-sky-100"><ArrowLeft className="h-5 w-5" /></button>
          : <img src={import.meta.env.BASE_URL + 'images/brand/icon_settings_helm_final.png'} alt="" className="h-11 w-11 object-contain" />}
        <h2 ref={headingRef} tabIndex={-1} id="threshold-settings-title" className="min-w-0 flex-1 text-base font-black [word-break:keep-all] focus:outline-none">{titles[screen]}</h2>
        {screen === 'thresholds' && <span className="rounded-md border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-[#0066b3]">{isCustomThresholds || !isMatchesDefault ? '사용자 설정' : '표준 기본값'}</span>}
        <button type="button" onClick={onClose} aria-label="조타실 닫기" className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-xl active:bg-sky-100"><X className="h-5 w-5" /></button>
      </header>
      <div ref={contentRef} className="min-h-0 overflow-y-auto overscroll-contain px-3.5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-5">
        <nav hidden={screen !== 'main'} aria-label="조타실 메뉴" className="divide-y divide-sky-100">
          {menus.map((item, index) => <div key={item.id}>
            {index === 2 && <SettingsInstallMenuItem isStandalone={isStandalone} canInstall={canInstall} onInstall={onInstall} />}
            <button ref={(element) => { menuButtonRefs.current[item.id] = element; }} type="button" onClick={() => navigate(item.id)} className="flex min-h-20 w-full touch-manipulation items-center gap-3 rounded-xl px-2 py-3 text-left active:bg-sky-50">
              <item.icon className="h-5 w-5 shrink-0 text-[#00846c]" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{item.title}</span><span className="mt-1 block text-xs text-slate-600">{item.description}</span></span><ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          </div>)}
        </nav>
        <div hidden={screen !== 'account'}><SettingsAccountSection /></div>
        <div hidden={screen !== 'thresholds'}>
        <section aria-label="공통 기상 판정 기준">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-600">모든 선박에 공통으로 적용합니다.</p>
            <button type="button" onClick={handleResetToDefault} disabled={isMatchesDefault && !isCustomThresholds}
              className="inline-flex min-h-11 shrink-0 touch-manipulation items-center gap-1 rounded-lg px-2 text-xs font-bold text-[#0066b3] active:bg-sky-50 disabled:opacity-45">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />기본값 복원
            </button>
          </div>
          <table className="w-full table-fixed text-center text-xs leading-relaxed tabular-nums">
            <caption className="sr-only">입력한 풍속·파고 기준에 따른 판정 구간</caption>
            <thead><tr className="border-b border-sky-100">
              <th scope="col" className="w-[18%] py-2 font-bold">항목</th>
              <th scope="col" className="py-2 font-bold text-[#00846c]">양호</th>
              <th scope="col" className="py-2 font-bold text-slate-600">보통</th>
              <th scope="col" className="py-2 font-bold text-red-700">나쁨</th>
            </tr></thead>
            <tbody>
              {[
                { label: '풍속', good: windGoodNum, moderate: windModNum, scale: 1, unit: 'kn', valid: rawWindError === null },
                { label: '파고', good: waveGoodNum, moderate: waveModNum, scale: 10, unit: 'm', valid: rawWaveError === null },
              ].map((row) => {
                const format = (value: number) => (value / row.scale).toFixed(row.scale === 1 ? 0 : 1);
                const good = Math.floor(row.good * row.scale);
                const moderate = Math.floor(row.moderate * row.scale);
                return <tr key={row.label} className="border-b border-sky-100">
                  <th scope="row" className="py-3 font-bold">{row.label}<span className="block text-[10px] font-normal text-slate-500">{row.unit}</span></th>
                  <td className="py-3 text-[#00846c]">{row.valid ? format(good) + ' 이하' : '—'}</td>
                  <td className="py-3 text-slate-600">{row.valid ? moderate > good ? format(good + 1) + '~' + format(moderate) : '해당 없음' : '—'}</td>
                  <td className="py-3 text-red-700">{row.valid ? format(moderate + 1) + ' 이상' : '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">풍속은 정수 kn, 파고는 소수 첫째 자리 m로 반올림한 뒤 판정합니다.</p>
          <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-3">
            {[
              { label: '풍속 (kn)', prefix: 'wind', good: windGoodStr, moderate: windModStr, setGood: setWindGoodStr, setModerate: setWindModStr, setTouched: setWindTouched, error: windError, inputRef: windGoodInputRef, step: '1', max: '60' },
              { label: '파고 (m)', prefix: 'wave', good: waveGoodStr, moderate: waveModStr, setGood: setWaveGoodStr, setModerate: setWaveModStr, setTouched: setWaveTouched, error: waveError, inputRef: waveGoodInputRef, step: '0.1', max: '15' },
            ].map((metric) => <fieldset key={metric.prefix} className="rounded-xl border border-sky-100 bg-sky-50/50 px-3 pb-3">
              <legend className="px-1 text-xs font-bold">{metric.label}</legend>
              <div className="grid grid-cols-2 gap-3">
                {([
                  { id: 'good', label: '양호 상한값 (≤)', value: metric.good, setValue: metric.setGood },
                  { id: 'moderate', label: '보통 상한값 (≤)', value: metric.moderate, setValue: metric.setModerate },
                ] as const).map((input) => <div key={input.id}>
                  <label htmlFor={metric.prefix + '-' + input.id + '-input'} className="mb-1 block text-xs text-slate-600">{input.label}</label>
                  <input ref={input.id === 'good' ? metric.inputRef : undefined} id={metric.prefix + '-' + input.id + '-input'}
                    name={metric.prefix + input.id} type="number" inputMode="decimal" step={metric.step} min={metric.step} max={metric.max}
                    value={input.value} onChange={(event) => input.setValue(event.target.value)} onBlur={() => metric.setTouched(true)}
                    aria-invalid={metric.error ? true : undefined} aria-describedby={metric.error ? metric.prefix + '-threshold-error' : undefined}
                    className="min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-base font-bold text-[#003360] focus:border-[#0066b3] focus:outline-none" />
                </div>)}
              </div>
              {metric.error && <p id={metric.prefix + '-threshold-error'} role="alert" className="mt-2 flex items-start gap-1 text-xs text-red-800"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />{metric.error}</p>}
            </fieldset>)}
            <button type="submit" disabled={(windTouched || waveTouched || hasSubmitted) && !isFormValid}
              className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#00854a] via-[#00846c] to-[#0066b3] px-3 text-sm font-bold text-white disabled:opacity-45">
              <Check className="h-4 w-4" aria-hidden="true" />기상 기준 저장
            </button>
          </form>
          <p className="mt-3 text-xs leading-relaxed text-slate-500">기상 판정은 참고용입니다. 실제 운항 시 현장 상황과 공식 해상특보를 확인해 주세요.</p>
        </section>
        </div>
        <div hidden={screen !== 'guide'}><SettingsInformation screen="guide" /></div>
        <div hidden={screen !== 'sources'}><SettingsInformation screen="sources" focusSourceId={focusSourceId} /></div>
      </div>
    </dialog>
  );
}
