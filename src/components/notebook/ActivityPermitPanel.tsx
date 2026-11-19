import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { PermitWorkspace } from '../../hooks/useActivityPermits';
import { AccountPanel } from '../auth/AccountPanel';
import { dmsDecimal, PERMIT_POINT_LABELS, permitStatus, type ActivityPermit, type Dms, type PermitInput, type PermitSnapshot } from '../../services/activityPermitModel';
import { deletePermit, savePermit } from '../../services/activityPermitService';
import { getFirebaseClient } from '../../services/firebaseClient';

type VertexForm = { lat: string[]; lng: string[]; latHem: string; lngHem: string };
const emptyVertex = (): VertexForm => ({ lat: ['', '', ''], lng: ['', '', ''], latHem: 'N', lngHem: 'E' });
const inputClass = 'min-h-11 min-w-0 w-full rounded-xl border border-slate-300 bg-white px-2 text-base';
const buttonClass = 'min-h-11 rounded-xl border border-sky-200 px-3 py-2 text-sm font-bold disabled:opacity-40';
export function PermitForm({ existing, onSave, onCancel, onBusy }: { existing?: ActivityPermit; onSave: (input: PermitInput) => Promise<void>; onCancel: () => void; onBusy?: (value: boolean) => void }) {
  const [permitNumber, setNumber] = useState(existing?.permitNumber ?? '');
  const [target, setTarget] = useState(existing?.target ?? '');
  const [sourceCrs, setCrs] = useState(existing?.sourceCrs ?? '');
  const [startDate, setStart] = useState(existing?.startDate ?? '');
  const [endDate, setEnd] = useState(existing?.endDate ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [vertices, setVertices] = useState<VertexForm[]>(() => existing ? existing.vertices.map(v => ({ lat: [v.latDms.degrees, v.latDms.minutes, v.latDms.seconds].map(String), lng: [v.lngDms.degrees, v.lngDms.minutes, v.lngDms.seconds].map(String), latHem: v.latDms.hemisphere, lngHem: v.lngDms.hemisphere })) : Array.from({ length: 4 }, emptyVertex));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const update = (index: number, patch: Partial<VertexForm>) => setVertices(v => v.map((item, i) => i === index ? { ...item, ...patch } : item));
  const parse = (values: string[], hemisphere: string): Dms => {
    if (!values.every((v, i) => (i === 2 ? /^\d+(?:\.\d+)?$/ : /^\d+$/).test(v.trim()))) throw new Error('빈 좌표나 잘못된 도·분·초 형식이 있습니다.');
    return { degrees: Number(values[0]), minutes: Number(values[1]), seconds: Number(values[2]), hemisphere };
  };
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault(); if (lock.current) return; lock.current = true; setBusy(true); onBusy?.(true); setError('');
    try {
      const points = vertices.map(v => { const latDms = parse(v.lat, v.latHem), lngDms = parse(v.lng, v.lngHem); return { latDms, lngDms, lat: dmsDecimal(latDms, 'lat'), lng: dmsDecimal(lngDms, 'lng') }; });
      await onSave({ permitNumber, target, sourceCrs, vertices: points, startDate, endDate, notes });
    } catch (e) { setError(e instanceof Error && !('code' in e) ? e.message : '저장하지 못했습니다. 연결과 권한을 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); onBusy?.(false); }
  }}>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <label className="block text-sm font-bold">허가번호<input required maxLength={120} value={permitNumber} onChange={e => setNumber(e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-bold">조사 대상<input required maxLength={80} value={target} onChange={e => setTarget(e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-bold">원본 좌표계<select required value={sourceCrs} onChange={e => setCrs(e.target.value)} className={inputClass}><option value="">미확인 · 원본 확인 필요</option><option value="EPSG:4326">WGS84 · EPSG:4326 (확인됨)</option></select></label>
      {vertices.map((vertex, index) => <fieldset key={index} className="min-w-0 rounded-xl border border-sky-200 bg-sky-50 p-2">
        <legend className="flex items-center gap-2 text-sm font-bold">{PERMIT_POINT_LABELS[index]} 지점 {index >= 4 && <button type="button" className={buttonClass} onClick={() => setVertices(v => v.filter((_, i) => i !== index))}>삭제</button>}</legend>
        {(['lat', 'lng'] as const).map(axis => <div key={axis} className="mt-2 min-w-0">
          <span className="text-sm">{axis === 'lat' ? '위도' : '경도'}</span>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_3.5rem] gap-1">
            {vertex[axis].map((value, part) => <label key={part} className="min-w-0 text-xs">{['도', '분', '초'][part]}<input aria-label={`${PERMIT_POINT_LABELS[index]} ${axis === 'lat' ? '위도' : '경도'} ${['도', '분', '초'][part]}`} required inputMode={part === 2 ? 'decimal' : 'numeric'} value={value} onChange={e => update(index, { [axis]: vertex[axis].map((v, i) => i === part ? e.target.value : v) })} className={inputClass} /></label>)}
            <label className="min-w-0 text-xs">방위<select aria-label={`${PERMIT_POINT_LABELS[index]} ${axis === 'lat' ? '위도' : '경도'} 방위`} value={axis === 'lat' ? vertex.latHem : vertex.lngHem} onChange={e => update(index, { [axis === 'lat' ? 'latHem' : 'lngHem']: e.target.value })} className={inputClass}>{(axis === 'lat' ? ['N', 'S'] : ['E', 'W']).map(h => <option key={h}>{h}</option>)}</select></label>
          </div>
        </div>)}
      </fieldset>)}
      <button type="button" disabled={vertices.length >= PERMIT_POINT_LABELS.length} onClick={() => setVertices(v => [...v, emptyVertex()])} className={buttonClass}>+ 지점 추가</button>
      <label className="block min-w-0 text-sm font-bold">조사 가능 시작일<input required type="date" value={startDate} onChange={e => setStart(e.target.value)} className={inputClass} /></label>
      <label className="block min-w-0 text-sm font-bold">조사 가능 종료일<input required type="date" value={endDate} onChange={e => setEnd(e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-bold">비고<textarea maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} rows={3} className={`${inputClass} py-2`} /></label>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2"><button disabled={busy} type="submit" className={`${buttonClass} bg-[#00846c] text-white`}>{busy ? '저장 중…' : '저장'}</button><button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>취소</button></div>
  </form>;
}

export function ActivityPermitPanel({ workspace, selected, mode, onClose, onFocus }: {
  workspace: PermitWorkspace; selected: (PermitSnapshot & { id: string }) | null; mode: 'list' | 'detail';
  onClose: () => void; onFocus: (p: PermitSnapshot & { id: string }) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [edit, setEdit] = useState<ActivityPermit | 'new' | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'list' || edit) dialog.current?.showModal(); }, [mode, edit]);
  const profile = workspace.profile;
  const current = selected ? workspace.records.find(p => p.id === selected.id) : undefined;
  const actions = current && profile && <div className="mt-3 flex flex-wrap gap-2">
    {current.authorUid === profile.uid && <button className={buttonClass} disabled={!workspace.ready || busy} onClick={() => setEdit(current)}>수정</button>}
    {(current.authorUid === profile.uid || workspace.isAdmin) && <button className={`${buttonClass} text-red-700`} disabled={!workspace.ready || busy} onClick={async () => {
      const db = getFirebaseClient()?.db; if (!db || busy) return; setBusy(true);
      try { await deletePermit(db, current); onClose(); } catch { setError('삭제하지 못했습니다. 권한·최신 자료를 확인해 주세요.'); } finally { setBusy(false); }
    }}>삭제</button>}
  </div>;
  const details = selected && <><h2 className="break-words text-lg font-black">{selected.permitNumber}-{selected.target}</h2><p className="mt-1 text-sm">{selected.startDate} ~ {selected.endDate} · {permitStatus(selected, workspace.today)}</p>{current?.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{current.notes}</p>}{!current && <p className="mt-2 text-sm">달력에 보존된 조사구역입니다.</p>}{actions}</>;
  if (mode === 'detail' && !edit) return <aside aria-label="행위허가 상세정보" className="fixed inset-x-2 bottom-3 z-[1250] mx-auto max-h-[32dvh] max-w-lg overflow-y-auto rounded-2xl border-2 border-yellow-500 bg-white p-3 text-[#003360] shadow-xl">
    <button aria-label="행위허가 닫기" onClick={onClose} className="float-right flex h-11 w-11 items-center justify-center rounded-xl border"><X className="h-4 w-4" /></button>{details}{error && <p role="alert">{error}</p>}
  </aside>;
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) { setEdit(null); onClose(); } }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-2xl border border-sky-200 bg-white p-3 text-[#003360] shadow-xl">
    <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-lg font-black">{edit ? '행위허가 등록·수정' : '행위허가 조사구역'}</h2><button aria-label="행위허가 닫기" disabled={busy} onClick={() => { setEdit(null); onClose(); }} className="flex h-11 w-11 items-center justify-center rounded-xl border"><X className="h-4 w-4" /></button></div>
    {!profile ? <AccountPanel /> : edit ? <PermitForm key={edit === 'new' ? 'new' : edit.id} existing={edit === 'new' ? undefined : edit} onBusy={setBusy} onCancel={() => setEdit(null)} onSave={async input => {
      const db = getFirebaseClient()?.db; if (!db || !workspace.ready) throw new Error('서버 연결을 확인한 뒤 저장해 주세요.');
      const id = await savePermit(db, profile, input, edit === 'new' ? undefined : edit);
      setEdit(null); onFocus({ ...input, id });
    }} /> : <>
      <button onClick={() => setEdit('new')} disabled={!workspace.ready} className={`${buttonClass} mb-3 bg-[#00846c] text-white`}>+ 신규 등록</button>
      {!workspace.ready && !workspace.error && <p role="status" className="text-sm">서버 연결 확인 중…</p>}
      {workspace.error && <p role="alert" className="text-sm text-red-700">{workspace.error}<button onClick={workspace.retry} className={buttonClass}>다시 시도</button></p>}
      <ul className="space-y-2">{workspace.records.map(p => <li key={p.id}><button className="w-full rounded-xl border border-sky-200 p-3 text-start" onClick={() => onFocus(p)}><strong className="block break-words text-sm">{p.permitNumber}-{p.target}</strong><span className="text-sm">{p.startDate} ~ {p.endDate} · {permitStatus(p, workspace.today)}</span></button></li>)}</ul>
      {workspace.ready && !workspace.records.length && <p className="text-sm">등록된 조사구역이 없습니다.</p>}
    </>}
  </dialog>;
}
