import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { RockWorkspace } from '../../hooks/useRockDocking';
import { getFirebaseClient } from '../../services/firebaseClient';
import { deleteRockNote, deleteRockPoint, ensureRockIsland, getRockPoint, saveRockNote, saveRockPoint, subscribeRockNotes } from '../../services/rockDockingService';
import { ROCK_STATES, rockComparison, rockIslandId, validateRock, type RockInput, type RockNote, type RockPhoto, type RockPoint, type RockVessel, type RockState } from '../../services/rockDockingModel';
import { ROCK_TRIAL_NOTICE } from '../../services/rockDockingTrialTides';
import { compressRockPhoto, loadRockPhoto, removeRockPhoto, rockStorageReady, rockPhotoStore } from '../../services/rockDockingPhotos';
import { applyRockPhotoPlan, planRockPhotos, sameRockPhotos, RockPhotoCommitUncertain, RockPhotoSaveError, rockSaveStep, rockSaveDiagnostic } from '../../services/rockDockingPhotoPlan';
import { koreaToday } from '../../services/sharedCalendarModel';

const button = 'min-h-11 rounded-xl border border-sky-200 bg-white px-3 text-sm font-bold text-[#003360] disabled:opacity-50';
const input = 'mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-[#003360]';
const errorText = (e: unknown) => {
  const diagnostic = rockSaveDiagnostic(e);
  const message = e instanceof Error && !('code' in e) ? e.message : '저장하지 못했습니다. 연결 또는 권한을 확인해 주세요.';
  return message + (diagnostic.stage || diagnostic.code ? ` (${[diagnostic.stage,diagnostic.code].filter(Boolean).join(' · ')})` : '');
};
export type RockPanelMode = 'list' | 'form' | 'detail' | 'brief';
function RockDialog({ open = true, title, children, onClose, back }: { open?: boolean; title: string; children: ReactNode; onClose: () => void; back?: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open) { ref.current?.close(); return; }
    const trigger = document.activeElement, dialog = ref.current; dialog?.showModal(); heading.current?.focus();
    return () => { dialog?.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); else document.querySelector<HTMLButtonElement>('[role="group"][aria-label="바다수첩 기능"] button')?.focus(); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby="rock-panel-title" onCancel={e => { e.preventDefault(); onClose(); }} className="bada-modal-dialog fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-transparent p-0 text-[#003360]">
    <div className="flex h-full items-end justify-center px-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-3">
      <section className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border-2 border-[#A5F3FC] bg-white shadow-lg">
        <header className="flex shrink-0 items-center gap-1 border-b border-sky-100 p-2">
          {back && <button type="button" className={button} aria-label="접안정보 목록으로" onClick={back}><ArrowLeft className="h-5 w-5" /></button>}
          <h2 id="rock-panel-title" ref={heading} tabIndex={-1} className="min-w-0 flex-1 px-2 font-black">{title}</h2>
          <button type="button" className={button} aria-label="접안정보 닫기" onClick={onClose}><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3 [overflow-wrap:anywhere]">{children}</div>
      </section>
    </div>
  </dialog>;
}
const photoLabel = (photo: RockPhoto) => photo.role === 'wide' ? '원경' : photo.role === 'close' ? '근경' : '추가 사진';
async function photoThumbnail(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1,480 / Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
    const context = canvas.getContext('2d'); if (!context) return blob;
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value ?? blob),'image/webp',.75));
  } finally { bitmap.close(); }
}
function Gallery({ photos }: { photos: RockPhoto[] }) {
  const ordered = [...photos].sort((a,b) => ['wide','close','extra'].indexOf(a.role)-['wide','close','extra'].indexOf(b.role));
  const [assets,setAssets] = useState<Record<string,{url: string; blob: Blob}>>({});
  const [selected,setSelected] = useState<number | null>(null), [fullUrl,setFullUrl] = useState(''), [error,setError] = useState('');
  const signature = ordered.map(p => p.path).join('|'), viewer = useRef<HTMLDialogElement>(null), start = useRef<{x: number; y: number} | null>(null);
  useEffect(() => {
    let active = true; const created: string[] = []; setAssets({}); setSelected(null); setError('');
    if (photos.length && !rockStorageReady()) { setError('사진 저장소 미연결'); return; }
    for (const photo of photos) void loadRockPhoto(photo).then(async blob => {
      const thumbnail = await photoThumbnail(blob);
      if (active) { const url = URL.createObjectURL(thumbnail); created.push(url); setAssets(v => ({...v,[photo.id]:{url,blob}})); }
    }).catch(e => { console.error('[rock-docking photo]',rockSaveDiagnostic(e)); if (active) setError('사진을 불러오지 못했습니다.'); });
    return () => { active = false; created.forEach(url => URL.revokeObjectURL(url)); };
  // Parent keys by point ID/revision. Only this selected point downloads photos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[signature]);
  const selectedBlob = selected === null ? null : assets[ordered[selected]?.id]?.blob;
  useEffect(() => {
    const dialog = viewer.current;
    if (selected === null) { dialog?.close(); setFullUrl(''); return; }
    if (dialog && !dialog.open) dialog.showModal();
    if (!selectedBlob) { setFullUrl(''); return; }
    // Create a full-size URL only when enlarged; reuse the authenticated in-memory blob.
    const url = URL.createObjectURL(selectedBlob); setFullUrl(url);
    return () => URL.revokeObjectURL(url);
  },[selected,selectedBlob]);
  const move = (step: number) => setSelected(v => v === null ? null : (v+step+ordered.length)%ordered.length);
  return <div>
    <div className="grid grid-cols-2 gap-2">{ordered.map((p,i) => <figure key={p.id} className="min-w-0">
      <button type="button" className="relative block aspect-[4/3] min-h-11 w-full overflow-hidden rounded-xl border border-sky-200 bg-slate-50" disabled={!assets[p.id]} aria-label={(p.role==='extra'?'추가':photoLabel(p))+' 사진 '+(i+1)+' 확대'} onClick={() => setSelected(i)}>
        {assets[p.id] ? <img src={assets[p.id].url} alt={photoLabel(p)} className="h-full w-full object-cover" loading={i<2?'eager':'lazy'} /> : <span role="status" className="text-xs text-slate-500">사진 불러오는 중</span>}
      </button><figcaption className="mt-1 text-center text-xs text-slate-600">{photoLabel(p)}</figcaption>
    </figure>)}</div>
    {error && <p role="status" className="mt-1 text-xs text-slate-600">{error}</p>}
    <dialog ref={viewer} onCancel={e => { e.preventDefault(); e.stopPropagation(); setSelected(null); }} onKeyDown={e => { if (e.key === 'ArrowLeft') move(-1); if (e.key === 'ArrowRight') move(1); }} aria-label="접안지 사진 확대" className="bada-modal-dialog fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-slate-950 p-3 text-white">
      {selected !== null && <div className="flex h-full flex-col gap-2">
        <div className="flex items-center justify-between"><span>{selected+1} / {ordered.length} · {photoLabel(ordered[selected])}</span><button type="button" className="min-h-11 min-w-11" aria-label="사진 확대 닫기" onClick={() => setSelected(null)}><X /></button></div>
        <div className="flex min-h-0 flex-1 items-center justify-center" style={{touchAction:'pan-y pinch-zoom'}} onTouchStart={e => { start.current = {x:e.touches[0].clientX,y:e.touches[0].clientY}; }} onTouchEnd={e => {
          if (start.current && e.changedTouches.length) { const dx=e.changedTouches[0].clientX-start.current.x,dy=e.changedTouches[0].clientY-start.current.y; if (Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy)) move(dx<0?1:-1); } start.current=null;
        }} onTouchCancel={() => { start.current=null; }}>
          {fullUrl ? <img src={fullUrl} alt={photoLabel(ordered[selected])+' 확대'} className="max-h-full max-w-full object-contain" /> : <span role="status">사진 불러오는 중</span>}
        </div>
        {ordered.length>1 && <div className="flex justify-between"><button type="button" className="min-h-11 min-w-11" aria-label="이전 사진" onClick={() => move(-1)}><ChevronLeft /></button><button type="button" className="min-h-11 min-w-11" aria-label="다음 사진" onClick={() => move(1)}><ChevronRight /></button></div>}
      </div>}
    </dialog>
  </div>;
}
function RockBrief({ point,props,rangeText,estimate }: { point: RockPoint; props: Props; rangeText: (v: RockVessel) => string; estimate: string }) {
  const [notes,setNotes] = useState<number | null>(null),[noteError,setNoteError] = useState(false);
  useEffect(() => {
    const db=getFirebaseClient()?.db; if (!db) return;
    let active=true;
    const stop=subscribeRockNotes(db,point.id,items => { if(active) setNotes(items.length); },() => { if(active) setNoteError(true); });
    return () => {active=false;stop();};
  },[point.id]);
  return <aside aria-label="갯바위 접안 간략정보" style={point.photos.length ? {height:'58dvh'} : undefined} className="pointer-events-auto fixed inset-x-2.5 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[950] mx-auto flex max-h-[58dvh] max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-[#A5F3FC] bg-white text-[#003360] shadow-md">
    <header className="flex shrink-0 items-start justify-between gap-2 border-b border-sky-100 px-3 py-2">
      <div className="min-w-0"><h2 className="break-words text-sm font-black">{point.name}</h2><p className="mt-1 text-xs">{props.vessel}호 · <strong style={{color:ROCK_STATES[props.state].color}}>{ROCK_STATES[props.state].label}</strong> · 시험 운영</p><p className="mt-1 text-xs">현재 예보 조위 {estimate} · {point.stationCode === 'DT_0014' ? '통영' : '고현항'} 기준</p></div>
      <button type="button" className="flex min-h-11 min-w-11 items-center justify-center" aria-label="접안정보 닫기" onClick={props.onClose}><X className="h-5 w-5" /></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 [overflow-wrap:anywhere]">
      {point.photos.length>0 && <Gallery key={point.id+':'+point.revision} photos={point.photos} />}
      <TrialRanges point={point} height={props.height} rangeText={rangeText} />
      <p className="mt-2 text-xs text-slate-600">{ROCK_TRIAL_NOTICE}</p>
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-sky-100 px-3 py-2">
      <div className="min-w-0 text-xs text-slate-600"><p>{noteError?'현장 메모 확인 실패':'현장 메모 '+(notes===null?'확인 중':notes+'건')}</p><p className="mt-1">최종 확인 {point.confirmedOn}</p></div>
      <button type="button" className={button+' shrink-0'} onClick={() => props.onMode('detail')}>상세 보기</button>
    </footer>
  </aside>;
}

function TrialRanges({ point, height, rangeText }: { point: RockPoint; height: number | null; rangeText: (v: RockVessel) => string }) {
  return <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">{(['101','103'] as const).map(v => {
    const state = ROCK_STATES[rockComparison(height, point.ranges[v])];
    return <div key={v}><dt>{v}호: <strong style={{color:state.color}}>{state.label}</strong></dt><dd className="mt-1 text-xs text-slate-600">{rangeText(v)}</dd></div>;
  })}</dl>;
}

