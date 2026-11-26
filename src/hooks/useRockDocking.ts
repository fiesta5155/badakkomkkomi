import { useEffect, useState } from 'react';
import { useFirebaseAuth } from './useFirebaseAuth';
import { getFirebaseClient } from '../services/firebaseClient';
import { subscribeRockIslands, subscribeRockPoints } from '../services/rockDockingService';
import { rockReadErrorMessage, type RockIsland, type RockPoint } from '../services/rockDockingModel';
import { subscribeCalendarAdmin } from '../services/calendarFirestoreService';

export function useRockDocking(enabled: boolean) {
  const auth = useFirebaseAuth(), uid = auth.status === 'ready' ? auth.profile?.uid ?? '' : '';
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ uid: '', points: [] as RockPoint[], islands: [] as RockIsland[], pointsReady: false, islandsReady: false, error: '' });
  const [admin, setAdmin] = useState({ uid: '', value: false });
  useEffect(() => {
    if (!enabled || !uid) return;
    const db = getFirebaseClient()?.db; if (!db) return;
    let live = true; const stops: (() => void)[] = [];
    queueMicrotask(() => { if (live) setState(s => ({ ...s, uid, points: s.uid === uid ? s.points : [], islands: s.uid === uid ? s.islands : [], pointsReady: false, islandsReady: false, error: '' })); });
    const fail = (cause: unknown) => { if (live) setState(s => ({ ...s, uid, pointsReady: false, islandsReady: false, error: rockReadErrorMessage(cause) })); };
    try {
      stops.push(subscribeRockPoints(db, (points, cache) => { if (live) setState(s => ({ ...s, uid, points, pointsReady: !cache })); }, fail));
      stops.push(subscribeRockIslands(db, (islands, cache) => { if (live) setState(s => ({ ...s, uid, islands, islandsReady: !cache })); }, fail));
      stops.push(subscribeCalendarAdmin(db, uid, value => { if (live) setAdmin({ uid, value }); }, () => { if (live) setAdmin({ uid, value: false }); }));
    } catch (cause) { fail(cause); }
    return () => { live = false; stops.forEach(stop => stop()); };
  }, [uid, enabled, retry]);
  const same = Boolean(uid && state.uid === uid);
  return { profile: auth.status === 'ready' ? auth.profile : null, points: same ? state.points : [], islands: same ? state.islands : [],
    ready: same && state.pointsReady && state.islandsReady && !state.error, error: same ? state.error : '', isAdmin: admin.uid === uid && admin.value,
    retry: () => setRetry(v => v + 1) };
}
export type RockWorkspace = ReturnType<typeof useRockDocking>;
