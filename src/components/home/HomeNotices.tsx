import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Settings, X } from 'lucide-react';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { announcementError, nextAnnouncementId, publishedAnnouncements, validateAnnouncement } from '../../services/announcementModel';
import type { Announcement, AnnouncementInput } from '../../services/announcementModel';
import { deleteAnnouncement, saveAnnouncement } from '../../services/announcementService';
import { getFirebaseClient } from '../../services/firebaseClient';
import './noticeTicker.css';

const buttonStyle = 'min-h-11 rounded-xl border border-sky-200 px-3 text-sm font-bold disabled:opacity-50';
const inputStyle = 'mt-1 min-h-11 w-full rounded-xl border border-sky-200 bg-white p-3 text-sm outline-none focus:border-[#008ca3]';

export function HomeNotices() {
  const auth = useFirebaseAuth();
  return auth.status === 'ready' && auth.user && auth.profile ? <NoticeBoard key={auth.user.uid} uid={auth.user.uid} /> : null;
}

function NoticeModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} aria-labelledby={label} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_1.5rem)] max-w-lg overflow-y-auto rounded-2xl border border-sky-200 bg-white p-4 text-[#003360] shadow-2xl select-text backdrop:bg-slate-950/50">
    <header className="mb-3 flex items-start justify-between gap-2"><h2 id={label} className="break-words text-lg font-black">{title}</h2>
      <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="공지 창 닫기" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-200"><X className="h-5 w-5" /></button></header>
    {children}
  </dialog>;
}

function NoticeBoard({ uid }: { uid: string }) {
  const notices = useAnnouncements(uid);
  const published = useMemo(() => publishedAnnouncements(notices.entries), [notices.entries]);
  const [activeId, setActiveId] = useState('');
  const active = published.find((notice) => notice.id === activeId) ?? published[0];
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = published.find((notice) => notice.id === detailId);
  const [managing, setManaging] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!reduced || detail || managing || published.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveId((id) => nextAnnouncementId(published, id));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [reduced, detail, managing, published]);
  const advance = () => {
    if (!active || published.length < 2) return;
    setActiveId(nextAnnouncementId(published, active.id));
  };
  return <>
    {notices.error && <p role="status" className="mt-2 rounded-xl bg-white/90 p-2 text-xs text-rose-800">{notices.error}
      <button type="button" onClick={notices.retry} className="ml-2 min-h-9 underline">다시 확인</button></p>}
    {active && <section aria-label="공지사항" className="bada-notice-bar mt-2.5 flex min-h-12 items-center gap-2 rounded-2xl border-2 border-white bg-white/95 px-3 text-[#003360] shadow-md">
      <span className="shrink-0 text-xl" aria-hidden="true">📢</span>
      <button type="button" onClick={() => setDetailId(active.id)} aria-label={`공지: ${active.title}. 전체 내용 보기`}
        className="min-h-11 min-w-0 flex-1 overflow-hidden text-left text-sm font-bold">
        <span key={`${active.id}/${active.title}`} className="bada-notice-copy" onAnimationIteration={advance}
          style={{ '--notice-duration': `${Math.max(18, Math.min(60, active.title.length / 3 + 12)) / 1.3}s` } as CSSProperties}>{active.title}</span>
      </button>
      {notices.isAdmin && <button type="button" onClick={() => setManaging(true)} aria-label="공지사항 관리" className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg"><Settings className="h-5 w-5" /></button>}
    </section>}
    {!active && notices.isAdmin && <button type="button" onClick={() => setManaging(true)} className={`${buttonStyle} mt-2 self-end bg-white/95`}><Settings className="mr-1 inline h-4 w-4" />공지사항 관리</button>}
    {detail && <NoticeModal title={detail.title} onClose={() => setDetailId(null)}>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{detail.body}</p>
      {published.length > 1 && <div className="mt-4 flex flex-wrap gap-2">{published.map((notice, index) => <button key={notice.id} type="button" onClick={() => setDetailId(notice.id)} aria-pressed={detail.id === notice.id} className={buttonStyle}>공지 {index + 1}</button>)}</div>}
    </NoticeModal>}
    {managing && notices.isAdmin && <NoticeManager uid={uid} entries={notices.entries} ready={notices.ready} onClose={() => setManaging(false)} />}
  </>;
}

