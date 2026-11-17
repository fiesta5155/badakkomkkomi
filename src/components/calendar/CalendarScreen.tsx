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

function weatherTimeLabel(value: number): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function CalendarScreen({ onBackHome }: { onBackHome: () => void }) {
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
  return <SharedCalendarScreen key={auth.user.uid} onBackHome={onBackHome} />;
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
  return <aside className="my-3 rounded-xl border border-sky-200 p-3 text-xs text-[#003360]">
    {raw !== null ? <><p className="font-bold">기존 로컬 일정 보관 중</p><p>공유 달력과 분리하여 보존합니다. 자동 이전하지 않습니다.</p></> : <p>기존 로컬 자료가 있다면 원본 그대로 JSON 백업할 수 있습니다.</p>}
    <button type="button" onClick={download} className="mt-2 min-h-9 rounded-lg border border-sky-200 px-2">로컬 일정 JSON 백업</button>
    {error && <p role="alert">{error}</p>}
  </aside>;
}

function SharedCalendarScreen({ onBackHome }: { onBackHome: () => void }) {
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
  const [notice, setNotice] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const month = String(displayMonth.getFullYear()) + '-' + String(displayMonth.getMonth() + 1).padStart(2, '0');
  const shared = useSharedCalendar(profile.uid, vessel, month);
  const ready = shared.phase === 'ready';
  const day = entriesForDay(shared.entries, selectedDate);
  const latest = expected ? shared.entries.find((entry) => entry.id === expected.id) : undefined;
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
    setContent(''); setError(''); setNotice(''); setView('editor');
  };
  const edit = (entry: SharedEntry) => {
    if (!canEdit(entry) || !ready) return;
    setExpected(entry); setEditTarget(entry.kind === 'memo' ? { kind: 'memo', id: entry.id } : { kind: 'status' });
    setEntryKind(entry.kind); setContent(entry.content); setError(''); setNotice(''); setView('editor');
  };
  const editStatus = () => { if (day.status) edit(day.status); };
  const editMemo = (id: string) => { const entry = day.memos.find((item) => item.id === id); if (entry) edit(entry); };

  const saveEntry = async () => {
    if (busyRef.current || !ready) return;
    if (!content.trim()) { setError('내용을 입력해 주세요.'); return; }
    const db = getFirebaseClient()?.db;
    if (!db || getFirebaseClient()?.auth.currentUser?.uid !== profile.uid) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await saveSharedEntry(db, vessel, profile, {
        id: expected?.id ?? (entryKind === 'memo' ? newMemoId.current : 'status_' + selectedDate),
        date: selectedDate, kind: entryKind, content, expected,
      });
      if (mounted.current) { setNotice('서버에 저장했습니다.'); setView('detail'); }
    } catch (cause) { if (mounted.current) setError(calendarErrorMessage(cause)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const remove = async (entry: SharedEntry) => {
    if (busyRef.current || !ready || !canDelete(entry) || !window.confirm('일정을 삭제할까요?')) return;
    const db = getFirebaseClient()?.db;
    if (!db || getFirebaseClient()?.auth.currentUser?.uid !== profile.uid) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await deleteSharedEntry(db, vessel, entry);
      if (mounted.current) setNotice('서버에서 삭제했습니다.');
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
        {shared.phase !== 'ready' && <div role="status" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
          {shared.phase === 'error' ? shared.error : shared.phase === 'cache' ? '서버의 최신 일정을 확인하지 못했습니다. 인터넷 연결을 확인해 주세요.' : '공유 일정을 서버에서 확인 중입니다…'}
          <button type="button" onClick={shared.retry} className="ml-2 min-h-9 rounded-lg border px-2">다시 확인</button>
        </div>}
        {shared.adminError && <p role="status" className="mb-2 text-xs">{shared.adminError}</p>}
        {notice && <p role="status" className="mb-2 text-sm text-sky-800">{notice}</p>}
        {view === 'month' && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl border border-sky-200 bg-sky-50 p-1" role="tablist" aria-label="선박 선택">
              {(['101', '103'] as const).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={vessel === item} onClick={() => selectVessel(item)} className={`min-h-11 rounded-xl text-sm font-black ${vessel === item ? 'bg-[#0066b3] text-white shadow-sm' : 'bg-white text-[#003360]'}`}>
                  {item}호
                </button>
              ))}
            </div>

            <div className="mb-2 flex justify-end gap-1" role="group" aria-label="지역 선택">
              {(['tongyeong', 'geoje'] as const).map((item) => <button key={item} type="button" onClick={() => selectRegion(item)} aria-pressed={region === item} className={`min-h-9 rounded-lg border px-3 text-xs font-bold ${region === item ? 'border-[#0066b3] bg-[#0066b3] text-white' : 'border-sky-200 bg-white text-[#003360]'}`}>{item === 'tongyeong' ? '통영' : '거제'}</button>)}
            </div>

            <div role="status" aria-live="polite" className={`mb-2 rounded-lg px-2 py-1.5 text-[11px] ${weather.stale || weather.error ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>
              <p>{weather.refreshing ? (weather.cache ? '날씨 갱신 중 · 기존 예보 유지' : '날씨 조회 중') : weather.stale ? '오래된 예보 표시 중' : weather.cache ? '날씨 최신 조회 완료' : weather.error ? '날씨 예보 확인 불가' : '날씨 예보 확인 중'}</p>
              {weather.cache && <p>마지막 갱신·저장: {weatherTimeLabel(weather.cache.savedAt)} · 조회 기준: {weatherTimeLabel(weather.cache.forecastReferenceAt)} (한국시간)</p>}
              {weather.cache && <p>조회 기준은 요청 시각이며 모델 발표 시각은 제공되지 않습니다.</p>}
              {weather.error && <p>{weather.error}</p>}
              {weather.storageError && <p>기기 저장소를 사용할 수 없어 새로고침 후 예보가 복원되지 않을 수 있습니다.</p>}
            </div>

            <section className="rounded-2xl border border-sky-200 bg-white p-2.5 shadow-sm" aria-label="월간 달력">
              <div className="mb-3 flex items-center justify-between gap-1">
                <button type="button" onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1))} aria-label="이전 달" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200"><ChevronLeft className="h-5 w-5" /></button>
                <h2 className="text-lg font-black tabular-nums">{displayMonth.getFullYear()}년 {displayMonth.getMonth() + 1}월</h2>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={goToday} className="min-h-9 rounded-full border border-cyan-300 px-2.5 text-xs font-bold text-[#007e9e]">오늘</button>
                  <button type="button" onClick={() => setDisplayMonth(new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1))} aria-label="다음 달" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200"><ChevronRight className="h-5 w-5" /></button>
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
                  const condition = weatherDescription(weather.cache?.values[date] ?? NaN);
                  const weatherLabel = condition ? `${condition}${weather.stale ? ' · 오래된 예보' : ''}` : null;
                  const WeatherIcon = condition === '맑음' ? Sun : condition === '구름' ? CloudSun : condition === '흐림' ? Cloud : condition === '눈' ? CloudSnow : CloudRain;
                  return (
                    <button key={date} type="button" onClick={() => { setSelectedDate(date); setView('detail'); }} aria-label={`${fullDateLabel(date)}, ${tide ?? '물때 정보 없음'}, ${weatherLabel ?? '날씨 예보 없음'}, ${ready ? (entry.status ? entryLabels[entry.status.kind] : '운항 상태 없음') + ', 메모 ' + entry.memos.length + '건' : '공유 일정 확인 전'}`} className={`flex min-h-[72px] min-w-0 flex-col items-center rounded-lg border px-0.5 py-0.5 text-center ${selectedDate === date ? 'border-2 border-[#00a79d] bg-cyan-50' : date === todayKey ? 'border-sky-400 bg-sky-50' : 'border-sky-100 bg-white'}`}>
                      <span className={`text-sm font-bold tabular-nums ${weekday === 0 ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-[#003360]'}`}>{Number(date.slice(-2))}</span>
                      <span className="mt-1 grid w-full grid-cols-2 grid-rows-2 place-items-center gap-y-1">
                        <span className="h-4 whitespace-nowrap text-[10px] font-bold leading-4">{tide}</span>
                        <span className="flex h-4 items-center justify-center" title={weatherLabel ?? undefined}>{condition && <WeatherIcon className={`h-3.5 w-3.5 ${weather.stale ? 'text-amber-600' : 'text-sky-600'}`} aria-hidden="true" />}</span>
                        <span className="flex h-4 items-center justify-center">{entry.status && <Ship className={`h-3.5 w-3.5 ${entry.status.kind === 'planned' ? 'text-[#0066b3]' : 'text-red-600'}`} fill="currentColor" aria-hidden="true" />}</span>
                        <span className="relative flex h-4 items-center justify-center">{entry.memos.length > 0 && <><FileText className="h-3.5 w-3.5 text-[#003360]" aria-hidden="true" />{entry.memos.length > 1 && <span className="absolute -top-1 left-[calc(50%+3px)] rounded-full bg-sky-100 px-0.5 text-[8px] font-black leading-3 text-[#0066b3]">{entry.memos.length}</span>}</>}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold">
              <span className="flex items-center gap-1 text-[#0066b3]"><Ship className="h-3.5 w-3.5" fill="currentColor" />운항예정</span>
              <span className="flex items-center gap-1 text-red-600"><Ship className="h-3.5 w-3.5" fill="currentColor" />운항불가</span>
              <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />메모</span>
            </div>
            {error && <p role="alert" className="mt-2 text-sm font-bold text-red-700">{error}</p>}
          </>
        )}

        {view === 'detail' && (
          <section className="space-y-3" aria-label="날짜별 일정 상세">
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
              <h2 className="text-lg font-black">{fullDateLabel(selectedDate)}</h2>
              <p className="text-sm font-bold text-sky-800">{vessel}호</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-black">운항 상태</h3>
              {day.status ? <div className="flex items-start gap-2">
                <Ship className={`mt-0.5 h-5 w-5 shrink-0 ${day.status.kind === 'planned' ? 'text-[#0066b3]' : 'text-red-600'}`} fill="currentColor" />
                <div className="min-w-0 flex-1"><strong className="text-sm">{entryLabels[day.status.kind]}</strong><p className="text-xs">{day.status.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{day.status.content}</p></div>
                {canEdit(day.status) && <button type="button" disabled={busy || !ready} onClick={editStatus} aria-label="운항 상태 수정" className="rounded-lg p-1.5 text-sky-700"><Pencil className="h-4 w-4" /></button>}
                {canDelete(day.status) && <button type="button" disabled={busy || !ready} onClick={deleteStatus} aria-label="운항 상태 삭제" className="rounded-lg p-1.5 text-red-600"><Trash2 className="h-4 w-4" /></button>}
              </div> : <p className="text-sm text-slate-500">{ready ? '등록된 운항 상태가 없습니다.' : '운항 상태 확인 중입니다.'}</p>}
            </div>
            <div className="rounded-2xl border border-sky-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-black">메모 {day.memos.length > 0 ? day.memos.length : ''}</h3>
              {day.memos.length === 0 ? <p className="text-sm text-slate-500">{ready ? '등록된 메모가 없습니다.' : '메모 확인 중입니다.'}</p> : <ul className="space-y-2">
                {day.memos.map((memo) => <li key={memo.id} className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 p-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                  <div className="min-w-0 flex-1"><strong className="text-xs">{memo.authorName}</strong><p className="whitespace-pre-wrap break-words text-sm">{memo.content}</p></div>
                  {canEdit(memo) && <button type="button" disabled={busy || !ready} onClick={() => editMemo(memo.id)} aria-label={`${memo.authorName} 메모 수정`} className="rounded-lg p-1 text-sky-700"><Pencil className="h-4 w-4" /></button>}
                  {canDelete(memo) && <button type="button" disabled={busy || !ready} onClick={() => deleteMemo(memo.id)} aria-label={`${memo.authorName} 메모 삭제`} className="rounded-lg p-1 text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </li>)}
              </ul>}
            </div>
            {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
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
            {expected && ready && (!latest || latest.revision !== expected.revision || latest.createdAt.seconds !== expected.createdAt.seconds || latest.createdAt.nanoseconds !== expected.createdAt.nanoseconds) &&
              <aside role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">
                <p>편집 시작 후 원본이 변경되었거나 삭제되었습니다. 아래 입력 내용은 유지됩니다.</p>
                <p className="whitespace-pre-wrap break-words">{latest ? `최신 내용: ${entryLabels[latest.kind]} · ${latest.content}` : '최신 상태: 삭제됨'}</p>
                <p>작성 내용을 복사해 보관한 뒤 상세 화면에서 최신 일정을 다시 열어 편집해 주세요.</p>
              </aside>}
            <label className="block text-sm font-bold">{entryKind === 'memo' ? '메모 내용' : '운항 내용·사유'}
              <textarea disabled={busy} value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} rows={5} className="mt-1 w-full resize-y rounded-xl border border-sky-200 bg-white p-3 outline-none focus:border-[#008ca3]" />
            </label>
            {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
            <button type="button" disabled={busy || !ready} onClick={() => void saveEntry()} className="min-h-11 w-full rounded-xl bg-[#008ca3] text-sm font-black text-white">{busy ? '서버 저장 중…' : '저장'}</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setView('detail'); }} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">취소</button>
          </section>
        )}
      </main>
    </div>
  );
}
