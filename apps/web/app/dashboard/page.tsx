'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FiUpload,
  FiHardDrive,
  FiGift,
  FiTrash2,
  FiCopy,
  FiCheck,
  FiFile,
  FiClock,
  FiLoader,
  FiExternalLink,
} from 'react-icons/fi';
import { useAuth } from '@/lib/auth-context';
import { api, UserFile, Credits } from '@/lib/api';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export default function Dashboard() {
  const { user, session, ready } = useAuth();
  const router = useRouter();
  const [files, setFiles] = useState<UserFile[]>([]);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderedAt, setRenderedAt] = useState(0);
  // The session whose data is currently loaded; while it lags `session` we're
  // still fetching. Deriving `loading` this way avoids a synchronous setState
  // inside the effect.
  // The (session, reloadKey) pair whose data is currently loaded; while it lags
  // the live pair we're still fetching. Deriving `loading` this way avoids a
  // synchronous setState inside the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const currentKey = session ? `${session}:${reloadKey}` : null;
  const loading = !!session && loadedKey !== currentKey;

  useEffect(() => {
    if (ready && !user) router.push('/signin');
  }, [ready, user, router]);

  useEffect(() => {
    if (!session || !currentKey) return;
    let active = true;
    Promise.all([api.listFiles(session), api.getCredits(session)])
      .then(([f, c]) => {
        if (!active) return;
        setFiles(f.files);
        setCredits(c);
        setLoadError(null);
        setRenderedAt(Date.now());
      })
      .catch((e) => {
        if (!active) return;
        setLoadError(
          e instanceof Error ? e.message : 'Failed to load your files.',
        );
      })
      .finally(() => {
        if (active) setLoadedKey(currentKey);
      });
    return () => {
      active = false;
    };
  }, [session, currentKey]);

  // Load any locally-stored share links (which include the #key fragment).
  // The key is never on the server, so this is the only source for a working
  // link. `files` only populates after the client-side fetch (post-hydration),
  // so reading localStorage here can't cause a hydration mismatch.
  const links = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    if (typeof window === 'undefined') return map;
    for (const file of files) {
      try {
        const link = localStorage.getItem(`scatter.links.${file.id}`);
        if (link) map[file.id] = link;
      } catch {
        // localStorage unavailable — leave links absent (copy disabled).
      }
    }
    return map;
  }, [files]);

  const copyLink = (fileId: string) => {
    const link = links[fileId];
    if (!link) return; // No key-bearing link on this device — button is disabled.
    navigator.clipboard.writeText(link);
    setCopiedId(fileId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteFile = async (fileId: string) => {
    if (!session || !confirm('Delete this file? This cannot be undone.'))
      return;
    setDeletingId(fileId);
    try {
      await api.deleteFile(fileId, session);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      alert('Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

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

      <div className="flex-1 max-w-4xl mx-auto px-6 py-12 w-full">
        <div className="mb-8">
          <p className="text-scatter-muted font-mono text-sm mb-1">
            {'// dashboard'}
          </p>
          <h1 className="text-4xl font-black tracking-tight">
            welcome back,{' '}
            <span className="text-scatter-primary">
              {user.username || user.email.split('@')[0]}
            </span>
          </h1>
        </div>

        {/* Stats grid */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <DashStat
            icon={<FiGift />}
            label="credits"
            value={credits?.balance.toLocaleString() ?? '—'}
            hint="earn by running a node"
          />
          <DashStat
            icon={<FiUpload />}
            label="uploads"
            value={files.length.toString()}
            hint="total files"
          />
          <DashStat
            icon={<FiHardDrive />}
            label="max file size"
            value="1 GB"
            hint="earn to unlock more"
          />
        </div>

        {/* Primary CTAs */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <Link
            href="/"
            className="brutal-btn p-6 bg-scatter-primary text-white border-2 border-scatter-border shadow-brutal flex items-center gap-4"
          >
            <FiUpload size={28} className="flex-shrink-0" />
            <div>
              <div className="font-black text-lg">upload a file</div>
              <div className="text-sm opacity-90">share with a link</div>
            </div>
          </Link>
          <Link
            href="/download"
            className="brutal-btn p-6 bg-scatter-surface border-2 border-scatter-border shadow-brutal flex items-center gap-4"
          >
            <FiHardDrive size={28} className="flex-shrink-0" />
            <div>
              <div className="font-black text-lg">run a node</div>
              <div className="text-sm text-scatter-muted">
                earn credits with spare space
              </div>
            </div>
          </Link>
        </div>

        {/* File list */}
        <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <div className="p-4 border-b-2 border-scatter-border flex items-center justify-between">
            <h2 className="text-xl font-black">your files</h2>
            <span className="text-sm text-scatter-muted font-mono">
              {files.length} total
            </span>
          </div>

          {loading ? (
            <div className="p-12 text-center">
              <FiLoader
                size={32}
                className="mx-auto mb-3 animate-spin text-scatter-muted"
              />
              <p className="text-scatter-muted">loading...</p>
            </div>
          ) : loadError ? (
            <div className="p-8 text-center">
              <div className="inline-block w-full max-w-md p-4 border-2 border-scatter-danger bg-scatter-danger/10 text-left">
                <p className="font-black mb-1">couldn&apos;t load your files</p>
                <p className="text-sm text-scatter-muted font-mono break-words">
                  {loadError}
                </p>
                <button
                  onClick={() => {
                    if (!session) return;
                    setLoadError(null);
                    setReloadKey((k) => k + 1);
                  }}
                  className="brutal-btn-sm mt-3 px-4 py-2 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal-sm"
                >
                  retry
                </button>
              </div>
            </div>
          ) : files.length === 0 ? (
            <div className="p-12 text-center text-scatter-muted">
              <FiFile size={48} className="mx-auto mb-4 opacity-30" />
              <p className="font-semibold mb-2">no uploads yet</p>
              <p className="text-sm">
                upload a file from the{' '}
                <Link href="/" className="underline font-semibold">
                  home page
                </Link>
              </p>
            </div>
          ) : (
            <div className="divide-y-2 divide-scatter-border">
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  now={renderedAt}
                  onCopy={() => copyLink(file.id)}
                  onDelete={() => deleteFile(file.id)}
                  copied={copiedId === file.id}
                  deleting={deletingId === file.id}
                  hasLink={!!links[file.id]}
                />
              ))}
            </div>
          )}
        </div>

        {/* Credit history */}
        {credits && credits.history.length > 0 && (
          <div className="mt-8 border-2 border-scatter-border bg-scatter-surface shadow-brutal">
            <div className="p-4 border-b-2 border-scatter-border">
              <h2 className="text-xl font-black">credit history</h2>
            </div>
            <div className="divide-y-2 divide-scatter-border max-h-64 overflow-y-auto">
              {credits.history.map((event, i) => (
                <div
                  key={i}
                  className="p-4 flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`font-mono font-bold ${
                        event.delta > 0
                          ? 'text-scatter-primary'
                          : 'text-scatter-danger'
                      }`}
                    >
                      {event.delta > 0 ? '+' : ''}
                      {event.delta}
                    </span>
                    <span className="text-scatter-muted">
                      {formatReason(event.reason)}
                    </span>
                  </div>
                  <span className="text-scatter-dim font-mono text-xs">
                    {formatDate(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Footer />
    </main>
  );
}

function DashStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="p-5 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm">
      <div className="flex items-center gap-2 text-scatter-muted text-sm font-bold uppercase tracking-wider mb-2">
        {icon} {label}
      </div>
      <div className="text-3xl font-black font-mono">{value}</div>
      <div className="text-xs text-scatter-muted mt-1">{hint}</div>
    </div>
  );
}

function FileRow({
  file,
  now,
  onCopy,
  onDelete,
  copied,
  deleting,
  hasLink,
}: {
  file: UserFile;
  now: number;
  onCopy: () => void;
  onDelete: () => void;
  copied: boolean;
  deleting: boolean;
  hasLink: boolean;
}) {
  const isExpiring = file.expiresAt && file.expiresAt < now + 3600_000;

  return (
    <div className="p-4 flex items-center gap-4">
      <div className="p-2 border-2 border-scatter-border bg-scatter-bg">
        <FiFile size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold truncate">{file.fileName}</p>
        <div className="flex items-center gap-3 text-xs text-scatter-muted mt-1">
          <span className="font-mono">{formatSize(file.fileSize)}</span>
          <span>•</span>
          <span>{formatDate(file.createdAt)}</span>
          {file.expiresAt && (
            <>
              <span>•</span>
              <span
                className={
                  isExpiring ? 'text-scatter-warning font-semibold' : ''
                }
              >
                <FiClock size={10} className="inline mr-1" />
                expires {formatDate(file.expiresAt)}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/f/${file.id}`}
          className="brutal-link p-2"
          title="Open download page"
        >
          <FiExternalLink size={16} />
        </Link>
        <button
          onClick={onCopy}
          disabled={!hasLink}
          className="brutal-link p-2 disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            hasLink
              ? 'Copy share link'
              : 'Link with key not available on this device'
          }
          aria-label={
            hasLink
              ? 'Copy share link'
              : 'Link with key not available on this device'
          }
        >
          {copied ? (
            <FiCheck size={16} className="text-scatter-primary" />
          ) : (
            <FiCopy size={16} />
          )}
        </button>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="brutal-link p-2 text-scatter-danger disabled:opacity-50"
          title="Delete"
        >
          {deleting ? (
            <FiLoader size={16} className="animate-spin" />
          ) : (
            <FiTrash2 size={16} />
          )}
        </button>
      </div>
    </div>
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

  if (diffMs < 0) {
    // Future date (expiration)
    const futureMins = Math.floor(-diffMs / 60_000);
    const futureHours = Math.floor(-diffMs / 3_600_000);
    if (futureMins < 60) return `in ${futureMins}m`;
    if (futureHours < 24) return `in ${futureHours}h`;
    return date.toLocaleDateString();
  }

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatReason(reason: string): string {
  const map: Record<string, string> = {
    signup_bonus: 'signup bonus',
    shard_stored: 'stored a shard',
    shard_served: 'served a shard',
    daily_bonus: 'daily node bonus',
    upload_cost: 'file upload',
  };
  return map[reason] ?? reason.replace(/_/g, ' ');
}
