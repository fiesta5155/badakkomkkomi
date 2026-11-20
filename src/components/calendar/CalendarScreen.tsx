import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Cloud, CloudRain, CloudSnow, CloudSun, FileText, Pencil, Plus, Ship, Sun, Trash2 } from 'lucide-react';
import { tideNameForDate, weatherDescription, type CalendarRegion } from './calendarConditions';
import { createCalendarRepository, monthCells, type CalendarVessel, type VoyageKind } from '../../services/calendarRepository';
import { useFirebaseAuth } from '../../hooks/useFirebaseAuth';
import { useSharedCalendar } from '../../hooks/useSharedCalendar';
import { useCalendarWeather } from '../../hooks/useCalendarWeather';
import { getFirebaseClient } from '../../services/firebaseClient';
import { deleteSharedEntry, saveSharedEntry } from '../../services/calendarFirestoreService';
import { calendarErrorMessage, entriesForDay, koreaToday, legacyBackup } from '../../services/sharedCalendarModel';
import type { SharedEntry } from '../../services/sharedCalendarModel';
import { AccountPanel } from '../auth/AccountPanel';
import { CalendarDetailConditions } from './CalendarDayConditions';
import { PermitInvestigationSection } from './PermitInvestigationSection';
import type { PermitSnapshot } from '../../services/activityPermitModel';
import type { PermitWorkspace } from '../../hooks/useActivityPermits';

type CalendarView = 'month' | 'detail' | 'editor';
type EntryKind = VoyageKind | 'memo';
type EditTarget = { kind: 'new' } | { kind: 'status' } | { kind: 'memo'; id: string };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const entryLabels: Record<EntryKind, string> = {
  planned: '운항예정', unavailable: '운항불가', memo: '메모',
};

function fullDateLabel(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(`${value}T12:00:00+09:00`));
}

type CalendarProps = { onBackHome: () => void; onOpenPermit: (id: string, snapshot: PermitSnapshot) => void; permitWorkspace: PermitWorkspace };
export function CalendarScreen({ onBackHome, onOpenPermit, permitWorkspace }: CalendarProps) {
  const auth = useFirebaseAuth();
  if (auth.status !== 'ready' || !auth.user || !auth.profile) return (
    <div className="h-dvh overflow-y-auto bg-white p-4" style={{ paddingTop: 'var(--safe-top)' }}>
      <button type="button" onClick={onBackHome} className="mb-4 min-h-10 rounded-xl border p-2">홈으로</button>
      <h1 className="mb-3 text-xl font-black">꼬미의 달력</h1>
      <AccountPanel />
      <p role="status">공유 달력은 Google 로그인과 한글 2글자 실명 확인을 완료한 뒤 이용할 수 있습니다.</p>
      <LegacyCalendarBackup />
    </div>
  );
  return <SharedCalendarScreen key={auth.user.uid} onBackHome={onBackHome} onOpenPermit={onOpenPermit} permitWorkspace={permitWorkspace} />;
}

