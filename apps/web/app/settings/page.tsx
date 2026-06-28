'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FiUser,
  FiSave,
  FiLoader,
  FiCheck,
  FiMail,
  FiMonitor,
  FiCopy,
  FiRefreshCw,
} from 'react-icons/fi';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function Settings() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) router.push('/signin');
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <main className="page-wrapper bg-scatter-bg">
        <Nav />
        <div className="flex-1" />
        <Footer />
      </main>
    );
  }

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <div className="mb-8">
          <p className="text-scatter-muted font-mono text-sm mb-1">
            {'// settings'}
          </p>
          <h1 className="text-4xl font-black tracking-tight">
            account settings
          </h1>
        </div>

        <UsernameSetting />

        <GuiLoginCode />

        <div className="mt-6 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm p-5">
          <div className="flex items-center gap-2 text-scatter-muted text-sm font-bold uppercase tracking-wider mb-3">
            <FiMail /> email
          </div>
          <span className="font-mono font-bold truncate">{user.email}</span>
          <p className="text-xs text-scatter-muted mt-2">
            your email is used to sign in and can&apos;t be changed.
          </p>
        </div>
      </div>

      <Footer />
    </main>
  );
}

function GuiLoginCode() {
  const { session } = useAuth();
  const [code, setCode] = useState<string | null>(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await api.createLoginCode(session);
      setCode(res.code);
      setExpiresInMinutes(res.expiresInMinutes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not generate code');
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; user can copy manually */
    }
  };

  return (
    <div className="mt-6 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm p-5">
      <div className="flex items-center gap-2 text-scatter-muted text-sm font-bold uppercase tracking-wider mb-3">
        <FiMonitor /> desktop app login
      </div>
      <p className="text-sm text-scatter-muted mb-4 leading-relaxed">
        generate a one-time code to sign in on the scatter desktop app. open the
        app, go to your account, choose &quot;use a login code&quot;, and paste
        it in.
      </p>

      {code ? (
        <div>
          <div className="flex flex-col sm:flex-row gap-2">
            <code className="flex-1 px-4 py-3 border-2 border-scatter-border bg-scatter-bg font-mono font-black text-xl tracking-widest text-center select-all">
              {code}
            </code>
            <div className="flex gap-2">
              <button
                onClick={copy}
                className="brutal-btn-sm px-4 py-2 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2"
              >
                {copied ? <FiCheck size={14} /> : <FiCopy size={14} />}
                {copied ? 'copied' : 'copy'}
              </button>
              <button
                onClick={generate}
                disabled={loading}
                title="generate a new code"
                className="brutal-btn-sm px-4 py-2 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <FiRefreshCw
                  size={14}
                  className={loading ? 'animate-spin' : ''}
                />
                new
              </button>
            </div>
          </div>
          <p className="text-xs text-scatter-muted mt-2">
            single use{expiresInMinutes ? `, expires in ${expiresInMinutes} minutes` : ''}.
            generating a new code invalidates the previous one once used.
          </p>
        </div>
      ) : (
        <button
          onClick={generate}
          disabled={loading}
          className="brutal-btn-sm px-4 py-2 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? (
            <FiLoader size={14} className="animate-spin" />
          ) : (
            <FiMonitor size={14} />
          )}
          generate login code
        </button>
      )}

      {error && (
        <p className="text-xs text-scatter-danger font-semibold mt-2">{error}</p>
      )}
    </div>
  );
}

function UsernameSetting() {
  const { user, session, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(user?.username ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!user) return null;

  const startEdit = () => {
    setValue(user.username ?? '');
    setError(null);
    setSaved(false);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setError(null);
  };

  const save = async () => {
    if (!session) return;
    const next = value.trim();
    if (next === user.username) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { user: updated } = await api.updateUsername(next, session);
      updateUser(updated);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not update username');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm p-5">
      <div className="flex items-center gap-2 text-scatter-muted text-sm font-bold uppercase tracking-wider mb-3">
        <FiUser /> username
      </div>

      {editing ? (
        <div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={value}
              autoFocus
              maxLength={24}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
              }}
              placeholder="your-username"
              className="flex-1 px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm outline-none focus:bg-white"
            />
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving || !value.trim()}
                className="brutal-btn-sm px-4 py-2 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <FiLoader size={14} className="animate-spin" />
                ) : (
                  <FiSave size={14} />
                )}
                save
              </button>
              <button
                onClick={cancel}
                disabled={saving}
                className="brutal-btn-sm px-4 py-2 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm disabled:opacity-60"
              >
                cancel
              </button>
            </div>
          </div>
          <p className="text-xs text-scatter-muted mt-2">
            3–24 characters: letters, numbers, hyphens and underscores.
          </p>
          {error && (
            <p className="text-xs text-scatter-danger font-semibold mt-2">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono font-bold truncate">
            {user.username || '—'}
          </span>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-xs font-bold text-scatter-primary flex items-center gap-1">
                <FiCheck size={14} /> saved
              </span>
            )}
            <button
              onClick={startEdit}
              className="brutal-btn-sm px-4 py-2 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm text-sm"
            >
              edit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
