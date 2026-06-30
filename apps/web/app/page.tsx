'use client';

import { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import Link from 'next/link';
import {
  FiUploadCloud,
  FiFile,
  FiX,
  FiLock,
  FiLink,
  FiZap,
} from 'react-icons/fi';
import { api, NetworkStats } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [stats, setStats] = useState<NetworkStats | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { session, user } = useAuth();
  const [progress, setProgress] = useState<{
    pct: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    api
      .stats()
      .then(setStats)
      .catch(() => {});
  }, []);

  const maxBytes = user ? 1024 ** 3 : 100 * 1024 ** 2;

  const tooLargeMessage = () =>
    `File is too large. Max ${formatSize(maxBytes)} (${
      user ? 'free' : 'guest'
    } limit). ${user ? 'Earn credits for more.' : 'Sign in for more.'}`;

  const selectFile = (f: File) => {
    setError(null);
    if (f.size > maxBytes) {
      setFile(f);
      setError(tooLargeMessage());
      return;
    }
    setFile(f);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) selectFile(e.target.files[0]);
  };

  const openPicker = () => {
    if (!file && !uploading) inputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!file) return;
    if (file.size > maxBytes) {
      setError(tooLargeMessage());
      return;
    }
    setUploading(true);
    setError(null);
    setProgress({ pct: 0, label: 'encrypting...' });

    try {
      const { prepareUpload } = await import('@scatter/protocol');
      const { uploadShards } = await import('@/lib/upload');

      const prep = await prepareUpload(file, window.location.origin);
      setProgress({ pct: 5, label: 'requesting upload...' });

      const plan = await api.uploadPlan(prep.manifest, session);
      setProgress({ pct: 10, label: 'uploading shards...' });

      await uploadShards(prep, plan, session, (p) => {
        const uploadPct = (p.sent / p.total) * 85;
        setProgress({
          pct: 10 + uploadPct,
          label: `uploading shard ${p.currentShard} of ${p.totalShards}`,
        });
      });

      setProgress({ pct: 100, label: 'done!' });

      sessionStorage.setItem(
        `scatter.upload.${prep.fileId}`,
        JSON.stringify({
          link: prep.link,
          fileName: file.name,
          fileSize: file.size,
        }),
      );
      // Persist the full link (with #key fragment) so the dashboard can offer a
      // working copy-link; the key is never on the server.
      try {
        localStorage.setItem(`scatter.links.${prep.fileId}`, prep.link);
      } catch {
        // localStorage may be unavailable (private mode / quota) — non-fatal.
      }
      window.location.href = `/uploaded/${prep.fileId}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setUploading(false);
      setProgress(null);
    }
  };

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="max-w-3xl mx-auto px-6 py-12 md:py-20">
        <div className="mb-8 text-center">
          <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-3">
            share any file, privately.
          </h1>
          <p className="text-lg text-scatter-muted font-medium">
            drop a file, get a link. only people with the link can open it.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openPicker();
            }
          }}
          className={`
            relative border-2 border-scatter-border bg-scatter-surface
            ${!file && !uploading ? 'cursor-pointer hover:shadow-brutal-lg hover:-translate-x-1 hover:-translate-y-1' : ''}
            ${dragging ? 'bg-scatter-primary/10 shadow-brutal-lg -translate-x-1 -translate-y-1' : 'shadow-brutal'}
            transition-all duration-100
          `}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleInputChange}
          />

          {!file ? (
            <div className="py-20 md:py-24 px-6 text-center">
              <FiUploadCloud
                size={72}
                className="mx-auto mb-6 text-scatter-border"
                strokeWidth={1.5}
              />
              <p className="text-2xl font-bold mb-2">drop a file here</p>
              <p className="text-scatter-muted">
                or{' '}
                <span className="underline font-semibold">click to browse</span>
              </p>
              <p className="text-xs text-scatter-muted mt-6 font-mono">
                {user
                  ? 'up to 1 GB free · earn more by running the app'
                  : 'up to 100 MB as a guest · sign in for 1 GB'}
              </p>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-start justify-between gap-4 mb-6 p-4 border-2 border-scatter-border bg-scatter-bg">
                <div className="flex items-start gap-3 min-w-0">
                  <FiFile size={24} className="flex-shrink-0 mt-1" />
                  <div className="min-w-0">
                    <p className="font-bold truncate">{file.name}</p>
                    <p className="text-sm text-scatter-muted font-mono">
                      {formatSize(file.size)}
                    </p>
                  </div>
                </div>
                {!uploading && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setError(null);
                    }}
                    className="brutal-link flex-shrink-0 p-1"
                    aria-label="Remove file"
                  >
                    <FiX size={20} />
                  </button>
                )}
              </div>

              {error && (
                <div className="mb-4 p-3 border-2 border-scatter-danger bg-scatter-danger/10 text-sm font-semibold">
                  {error}
                </div>
              )}

              {progress && uploading && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-sm font-bold mb-2">
                    <span>{progress.label}</span>
                    <span className="font-mono">
                      {Math.floor(progress.pct)}%
                    </span>
                  </div>
                  <div className="h-3 border-2 border-scatter-border bg-scatter-bg overflow-hidden">
                    <div
                      className="h-full bg-scatter-primary transition-all duration-200"
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  className="brutal-btn flex-1 px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <FiLock size={18} />{' '}
                  {uploading ? 'uploading...' : 'upload & get link'}
                </button>
                {!uploading && (
                  <button
                    onClick={() => {
                      setFile(null);
                      setError(null);
                    }}
                    className="brutal-btn-sm px-6 py-4 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm"
                  >
                    cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-0 border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <Stat
            label="people helping"
            value={stats ? stats.activeNodes.toLocaleString() : '—'}
          />
          <Stat
            label="space used"
            value={stats ? formatSize(stats.totalUsedBytes) : '—'}
          />
          <Stat
            label="files shared"
            value={stats ? stats.filesScattered.toLocaleString() : '—'}
          />
        </div>

        <div className="mt-12 grid md:grid-cols-3 gap-4">
          <InfoCard
            icon={<FiLock size={20} />}
            title="private by default"
            desc="your files are locked up on your device before they leave. only the link can open them."
          />
          <InfoCard
            icon={<FiZap size={20} />}
            title="fast and resilient"
            desc="files are spread across many computers. if some go offline, your file still works."
          />
          <InfoCard
            icon={<FiLink size={20} />}
            title="share with a link"
            desc="send one link to anyone. no accounts needed to download."
          />
        </div>

        <div className="mt-12 p-6 border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-black mb-1">
                got spare storage? earn bigger uploads.
              </h3>
              <p className="text-scatter-muted">
                install our app, share some space, get more room for your own
                files.
              </p>
            </div>
            <Link
              href="/download"
              className="brutal-btn-sm px-5 py-3 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal-sm whitespace-nowrap"
            >
              get the app →
            </Link>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 text-center border-r-2 border-scatter-border last:border-r-0">
      <div className="text-2xl md:text-3xl font-black font-mono">{value}</div>
      <div className="text-xs text-scatter-muted uppercase tracking-wider mt-1 font-semibold">
        {label}
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="p-5 border-2 border-scatter-border bg-scatter-surface">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="font-bold">{title}</h3>
      </div>
      <p className="text-sm text-scatter-muted leading-relaxed">{desc}</p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}
