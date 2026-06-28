'use client';

import { useState, useSyncExternalStore, use } from 'react';
import Link from 'next/link';
import { FiCopy, FiCheck, FiArrowLeft, FiExternalLink, FiAlertTriangle } from 'react-icons/fi';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

interface UploadInfo {
  link: string;
  fileName: string;
  fileSize: number;
}

// Stored once right after upload; never changes for this page, so the store
// never re-emits. useSyncExternalStore reads the client-only sessionStorage
// value without a hydration mismatch (server renders the "not loaded" state).
function noopSubscribe() {
  return () => {};
}

// Cache the parsed snapshot per id so getSnapshot returns a stable reference
// (useSyncExternalStore compares by identity and would loop otherwise).
const infoCache = new Map<string, UploadInfo | null>();

function readUploadInfo(id: string): UploadInfo | null {
  if (infoCache.has(id)) return infoCache.get(id)!;
  let parsed: UploadInfo | null = null;
  const raw = sessionStorage.getItem(`scatter.upload.${id}`);
  if (raw) {
    try {
      parsed = JSON.parse(raw) as UploadInfo;
    } catch {
      // Corrupt entry — treat as if there's no info and show recovery UI.
      parsed = null;
    }
  }
  infoCache.set(id, parsed);
  return parsed;
}

export default function Uploaded({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const info = useSyncExternalStore<UploadInfo | null>(
    noopSubscribe,
    () => readUploadInfo(id),
    () => null,
  );
  const loaded = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!info) return;
    navigator.clipboard.writeText(info.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="max-w-2xl mx-auto px-6 py-12 md:py-20">
        {loaded && !info ? (
          <>
            <div className="text-center mb-8">
              <div className="inline-block p-3 border-2 border-scatter-border bg-scatter-surface mb-4 shadow-brutal">
                <FiAlertTriangle size={32} className="text-scatter-warning" />
              </div>
              <h1 className="text-4xl font-black tracking-tight mb-2">
                share link not available here
              </h1>
              <p className="text-scatter-muted">
                your file may still be scattered across the network.
              </p>
            </div>

            <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-6 mb-6">
              <p className="text-sm text-scatter-muted leading-relaxed">
                the share link includes the decryption key in its{' '}
                <code className="font-mono">#fragment</code>, which we never see
                or store. it&apos;s shown only once — right after upload, on the
                device you uploaded from. it can&apos;t be recovered here (you
                refreshed, or opened this page somewhere else).
              </p>
              <p className="text-sm text-scatter-muted leading-relaxed mt-3">
                if you saved the link, you can still share it. otherwise
                you&apos;ll need to upload the file again to get a new one.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/dashboard"
                className="brutal-btn-sm flex-1 px-5 py-3 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2"
              >
                <FiExternalLink size={16} /> manage your files
              </Link>
              <Link
                href="/"
                className="brutal-btn-sm flex-1 px-5 py-3 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2"
              >
                <FiArrowLeft size={16} /> upload again
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="text-center mb-8">
              <div className="inline-block p-3 border-2 border-scatter-border bg-scatter-primary mb-4 shadow-brutal">
                <FiCheck size={32} className="text-white" />
              </div>
              <h1 className="text-4xl font-black tracking-tight mb-2">done!</h1>
              <p className="text-scatter-muted">
                {info ? (
                  <>
                    <strong>{info.fileName}</strong> is now scattered across the
                    network.
                  </>
                ) : (
                  'your file is scattered.'
                )}
              </p>
            </div>

            <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal p-6 mb-6">
              <label className="text-xs font-mono uppercase tracking-wider text-scatter-muted font-bold">
                share link
              </label>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 border-2 border-scatter-border bg-scatter-bg px-3 py-3 font-mono text-sm truncate">
                  {info?.link ?? '...'}
                </div>
                <button
                  onClick={copy}
                  className="brutal-btn-sm p-3 bg-scatter-primary text-white border-2 border-scatter-border shadow-brutal-sm"
                  aria-label="Copy link"
                >
                  {copied ? <FiCheck size={18} /> : <FiCopy size={18} />}
                </button>
              </div>
              <p className="mt-3 text-xs text-scatter-muted">
                the decryption key is in the{' '}
                <code className="font-mono">#fragment</code> — we never see it.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              {info && (
                <a
                  href={info.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="brutal-btn-sm flex-1 px-5 py-3 bg-scatter-surface font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2"
                >
                  <FiExternalLink size={16} /> preview download page
                </a>
              )}
              <Link
                href="/"
                className="brutal-btn-sm flex-1 px-5 py-3 bg-scatter-text text-scatter-bg font-bold border-2 border-scatter-border shadow-brutal-sm flex items-center justify-center gap-2"
              >
                <FiArrowLeft size={16} /> upload another
              </Link>
            </div>
          </>
        )}
      </div>

      <Footer />
    </main>
  );
}
