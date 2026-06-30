'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  FiDownload,
  FiFile,
  FiLock,
  FiLoader,
  FiAlertCircle,
  FiClock,
} from 'react-icons/fi';
import { api, ApiError, DownloadPlan } from '@/lib/api';
import type { FileManifest } from '@scatter/protocol';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function DownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [state, setState] = useState<
    'loading' | 'ready' | 'error' | 'downloading' | 'done'
  >('loading');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<DownloadPlan | null>(null);
  const [manifest, setManifest] = useState<FileManifest | null>(null);
  const [progress, setProgress] = useState<{
    pct: number;
    label: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const keyFragment =
      typeof window !== 'undefined' ? window.location.hash.slice(1) : '';

    const load = keyFragment
      ? api.downloadPlan(id)
      : Promise.reject(
          new Error(
            'This link is missing the decryption key. Make sure the full URL was copied.',
          ),
        );

    load
      .then((p) => {
        if (!active) return;
        setPlan(p);
        setManifest(p.manifest as FileManifest);
        setState('ready');
      })
      .catch((e) => {
        if (!active) return;
        setState('error');
        setError(
          e instanceof ApiError
            ? e.status === 404
              ? "This file doesn't exist or has been deleted."
              : e.status === 410
                ? 'This file has expired.'
                : e.message
            : e instanceof Error
              ? e.message
              : "Couldn't load this file",
        );
      });

    return () => {
      active = false;
    };
  }, [id]);

  const handleDownload = async () => {
    if (!plan || !manifest) return;
    const keyFragment = window.location.hash.slice(1);
    setState('downloading');
    setProgress({ pct: 0, label: 'fetching file...' });

    try {
      const { downloadFile, saveBlob } = await import('@/lib/download');

      const blob = await downloadFile(id, keyFragment, plan, (p) => {
        const pct = (p.received / p.total) * 90;
        setProgress({
          pct,
          label: `downloading... ${Math.floor(pct)}%`,
        });
      });

      setProgress({ pct: 95, label: 'preparing file...' });
      saveBlob(blob, manifest.fileName);
      setProgress({ pct: 100, label: 'saved!' });
      setState('done');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : 'Download failed');
      setProgress(null);
    }
  };

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-lg w-full">
          {state === 'loading' && (
            <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-12 text-center">
              <FiLoader
                size={48}
                className="mx-auto mb-4 animate-spin text-scatter-primary"
              />
              <p className="font-bold text-lg">loading file info...</p>
            </div>
          )}

          {state === 'error' && (
            <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-8 text-center">
              <FiAlertCircle
                size={48}
                className="mx-auto mb-4 text-scatter-danger"
              />
              <h1 className="text-2xl font-black mb-2">can&apos;t open this file</h1>
              <p className="text-scatter-muted mb-6">{error}</p>
              <Link
                href="/"
                className="brutal-btn inline-block px-6 py-3 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal"
              >
                go home
              </Link>
            </div>
          )}

          {(state === 'ready' || state === 'downloading' || state === 'done') &&
            manifest && (
              <>
                <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal">
                  <div className="p-6 border-b-2 border-scatter-border">
                    <div className="flex items-start gap-4">
                      <div className="p-3 border-2 border-scatter-border bg-scatter-bg">
                        <FiFile size={32} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h1 className="text-xl font-black truncate mb-1">
                          {manifest.fileName}
                        </h1>
                        <p className="text-scatter-muted font-mono text-sm">
                          {formatSize(manifest.fileSize)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 border-b-2 border-scatter-border bg-scatter-bg/50">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center gap-2">
                        <FiClock size={14} className="text-scatter-muted" />
                        <span className="text-scatter-muted">shared</span>
                        <span className="font-bold ml-auto">
                          {formatDate(manifest.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FiLock size={14} className="text-scatter-muted" />
                        <span className="text-scatter-muted">security</span>
                        <span className="font-bold ml-auto text-scatter-primary">
                          encrypted
                        </span>
                      </div>
                    </div>
                    <p className="mt-4 text-xs text-scatter-muted">
                      this file is protected — only people with this exact link
                      can access it.
                    </p>
                  </div>

                  {progress && (
                    <div className="p-6 border-b-2 border-scatter-border">
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

                  <div className="p-6">
                    {state === 'done' ? (
                      <div className="text-center">
                        <div className="inline-flex items-center gap-2 px-4 py-2 bg-scatter-primary text-white font-bold mb-4">
                          <FiDownload size={18} /> file saved!
                        </div>
                        <p className="text-sm text-scatter-muted">
                          check your downloads folder
                        </p>
                        <button
                          onClick={() => {
                            setState('ready');
                            setProgress(null);
                          }}
                          className="mt-4 brutal-link px-3 py-1 text-sm font-semibold"
                        >
                          download again
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleDownload}
                        disabled={state === 'downloading'}
                        className="brutal-btn w-full px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {state === 'downloading' ? (
                          <>
                            <FiLoader size={18} className="animate-spin" />{' '}
                            downloading...
                          </>
                        ) : (
                          <>
                            <FiDownload size={18} /> download file
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-4 p-4 border-2 border-scatter-border bg-scatter-surface text-center text-sm text-scatter-muted">
                  <p>
                    the decryption key is in your URL — we can&apos;t read this file.{' '}
                    <Link
                      href="/about"
                      className="brutal-link underline font-semibold"
                    >
                      learn more
                    </Link>
                  </p>
                </div>
              </>
            )}
        </div>
      </div>

      <Footer />
    </main>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
