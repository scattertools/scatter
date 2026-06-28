'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { FiMail, FiCheck, FiLoader } from 'react-icons/fi';
import { api, ApiError } from '@/lib/api';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.requestMagicLink(email);
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something broke');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text flex flex-col">
      <Nav />

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          <h1 className="text-4xl font-black tracking-tight text-center mb-2">
            sign in
          </h1>
          <p className="text-scatter-muted text-center mb-8">
            we'll email you a link. no password needed.
          </p>

          <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-6">
            {sent ? (
              <div className="text-center py-6">
                <FiCheck
                  size={48}
                  className="mx-auto mb-4 text-scatter-primary"
                />
                <h2 className="text-xl font-black mb-2">check your email</h2>
                <p className="text-scatter-muted">
                  we sent a sign-in link to <strong>{email}</strong>
                </p>
                <p className="text-xs text-scatter-muted mt-4 font-mono">
                  link expires in 15 minutes
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-2 border-scatter-border bg-scatter-bg px-4 focus-within:shadow-brutal-sm transition-shadow">
                  <FiMail
                    size={18}
                    className="text-scatter-muted flex-shrink-0"
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    autoFocus
                    disabled={loading}
                    className="flex-1 bg-transparent py-3 outline-none font-medium placeholder:text-scatter-dim disabled:opacity-50"
                  />
                </div>

                {error && (
                  <div className="p-3 border-2 border-scatter-danger bg-scatter-danger/10 text-sm font-semibold">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="brutal-btn px-6 py-3 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-2 disabled:opacity-70"
                >
                  {loading ? (
                    <>
                      <FiLoader size={18} className="animate-spin" /> sending...
                    </>
                  ) : (
                    'send me a link'
                  )}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-sm text-scatter-muted">
            no account?{' '}
            <Link
              href="/signin"
              className="brutal-link underline font-semibold"
            >
              signing in creates one for free.
            </Link>
          </p>
        </div>
      </div>

      <Footer />
    </main>
  );
}
