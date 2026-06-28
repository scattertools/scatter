'use client';

import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  ReactNode,
} from 'react';
import {
  saveSession,
  clearSession,
  subscribeSession,
  getSessionSnapshot,
  getServerSessionSnapshot,
} from './session';
import type { User } from './api';

interface AuthContextValue {
  user: User | null;
  session: string | null;
  ready: boolean;
  signIn: (token: string, user: User) => void;
  updateUser: (user: User) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  // On the server we have no storage to read, so we're never "ready"; once the
  // client subscription is established useSyncExternalStore returns true.
  const ready = useSyncExternalStore(
    subscribeSession,
    () => true,
    () => false,
  );

  const user = stored?.user ?? null;
  const session = stored?.token ?? null;

  const signIn = useCallback((token: string, u: User) => {
    saveSession(token, u);
  }, []);

  const updateUser = useCallback(
    (u: User) => {
      if (session) saveSession(session, u);
    },
    [session],
  );

  const signOut = useCallback(() => {
    clearSession();
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, session, ready, signIn, updateUser, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
