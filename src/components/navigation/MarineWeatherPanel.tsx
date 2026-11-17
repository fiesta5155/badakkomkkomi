import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SlidersHorizontal,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  MapPin,
  Plus,
  WifiOff,
  Wind,
  Waves,
} from 'lucide-react';
import type { MarineWeatherStatusResult } from '../../types/weather';
import type { RouteWaypoint } from '../../types/route';
import { getKstForecastDates, isThreeHourForecastTime } from '../../services/ecmwfWeatherService';

interface MarineWeatherPanelProps {
  weather: MarineWeatherStatusResult;
  waypoints?: RouteWaypoint[];
  onSelectWaypointWeather?: (lat: number, lng: number, name: string) => void;
  onAddCurrentWeatherAsWaypoint?: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
}

export function MarineWeatherPanel({
  weather,
  waypoints = [],
  onSelectWaypointWeather,
  onAddCurrentWeatherAsWaypoint,
  onOpenSettings,
  onRefresh,
}: MarineWeatherPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDateOpen, setIsDateOpen] = useState(false);
  const [forecastDates, setForecastDates] = useState(getKstForecastDates);
  const dateMenuRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mouseDragRef = useRef<{ startX: number; scrollLeft: number; moved: boolean; active: boolean } | null>(null);
  const current = weather.current;
  const selectedDate = weather.selectedTime.slice(0, 10);
  const selectedDay = '일월화수목금토'[new Date(`${selectedDate}T00:00:00Z`).getUTCDay()];
  const cards = useMemo(() => weather.hourly.filter((item) =>
    forecastDates.includes(item.time.slice(0, 10)) && isThreeHourForecastTime(item.time)),
  [weather.hourly, forecastDates]);

  useEffect(() => {
    const interval = window.setInterval(() => setForecastDates(getKstForecastDates()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isDateOpen) return;
    const close = (event: MouseEvent) => {
      if (!dateMenuRef.current?.contains(event.target as Node)) setIsDateOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDateOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [isDateOpen]);

  useEffect(() => {
    const timeline = timelineRef.current;
    const selected = Array.from(timeline?.children ?? []).find((child) =>
      (child as HTMLElement).dataset.forecastTime === weather.selectedTime) as HTMLElement | undefined;
    if (!timeline || !selected) return;
    const left = timeline.scrollLeft + selected.getBoundingClientRect().left
      - timeline.getBoundingClientRect().left - (timeline.clientWidth - selected.clientWidth) / 2;
    timeline.scrollTo({ left, behavior: 'smooth' });
  }, [weather.selectedTime, cards]);

  const scrollTimeline = (direction: -1 | 1) => {
    const timeline = timelineRef.current;
    if (timeline) timeline.scrollBy({ left: direction * timeline.clientWidth * 0.8, behavior: 'smooth' });
  };
  const isCurrentMatchingWaypoint = waypoints.some(
    (wp) =>
      Math.abs(weather.lat - wp.lat) < 0.002 &&
      Math.abs(weather.lng - wp.lng) < 0.002,
  );

  // 신호등 색상 및 텍스트 매핑 (3단계: 양호-초록, 보통-황색, 나쁨-빨강, 실패/미확인-회색)
  const gradeMeta = {
    good: {
      label: '양호',
      color: '#16A34A',
      pillClass: 'bg-[#16A34A] text-white',
    },
    moderate: {
      label: '보통',
      color: '#D97706',
      pillClass: 'bg-[#D97706] text-slate-950',
    },
    bad: {
      label: '나쁨',
      color: '#DC2626',
      pillClass: 'bg-[#DC2626] text-white',
    },
    unknown: {
      label: '미확인 (?)',
      color: '#64748b',
      pillClass: 'bg-slate-600 text-white',
    },
  }[current?.grade || 'unknown'];

  return (
    <section
      ref={dateMenuRef}
      className="knps-hud-surface bada-hud-panel pointer-events-auto relative flex max-h-[calc(100dvh-10.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))] w-full min-w-0 flex-col overflow-visible rounded-2xl border border-[#00a79d]/55 bg-white/96 p-2 text-[#003360] shadow-2xl backdrop-blur-md sm:p-3"
      aria-label="해상기상 상태판정 패널"
    >
      <div
        aria-hidden="true"
        className="knps-tricolor-bar pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-95"
      />
      {/* 상단 2단 계층형 기상 판정 헤더 (Row 1: 타이틀·해역배지·유틸 툴바 / Row 2: 전폭 100% 기상 신호등·수치·기준치 브리핑 박스) */}
      <div className="shrink-0">
        {/* Row 1: 좌측 타이틀·해역 배지 + 우측 유틸리티 컨트롤 툴바 */}
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[10px] font-black tracking-tight text-[#0066b3] min-[390px]:text-[11px]">
              선택 지점 해상 기상예보
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div>
              <button type="button" onClick={() => setIsDateOpen((open) => !open)} aria-expanded={isDateOpen}
                aria-label="예보 날짜 선택" className="flex h-7 items-center gap-0.5 rounded-lg border border-sky-300 bg-sky-50 px-1.5 text-[10px] font-black text-[#0066b3] shadow-2xs sm:h-8">
                {`${Number(selectedDate.slice(5, 7))}/${Number(selectedDate.slice(8, 10))}`}
                <span className="hidden min-[390px]:inline">({selectedDay})</span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              aria-label="기상 정보 새로고침"
              title="기상 예보 다시 불러오기"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-[#003360] shadow-2xs active:scale-95 sm:h-8 sm:w-8"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${weather.isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="기준값 설정"
              title="풍속·파고 판정 기준치 설정"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-[#0066b3] shadow-2xs active:scale-95 sm:h-8 sm:w-8"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed((v) => !v)}
              aria-label={isCollapsed ? '기상 패널 펼치기' : '기상 패널 접기'}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sky-300 bg-sky-50 text-xs font-black text-[#0066b3] active:scale-95 sm:h-8 sm:w-8"
            >
              {isCollapsed ? (
                <ChevronUp className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Row 2: 전폭(100%) 기상 판정 히어로 브리핑 박스 */}
        <div className="mt-1.5 rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50/90 via-teal-50/60 to-emerald-50/50 px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 gap-y-1">
            <div className="flex min-w-0 items-center gap-1">
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white text-[10px] font-black text-white shadow"
                style={{ backgroundColor: gradeMeta.color }}
              >
                {current?.grade === 'unknown' || !current ? '?' : ''}
              </span>
              <span className="max-w-[100px] truncate text-lg leading-none font-black tracking-tight whitespace-nowrap text-[#003360] sm:max-w-none sm:text-xl">
                {weather.isLoading ? '예보 조회 중...' : gradeMeta.label}
              </span>
              {current && (
                <span
                  className={`shrink-0 rounded-md px-1 py-0.5 text-[10px] font-extrabold whitespace-nowrap tabular-nums shadow-2xs ${gradeMeta.pillClass}`}
                >
                  {current.displayTime}
                </span>
              )}
            </div>

            {current && (
              <div className="flex shrink-0 items-center gap-1 text-[11px] font-bold">
                <span className="inline-flex shrink-0 items-center gap-0.5 font-mono whitespace-nowrap tabular-nums text-[#0066b3]">
                  <Wind className="h-3 w-3 shrink-0" />
                  {current.windSpeedKnots !== null
                    ? `${current.windSpeedKnots.toFixed(1)}kn`
                    : '?'}
                </span>
                <span className="inline-flex shrink-0 items-center gap-0.5 font-mono whitespace-nowrap tabular-nums text-[#00846c]">
                  <Waves className="h-3 w-3 shrink-0" />
                  {current.waveHeightMeters !== null
                    ? `${current.waveHeightMeters.toFixed(2)}m`
                    : '?'}
                </span>
              </div>
            )}
          </div>

        </div>
      </div>

      {isDateOpen && (
        <div role="group" aria-label="예보 날짜" className="absolute right-2.5 bottom-full z-[1000] mb-2 grid w-[min(240px,calc(100vw-24px))] grid-cols-2 gap-1 rounded-xl border border-sky-300 bg-white p-2 shadow-xl">
          {forecastDates.map((date) => (
            <button key={date} type="button" aria-pressed={date === selectedDate}
              onClick={() => { weather.selectForecastTime(`${date}T12:00`); setIsDateOpen(false); }}
              className={`rounded-lg border px-1.5 py-1 text-[11px] font-bold ${date === selectedDate ? 'border-[#0066b3] bg-sky-50 text-[#0066b3]' : 'border-slate-200 bg-white text-[#003360]'}`}>
              {`${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`}
            </button>
          ))}
        </div>
      )}

      {!isCollapsed && (
        <div className="mt-1.5 min-h-0 min-w-0 flex-1 space-y-1.5 overflow-y-auto border-t border-sky-200/80 pt-1.5">
          {/* 바닷길 시간계산 항로(출발·경유·도착) 해역 원터치 기상 연동 칩 */}
          {waypoints.length > 0 && onSelectWaypointWeather && (
            <div
              role="group"
              aria-label="현재 항로 지점별 기상 빠른 조회"
              className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-sky-200 bg-sky-50/75 px-2 py-1.5 scrollbar-none"
            >
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-black text-[#0066b3]">
                <MapPin className="h-3 w-3" />
                항로 해역:
              </span>
              {waypoints.map((wp, idx) => {
                const roleLabel =
                  wp.type === 'start'
                    ? '출발'
                    : wp.type === 'end'
                      ? '도착'
                      : `경유${idx}`;
                const isNearCurrent =
                  Math.abs(weather.lat - wp.lat) < 0.002 &&
                  Math.abs(weather.lng - wp.lng) < 0.002;
                return (
                  <button
                    key={wp.id}
                    type="button"
                    onClick={() => onSelectWaypointWeather(wp.lat, wp.lng, wp.name)}
                    className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-extrabold transition active:scale-95 ${
                      isNearCurrent
                        ? 'border-[#0066b3] bg-[#0066b3] text-white shadow-2xs'
                        : 'border-slate-300 bg-white text-[#003360] hover:border-[#0066b3]'
                    }`}
                  >
                    <span className="opacity-85">[{roleLabel}]</span>
                    <span className="max-w-[115px] truncate">{wp.name}</span>
                  </button>
                );
              })}

              {!isCurrentMatchingWaypoint && onAddCurrentWeatherAsWaypoint && (
                <button
                  type="button"
                  onClick={onAddCurrentWeatherAsWaypoint}
                  className="ml-auto flex shrink-0 items-center gap-0.5 rounded-lg border border-amber-400 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-900 shadow-2xs transition active:scale-95"
                  title="현재 기상 조회 중인 해역을 항로 경유지로 추가"
                >
                  <Plus className="h-3 w-3" />
                  <span>이 해역 경유지 추가</span>
                </button>
              )}
            </div>
          )}

          {/* 조회 실패 / 자료 없음 경고 배너 */}
          {weather.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-800"
            >
              <WifiOff className="h-4 w-4 shrink-0 text-red-600" />
              <span>
                조회 실패: {weather.error}
              </span>
            </div>
          )}

          {/* 날짜/시간 좌우 타임라인 슬라이더 (API가 제공하는 예보 시각만 선택 가능) */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-1.5">
              <span className="truncate text-xs font-extrabold text-[#003360]">
                시간별 예보
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="font-mono text-xs font-bold text-[#0066b3]">
                  {current?.displayTime ?? `${Number(selectedDate.slice(5, 7))}/${Number(selectedDate.slice(8, 10))} ${weather.selectedTime.slice(11, 13)}시`}
                </span>
              </div>
            </div>

            {cards.length > 0 ? (
              <div className="flex min-w-0 items-center gap-1">
                <button type="button" aria-label="이전 예보 시간 보기" onClick={() => scrollTimeline(-1)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-white text-[#0066b3] shadow-2xs">
                  <ChevronDown className="h-3.5 w-3.5 rotate-90" />
                </button>
              <div ref={timelineRef}
                onPointerDown={(event) => {
                  if (event.pointerType !== 'mouse' || event.button !== 0) return;
                  mouseDragRef.current = { startX: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false, active: true };
                }}
                onPointerMove={(event) => {
                  const drag = mouseDragRef.current;
                  if (!drag?.active || event.pointerType !== 'mouse') return;
                  if ((event.buttons & 1) === 0) {
                    mouseDragRef.current = null;
                    return;
                  }
                  const distance = event.clientX - drag.startX;
                  if (Math.abs(distance) > 4 && !drag.moved) {
                    drag.moved = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                  if (drag.moved) event.currentTarget.scrollLeft = drag.scrollLeft - distance;
                }}
                onPointerUp={(event) => {
                  if (event.pointerType === 'mouse' && mouseDragRef.current) mouseDragRef.current.active = false;
                }}
                onPointerCancel={() => { mouseDragRef.current = null; }}
                onPointerLeave={() => {
                  if (mouseDragRef.current && !mouseDragRef.current.moved) mouseDragRef.current = null;
                }}
                onClickCapture={(event) => {
                  if (!mouseDragRef.current?.moved) return;
                  event.stopPropagation();
                  mouseDragRef.current = null;
                }}
                onDragStart={(event) => event.preventDefault()}
                className="flex min-w-0 flex-1 cursor-grab select-none gap-1 overflow-x-auto overscroll-x-contain pb-0.5 touch-pan-x scrollbar-none active:cursor-grabbing"
                style={{ WebkitOverflowScrolling: 'touch' }}>
                {cards.map((item) => {
                  const isSelected = item.time === weather.selectedTime;
                  const color =
                    item.grade === 'good'
                      ? '#16A34A'
                      : item.grade === 'moderate'
                        ? '#D97706'
                        : item.grade === 'bad'
                          ? '#DC2626'
                          : '#64748b';
                  const itemGradeLabel =
                    item.grade === 'good'
                      ? '양호'
                      : item.grade === 'moderate'
                        ? '보통'
                        : item.grade === 'bad'
                          ? '나쁨'
                          : '미확인';

                  return (
                    <button
                      key={`forecast-${item.time}`}
                      data-forecast-time={item.time}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${item.datePart} ${item.hourPart} 기상 판정 ${itemGradeLabel}`}
                      onClick={() => weather.selectForecastTime(item.time)}
                      className={`flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg border px-0.5 py-0.5 transition active:scale-95 ${
                        isSelected
                          ? 'border-[#0066b3] bg-sky-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-sky-300'
                      }`}
                    >
                      <span className="h-2.5 font-mono text-[9px] leading-2.5 font-bold text-slate-500">
                        {item.hourPart === '00시' ? item.datePart : ''}
                      </span>
                      <span className="font-mono text-xs font-black text-[#003360]">
                        {item.hourPart}
                      </span>
                      <span
                        className="mt-0.5 flex h-3 w-3 items-center justify-center rounded-full border border-white text-[8px] font-black text-white shadow-2xs"
                        style={{ backgroundColor: color }}
                      >
                        {item.grade === 'unknown' ? '?' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
                <button type="button" aria-label="다음 예보 시간 보기" onClick={() => scrollTimeline(1)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-300 bg-white text-[#0066b3] shadow-2xs">
                  <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
                </button>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-bold text-slate-600">
                {weather.isLoading
                  ? '예보 조회 중...'
                  : '예보 자료가 없습니다.'}
              </div>
            )}
          </div>

        </div>
      )}
    </section>
  );
}
