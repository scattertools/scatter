'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FiCheck, FiLoader, FiX } from 'react-icons/fi';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { signIn } = useAuth();
  const [status, setStatus] = useState<'init' | 'loading' | 'ok' | 'error'>(
    'init',
  );
  const [error, setError] = useState<string | null>(null);
  const verifiedToken = useRef<string | null>(null);

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setError('missing token');
      return;
    }

    // Magic-link tokens are single-use: the coordinator marks them consumed on
    // first verify. Guard against React running this effect twice (StrictMode /
    // remounts), which would fire a second verify with the now-spent token and
    // clobber the success state with a spurious error.
    if (verifiedToken.current === token) return;
    verifiedToken.current = token;

    setStatus('loading');

    api
      .verifyMagicLink(token)
      .then(({ session, user }) => {
        signIn(session, user);
        setStatus('ok');
        setTimeout(() => router.push('/dashboard'), 500);
      })
      .catch((e) => {
        setStatus('error');
        setError(e instanceof ApiError ? e.message : 'verification failed');
      });
  }, [params, router, signIn]);

  return (
    <div className="max-w-md w-full text-center">
      <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-8">
        {(status === 'init' || status === 'loading') && (
          <>
            <FiLoader
              size={48}
              className="mx-auto mb-4 animate-spin text-scatter-primary"
            />
            <p className="font-bold">signing you in...</p>
          </>
        )}
        {status === 'ok' && (
          <>
            <FiCheck size={48} className="mx-auto mb-4 text-scatter-primary" />
            <p className="font-bold">welcome!</p>
            <p className="text-scatter-muted text-sm mt-2">redirecting...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <FiX size={48} className="mx-auto mb-4 text-scatter-danger" />
            <p className="font-bold">couldn't sign you in</p>
            <p className="text-scatter-muted text-sm mt-2">{error}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthCallback() {
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
          <CallbackInner />
        </Suspense>
      </div>
      <Footer />
    </main>
  );
}