function LegacyCalendarBackup() {
  const [error, setError] = useState('');
  let raw: string | null = null;
  try { raw = legacyBackup(window.localStorage); } catch { /* 다운로드 시 접근 오류를 안내한다. */ }
  const download = () => {
    try {
      const original = legacyBackup(window.localStorage);
      if (original === null) throw new Error('missing');
      const url = URL.createObjectURL(new Blob([original], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'bada-calendar-local-backup-' + koreaToday() + '.json';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch { setError('로컬 원본을 읽지 못했습니다. 브라우저 저장소 접근을 확인해 주세요.'); }
  };
  return <aside hidden className="my-3 rounded-xl border border-sky-200 p-3 text-xs text-[#003360]">
    {raw !== null ? <><p className="font-bold">기존 로컬 일정 보관 중</p><p>공유 달력과 분리하여 보존합니다. 자동 이전하지 않습니다.</p></> : <p>기존 로컬 자료가 있다면 원본 그대로 JSON 백업할 수 있습니다.</p>}
    <button type="button" onClick={download} className="mt-2 min-h-9 rounded-lg border border-sky-200 px-2">로컬 일정 JSON 백업</button>
    {error && <p role="alert">{error}</p>}
  </aside>;
}

function SharedCalendarScreen({ onBackHome, onOpenPermit, permitWorkspace }: CalendarProps) {
  const auth = useFirebaseAuth();
  const profile = auth.profile!;
  const repository = useMemo(() => createCalendarRepository(window.localStorage), []);
  const [vessel, setVessel] = useState<CalendarVessel>(() => repository.getLastVessel());
  const [region, setRegion] = useState<CalendarRegion>(() => {
    try { return window.localStorage.getItem('bada_kkomkkomi_calendar_region_v1') === 'geoje' ? 'geoje' : 'tongyeong'; }
    catch { return 'tongyeong'; }
  });
  const weather = useCalendarWeather(region);
  const [displayMonth, setDisplayMonth] = useState(() => new Date(koreaToday().slice(0, 7) + '-01T12:00:00'));
  const [selectedDate, setSelectedDate] = useState(koreaToday);
  const [todayKey, setTodayKey] = useState(koreaToday);
  const [view, setView] = useState<CalendarView>('month');
  const [editTarget, setEditTarget] = useState<EditTarget>({ kind: 'new' });
  const [entryKind, setEntryKind] = useState<EntryKind>('planned');
  const [expected, setExpected] = useState<SharedEntry | undefined>();
  const newMemoId = useRef('');
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [, setError] = useState('');

  const month = String(displayMonth.getFullYear()) + '-' + String(displayMonth.getMonth() + 1).padStart(2, '0');
  const shared = useSharedCalendar(profile.uid, vessel, month);
  const ready = shared.phase === 'ready';
  const day = entriesForDay(shared.entries, selectedDate);
  const canEdit = (entry: SharedEntry) => entry.authorUid === profile.uid;
  const canDelete = (entry: SharedEntry) => canEdit(entry) || shared.isAdmin;
  const cells = useMemo(() => monthCells(displayMonth.getFullYear(), displayMonth.getMonth()), [displayMonth]);

  const selectRegion = (next: CalendarRegion) => {
    setRegion(next);
    try { window.localStorage.setItem('bada_kkomkkomi_calendar_region_v1', next); } catch { /* Still usable without persistence. */ }
  };

  const openNewEntry = () => {
    setEditTarget({ kind: 'new' }); setExpected(undefined);
    newMemoId.current = 'memo_' + crypto.randomUUID();
    setEntryKind(day.status ? 'memo' : 'planned');
    setContent(''); setError(''); setView('editor');
  };
  const edit = (entry: SharedEntry) => {
    if (!canEdit(entry) || !ready) return;
    setExpected(entry); setEditTarget(entry.kind === 'memo' ? { kind: 'memo', id: entry.id } : { kind: 'status' });
    setEntryKind(entry.kind); setContent(entry.content); setError(''); setView('editor');
  };
  const editStatus = () => { if (day.status) edit(day.status); };
  const editMemo = (id: string) => { const entry = day.memos.find((item) => item.id === id); if (entry) edit(entry); };

  const saveEntry = async () => {
    if (busyRef.current || !ready) return;
    if (!content.trim()) { setError('내용을 입력해 주세요.'); return; }
    const db = getFirebaseClient()?.db;
    if (!db || getFirebaseClient()?.auth.currentUser?.uid !== profile.uid) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await saveSharedEntry(db, vessel, profile, {
        id: expected?.id ?? (entryKind === 'memo' ? newMemoId.current : 'status_' + selectedDate),
        date: selectedDate, kind: entryKind, content, expected,
      });
      if (mounted.current) setView('detail');
    } catch (cause) { if (mounted.current) setError(calendarErrorMessage(cause)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const remove = async (entry: SharedEntry) => {
    if (busyRef.current || !ready || !canDelete(entry) || !window.confirm('일정을 삭제할까요?')) return;
    const db = getFirebaseClient()?.db;
    if (!db || getFirebaseClient()?.auth.currentUser?.uid !== profile.uid) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await deleteSharedEntry(db, vessel, entry);
    } catch (cause) { if (mounted.current) setError(calendarErrorMessage(cause)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const deleteStatus = () => { if (day.status) void remove(day.status); };
  const deleteMemo = (id: string) => { const entry = day.memos.find((item) => item.id === id); if (entry) void remove(entry); };

  const selectVessel = (next: CalendarVessel) => {
    setVessel(next);
    try { repository.setLastVessel(next); setError(''); }
    catch { setError('선박 선택을 기기에 저장하지 못했습니다.'); }
  };

  const goToday = () => {
    const key = koreaToday();
    setDisplayMonth(new Date(key.slice(0, 7) + '-01T12:00:00'));
    setSelectedDate(key); setTodayKey(key);
  };

  const goBack = () => {
    if (busyRef.current) return;
    if (view === 'editor') { setError(''); setView('detail'); }
    else if (view === 'detail') setView('month');
    else onBackHome();
  };

  return (
    <div className="relative z-[1100] h-dvh w-full overflow-y-auto bg-white text-[#003360]" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      <main aria-busy={busy} className="mx-auto w-full max-w-lg px-3 py-3 sm:px-5">
        <header className="mb-4 flex items-center gap-2">
          <button type="button" disabled={busy} onClick={goBack} aria-label={view === 'month' ? '홈으로' : view === 'detail' ? '달력으로 돌아가기' : '상세 화면으로 돌아가기'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-[#003360]">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <CalendarDays className="h-6 w-6 text-[#008ca3]" aria-hidden="true" />
          <h1 className="text-xl font-black">꼬미의 달력</h1>
        </header>

        <LegacyCalendarBackup />
        {view === 'month' && (
          <>
            <div className="mb-3 flex items-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-1">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1" role="group" aria-label="선박 선택">
                {(['101', '103'] as const).map((item) => (
                  <button key={item} type="button" aria-pressed={vessel === item} onClick={() => selectVessel(item)} className={`min-h-11 min-w-0 rounded-xl px-2 text-sm font-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066b3] ${vessel === item ? 'bg-[#0066b3] text-white shadow-sm' : 'bg-white text-[#003360]'}`}>
                    {item}호
                  </button>
                ))}
              </div>
              <select
                aria-label="지역 선택"
                value={region}
                onChange={(event) => selectRegion(event.target.value === 'geoje' ? 'geoje' : 'tongyeong')}
                className="h-11 w-24 shrink-0 rounded-xl border border-sky-200 bg-white px-2 text-base font-bold text-[#003360] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066b3]"
              >
                <option value="tongyeong">통영</option>
                <option value="geoje">거제</option>
              </select>
            </div>

            <section className="rounded-2xl border border-sky-200 bg-white p-2.5 shadow-sm" aria-label="월간 달력">
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                <button type="button" onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))} aria-label="이전 달" className="flex h-11 w-11 items-center justify-center rounded-full border border-sky-200"><ChevronLeft className="h-5 w-5" /></button>
                <h2 className="whitespace-nowrap text-sm font-black tabular-nums min-[360px]:text-base sm:text-lg">{displayMonth.getFullYear()}년 {displayMonth.getMonth() + 1}월</h2>
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={goToday} className="h-11 w-11 shrink-0 rounded-full border border-cyan-300 text-xs font-bold text-[#007e9e]">오늘</button>
                  <button type="button" onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))} aria-label="다음 달" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-sky-200"><ChevronRight className="h-5 w-5" /></button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 rounded-lg bg-sky-50 py-1 text-center text-xs font-black">
                {WEEKDAYS.map((weekday, index) => <span key={weekday} className={index === 0 ? 'text-red-600' : index === 6 ? 'text-blue-600' : ''}>{weekday}</span>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-0.5">
                {cells.map((date, index) => {
                  if (!date) return <div key={`empty-${index}`} aria-hidden="true" className="min-h-14" />;
                  const entry = entriesForDay(shared.entries, date);
                  const weekday = index % 7;
                  const tide = tideNameForDate(date);
                  const condition = weather.stale || weather.error ? null : weatherDescription(weather.cache?.values[date] ?? NaN);
                  const weatherLabel = condition;
                  const WeatherIcon = condition === '맑음' ? Sun : condition === '구름' ? CloudSun : condition === '흐림' ? Cloud : condition === '눈' ? CloudSnow : CloudRain;
                  return (
                    <button key={date} type="button" onClick={() => { setSelectedDate(date); setView('detail'); }} aria-label={`${fullDateLabel(date)}, ${tide ?? '물때 정보 없음'}, ${weatherLabel ?? '날씨 예보 없음'}, ${entry.status ? entryLabels[entry.status.kind] : '운항 상태 없음'}, 메모 ${entry.memos.length}건`} className={`flex min-h-[72px] min-w-0 flex-col items-center rounded-lg border px-0.5 py-0.5 text-center ${selectedDate === date ? 'border-2 border-[#00a79d] bg-cyan-50' : date === todayKey ? 'border-sky-400 bg-sky-50' : 'border-sky-100 bg-white'}`}>
                      <span className={`text-sm font-bold tabular-nums ${weekday === 0 ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-[#003360]'}`}>{Number(date.slice(-2))}</span>
                      <span className="mt-1 grid w-full grid-cols-2 grid-rows-2 place-items-center gap-y-1">
                        <span className="h-4 whitespace-nowrap text-[10px] font-bold leading-4">{tide}</span>
                        <span className="flex h-4 items-center justify-center" title={weatherLabel ?? undefined}>{condition && <WeatherIcon className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />}</span>
                        <span className="flex h-4 items-center justify-center">{entry.status && <Ship className={`h-3.5 w-3.5 ${entry.status.kind === 'planned' ? 'text-[#0066b3]' : 'text-red-600'}`} fill="none" aria-hidden="true" />}</span>
                        <span className="relative flex h-4 items-center justify-center">{entry.memos.length > 0 && <><FileText className="h-3.5 w-3.5 text-[#003360]" aria-hidden="true" />{entry.memos.length > 1 && <span className="absolute -top-1 left-[calc(50%+3px)] rounded-full bg-sky-100 px-0.5 text-[8px] font-black leading-3 text-[#0066b3]">{entry.memos.length}</span>}</>}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
              <span className="flex items-center gap-1 text-[#0066b3]"><Ship className="h-3.5 w-3.5" fill="none" />운항예정</span>
              <span className="flex items-center gap-1 text-red-600"><Ship className="h-3.5 w-3.5" fill="none" />운항불가</span>
              <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />메모</span>
            </div>
          </>
        )}

        {view === 'detail' && (
          <section className="space-y-3" aria-label="날짜별 일정 상세">
            <CalendarDetailConditions region={region} date={selectedDate} dateLabel={fullDateLabel(selectedDate)} vessel={vessel} />
            <div className="rounded-2xl border border-sky-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-black">운항 상태</h3>
              {day.status ? <div className="flex items-start gap-2">
                <Ship className={`mt-0.5 h-4 w-4 shrink-0 ${day.status.kind === 'planned' ? 'text-[#0066b3]' : 'text-red-600'}`} fill="none" aria-hidden="true" />
                <div className="min-w-0 flex-1"><strong className="text-sm">{entryLabels[day.status.kind]}</strong><p className="text-xs">{day.status.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{day.status.content}</p></div>
                {canEdit(day.status) && <button type="button" disabled={busy || !ready} onClick={editStatus} aria-label="운항 상태 수정" className="rounded-lg p-1.5 text-sky-700"><Pencil className="h-4 w-4" /></button>}
                {canDelete(day.status) && <button type="button" disabled={busy || !ready} onClick={deleteStatus} aria-label="운항 상태 삭제" className="rounded-lg p-1.5 text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </div> : null}
            </div>
            <PermitInvestigationSection date={selectedDate} vessel={vessel} isAdmin={shared.isAdmin} onOpenPermit={onOpenPermit} workspace={permitWorkspace} />
            <div className="rounded-2xl border border-sky-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-black">메모 {day.memos.length > 0 ? day.memos.length : ''}</h3>
              {day.memos.length > 0 && <ul className="space-y-2">
                {day.memos.map((memo) => <li key={memo.id} className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 p-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                  <div className="min-w-0 flex-1"><strong className="text-xs">{memo.authorName}</strong><p className="whitespace-pre-wrap break-words text-sm">{memo.content}</p></div>
                  {canEdit(memo) && <button type="button" disabled={busy || !ready} onClick={() => editMemo(memo.id)} aria-label={`${memo.authorName} 메모 수정`} className="rounded-lg p-1 text-sky-700"><Pencil className="h-4 w-4" /></button>}
                  {canDelete(memo) && <button type="button" disabled={busy || !ready} onClick={() => deleteMemo(memo.id)} aria-label={`${memo.authorName} 메모 삭제`} className="rounded-lg p-1 text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </li>)}
              </ul>}
            </div>
            <button type="button" disabled={busy || !ready} onClick={openNewEntry} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-[#008ca3] text-sm font-black text-white"><Plus className="h-4 w-4" />일정 추가</button>
            <button type="button" disabled={busy} onClick={() => setView('month')} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">달력으로 돌아가기</button>
          </section>
        )}

        {view === 'editor' && (
          <section className="space-y-3" aria-label="일정 작성">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <h2 className="text-lg font-black">{editTarget.kind === 'new' ? '일정 추가' : '일정 수정'}</h2>
              <p className="text-sm font-bold">{fullDateLabel(selectedDate)} · {vessel}호</p>
            </div>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label="일정 유형">
              {(['planned', 'unavailable', 'memo'] as const).map((kind) => {
                const disabled = editTarget.kind === 'memo' ? kind !== 'memo' : editTarget.kind === 'status' ? kind === 'memo' : Boolean(day.status) && kind !== 'memo';
                return <button key={kind} type="button" disabled={disabled || busy} aria-pressed={entryKind === kind} onClick={() => { setEntryKind(kind); setError(''); }} className={`min-h-10 rounded-xl border px-1 text-xs font-bold ${entryKind === kind ? 'border-[#008ca3] bg-cyan-50 text-[#0066b3]' : 'border-sky-200 bg-white'} disabled:opacity-40`}>{entryLabels[kind]}</button>;
              })}
            </div>
            {editTarget.kind === 'new' && day.status && <p className="text-xs text-slate-600">운항 상태는 이미 등록되어 있습니다. 상세 화면에서 수정해 주세요.</p>}
            <p className="text-sm font-bold">작성자: {expected?.authorName ?? profile.realName}</p>
            <label className="block text-sm font-bold">{entryKind === 'memo' ? '메모 내용' : '운항 내용·사유'}
              <textarea disabled={busy} value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} rows={5} className="mt-1 w-full resize-y rounded-xl border border-sky-200 bg-white p-3 outline-none focus:border-[#008ca3]" />
            </label>
            <button type="button" disabled={busy || !ready} onClick={() => void saveEntry()} className="min-h-11 w-full rounded-xl bg-[#008ca3] text-sm font-black text-white">저장</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setView('detail'); }} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">취소</button>
          </section>
        )}
      </main>
    </div>
  );
}
