import { useEffect, useState } from 'react';
import type { CalendarVessel } from '../services/calendarRepository';
import { getFirebaseClient } from '../services/firebaseClient';
import { subscribeCalendar, subscribeCalendarAdmin } from '../services/calendarFirestoreService';
import { calendarErrorMessage, calendarScope, guardedSubscription } from '../services/sharedCalendarModel';
import type { SharedEntry } from '../services/sharedCalendarModel';

export function useSharedCalendar(uid: string, vessel: CalendarVessel, month: string) {
  const scope = calendarScope(uid, vessel, month);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ scope: string; entries: SharedEntry[]; phase: 'loading' | 'ready' | 'cache' | 'error'; error: string }>({ scope: '', entries: [], phase: 'loading', error: '' });
  const [admin, setAdmin] = useState({ uid: '', enabled: false, error: '' });
  useEffect(() => {
    const db = getFirebaseClient()?.db;
    if (!db) return;
    return guardedSubscription<{ entries: SharedEntry[]; fromCache: boolean }>(
      (next, error) => subscribeCalendar(db, vessel, month, (entries, fromCache) => next({ entries, fromCache }), error),
      ({ entries, fromCache }) => setState({ scope, entries, phase: fromCache ? 'cache' : 'ready', error: '' }),
      (cause) => setState((current) => ({ scope, entries: current.scope === scope ? current.entries : [], phase: 'error', error: calendarErrorMessage(cause) })));
  }, [uid, vessel, month, scope, retry]);
  useEffect(() => {
    const db = getFirebaseClient()?.db;
    if (!db) return;
    return guardedSubscription<boolean>((next, error) => subscribeCalendarAdmin(db, uid, next, error),
      (enabled) => setAdmin({ uid, enabled, error: '' }),
      () => setAdmin({ uid, enabled: false, error: '관리자 권한을 확인하지 못했습니다. 관리자 삭제 기능은 잠겨 있습니다.' }));
  }, [uid, retry]);
  const current = state.scope === scope ? state : { entries: [], phase: 'loading' as const, error: '' };
  return { ...current, isAdmin: admin.uid === uid && admin.enabled, adminError: admin.uid === uid ? admin.error : '',
    retry: () => { setState((current) => ({ ...current, phase: 'loading', error: '' })); setRetry((value) => value + 1); } };
}
