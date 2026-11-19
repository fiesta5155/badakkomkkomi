import { useEffect, useState } from 'react';
import { useFirebaseAuth } from './useFirebaseAuth';
import { getFirebaseClient } from '../services/firebaseClient';
import { subscribeCalendarAdmin } from '../services/calendarFirestoreService';
import { subscribePermits } from '../services/activityPermitService';
import type { ActivityPermit } from '../services/activityPermitModel';
import { guardedSubscription, koreaToday } from '../services/sharedCalendarModel';

export function useActivityPermits() {
  const auth = useFirebaseAuth(), uid = auth.profile?.uid ?? '';
  const [retry, setRetry] = useState(0);
  const [today, setToday] = useState(koreaToday);
  const [state, setState] = useState({ uid: '', records: [] as ActivityPermit[], ready: false, error: '' });
  const [admin, setAdmin] = useState({ uid: '', enabled: false });
  useEffect(() => {
    const update = () => setToday(koreaToday());
    const timer = window.setInterval(update, 30000);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    const db = getFirebaseClient()?.db;
    if (!uid || auth.status !== 'ready' || !db) return;
    return guardedSubscription<{ records: ActivityPermit[]; cache: boolean }>(
      (next, error) => subscribePermits(db, (records, cache) => next({ records, cache }), error),
      ({ records, cache }) => setState({ uid, records, ready: !cache, error: '' }),
      () => setState(current => ({ uid, records: current.uid === uid ? current.records : [], ready: false, error: '행위허가 자료를 읽지 못했습니다. 연결 또는 보안 규칙을 확인해 주세요.' })));
  }, [uid, auth.status, retry]);
  useEffect(() => {
    const db = getFirebaseClient()?.db; if (!uid || auth.status !== 'ready' || !db) return;
    return guardedSubscription<boolean>((next, error) => subscribeCalendarAdmin(db, uid, next, error),
      enabled => setAdmin({ uid, enabled }), () => setAdmin({ uid, enabled: false }));
  }, [uid, auth.status, retry]);
  return { profile: auth.status === 'ready' ? auth.profile : null, records: state.uid === uid && uid ? state.records : [],
    ready: Boolean(uid && state.uid === uid && state.ready), error: state.uid === uid ? state.error : '', today,
    isAdmin: Boolean(uid && admin.uid === uid && admin.enabled), retry: () => setRetry(v => v + 1) };
}
export type PermitWorkspace = ReturnType<typeof useActivityPermits>;
