import { useEffect, useState } from 'react';
import { getFirebaseClient } from '../services/firebaseClient';
import { subscribeAnnouncementAdmin, subscribeAnnouncements } from '../services/announcementService';
import { announcementError } from '../services/announcementModel';
import type { Announcement } from '../services/announcementModel';
import { guardedSubscription } from '../services/sharedCalendarModel';

export function useAnnouncements(uid: string) {
  const [attempt, setAttempt] = useState(0);
  const [permission, setPermission] = useState<{ uid: string; admin: boolean | null; error: string }>({ uid: '', admin: null, error: '' });
  const [state, setState] = useState<{ scope: string; entries: Announcement[]; ready: boolean; error: string }>({ scope: '', entries: [], ready: false, error: '' });
  const admin = permission.uid === uid ? permission.admin : null;
  const scope = `${uid}/${admin}`;
  useEffect(() => {
    const db = getFirebaseClient()?.db;
    if (!db) return;
    return guardedSubscription<boolean>((next, error) => subscribeAnnouncementAdmin(db, uid, next, error),
      (value) => setPermission({ uid, admin: value, error: '' }),
      (cause) => { setPermission({ uid, admin: null, error: announcementError(cause) }); });
  }, [uid, attempt]);
  useEffect(() => {
    const db = getFirebaseClient()?.db;
    if (!db || admin === null) return;
    return guardedSubscription<{ entries: Announcement[]; cache: boolean }>(
      (next, error) => subscribeAnnouncements(db, admin, (entries, cache) => next({ entries, cache }), error),
      ({ entries, cache }) => setState({ scope, entries: cache ? [] : entries, ready: !cache, error: '' }),
      (cause) => setState({ scope, entries: [], ready: false, error: announcementError(cause) }));
  }, [uid, admin, scope, attempt]);
  return { entries: state.scope === scope ? state.entries : [], ready: state.scope === scope && state.ready,
    isAdmin: admin === true, error: permission.error || (state.scope === scope ? state.error : ''),
    retry: () => { setPermission({ uid: '', admin: null, error: '' }); setState({ scope: '', entries: [], ready: false, error: '' }); setAttempt((value) => value + 1); } };
}
