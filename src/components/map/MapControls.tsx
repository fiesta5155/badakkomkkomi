import type { Ref } from 'react';
import { LocateFixed, Maximize, Satellite, Map } from 'lucide-react';

export function MapControls({ onGps, onBackground, onOverview, onFocus, backgroundOpen, focusButtonRef }: {
  onGps: () => void;
  onBackground: () => void;
  onOverview: () => void;
  onFocus: () => void;
  backgroundOpen: boolean;
  focusButtonRef: Ref<HTMLButtonElement>;
}) {
  return <nav aria-label="지도 조작" className="fixed top-[6.25rem] right-2.5 z-[850] flex flex-col gap-1.5 sm:top-[7.25rem] sm:right-3 sm:gap-2">
    {[
      { label: '현위치', title: 'GPS로 내 위치 찾기', icon: LocateFixed, action: onGps },
      { label: '배경지도', title: '배경지도 선택', icon: Satellite, action: onBackground },
      { label: '통영·거제 전체보기', title: '통영·거제 전체보기', icon: Map, action: onOverview },
      { label: '지도 집중 모드', title: '지도 집중 모드', icon: Maximize, action: onFocus },
    ].map((item, index) => <button key={item.label} ref={index === 3 ? focusButtonRef : undefined} type="button"
      onClick={item.action} aria-label={item.label} title={item.title}
      aria-expanded={index === 1 ? backgroundOpen : undefined} aria-controls={index === 1 ? 'map-background-options' : undefined}
      className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-xl border-2 border-[#00a79d]/60 bg-white/96 text-[#003360] shadow-xl active:bg-sky-100 sm:rounded-2xl">
      <item.icon className="h-5 w-5 stroke-[2.4]" aria-hidden="true" />
    </button>)}
  </nav>;
}
