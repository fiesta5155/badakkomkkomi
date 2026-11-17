import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { FirebaseAuthContext } from '../../hooks/useFirebaseAuth';
import type { AuthStatus } from '../../hooks/useFirebaseAuth';
import { firebaseConfigurationError, getFirebaseClient } from '../../services/firebaseClient';
import { firebaseErrorMessage, isValidRealName, loadUserProfile, REAL_NAME_HELP, saveUserProfile } from '../../services/userProfileService';
import type { UserProfile } from '../../services/userProfileService';
import { RealNameDialog } from './RealNameDialog';

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [connection] = useState(() => {
    try { return { client: getFirebaseClient(), error: firebaseConfigurationError }; }
    catch (cause) { return { client: null, error: firebaseErrorMessage(cause) }; }
  });
  const [status, setStatus] = useState<AuthStatus>(connection.client ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState(connection.error);
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const generation = useRef(0);
  const invalidateRequests = useCallback(() => ++generation.current, []);

  const readProfile = useCallback(async (nextUser: User, request: number) => {
    try {
      const client = getFirebaseClient();
      if (!client) return;
      const nextProfile = await loadUserProfile(client.db, nextUser.uid);
      if (generation.current !== request || client.auth.currentUser?.uid !== nextUser.uid) return;
      setProfile(nextProfile);
      setStatus(nextProfile ? 'ready' : 'needs-name');
      setError('');
    } catch (cause) {
      if (generation.current !== request) return;
      setStatus('profile-error');
      setError(firebaseErrorMessage(cause));
    }
  }, []);

  useEffect(() => {
    const client = connection.client;
    if (!client) return;
    const unsubscribe = onAuthStateChanged(client.auth, (nextUser) => {
      const request = ++generation.current;
      setUser(nextUser);
      setProfile(null);
      setEditingName(false);
      setError('');
      setStatus(nextUser ? 'loading' : 'signed-out');
      if (nextUser) void readProfile(nextUser, request);
    }, (cause) => {
      ++generation.current;
      setUser(null);
      setProfile(null);
      setStatus('signed-out');
      setError(firebaseErrorMessage(cause));
    });
    return () => { invalidateRequests(); unsubscribe(); };
  }, [connection, readProfile, invalidateRequests]);

  const login = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const client = getFirebaseClient();
      if (!client) { setError(firebaseConfigurationError); return; }
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(client.auth, provider);
    } catch (cause) { setError(firebaseErrorMessage(cause)); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const client = getFirebaseClient();
      if (client) await signOut(client.auth);
      // 달력·레이어·환경설정 localStorage는 삭제하지 않는다.
    } catch (cause) { setError(firebaseErrorMessage(cause)); }
    finally { setBusy(false); }
  };

  const retryProfile = async () => {
    if (!user || busy) return;
    setStatus('loading');
    setError('');
    await readProfile(user, ++generation.current);
  };

  const saveName = async (name: string) => {
    if (busy || !user) return;
    if (!isValidRealName(name)) { setError(REAL_NAME_HELP); return; }
    const request = generation.current;
    setBusy(true);
    setError('');
    try {
      const client = getFirebaseClient();
      if (!client || client.auth.currentUser?.uid !== user.uid) return;
      const saved = await saveUserProfile(client.db, user.uid, name);
      if (generation.current !== request || client.auth.currentUser?.uid !== user.uid) return;
      setProfile(saved);
      setStatus('ready');
      setEditingName(false);
    } catch (cause) {
      if (generation.current === request) setError(firebaseErrorMessage(cause));
    } finally { setBusy(false); }
  };

  return (
    <FirebaseAuthContext.Provider value={{
      status, user, profile, error, busy, editingName, login, logout, retryProfile, saveName,
      editName: () => { setError(''); setEditingName(true); },
      cancelEditName: () => { setError(''); setEditingName(false); },
    }}>
      {children}
      <RealNameDialog />
    </FirebaseAuthContext.Provider>
  );
}
