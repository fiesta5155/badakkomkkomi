import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWarningMap, warningAreaId, type WarningMapArea } from '../../services/navigationalWarningMap';
import { ArrowLeft, X } from 'lucide-react';
import { fetchWarningData, type WarningData, type WarningDocument, type WarningRaw } from '../../services/navigationalWarningService';
import { warningPanelStatus, warningSchedule } from './warningPresentation';

const control = 'flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-xl text-[#003360] hover:bg-sky-50';
const original = 'whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]';
const field = (name: string, value: string | undefined) => value?.trim() ? <div>
  <dt className="text-xs font-bold text-slate-600">{name}</dt><dd className={original}>{value}</dd>
</div> : null;

function OriginalContent({ raw }: { raw: WarningRaw }) {
  return <dl className="space-y-3">
    {field('경보 내용', raw.content || '내용 미제공')}
  </dl>;
}

function DocumentDetail({ document, mappable, onViewArea }: { document: WarningDocument; mappable: ReadonlySet<string>; onViewArea?: (id: string) => void }) {
  const raw = document.observations[0].raw;
  const variants = document.observations.filter((o, index, items) => index > 0
    && !items.slice(0, index).some(previous => JSON.stringify(previous.raw) === JSON.stringify(o.raw)));
  return <article className="space-y-4">
    <div className="space-y-1">
      <h3 className="text-base font-black leading-relaxed [overflow-wrap:anywhere]">{raw.title || '제목 미제공'}</h3>
      <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">문서번호 {document.docNum}</p>
    </div>
    <OriginalContent raw={raw} />
    <section aria-label="구역별 원문" className="space-y-2">
      <h3 className="text-sm font-black">구역 {document.areas.length}개</h3>
      {document.areas.length === 0 && <p className="text-sm text-slate-600">구역 정보가 제공되지 않았습니다.</p>}
      {document.areas.map((area, index) => {
        const schedule = warningSchedule(area.raw.alarm_date, area.raw.alarm_time);
        return <details key={`${area.raw.area}-${index}`} className="rounded-xl border border-sky-200 px-3" data-warning-area={area.raw.area}>
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold [overflow-wrap:anywhere]">구역 {area.raw.area}{area.raw.position_nm ? ` · ${area.raw.position_nm}` : ''}</summary>
        <div className="space-y-2 pb-3">
          {schedule.entries.length > 0 ? <div>
            <p className="text-xs font-bold text-slate-600">적용 날짜 · 시간</p>
            <dl className="text-sm leading-relaxed">{schedule.entries.map((entry, i) => <div key={i} className="flex flex-wrap gap-x-3">
              <dt>{entry.date}</dt><dd>{entry.time}</dd>
            </div>)}</dl>
          </div> : <dl className="space-y-2">{field('적용 날짜', schedule.date)}{field('적용 시간', schedule.time)}</dl>}
          {onViewArea && mappable.has(warningAreaId(document.docNum, area.raw.area)) && <button type="button" className="min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold" onClick={() => onViewArea(warningAreaId(document.docNum, area.raw.area))}>지도에서 보기</button>}
          <details data-warning-coordinates>
            <summary className="min-h-11 cursor-pointer py-3 text-xs font-bold">원문 좌표 및 위치 설명</summary>
            <dl className="space-y-2">{field('원문 좌표', area.raw.position || '위치정보 미제공')}{field('위치 설명', area.raw.position_desc)}</dl>
          </details>
        </div>
      </details>; })}
    </section>
    <details className="rounded-xl border border-sky-200 px-3" data-warning-extra>
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">추가 정보</summary>
      <div className="space-y-3 pb-3">
        <dl className="space-y-3">
          {field('공식 제공 날짜', document.issuedAt ?? undefined)}
          {field('발행 근거', raw.basic)}
          {document.areas.some(area => area.raw.sea_pos) && <div>
            <dt className="text-xs font-bold text-slate-600">관련 해도</dt>
            <dd><ul className={original}>{document.areas.filter(area => area.raw.sea_pos).map((area, index) =>
              <li key={index} data-warning-chart={area.raw.area}>구역 {area.raw.area}: <span>{area.raw.sea_pos}</span></li>)}</ul></dd>
          </div>}
        </dl>
        {variants.length > 0 && <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">조회일별 다른 원문 {variants.length}건</summary>
          <div className="space-y-4">{variants.map((observation, index) => <div key={index} className="space-y-2">
            <p className="text-xs text-slate-600">조회일 {observation.queryDate}</p>
            <p className={original}>{observation.raw.title}</p><OriginalContent raw={observation.raw} />
            <dl>{field('발행 근거', observation.raw.basic)}</dl>
          </div>)}</div>
        </details>}
        <p className="text-xs">출처: <a className="inline-flex min-h-11 items-center underline" href="https://www.khoa.go.kr/nwb/mainPage.do?lang=ko" target="_blank" rel="noopener noreferrer">국립해양조사원 항행경보 (새 창)</a></p>
      </div>
    </details>
  </article>;
}