type PhotoSlot = { role: RockPhoto['role']; photo?: RockPhoto; data?: Awaited<ReturnType<typeof compressRockPhoto>>; preview?: string };
function RockForm({ workspace, point, picked, onPick, onSaved }: { workspace: RockWorkspace; point: RockPoint | null; picked: { lat: number; lng: number; nonce: number } | null; onPick: () => void; onSaved: (id: string) => void }) {
  const [island, setIsland] = useState(point?.islandId ?? workspace.islands[0]?.id ?? '__new'), [newIsland, setNewIsland] = useState('');
  const [name, setName] = useState(point?.name ?? '');
  const coords = picked ? {lat: picked.lat, lng: picked.lng} : (point ? {lat: point.lat, lng: point.lng} : null);
  const [station, setStation] = useState<RockInput['stationCode']>(point?.stationCode ?? 'DT_0014'), [datum, setDatum] = useState<RockInput['datum']>(point?.datum ?? 'unverified');
  const [confirmed, setConfirmed] = useState(point?.confirmedOn ?? koreaToday());
  const [ranges, setRanges] = useState(() => Object.fromEntries((['101','103'] as const).map(v => [v, { min: point?.ranges[v]?.min.toString() ?? '', max: point?.ranges[v]?.max.toString() ?? '' }])) as Record<RockVessel, { min: string; max: string }>);
  const [memo, setMemo] = useState(''), [pinned, setPinned] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [persisted, setPersisted] = useState(point);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [slots, setSlots] = useState<PhotoSlot[]>(() => {
    const items: PhotoSlot[] = (point?.photos ?? []).map(photo => ({ role: photo.role, photo }));
    for (const role of ['wide','close'] as const) if (!items.some(s => s.role === role)) items.push({ role }); return items;
  });
  const live = useRef(true);
  const objectUrls = useRef<string[]>([]), errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { const urls = objectUrls.current; live.current = true; return () => { live.current = false; urls.forEach(url => URL.revokeObjectURL(url)); }; }, []);
  const updateSlot = async (index: number, file?: File) => {
    if (!file || busy || recoveryRequired) return; setBusy(true); setError('');
    try { const data = await compressRockPhoto(file); if (!live.current) return; const preview = URL.createObjectURL(data.blob); objectUrls.current.push(preview); setSlots(items => items.map((s, i) => i === index ? { ...s, data, preview } : s)); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy || recoveryRequired) return; setError('');
    const db = getFirebaseClient()?.db, profile = workspace.profile; if (!db || !profile || !workspace.ready) { setError('로그인과 연결 상태를 확인해 주세요.'); return; }
    if (!coords) { setError('지도에서 위치를 선택해 주세요.'); return; }
    setBusy(true); let photosCommitted = false, pointSaved = false, snapshotRead = false;
    try {
      const islandId = island === '__new' ? rockIslandId(newIsland) : island;
      const values = Object.fromEntries((['101','103'] as const).map(v => { const r = ranges[v]; if ((r.min === '') !== (r.max === '')) throw Error(`${v}호 최저·최고 조위를 함께 입력해 주세요.`); return [v, r.min === '' ? null : { min: Number(r.min), max: Number(r.max) }]; })) as RockInput['ranges'];
      const input: RockInput = { islandId, name, ...coords, stationCode: station, datum, confirmedOn: confirmed, ranges: values, photos: persisted?.photos ?? [] };
      validateRock(input);
      if (island === '__new') await rockSaveStep('섬 저장','rockDockingIslands/'+islandId,() => ensureRockIsland(db, profile, newIsland));
      const id = await rockSaveStep('지점 저장','rockDockingPoints/'+(persisted?.id ?? '(신규)'),() => saveRockPoint(db, profile, input, persisted ?? undefined, memo.trim() ? { text: memo, pinned } : undefined)); pointSaved = true;
      const current = await rockSaveStep('저장된 지점 확인','rockDockingPoints/'+id,() => getRockPoint(db,id,true)); snapshotRead = true; setPersisted(current); setMemo('');
      const plan = planRockPhotos(id,current.authorUid,slots,current.photos);
      const unchanged = async () => {
        const observed = await rockSaveStep('지점 변경 확인','rockDockingPoints/'+id,() => getRockPoint(db,id,true));
        return !observed.deleted && observed.revision === current.revision && sameRockPhotos(observed.photos,current.photos);
      };
      const commit = async (photos: RockPhoto[]) => {
        if (!plan.writes.length && !plan.removals.length && sameRockPhotos(photos,current.photos)) return;
        try { await rockSaveStep('사진 메타데이터 저장','rockDockingPoints/'+id,() => saveRockPoint(db,profile,{...input,photos},current)); }
        catch (cause) {
          let observed: RockPoint;
          try { observed = await getRockPoint(db,id,true); } catch { throw new RockPhotoCommitUncertain(cause); }
          if (!observed.deleted && observed.revision === current.revision + 1 && sameRockPhotos(observed.photos,photos)) return;
          if (observed.revision === current.revision && sameRockPhotos(observed.photos,current.photos)) throw cause;
          throw new RockPhotoCommitUncertain(cause);
        }
      };
      if (plan.writes.length || plan.removals.length) {
        const result = await applyRockPhotoPlan(plan,rockPhotoStore(unchanged),commit); photosCommitted = true;
        if (result.cleanupFailed.length) throw new RockPhotoSaveError('접안정보는 저장됐지만 이전 사진 정리에 실패했습니다. 다시 열어 확인해 주세요.',true);
      } else { await commit(plan.photos); photosCommitted = true; }
      setPersisted(await getRockPoint(db,id,true));
      if (live.current) onSaved(id);
    } catch (e) {
      console.error('[rock-docking save]',rockSaveDiagnostic(e));
      if ((pointSaved && !snapshotRead) || photosCommitted || (e instanceof RockPhotoSaveError && e.needsReload)) setRecoveryRequired(true);
      setError(errorText(e) + (pointSaved && snapshotRead && !photosCommitted ? ' 지점 정보는 저장되어 있습니다. 닫은 뒤 해당 지점에서 사진 상태를 확인해 주세요.' : ''));
    } finally { setBusy(false); }
  };
  return <form onSubmit={submit} className="space-y-3" aria-busy={busy}>
    <label className="block text-sm font-bold">섬<select className={input} value={island} onChange={e => setIsland(e.target.value)}>{workspace.islands.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}<option value="__new">새 섬 추가</option></select></label>
    {island === '__new' && <label className="block text-sm font-bold">새 섬 이름<input className={input} value={newIsland} onChange={e => setNewIsland(e.target.value)} required maxLength={40} /></label>}
    <label className="block text-sm font-bold">접안 지점명<input className={input} value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
    <div><button type="button" className={button} disabled={busy || recoveryRequired} onClick={onPick}>지도에서 위치 선택</button>{coords && <p className="mt-1 text-xs text-slate-600">{coords.lat.toFixed(5)}°N, {coords.lng.toFixed(5)}°E</p>}</div>
    <div className="grid grid-cols-2 gap-2">{slots.map((s, i) => <div key={i} className="min-w-0 rounded-xl border border-sky-200 p-2">
      <label className="block text-xs font-bold">{s.role === 'wide' ? '원경' : s.role === 'close' ? '근경' : '추가 사진'}<input className="mt-2 w-full text-xs" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || recoveryRequired || !rockStorageReady()} onChange={e => { void updateSlot(i, e.target.files?.[0]); e.target.value = ''; }} /></label>
      {s.preview ? <img src={s.preview} alt="선택한 사진" className="mt-2 h-20 w-full rounded-lg object-cover" /> : s.photo && <p className="mt-1 text-xs">등록된 사진</p>}
      <div className="mt-1 flex flex-wrap gap-1"><button type="button" className={button} disabled={busy || recoveryRequired || i === 0} aria-label={`사진 ${i + 1} 앞으로`} onClick={() => setSlots(items => { const next = [...items]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })}>↑</button><button type="button" className={button} disabled={busy || recoveryRequired || i === slots.length - 1} aria-label={`사진 ${i + 1} 뒤로`} onClick={() => setSlots(items => { const next = [...items]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; })}>↓</button>
        <button type="button" className={button} disabled={busy || recoveryRequired} aria-label={`사진 ${i + 1} 삭제`} onClick={() => setSlots(items => s.role === 'extra' ? items.filter((_, n) => n !== i) : items.map((item, n) => n === i ? { role: item.role } : item))}>삭제</button></div>
    </div>)}</div>
    {slots.length < 4 && <button type="button" className={button} disabled={busy || !rockStorageReady()} onClick={() => setSlots(items => [...items, { role: 'extra' }])}>+ 사진 추가</button>}
    {!rockStorageReady() && <p className="text-xs text-slate-600">사진 저장소 미연결</p>}
    <div className="grid grid-cols-2 gap-2"><label className="text-sm font-bold">조위 기준 지점<select className={input} value={station} onChange={e => setStation(e.target.value as RockInput['stationCode'])}><option value="DT_0014">통영</option><option value="SO_0552">고현항</option></select></label><label className="text-sm font-bold">조위 기준면<select className={input} value={datum} onChange={e => setDatum(e.target.value as RockInput['datum'])}><option value="unverified">미확인</option><option value="DL">DL</option></select></label></div>
    {(['101','103'] as const).map(v => <fieldset key={v} className="rounded-xl border border-sky-200 p-2"><legend className="px-1 text-sm font-bold">{v}호 조위 범위 (cm)</legend><div className="grid grid-cols-2 gap-2">{(['min','max'] as const).map(k => <label key={k} className="text-xs">{k === 'min' ? '최저 조위' : '최고 조위'}<input aria-label={`${v}호 ${k === 'min' ? '최저' : '최고'} 조위`} className={input} type="number" step="any" min={-2000} max={2000} value={ranges[v][k]} onChange={e => setRanges(r => ({ ...r, [v]: { ...r[v], [k]: e.target.value } }))} /></label>)}</div></fieldset>)}
    <label className="block text-sm font-bold">현장 메모<textarea className={input} rows={3} maxLength={4000} value={memo} onChange={e => setMemo(e.target.value)} /></label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />중요 메모 상단 고정</label>
    <label className="block text-sm font-bold">최종 확인일<input className={input} type="date" value={confirmed} onChange={e => setConfirmed(e.target.value)} required /></label>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-rose-800">{error}</p>}
    <button type="submit" className={button + ' w-full border-teal-400'} disabled={busy || recoveryRequired}>{busy ? '저장 중…' : '저장'}</button>
  </form>;
}

