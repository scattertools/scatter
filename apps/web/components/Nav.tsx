'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/auth-context';
import { FaGithub } from 'react-icons/fa';
import { FiUser, FiSettings } from 'react-icons/fi';

export default function Nav() {
  const { user, ready, signOut } = useAuth();

  return (
    <nav className="border-b-2 border-scatter-border">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Scatter" width={32} height={32} className="w-8 h-8" />
          <span className="text-xl font-black tracking-tight">Scatter</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/about"
            className="brutal-link hidden sm:block px-3 py-2 font-semibold"
          >
            about
          </Link>
          <Link
            href="/download"
            className="brutal-link hidden sm:block px-3 py-2 font-semibold"
          >
            get the app
          </Link>
          <Link
            href="https://github.com/scattertools/scatter"
            aria-label="GitHub"
            className="brutal-link p-2"
          >
            <FaGithub size={20} />
          </Link>

          {!ready ? (
            <div className="w-20 h-9" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/dashboard"
                className="brutal-link px-3 py-2 font-semibold flex items-center gap-1.5"
              >
                <FiUser size={14} />
                <span className="hidden sm:inline">
                  {user.username || user.email.split('@')[0]}
                </span>
              </Link>
              <Link
                href="/settings"
                aria-label="Settings"
                className="brutal-link p-2"
              >
                <FiSettings size={18} />
              </Link>
              <button
                onClick={signOut}
                className="brutal-btn-sm px-4 py-2 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm text-sm"
              >
                sign out
              </button>
            </div>
          ) : (
            <Link
              href="/signin"
              className="brutal-btn-sm ml-1 px-4 py-2 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal-sm"
            >
              sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
