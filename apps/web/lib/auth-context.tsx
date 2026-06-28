'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { loadSession, saveSession, clearSession } from './session';
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
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = loadSession();
    if (stored) {
      setUser(stored.user);
      setSession(stored.token);
    }
    setReady(true);
  }, []);

  const signIn = (token: string, u: User) => {
    saveSession(token, u);
    setSession(token);
    setUser(u);
  };

  const updateUser = (u: User) => {
    setUser(u);
    if (session) saveSession(session, u);
  };

  const signOut = () => {
    clearSession();
    setSession(null);
    setUser(null);
  };

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
