import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCalendarRepository,
  dateKey,
  deleteCalendarMemo,
  deleteVoyageStatus,
  emptyCalendar,
  getCalendarDay,
  monthCells,
  setCalendarMemo,
  setVoyageStatus,
} from '../services/calendarRepository.ts';
import { parseRouteFromUrl } from '../hooks/useAppRoute.ts';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values,
  };
}

describe('꼬미의 달력', () => {
  it('일요일부터 시작하는 7열 월간 배열과 윤년 날짜를 만든다', () => {
    const november = monthCells(2026, 10);
    assert.equal(november.length, 35);
    assert.equal(november[0], '2026-11-01');
    assert.equal(november[29], '2026-11-30');
    assert.equal(november[30], null);
    const february = monthCells(2028, 1);
    assert.ok(february.includes('2028-02-29'));
    assert.equal(dateKey(2026, 0, 3), '2026-01-03');
  });

  it('선박별 운항 상태 한 건과 여러 메모를 분리하고 수정·삭제한다', () => {
    const date = '2026-11-17';
    let snapshot = setVoyageStatus(emptyCalendar(), '101', date, { kind: 'planned', content: '순찰 예정' });
    snapshot = setCalendarMemo(snapshot, '101', date, { id: 'm1', author: '김', content: '장비 점검' });
    snapshot = setCalendarMemo(snapshot, '101', date, { id: 'm2', author: '박', content: '출항 준비' });
    assert.equal(getCalendarDay(snapshot, '101', date).status?.kind, 'planned');
    assert.equal(getCalendarDay(snapshot, '101', date).memos.length, 2);
    assert.deepEqual(getCalendarDay(snapshot, '103', date), { memos: [] });

    snapshot = setVoyageStatus(snapshot, '101', date, { kind: 'unavailable', content: '기상 악화' });
    snapshot = setCalendarMemo(snapshot, '101', date, { id: 'm1', author: '김', content: '정비 완료' });
    assert.equal(getCalendarDay(snapshot, '101', date).status?.content, '기상 악화');
    assert.equal(getCalendarDay(snapshot, '101', date).memos.length, 2);
    assert.equal(getCalendarDay(snapshot, '101', date).memos[0].content, '정비 완료');

    snapshot = deleteCalendarMemo(snapshot, '101', date, 'm2');
    snapshot = deleteVoyageStatus(snapshot, '101', date);
    assert.equal(getCalendarDay(snapshot, '101', date).status, undefined);
    assert.equal(getCalendarDay(snapshot, '101', date).memos.length, 1);
    snapshot = deleteCalendarMemo(snapshot, '101', date, 'm1');
    assert.equal(snapshot.vessels['101'][date], undefined);
  });

  it('새로고침 후 일정과 마지막 선박 선택을 다시 읽는다', () => {
    const storage = memoryStorage();
    const first = createCalendarRepository(storage);
    const data = setCalendarMemo(emptyCalendar(), '103', '2026-11-24', { id: 'm1', author: '이', content: '메모' });
    first.save(data);
    first.setLastVessel('103');
    const reloaded = createCalendarRepository(storage);
    assert.equal(reloaded.getLastVessel(), '103');
    assert.equal(getCalendarDay(reloaded.load(), '103', '2026-11-24').memos[0].content, '메모');
    assert.deepEqual(getCalendarDay(reloaded.load(), '101', '2026-11-24'), { memos: [] });
    assert.deepEqual([...storage.values.keys()].sort(), [
      'bada_kkomkkomi_calendar_last_vessel_v1',
      'bada_kkomkkomi_calendar_v1',
    ]);
  });

  it('달력 딥링크를 인식하고 잘못된 저장 데이터는 빈 일정으로 읽는다', () => {
    assert.deepEqual(parseRouteFromUrl('?screen=calendar'), { screen: 'calendar', panel: 'route' });
    const storage = memoryStorage();
    storage.setItem('bada_kkomkkomi_calendar_v1', '{invalid');
    assert.deepEqual(createCalendarRepository(storage).load(), emptyCalendar());
  });
});
