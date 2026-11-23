import { formatWarningTime, warningDataState, type WarningData } from '../../services/navigationalWarningService.ts';

const listItems = (value: string) => value.replace(/(?:,\s*)+$/, '').split(',').map(item => item.trim());
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d\s*~\s*(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(value);

// Presentation only: never sort, merge days or infer a date/time correspondence.
export function warningSchedule(date = '', time = '') {
  const dates = listItems(date), times = listItems(time);
  const knownDates = dates.length > 0 && dates.every(validDate);
  const knownTimes = times.length > 0 && times.every(validTime);
  if (knownDates && knownTimes && dates.length === times.length) {
    return { entries: dates.map((date, i) => ({ date: date.replaceAll('-', '.') + '.', time: times[i] })), date: '', time: '' };
  }
  return { entries: [], date: knownDates ? dates.map(d => d.replaceAll('-', '.') + '.').join(', ') : date,
    time: /[^,\s]/.test(time) ? knownDates && knownTimes ? times.join(', ') : time : '' };
}

export function warningPanelStatus(data: WarningData | null, detail = false, now = Date.now()) {
  if (!data) return detail ? '' : '항행경보 자료를 불러오는 중입니다.';
  const state = warningDataState(data, now);
  if (!state.available) return state.briefMessage;
  const flags: string[] = [];
  if (data.attempt?.status === 'failed') flags.push('수집 실패', '이전 정상 자료');
  else if (data.attempt?.status === 'not_configured') flags.push('수집 중단', '이전 정상 자료');
  if (state.stale) flags.push('과거 자료');
  if (state.mismatch) flags.push('수집 상태 미확인');
  if (state.publicationState === 'delayed') flags.push('갱신 지연');
  if (detail) return flags.join(' · ');
  const count = data.snapshot!.documents.length;
  const updated = formatWarningTime(data.snapshot!.lastSuccessfulAt).slice(5).replace(/ KST$/, '');
  return [`${count === 0 && data.attempt?.status === 'success' ? '정상 수집 ' : ''}${count}건`, `최종 갱신 ${updated}`, ...flags].join(' · ');
}
