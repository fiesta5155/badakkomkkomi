import { useEffect, useRef } from 'react';
import type { ReactNode, Ref } from 'react';
import { ArrowRight } from 'lucide-react';
import type { NavPanelType } from '../../hooks/useAppRoute';
import { HomeNotices } from './HomeNotices';
import './homeMenuCards.css';
import './homeHero.css';

export type NotebookLaunchPreset = 'hazard' | 'all' | 'layers';

function HomeMenuCard({ title, description, theme, icon, onClick, buttonRef }: {
  title: string;
  description: string;
  theme: 'notebook' | 'navigation' | 'calendar' | 'settings';
  icon: ReactNode;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return <article className="home-menu-item" aria-label={theme === 'settings' ? '설정' : title}>
    <button ref={buttonRef} type="button" className="home-menu-card" data-theme={theme} onClick={onClick}>
      <span className="home-menu-card__icon" aria-hidden="true">{icon}</span>
      <span className="home-menu-card__text">
        <span className="home-menu-card__title">{title}</span>
        <span className="home-menu-card__description">{description}</span>
      </span>
    </button>
  </article>;
}

export interface HomeScreenProps {
  lastTriggeredCardId: 'notebook' | 'navigation' | null;
  onSelectFeatureCard: (target: 'notebook' | 'navigation') => void;
  onSelectNotebookPreset?: (preset: NotebookLaunchPreset) => void;
  onSelectNavigationPanel?: (panel: NavPanelType) => void;
  onSelectCalendar?: () => void;
  onOpenSettings?: (section?: 'thresholds' | 'guide' | 'sources') => void;
  isCustomThresholds?: boolean;
  hasActiveWorkspace?: boolean;
  activeWorkspaceSummary?: string;
  onResumeWorkspace?: () => void;
  hazardCount?: number;
  totalDockingCount?: number;
  totalPortsCount?: number;
  isOnline?: boolean;
}

/**
 * 초기 접속 인트로 허브 (HomeScreen v2.4 — 미니멀 포스터 카드)
 * - 승인된 꼬미 배너와 4대 기능 카드의 투명 배경 확정 시안 아이콘을 사용합니다.
 * - 직원 사용성 극대화를 위해 각 카드 내부의 상단 배지 및 하단 다중 액션 버튼 바를 제거하고,
 *   원터치로 바로 주요 기능에 진입할 수 있는 깔끔한 포스터 카드 형태로 구성했습니다.
 */
export function HomeScreen({
  lastTriggeredCardId,
  onSelectFeatureCard,
  onSelectNotebookPreset,
  onSelectNavigationPanel,
  onSelectCalendar,
  onOpenSettings,
  hasActiveWorkspace = false,
  activeWorkspaceSummary,
  onResumeWorkspace,
}: HomeScreenProps) {
  const notebookBtnRef = useRef<HTMLButtonElement | null>(null);
  const navigationBtnRef = useRef<HTMLButtonElement | null>(null);
  const base = import.meta.env.BASE_URL;

  // Workspace에서 Home으로 복귀했을 때 마지막 실행 카드로 초점(Focus) 복원
  useEffect(() => {
    if (lastTriggeredCardId === 'notebook') {
      notebookBtnRef.current?.focus({ preventScroll: true });
    } else if (lastTriggeredCardId === 'navigation') {
      navigationBtnRef.current?.focus({ preventScroll: true });
    }
  }, [lastTriggeredCardId]);

  const handleLaunchNotebook = (preset: NotebookLaunchPreset) => {
    if (onSelectNotebookPreset) {
      onSelectNotebookPreset(preset);
      return;
    }
    onSelectFeatureCard('notebook');
  };

  const handleLaunchNavigation = (panel: NavPanelType) => {
    if (onSelectNavigationPanel) {
      onSelectNavigationPanel(panel);
      return;
    }
    onSelectFeatureCard('navigation');
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex min-h-dvh w-full flex-col overflow-x-hidden overflow-y-auto bg-gradient-to-b from-[#bae6fd] via-[#7dd3fc] to-[#24a9e1] text-slate-900 select-none"
      style={{
        paddingTop: 'var(--safe-top)',
        paddingBottom: 'var(--safe-bottom)',
      }}
    >
      <main className="relative z-10 mx-auto my-auto flex w-full min-w-0 max-w-lg flex-none flex-col px-3 py-2 sm:px-5 sm:py-3">
        <div className="home-launchpad overflow-hidden rounded-[2rem] border-4 border-white bg-white shadow-lg">
        {/* 승인된 최종 배너 원본을 그대로 표시하고 제목은 접근 가능한 텍스트로 유지 */}
        <section
          aria-labelledby="home-hero-title"
          className="home-hero relative"
        >
          <img
            src={`${base}images/brand/home_banner_final_b6c9666f60c9.png`}
            alt="국립공원공단 꼬미가 망원경으로 바다를 관찰하는 모습"
            className="home-hero__banner"
            width={2109}
            height={746}
            decoding="async"
          />
          <h1 id="home-hero-title" className="sr-only">바다꼼꼬미</h1>
          <p className="sr-only">우리 손안의 해양공원 업무수첩</p>
        </section>

        {/* 배너 전체를 가리지 않고 16px 아래에 기존 2x2 메뉴 배치 */}
        <nav
          aria-label="주요 기능"
          className="px-2.5 pt-4 pb-2.5 min-[380px]:px-3 min-[380px]:pb-3 sm:px-4 sm:pb-4"
        >
          <div className="home-menu-grid">
            <HomeMenuCard
              title="꼬미의 바다수첩" description="해양정보 · 현장기록" theme="notebook"
              buttonRef={notebookBtnRef} onClick={() => handleLaunchNotebook('hazard')}
              icon={<img src={base + 'images/brand/icon_notebook_map_final.png'} alt="" />}
            />
            <HomeMenuCard
              title="바닷길 콕콕" description="시간계산 · 날씨콕콕" theme="navigation"
              buttonRef={navigationBtnRef} onClick={() => handleLaunchNavigation('route')}
              icon={<img src={base + 'images/brand/icon_navigation_clock_final.png'} alt="" />}
            />
            <HomeMenuCard
              title="꼬미의 달력" description="운항일정 · 직원메모" theme="calendar"
              onClick={() => onSelectCalendar?.()}
              icon={<img src={base + 'images/brand/icon_calendar_boat_final.png'} alt="" />}
            />
            <HomeMenuCard
              title="꼬미의 조타실" description="환경설정 · 이용안내" theme="settings"
              onClick={() => onOpenSettings?.('thresholds')}
              icon={<img src={base + 'images/brand/icon_settings_helm_final.png'} alt="" />}
            />
          </div>
        </nav>
        </div>

        <HomeNotices />

        {/* 이전 작업 세션이 열려 있을 때 원터치 복귀 배너 */}
        {hasActiveWorkspace && onResumeWorkspace && (
          <button
            type="button"
            onClick={onResumeWorkspace}
            className="knps-hud-surface mt-2.5 flex w-full items-center justify-between gap-2 rounded-2xl border-2 px-2.5 py-2 text-left text-[#003360] shadow-xl transition active:scale-[0.99] sm:gap-2.5 sm:px-3"
          >
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <img
                src={`${base}images/brand/bandali_thumbsup.png`}
                alt=""
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-xl bg-white/95 object-contain p-0.5 shadow sm:h-10 sm:w-10"
              />
              <div className="min-w-0">
                <span className="block text-[10px] font-black tracking-wider text-[#00846c] uppercase">
                  진행 중인 국립공원 해상 작업공간 보존됨
                </span>
                <span className="block text-xs leading-snug font-extrabold text-[#003360] [word-break:keep-all] sm:text-sm">
                  {activeWorkspaceSummary || '직전 지도 화면으로 이어서 돌아가기'}
                </span>
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-xl bg-gradient-to-r from-[#00854a] to-[#0284c7] px-2.5 py-1.5 text-xs font-black whitespace-nowrap text-white shadow">
              <span>이어서 보기</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 stroke-[2.8]" />
            </span>
          </button>
        )}
      </main>
    </div>
  );
}
