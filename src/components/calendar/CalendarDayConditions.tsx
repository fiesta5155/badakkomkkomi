import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Cloud, CloudRain, CloudSnow, CloudSun, Sun } from 'lucide-react';
import { tideNameForDate, weatherDescription, type CalendarRegion } from './calendarConditions';
import { useCalendarDayConditions } from '../../hooks/useCalendarDayConditions';
import { windCompass, type NoonWeather } from '../../services/calendarDayConditions';
import type { TideEvent } from '../../services/khoaTideSchema';

const measure = (value: number | null, unit: string) => value === null ? '—' : `${Number(value.toFixed(1))}${unit}`;
const surface = 'min-w-0 rounded-2xl border border-sky-200 bg-white p-2.5';
export const CONDITIONS_EXPANDED_KEY = 'bada_kkomkkomi_calendar_conditions_expanded_v1';

export function CalendarConditionCards({ date, events, weather }: { date: string; events: TideEvent[]; weather: NoonWeather }) {
  const description = weatherDescription(weather.code ?? NaN);
  const Icon = description === '맑음' ? Sun : description === '구름' ? CloudSun : description === '흐림' ? Cloud : description === '눈' ? CloudSnow : CloudRain;
  return <div className="grid min-w-0 grid-cols-2 gap-2 text-sm" aria-label="조석·날씨 정보">
    <section className={surface} aria-label="조석정보">
      <h3 className="font-black">조석정보</h3>
      <p className="mt-1 flex min-h-8 items-center text-base font-bold text-[#007e9e]">{tideNameForDate(date) ?? '—'}</p>
      {events.length ? <ul className="mt-1.5 space-y-1 tabular-nums">
        {events.map(event => <li key={event.time} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
            <span role="img" className={event.kind === 'high' ? 'text-red-600' : 'text-blue-600'} aria-label={event.kind === 'high' ? '만조' : '간조'}>{event.kind === 'high' ? '▲' : '▼'}</span>
            <time className="break-all">{event.time}</time>
          </span>
          <span className="ms-auto break-all text-end font-semibold">{measure(event.heightCm, 'cm')}</span>
        </li>)}
      </ul> : <p className="mt-1.5">—</p>}
    </section>
    <section className={surface} aria-label="날씨정보">
      <h3 className="flex flex-wrap items-baseline justify-between gap-x-1 font-black">날씨정보 <span className="font-normal">12:00</span></h3>
      <div className="mt-1 flex min-h-8 flex-wrap items-center gap-1.5 tabular-nums">
        {description ? <Icon className="h-6 w-6 shrink-0 text-[#0066b3]" role="img" aria-label={description} /> : <span aria-label="날씨 정보 없음">—</span>}
        <span className="text-xl font-black tracking-tight">{measure(weather.temperature, '°C')}</span>
      </div>
      <dl className="mt-1.5 space-y-0.5 tabular-nums">
        {[
          ['풍향', windCompass(weather.direction)], ['풍속', measure(weather.speed, 'm/s')],
          ['파고', measure(weather.wave, 'm')], ['강수량', measure(weather.precipitation, 'mm')],
          ['강수확률', measure(weather.probability, '%')],
        ].map(([label, value]) => <div key={label} className="flex min-w-0 flex-wrap justify-between gap-x-1 gap-y-0.5">
          <dt aria-label={label === '강수확률' ? '강수확률 · ECMWF 앙상블' : undefined}>{label}</dt><dd className="ms-auto break-all font-semibold">{value}</dd>
        </div>)}
      </dl>
    </section>
  </div>;
}

export function CalendarDayConditions({ region, date }: { region: CalendarRegion; date: string }) {
  const conditions = useCalendarDayConditions(region, date);
  return <CalendarConditionCards date={date} {...conditions} />;
}

export function CalendarDetailConditions({ region, date, dateLabel, vessel }: {
  region: CalendarRegion; date: string; dateLabel: string; vessel: string;
}) {
  const [expanded, setExpanded] = useState(() => {
    try { return window.localStorage.getItem(CONDITIONS_EXPANDED_KEY) !== 'false'; }
    catch { return true; }
  });
  const panelId = useId();
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try { window.localStorage.setItem(CONDITIONS_EXPANDED_KEY, String(next)); }
    catch { /* Keep the control usable when browser storage is blocked. */ }
  };
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return <>
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-3 py-2">
      <div className="min-w-0">
        <h2 className="text-lg font-black">{dateLabel}</h2>
        <p className="text-sm font-bold text-sky-800">{vessel}호</p>
      </div>
      <button type="button" onClick={toggle} aria-expanded={expanded} aria-controls={panelId}
        aria-label={expanded ? '조석·날씨정보 접기' : '조석·날씨정보 펼치기'}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#0066b3] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066b3]">
        <Chevron className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
    <div id={panelId} hidden={!expanded}>
      {expanded && <CalendarDayConditions region={region} date={date} />}
    </div>
  </>;
}
