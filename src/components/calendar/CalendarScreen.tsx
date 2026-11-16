import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Cloud, CloudRain, CloudSnow, CloudSun, FileText, Pencil, Plus, Ship, Sun, Trash2 } from 'lucide-react';
import { fetchCalendarWeather, tideNameForDate, weatherDescription, type CalendarRegion } from './calendarConditions';
import {
  createCalendarRepository,
  dateKey,
  deleteCalendarMemo,
  deleteVoyageStatus,
  getCalendarDay,
  monthCells,
  setCalendarMemo,
  setVoyageStatus,
  type CalendarSnapshot,
  type CalendarVessel,
  type VoyageKind,
} from '../../services/calendarRepository';

type CalendarView = 'month' | 'detail' | 'editor';
type EntryKind = VoyageKind | 'memo';
type EditTarget = { kind: 'new' } | { kind: 'status' } | { kind: 'memo'; id: string };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const entryLabels: Record<EntryKind, string> = {
  planned: '운항예정', unavailable: '운항불가', memo: '메모',
};

function fullDateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(year, month - 1, day));
}

export function CalendarScreen({ onBackHome }: { onBackHome: () => void }) {
  const repository = useMemo(() => createCalendarRepository(window.localStorage), []);
  const [snapshot, setSnapshot] = useState<CalendarSnapshot>(() => repository.load());
  const [vessel, setVessel] = useState<CalendarVessel>(() => repository.getLastVessel());
  const [region, setRegion] = useState<CalendarRegion>(() => window.localStorage.getItem('bada_kkomkkomi_calendar_region_v1') === 'geoje' ? 'geoje' : 'tongyeong');
  const [weather, setWeather] = useState<{ region: CalendarRegion; values: Record<string, number> }>({ region, values: {} });
  const [displayMonth, setDisplayMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [todayKey, setTodayKey] = useState(() => {
    const now = new Date();
    return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [view, setView] = useState<CalendarView>('month');
  const [editTarget, setEditTarget] = useState<EditTarget>({ kind: 'new' });
  const [entryKind, setEntryKind] = useState<EntryKind>('planned');
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');

  const day = getCalendarDay(snapshot, vessel, selectedDate);
  const cells = useMemo(() => monthCells(displayMonth.getFullYear(), displayMonth.getMonth()), [displayMonth]);

  useEffect(() => {
    const controller = new AbortController();
    fetchCalendarWeather(region, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setWeather({ region, values: next }); })
      .catch(() => { if (!controller.signal.aborted) setWeather({ region, values: {} }); });
    return () => controller.abort();
  }, [region]);

  const selectRegion = (next: CalendarRegion) => {
    setRegion(next);
    try { window.localStorage.setItem('bada_kkomkkomi_calendar_region_v1', next); } catch { /* Still usable without persistence. */ }
  };

  const persist = (next: CalendarSnapshot): boolean => {
    try {
      repository.save(next);
      setSnapshot(next);
      setError('');
      return true;
    } catch {
      setError('기기에 저장하지 못했습니다. 저장 공간을 확인해 주세요.');
      return false;
    }
  };

  const openNewEntry = () => {
    setEditTarget({ kind: 'new' });
    setEntryKind(day.status ? 'memo' : 'planned');
    setAuthor('');
    setContent('');
    setError('');
    setView('editor');
  };

  const editStatus = () => {
    if (!day.status) return;
    setEditTarget({ kind: 'status' });
    setEntryKind(day.status.kind);
    setAuthor('');
    setContent(day.status.content);
    setError('');
    setView('editor');
  };

  const editMemo = (id: string) => {
    const memo = day.memos.find((item) => item.id === id);
    if (!memo) return;
    setEditTarget({ kind: 'memo', id });
    setEntryKind('memo');
    setAuthor(memo.author);
    setContent(memo.content);
    setError('');
    setView('editor');
  };

  const saveEntry = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) { setError('내용을 입력해 주세요.'); return; }
    if (entryKind === 'memo') {
      const trimmedAuthor = author.trim();
      if (!trimmedAuthor) { setError('작성자 이름을 입력해 주세요.'); return; }
      const id = editTarget.kind === 'memo' ? editTarget.id : crypto.randomUUID();
      if (persist(setCalendarMemo(snapshot, vessel, selectedDate, { id, author: trimmedAuthor, content: trimmedContent }))) {
        setView('detail');
      }
      return;
    }
    if (day.status && editTarget.kind !== 'status') {
      setError('운항 상태는 하루에 한 건만 등록할 수 있습니다. 상세 화면에서 기존 상태를 수정해 주세요.');
      return;
    }
    if (persist(setVoyageStatus(snapshot, vessel, selectedDate, { kind: entryKind, content: trimmedContent }))) {
      setView('detail');
    }
  };

  const deleteStatus = () => {
    if (!window.confirm('운항 상태를 삭제할까요?')) return;
    persist(deleteVoyageStatus(snapshot, vessel, selectedDate));
  };

  const deleteMemo = (id: string) => {
    if (!window.confirm('메모를 삭제할까요?')) return;
    persist(deleteCalendarMemo(snapshot, vessel, selectedDate, id));
  };

  const selectVessel = (next: CalendarVessel) => {
    setVessel(next);
    try { repository.setLastVessel(next); setError(''); }
    catch { setError('선박 선택을 기기에 저장하지 못했습니다.'); }
  };

  const goToday = () => {
    const now = new Date();
    setDisplayMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    const key = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    setSelectedDate(key);
    setTodayKey(key);
  };

  const goBack = () => {
    if (view === 'editor') { setError(''); setView('detail'); }
    else if (view === 'detail') setView('month');
    else onBackHome();
  };

  return (
    <div className="relative z-[1100] h-dvh w-full overflow-y-auto bg-white text-[#003360]" style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}>
      <main className="mx-auto w-full max-w-lg px-3 py-3 sm:px-5">
        <header className="mb-4 flex items-center gap-2">
          <button type="button" onClick={goBack} aria-label={view === 'month' ? '홈으로' : view === 'detail' ? '달력으로 돌아가기' : '상세 화면으로 돌아가기'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-[#003360]">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <CalendarDays className="h-6 w-6 text-[#008ca3]" aria-hidden="true" />
          <h1 className="text-xl font-black">꼬미의 달력</h1>
        </header>

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
                  const entry = getCalendarDay(snapshot, vessel, date);
                  const weekday = index % 7;
                  const tide = tideNameForDate(date);
                  const condition = weatherDescription(weather.region === region ? weather.values[date] : NaN);
                  const WeatherIcon = condition === '맑음' ? Sun : condition === '구름' ? CloudSun : condition === '흐림' ? Cloud : condition === '눈' ? CloudSnow : CloudRain;
                  return (
                    <button key={date} type="button" onClick={() => { setSelectedDate(date); setView('detail'); }} aria-label={`${fullDateLabel(date)}, ${tide ?? '물때 정보 없음'}, ${condition ?? '날씨 예보 없음'}, ${entry.status ? entryLabels[entry.status.kind] : '운항 상태 없음'}, 메모 ${entry.memos.length}건`} className={`flex min-h-[72px] min-w-0 flex-col items-center rounded-lg border px-0.5 py-0.5 text-center ${selectedDate === date ? 'border-2 border-[#00a79d] bg-cyan-50' : date === todayKey ? 'border-sky-400 bg-sky-50' : 'border-sky-100 bg-white'}`}>
                      <span className={`text-sm font-bold tabular-nums ${weekday === 0 ? 'text-red-600' : weekday === 6 ? 'text-blue-600' : 'text-[#003360]'}`}>{Number(date.slice(-2))}</span>
                      <span className="mt-1 grid w-full grid-cols-2 grid-rows-2 place-items-center gap-y-1">
                        <span className="h-4 whitespace-nowrap text-[10px] font-bold leading-4">{tide}</span>
                        <span className="flex h-4 items-center justify-center" title={condition ?? undefined}>{condition && <WeatherIcon className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />}</span>
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
                <div className="min-w-0 flex-1"><strong className="text-sm">{entryLabels[day.status.kind]}</strong><p className="mt-1 whitespace-pre-wrap break-words text-sm">{day.status.content}</p></div>
                <button type="button" onClick={editStatus} aria-label="운항 상태 수정" className="rounded-lg p-1.5 text-sky-700"><Pencil className="h-4 w-4" /></button>
                <button type="button" onClick={deleteStatus} aria-label="운항 상태 삭제" className="rounded-lg p-1.5 text-red-600"><Trash2 className="h-4 w-4" /></button>
              </div> : <p className="text-sm text-slate-500">등록된 운항 상태가 없습니다.</p>}
            </div>
            <div className="rounded-2xl border border-sky-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-black">메모 {day.memos.length > 0 ? day.memos.length : ''}</h3>
              {day.memos.length === 0 ? <p className="text-sm text-slate-500">등록된 메모가 없습니다.</p> : <ul className="space-y-2">
                {day.memos.map((memo) => <li key={memo.id} className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 p-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                  <div className="min-w-0 flex-1"><strong className="text-xs">{memo.author}</strong><p className="whitespace-pre-wrap break-words text-sm">{memo.content}</p></div>
                  <button type="button" onClick={() => editMemo(memo.id)} aria-label={`${memo.author} 메모 수정`} className="rounded-lg p-1 text-sky-700"><Pencil className="h-4 w-4" /></button>
                  <button type="button" onClick={() => deleteMemo(memo.id)} aria-label={`${memo.author} 메모 삭제`} className="rounded-lg p-1 text-red-600"><Trash2 className="h-4 w-4" /></button>
                </li>)}
              </ul>}
            </div>
            {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
            <button type="button" onClick={openNewEntry} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-[#008ca3] text-sm font-black text-white"><Plus className="h-4 w-4" />일정 추가</button>
            <button type="button" onClick={() => setView('month')} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">달력으로 돌아가기</button>
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
                return <button key={kind} type="button" disabled={disabled} aria-pressed={entryKind === kind} onClick={() => { setEntryKind(kind); setError(''); }} className={`min-h-10 rounded-xl border px-1 text-xs font-bold ${entryKind === kind ? 'border-[#008ca3] bg-cyan-50 text-[#0066b3]' : 'border-sky-200 bg-white'} disabled:opacity-40`}>{entryLabels[kind]}</button>;
              })}
            </div>
            {editTarget.kind === 'new' && day.status && <p className="text-xs text-slate-600">운항 상태는 이미 등록되어 있습니다. 상세 화면에서 수정해 주세요.</p>}
            {entryKind === 'memo' && <label className="block text-sm font-bold">작성자 이름
              <input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={40} className="mt-1 min-h-11 w-full rounded-xl border border-sky-200 bg-white px-3 outline-none focus:border-[#008ca3]" />
            </label>}
            <label className="block text-sm font-bold">{entryKind === 'memo' ? '메모 내용' : '운항 내용·사유'}
              <textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={2000} rows={5} className="mt-1 w-full resize-y rounded-xl border border-sky-200 bg-white p-3 outline-none focus:border-[#008ca3]" />
            </label>
            {error && <p role="alert" className="text-sm font-bold text-red-700">{error}</p>}
            <button type="button" onClick={saveEntry} className="min-h-11 w-full rounded-xl bg-[#008ca3] text-sm font-black text-white">저장</button>
            <button type="button" onClick={() => { setError(''); setView('detail'); }} className="min-h-10 w-full rounded-xl border border-sky-200 text-sm font-bold">취소</button>
          </section>
        )}
      </main>
    </div>
  );
}