function NoticeManager({ uid, entries, ready, onClose }: { uid: string; entries: Announcement[]; ready: boolean; onClose: () => void }) {
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [expected, setExpected] = useState<Announcement | undefined>();
  const [form, setForm] = useState<AnnouncementInput>({ title: '', body: '', published: false, sortOrder: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = () => { setId(crypto.randomUUID()); setExpected(undefined); setForm({ title: '', body: '', published: false, sortOrder: 0 }); setError(''); };
  const perform = async (remove: boolean) => {
    if (lock.current || !ready) return;
    if (remove && (!expected || !window.confirm('이 공지를 삭제할까요?'))) return;
    const client = getFirebaseClient();
    if (!client || client.auth.currentUser?.uid !== uid) return;
    if (!remove) { try { validateAnnouncement(form); } catch (cause) { setError(announcementError(cause)); return; } }
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (remove) await deleteAnnouncement(client.db, expected!);
      else await saveAnnouncement(client.db, uid, id, form, expected);
      if (mounted.current) { clear(); setNotice(remove ? '서버에서 삭제했습니다.' : '서버에 저장했습니다.'); }
    } catch (cause) { if (mounted.current) setError(announcementError(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return <NoticeModal title="공지사항 관리" onClose={onClose} busy={busy}>
    <p className="mb-3 text-xs">게시된 공지는 직원에게 즉시 반영됩니다. 정렬 숫자가 작은 공지부터 표시합니다.</p>
    {!ready && <p role="status" className="text-sm text-amber-800">서버의 최신 공지를 확인 중입니다. 쓰기는 잠겨 있습니다.</p>}
    <div className="mb-4 space-y-2">
      {entries.map((entry) => <button key={entry.id} type="button" disabled={busy} onClick={() => {
        setId(entry.id); setExpected(entry); setForm({ title: entry.title, body: entry.body, published: entry.published, sortOrder: entry.sortOrder }); setError(''); setNotice('');
      }} className="min-h-11 w-full rounded-xl border border-sky-200 p-3 text-left text-sm disabled:opacity-50"><span className="font-bold">{entry.title}</span><span className="ml-2 text-xs">{entry.published ? '게시' : '미게시'} · 순서 {entry.sortOrder}</span></button>)}
      {ready && entries.length === 0 && <p className="text-sm">등록된 공지가 없습니다.</p>}
    </div>
    <button type="button" disabled={busy} onClick={() => { clear(); setNotice(''); }} className={`${buttonStyle} mb-3`}>새 공지 작성</button>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void perform(false); }}>
      <label className="block text-sm font-bold">제목<input required maxLength={120} value={form.title} disabled={busy} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputStyle} /></label>
      <label className="block text-sm font-bold">본문<textarea required maxLength={10000} rows={6} value={form.body} disabled={busy} onChange={(event) => setForm({ ...form, body: event.target.value })} className={`${inputStyle} resize-y`} /></label>
      <label className="block text-sm font-bold">정렬 순서<input type="number" required min={0} max={9999} step={1} value={Number.isNaN(form.sortOrder) ? '' : form.sortOrder} disabled={busy} onChange={(event) => setForm({ ...form, sortOrder: event.target.value === '' ? NaN : Number(event.target.value) })} className={inputStyle} /></label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.published} disabled={busy} onChange={(event) => setForm({ ...form, published: event.target.checked })} />게시하기</label>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-sky-800">{notice}</p>}
      <div className="flex gap-2"><button type="submit" disabled={busy || !ready} className={`${buttonStyle} flex-1 bg-[#008ca3] text-white`}>{busy ? '처리 중…' : '저장'}</button>
        {expected && <button type="button" disabled={busy || !ready} onClick={() => void perform(true)} className={`${buttonStyle} text-rose-700`}>삭제</button>}</div>
    </form>
  </NoticeModal>;
}