export default function NavigationalWarningPanel({ onClose, initialData, initialDocument = null, onData, onViewArea, mapAreas }: {
  onClose: () => void; initialData?: WarningData | null; initialDocument?: string | null;
  onData?: (data: WarningData) => void; onViewArea?: (id: string) => void;
  mapAreas?: readonly WarningMapArea[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const returnDocument = useRef<string | null>(null);
  const [data, setData] = useState<WarningData | null>(initialData ?? null);
  const [selected, setSelected] = useState<string | null>(initialDocument);
  const mappable = useMemo(() => new Set((mapAreas ?? buildWarningMap(data?.snapshot ?? null).areas).map(area => area.id)), [data?.snapshot, mapAreas]);
  const [retry, setRetry] = useState(0);
  const [preview] = useState(() => import.meta.env.DEV && document.querySelector('meta[name="bada-nav-warning-preview"]')?.getAttribute('content') === '1');
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    headingRef.current?.focus();
    return () => { dialog?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    const base = import.meta.env.DEV && preview ? `${import.meta.env.BASE_URL}__dev/` : import.meta.env.BASE_URL;
    void fetchWarningData(base, controller.signal).then(result => { if (active) { setData(result); onData?.(result); } })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [retry, preview, onData]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = selected ? 0 : listScroll.current;
    if (selected) headingRef.current?.focus();
    else if (returnDocument.current) {
      const target = [...(scrollRef.current?.querySelectorAll<HTMLButtonElement>('[data-warning-document]') ?? [])]
        .find(button => button.dataset.warningDocument === returnDocument.current);
      target?.focus({ preventScroll: true }); returnDocument.current = null;
    }
  }, [selected]);
  const selectedDocument = data?.snapshot?.documents.find(d => d.docNum === selected);
  const statusText = warningPanelStatus(data, !!selectedDocument);
  return <dialog ref={dialogRef} aria-labelledby="warning-panel-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="bada-modal-dialog fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-clip border-0 bg-transparent p-0 text-[#003360]">
    <div className="flex h-full items-end justify-center px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-3" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[78dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border-2 border-[#A5F3FC] bg-white shadow-lg">
        <header className="flex shrink-0 items-center gap-1 border-b border-sky-100 px-2 py-2">
          {selectedDocument && <button type="button" className={control} aria-label="목록으로 돌아가기" onClick={() => { returnDocument.current = selectedDocument.docNum; setSelected(null); }}><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>}
          <h2 id="warning-panel-title" ref={headingRef} tabIndex={-1} className="min-w-0 flex-1 px-2 text-base font-black">항행경보</h2>
          <button type="button" className={control} onClick={onClose} aria-label="항행경보 닫기"><X className="h-5 w-5" aria-hidden="true" /></button>
        </header>
        <div ref={scrollRef} className="min-h-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere]">
          {(!selectedDocument || preview || statusText || !!data?.errors.length) && <div className="mb-3 space-y-1 text-xs leading-relaxed text-slate-600">
            {import.meta.env.DEV && preview && <p>과거 수집 자료 · 개발용 미리보기</p>}
            {statusText && !data?.errors.includes(statusText) && <p role="status">{statusText}</p>}
            {data?.errors.map(error => <p key={error} role="alert">{error}</p>)}
            {data && data.errors.length > 0 && <button type="button" className="min-h-11 rounded-xl border border-sky-200 px-3 font-bold text-[#003360]" onClick={() => { setData(null); setSelected(null); setRetry(value => value + 1); }}>다시 불러오기</button>}
          </div>}
          {selectedDocument ? <DocumentDetail document={selectedDocument} mappable={mappable} onViewArea={onViewArea} /> : <ul className="space-y-2" aria-label="경보 문서 목록">
            {data?.snapshot?.documents.map(d => <li key={d.docNum}>
              <button type="button" data-warning-document={d.docNum} onClick={() => { listScroll.current = scrollRef.current?.scrollTop ?? 0; setSelected(d.docNum); }}
                className="block min-h-11 w-full touch-manipulation space-y-0.5 rounded-2xl border border-sky-200 bg-white px-3 py-2.5 text-left hover:bg-sky-50">
                <span className="block text-xs text-slate-600">{d.docNum}</span>
                <span className="line-clamp-3 text-sm font-black leading-relaxed">{d.observations[0].raw.title || '제목 미제공'}</span>
                {d.observations[0].raw.content && <span className="line-clamp-2 text-xs leading-relaxed text-slate-600">{d.observations[0].raw.content.replace(/\s+/g, ' ').trim()}</span>}
              </button>
            </li>)}
          </ul>}
        </div>
      </section>
    </div>
  </dialog>;
}
