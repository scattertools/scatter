import type { User } from './api';

const SESSION_KEY = 'scatter.session';
const USER_KEY = 'scatter.user';

export interface StoredSession {
  token: string;
  user: User;
}

export function saveSession(token: string, user: User) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SESSION_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem(SESSION_KEY);
  const userJson = localStorage.getItem(USER_KEY);
  if (!token || !userJson) return null;
  try {
    return { token, user: JSON.parse(userJson) };
  } catch {
    return null;
  }
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_KEY);
}
