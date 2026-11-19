import { useEffect, useRef, useState } from 'react';
import { useActivityPermits } from '../../hooks/useActivityPermits';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';
import { addInvestigations, deleteInvestigation, subscribeInvestigations, updateInvestigation } from '../../services/activityPermitService';
import { getFirebaseClient } from '../../services/firebaseClient';
import { guardedSubscription } from '../../services/sharedCalendarModel';
import { MAX_PERMIT_SELECTION, type PermitInvestigation, type PermitSnapshot } from '../../services/activityPermitModel';
const button = 'min-h-11 rounded-xl border border-sky-200 px-3 py-2 text-sm font-bold disabled:opacity-40';
const field = 'min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-2 text-base';

type Props = {
  date: string; vessel: '101' | '103'; isAdmin: boolean;
  onOpenPermit: (id: string, snapshot: PermitSnapshot) => void;
};
export function PermitInvestigationSection(props: Props) {
  const auth = useFirebaseAuth();
  return <InvestigationSection key={`${auth.profile?.uid ?? ''}:${props.date}:${props.vessel}`} {...props} />;
}
function InvestigationSection({ date, vessel, isAdmin, onOpenPermit }: Props) {
  const workspace = useActivityPermits(), uid = workspace.profile?.uid ?? '';
  const scope = `${uid}:${vessel}:${date.slice(0, 7)}`;
  const [state, setState] = useState({ scope: '', records: [] as PermitInvestigation[], ready: false, error: '' });
  const [retry, setRetry] = useState(0), [picking, setPicking] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<PermitInvestigation | null>(null), [editDate, setDate] = useState(date), [editVessel, setVessel] = useState(vessel), [editStatus, setStatus] = useState<'planned' | 'completed'>('planned');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const db = getFirebaseClient()?.db; if (!db || !uid) return;
    return guardedSubscription<{ records: PermitInvestigation[]; cache: boolean }>(
      (next, fail) => subscribeInvestigations(db, vessel, date.slice(0, 7), (records, cache) => next({ records, cache }), fail),
      ({ records, cache }) => setState({ scope, records, ready: !cache, error: '' }),
      () => setState({ scope, records: [], ready: false, error: '조사 일정을 읽지 못했습니다. 연결·보안 규칙·인덱스를 확인해 주세요.' }));
  }, [uid, vessel, date, scope, retry]);
  const current = state.scope === scope ? state : { records: [], ready: false, error: '' };
  const entries = current.records.filter(s => s.date === date);
  const available = workspace.records.filter(p => date >= p.startDate && date <= p.endDate && !entries.some(s => s.permitId === p.id));
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await work(); setPicking(false); setSelected([]); setEditing(null); }
    catch { setError('저장하지 못했습니다. 본인 권한·기간·연결 및 최신 자료를 확인해 주세요.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <section aria-label="행위허가 조사" className="rounded-2xl border border-sky-200 bg-white p-3">
    <h3 className="mb-2 text-sm font-black">행위허가 조사</h3>
    {(current.error || error) && <p role="alert" className="mb-2 text-sm text-red-700">{current.error || error}{current.error && <button className={button} onClick={() => setRetry(v => v + 1)}>다시 시도</button>}</p>}
    <ul className="space-y-3">{entries.map(s => <li key={s.id} className="rounded-xl border border-sky-100 p-2">
      <button className="min-h-11 w-full break-words text-start text-sm font-bold text-[#0066b3] underline" onClick={() => onOpenPermit(s.permitId, s.permitSnapshot)}>{s.permitSnapshot.permitNumber}-{s.permitSnapshot.target}</button>
      <p className="text-sm">{s.status === 'completed' ? '조사 완료' : '조사 예정'} · {s.authorName}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {s.authorUid === uid && <button className={button} disabled={busy || !current.ready} onClick={() => { setEditing(s); setDate(s.date); setVessel(s.vessel); setStatus(s.status); setPicking(false); }}>일정 변경</button>}
        {(s.authorUid === uid || isAdmin) && <button className={button} disabled={busy || !current.ready} onClick={() => void run(async () => { const db = getFirebaseClient()?.db; if (!db) throw new Error(); await deleteInvestigation(db, s); })}>일정 취소</button>}
      </div>
      {editing?.id === s.id && <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => { const db = getFirebaseClient()?.db; if (!db || !workspace.profile) throw new Error(); await updateInvestigation(db, workspace.profile, s, { date: editDate, vessel: editVessel, status: editStatus }); }); }}>
        <label className="block text-sm">조사 날짜<input className={field} type="date" required disabled={busy} value={editDate} onChange={e => setDate(e.target.value)} /></label>
        <label className="block text-sm">선박<select className={field} disabled={busy} value={editVessel} onChange={e => setVessel(e.target.value === '103' ? '103' : '101')}><option value="101">101호</option><option value="103">103호</option></select></label>
        <label className="block text-sm">상태<select className={field} disabled={busy} value={editStatus} onChange={e => setStatus(e.target.value === 'completed' ? 'completed' : 'planned')}><option value="planned">조사 예정</option><option value="completed">조사 완료</option></select></label>
        <div className="flex gap-2"><button className={button} disabled={busy} type="submit">저장</button><button className={button} disabled={busy} type="button" onClick={() => setEditing(null)}>취소</button></div>
      </form>}
    </li>)}</ul>
    <button className={`${button} mt-2`} disabled={busy || !current.ready || !workspace.ready} onClick={() => { setPicking(v => !v); setSelected([]); setEditing(null); }}>+ 조사 일정 추가</button>
    {picking && <div className="mt-2 space-y-2">
      <p className="text-sm">한 번에 {MAX_PERMIT_SELECTION}개까지 선택</p>
      {available.map(p => <label key={p.id} className="flex min-h-11 items-start gap-2 rounded-xl border border-sky-200 p-2 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" disabled={busy || (selected.length >= MAX_PERMIT_SELECTION && !selected.includes(p.id))} checked={selected.includes(p.id)} onChange={e => setSelected(v => e.target.checked ? [...v, p.id] : v.filter(id => id !== p.id))} /><span className="min-w-0 break-words">{p.permitNumber}-{p.target}<span className="block">{p.startDate} ~ {p.endDate}</span></span></label>)}
      {!available.length && <p className="text-sm">이 날짜에 추가할 수 있는 조사구역이 없습니다.</p>}
      <div className="flex flex-wrap gap-2"><button className={`${button} bg-[#00846c] text-white`} disabled={busy || !selected.length} onClick={() => void run(async () => {
        const db = getFirebaseClient()?.db; if (!db || !workspace.profile) throw new Error(); await addInvestigations(db, workspace.profile, selected, vessel, date);
      })}>선택 일정 저장</button><button className={button} disabled={busy} onClick={() => { setPicking(false); setSelected([]); }}>취소</button></div>
    </div>}
  </section>;
}
