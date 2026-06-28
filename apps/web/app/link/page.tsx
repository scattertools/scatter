'use client';

import { useEffect, useState, Suspense } from 'react';import { useRouter, useSearchParams } from 'next/navigation';
import { FiCheck, FiLoader, FiMonitor, FiX } from 'react-icons/fi';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

function LinkInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, session, ready } = useAuth();

  const [code, setCode] = useState(() =>
    (params.get('code') ?? '').trim().toUpperCase(),
  );
  const [status, setStatus] = useState<'idle' | 'approving' | 'ok' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  // Require a signed-in session; bounce to sign-in and come back here.
  useEffect(() => {
    if (ready && !user) {
      const c = params.get('code');
      const next = `/link${c ? `?code=${encodeURIComponent(c)}` : ''}`;
      try {
        sessionStorage.setItem('scatter:postSignInRedirect', next);
      } catch {
        /* sessionStorage unavailable; sign-in just lands on dashboard */
      }
      router.push('/signin');
    }
  }, [ready, user, router, params]);

  const approve = async () => {
    if (!session || !code.trim()) return;
    setStatus('approving');
    setError(null);
    try {
      await api.approveDevice(code.trim(), session);
      setStatus('ok');
    } catch (e) {
      setStatus('error');
      setError(e instanceof ApiError ? e.message : 'could not link the device');
    }
  };

  if (!ready || !user) {
    return (
      <div className="max-w-md w-full text-center">
        <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-8">
          <FiLoader
            size={48}
            className="mx-auto mb-4 animate-spin text-scatter-primary"
          />
          <p className="font-bold">loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full">
      <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-8">
        {status === 'ok' ? (
          <div className="text-center">
            <FiCheck size={48} className="mx-auto mb-4 text-scatter-primary" />
            <h1 className="text-2xl font-black mb-2">device linked</h1>
            <p className="text-scatter-muted">
              you can head back to the scatter desktop app — it&apos;s signing
              in now.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-scatter-muted text-sm font-bold uppercase tracking-wider mb-3">
              <FiMonitor /> link desktop app
            </div>
            <h1 className="text-2xl font-black tracking-tight mb-2">
              confirm the code
            </h1>
            <p className="text-scatter-muted text-sm mb-6 leading-relaxed">
              make sure this matches the code shown in your scatter desktop app,
              then approve to sign it in to{' '}
              <strong className="text-scatter-text">{user.email}</strong>.
            </p>

            <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-2 block">
              device code
            </label>
            <input
              type="text"
              value={code}
              autoFocus
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && approve()}
              placeholder="XXXX-XXXX"
              className="w-full px-4 py-3 border-2 border-scatter-border bg-scatter-bg font-mono font-black text-xl tracking-widest text-center mb-4 outline-none focus:bg-white uppercase"
            />

            <button
              onClick={approve}
              disabled={status === 'approving' || !code.trim()}
              className="brutal-btn w-full px-6 py-3 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {status === 'approving' ? (
                <>
                  <FiLoader size={18} className="animate-spin" /> linking...
                </>
              ) : (
                'approve & link'
              )}
            </button>

            {status === 'error' && (
              <div className="mt-4 p-3 border-2 border-scatter-danger bg-scatter-danger/10 text-sm font-semibold flex items-center gap-2">
                <FiX size={16} className="flex-shrink-0" />
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function LinkDevice() {
  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <Suspense
          fallback={
            <div className="max-w-md w-full text-center">
              <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-8">
                <FiLoader
                  size={48}
                  className="mx-auto mb-4 animate-spin text-scatter-primary"
                />
                <p className="font-bold">loading...</p>
              </div>
            </div>
          }
        >
          <LinkInner />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}