function RockNotes({ point, workspace }: { point: RockPoint; workspace: RockWorkspace }) {
  const [notes, setNotes] = useState<RockNote[]>([]), [text, setText] = useState(''), [pinned, setPinned] = useState(false), [editing, setEditing] = useState<RockNote | undefined>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => {
    const db = getFirebaseClient()?.db; if (!db) return;
    let live = true, stop: (() => void) | undefined;
    queueMicrotask(() => { if (!live) return; try { stop = subscribeRockNotes(db, point.id, items => { if (live) { setNotes(items); setReady(true); } }, () => { if (live) { setReady(false); setError('메모를 읽지 못했습니다.'); } }); } catch { if (live) setError('메모를 읽지 못했습니다.'); } });
    return () => { live = false; stop?.(); };
  }, [point.id]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); const db = getFirebaseClient()?.db; if (!db || !workspace.profile || busy) return;
    setBusy(true); setError('');
    try { await saveRockNote(db, workspace.profile, point.id, text, pinned, editing); setText(''); setPinned(false); setEditing(undefined); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const remove = async (note: RockNote) => {
    const db = getFirebaseClient()?.db; if (!db || !window.confirm('이 메모를 삭제할까요?')) return;
    setBusy(true); try { await deleteRockNote(db, point.id, note); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <section aria-label="현장 메모" className="space-y-2">
    <h3 className="text-sm font-black">현장 메모</h3>
    {!ready && !error && <p role="status" className="text-xs">메모를 불러오는 중입니다.</p>}
    {notes.map(note => <article key={note.id} className="rounded-xl border border-sky-200 p-3">
      {note.pinned && <p className="text-xs font-bold text-teal-800">중요 메모</p>}
      <p className="whitespace-pre-wrap text-sm">{note.text}</p><p className="mt-1 text-xs text-slate-600">{note.authorName} · {new Date(note.updatedAt.seconds * 1000).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
      <div className="mt-1 flex gap-1">{note.authorUid === workspace.profile?.uid && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(note); setText(note.text); setPinned(note.pinned); }}>메모 수정</button>}
        {(note.authorUid === workspace.profile?.uid || workspace.isAdmin) && <button type="button" className={button} disabled={busy} onClick={() => void remove(note)}>메모 삭제</button>}</div>
    </article>)}
    <form onSubmit={save} className="space-y-2"><label className="block text-sm font-bold">{editing ? '메모 수정' : '메모 남기기'}<textarea className={input} rows={3} required maxLength={4000} value={text} onChange={e => setText(e.target.value)} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />중요 메모 상단 고정</label>
      <button type="submit" className={button} disabled={busy || !workspace.ready}>{editing ? '메모 변경 저장' : '메모 저장'}</button>
      {editing && <button type="button" className={button} onClick={() => { setEditing(undefined); setText(''); setPinned(false); }}>수정 취소</button>}
    </form>{error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
  </section>;
}
interface Props {
  workspace: RockWorkspace; mode: RockPanelMode; pointId: string | null; hidden: boolean;
  picked: { lat: number; lng: number; nonce: number } | null; onPick: () => void;
  onMode: (mode: RockPanelMode) => void; onNew: () => void; onFocus: (id: string) => void; onSaved: (id: string) => void; onClose: () => void;
  vessel: RockVessel; onVessel: (v: RockVessel) => void; height: number | null; state: RockState;
}
export default function RockDockingPanel(props: Props) {
  const { workspace, mode, pointId } = props, point = workspace.points.find(p => p.id === pointId) ?? null;
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const rangeText = (v: RockVessel) => point?.ranges[v] ? `${point.ranges[v]!.min} ~ ${point.ranges[v]!.max} cm` : '미확인';
  const estimate = props.height === null ? '미확인' : `${props.height.toLocaleString('ko-KR', {maximumFractionDigits:1})}cm`;
  const controls = <div className="mb-3 flex flex-wrap items-end gap-2">
    <label className="text-xs font-bold">선박<select className={input} value={props.vessel} onChange={e => props.onVessel(e.target.value as RockVessel)}><option value="101">101호</option><option value="103">103호</option></select></label>
  </div>;
  const remove = async () => {
    const db = getFirebaseClient()?.db; if (!point || !db || !workspace.profile || !window.confirm('이 접안 지점을 삭제할까요?')) return;
    setBusy(true); setError('');
    try { await deleteRockPoint(db, workspace.profile, point); const results = await Promise.allSettled(point.photos.map(removeRockPhoto));
      if (results.some(r => r.status === 'rejected')) { setError('지점은 삭제됐지만 일부 사진 정리에 실패했습니다.'); return; } props.onClose();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  if (mode === 'brief') return props.hidden || !point ? null : <RockBrief key={point.id} point={point} props={props} rangeText={rangeText} estimate={estimate} />;
  return <RockDialog key={mode} open={!props.hidden} title="갯바위 접안정보" onClose={props.onClose} back={mode !== 'list' ? () => props.onMode('list') : undefined}>
    {!workspace.profile ? <p className="text-sm">로그인 후 접안정보를 확인할 수 있습니다.</p> : workspace.error ? <div><p role="alert" className="text-sm">{workspace.error}</p><button type="button" className={button} onClick={workspace.retry}>다시 불러오기</button></div> : !workspace.ready ? <p role="status" className="text-sm">접안정보를 불러오는 중입니다.</p> : mode === 'form' ? <RockForm key={pointId ?? 'new'} workspace={workspace} point={point} picked={props.picked} onPick={props.onPick} onSaved={props.onSaved} /> : <>
      {controls}
      {mode === 'list' ? <div className="space-y-2"><button type="button" className={button + ' mb-2'} onClick={props.onNew}>+ 접안 지점 등록</button>
        {workspace.points.length === 0 && <p className="text-sm text-slate-600">등록된 접안 지점이 없습니다.</p>}
        {workspace.islands.filter(i => workspace.points.some(p => p.islandId === i.id)).map(island => <details key={island.id} className="rounded-xl border border-sky-200 px-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">{island.name}</summary><ul>{workspace.points.filter(p => p.islandId === island.id).map(p => <li key={p.id}><button type="button" className="min-h-11 w-full py-2 text-left text-sm" onClick={() => props.onFocus(p.id)}>{p.name}</button></li>)}</ul></details>)}
      </div> : point ? <article className="space-y-3">
        <h3 className="text-base font-black">{point.name}</h3>
        <p className="text-sm">현재 예보 조위 {estimate} · {point.stationCode === 'DT_0014' ? '통영' : '고현항'} 기준</p>
        <p className="text-xs text-slate-600">{props.vessel}호 · 시험 운영</p>
        {point.photos.length > 0 && <Gallery key={point.id + ":" + point.revision} photos={point.photos} />}
        <TrialRanges point={point} height={props.height} rangeText={rangeText} />
        <p className="text-xs text-slate-600">{ROCK_TRIAL_NOTICE}</p>
        <p className="text-xs text-slate-600">최종 확인 {point.confirmedOn}<br />작성 {point.authorName} · 수정 {point.updatedBy} {new Date(point.updatedAt.seconds * 1000).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={() => props.onFocus(point.id)}>지도에서 보기</button>
          {point.authorUid === workspace.profile.uid && <button type="button" className={button} onClick={() => props.onMode('form')}>지점 수정</button>}
          {(point.authorUid === workspace.profile.uid || workspace.isAdmin) && <button type="button" className={button} disabled={busy} onClick={() => void remove()}>지점 삭제</button>}</div>
        <RockNotes key={point.id} point={point} workspace={workspace} />
      </article> : <p role="status" className="text-sm">선택한 지점을 찾을 수 없습니다.</p>}
    </>}{error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
  </RockDialog>;
}
