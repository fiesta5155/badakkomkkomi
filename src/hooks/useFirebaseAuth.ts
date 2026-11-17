import { createContext, useContext } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../services/userProfileService';

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'needs-name' | 'ready' | 'profile-error';

export interface FirebaseAuthState {
  status: AuthStatus;
  user: User | null;
  profile: UserProfile | null;
  error: string;
  busy: boolean;
  editingName: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  retryProfile: () => Promise<void>;
  saveName: (name: string) => Promise<void>;
  editName: () => void;
  cancelEditName: () => void;
}

export const FirebaseAuthContext = createContext<FirebaseAuthState | null>(null);

export function useFirebaseAuth() {
  const value = useContext(FirebaseAuthContext);
  if (!value) throw new Error('FirebaseAuthProvider is required');
  return value;
}
