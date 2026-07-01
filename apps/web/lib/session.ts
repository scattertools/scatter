import type { User } from './api';

const SESSION_KEY = 'scatter.session';
const USER_KEY = 'scatter.user';

export interface StoredSession {
  token: string;
  user: User;
}

const listeners = new Set<() => void>();

let cachedRaw: string | null = null;
let cachedSnapshot: StoredSession | null = null;

function readSnapshot(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(SESSION_KEY);
  const userJson = localStorage.getItem(USER_KEY);
  if (!token || !userJson) {
    cachedRaw = null;
    cachedSnapshot = null;
    return null;
  }
  const raw = token + '\u0000' + userJson;
  // Keep a stable reference so useSyncExternalStore doesn't loop.
  if (raw === cachedRaw) return cachedSnapshot;
  cachedRaw = raw;
  try {
    cachedSnapshot = { token, user: JSON.parse(userJson) };
  } catch {
    cachedSnapshot = null;
  }
  return cachedSnapshot;
}

export function getSessionSnapshot(): StoredSession | null {
  return readSnapshot();
}

export function getServerSessionSnapshot(): StoredSession | null {
  return null;
}

function emit() {
  for (const l of listeners) l();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== 'undefined') {
    // Reflect sign-in/out that happens in other tabs.
    window.addEventListener('storage', listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', listener);
    }
  };
}

export function saveSession(token: string, user: User) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  emit();
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
  emit();
}
