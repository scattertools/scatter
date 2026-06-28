'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { FiDownload, FiPackage } from 'react-icons/fi';
import { FaApple, FaLinux, FaWindows } from 'react-icons/fa';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

type Platform = 'mac' | 'linux' | 'windows';

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'mac';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'mac';
}

const RELEASES_URL =
  'https://github.com/scattertools/scatter/releases/latest';
const SOURCE_URL = 'https://github.com/scattertools/scatter';
const BINARIES: Record<Platform, { file: string; label: string }> = {
  mac: { file: 'scatter-macos-arm64.tar.gz', label: 'macOS (Apple Silicon)' },
  linux: { file: 'scatter-linux-x64.tar.gz', label: 'Linux (x64)' },
  windows: { file: 'scatter-windows-x64.zip', label: 'Windows (x64)' },
};

// The auto-detected platform is a client-only value (navigator.userAgent), so
// it's read via useSyncExternalStore to avoid a hydration mismatch (server
// renders the 'mac' fallback). It never changes, so the store never re-emits.
function subscribePlatform() {
  return () => {};
}

export default function DownloadApp() {
  const detected = useSyncExternalStore<Platform>(
    subscribePlatform,
    detectPlatform,
    () => 'mac',
  );
  // User can override the auto-detected platform via the tabs.
  const [override, setOverride] = useState<Platform | null>(null);
  const platform = override ?? detected;
  const setPlatform = setOverride;

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="flex-1 max-w-3xl mx-auto px-6 py-12 md:py-20 w-full">
        <div className="mb-8">
          <p className="text-scatter-muted font-mono text-sm mb-2">
            {'// node app'}
          </p>
          <h1 className="text-5xl font-black tracking-tight mb-3">
            run a scatter node.
          </h1>
          <p className="text-lg text-scatter-muted font-medium">
            download the desktop app. share some spare storage. earn credits.
            help build a better internet.
          </p>
        </div>

        {/* Status banner */}
        <div className="mb-8 p-4 border-2 border-scatter-border bg-scatter-warning/10 flex items-start gap-3">
          <FiPackage size={20} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-black">in development — not released yet</p>
            <p className="text-sm text-scatter-muted">
              the desktop node app isn&apos;t shipped yet. when the first
              release is published, it&apos;ll appear on the{' '}
              <Link href={RELEASES_URL} className="underline font-semibold">
                releases page
              </Link>{' '}
              and the button below will download it. in the meantime you can{' '}
              <Link href="/" className="underline font-semibold">
                share files
              </Link>{' '}
              right from the web.
            </p>
          </div>
        </div>

        {/* Download buttons - PRIMARY */}
        <div className="mb-8 border-2 border-scatter-border bg-scatter-surface shadow-brutal p-6">
          <h2 className="text-xl font-black mb-4">download the app</h2>

          {/* Platform tabs */}
          <div className="flex gap-0 border-2 border-scatter-border bg-scatter-bg mb-4">
            <PlatformTab
              active={platform === 'windows'}
              onClick={() => setPlatform('windows')}
              icon={<FaWindows size={16} />}
              label="windows"
            />
            <PlatformTab
              active={platform === 'mac'}
              onClick={() => setPlatform('mac')}
              icon={<FaApple size={18} />}
              label="mac"
            />
            <PlatformTab
              active={platform === 'linux'}
              onClick={() => setPlatform('linux')}
              icon={<FaLinux size={18} />}
              label="linux"
            />
          </div>

          {/* Big download button */}
          <a
            href={`${RELEASES_URL}/download/${BINARIES[platform].file}`}
            className="brutal-btn w-full px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-3 text-lg"
          >
            <FiDownload size={22} />
            download for {BINARIES[platform].label}
          </a>

          <div className="mt-4 flex items-center justify-center gap-4 text-sm text-scatter-muted">
            <Link
              href={RELEASES_URL}
              className="brutal-link px-2 py-1 font-semibold"
            >
              all releases
            </Link>
            <span>•</span>
            <Link
              href={SOURCE_URL}
              className="brutal-link px-2 py-1 font-semibold"
            >
              source code
            </Link>
          </div>
        </div>

        {/* Quick start */}
        <h2 className="text-2xl font-black mb-4">after install</h2>
        <div className="space-y-3 mb-12">
          <StepCard
            n={1}
            title="open the app"
            desc="launch scatter from your applications. it connects to scatter.tools automatically."
          />
          <StepCard
            n={2}
            title="pick how much to share"
            desc="drag the storage slider to set your allocation — start small, change it anytime."
          />
          <StepCard
            n={3}
            title="sign in to earn credits"
            desc="link your account from settings. credits apply to your scatter.tools uploads."
          />
        </div>

        {/* FAQ */}
        <h2 className="text-2xl font-black mb-4">quick questions</h2>
        <div className="space-y-3">
          <Faq q="what does my computer actually store?">
            encrypted chunks of other people&apos;s files. you can&apos;t read them — only
            the person with the share link can decrypt anything.
          </Faq>
          <Faq q="how much bandwidth does it use?">
            only when someone is uploading or downloading through you. idle
            nodes use almost nothing.
          </Faq>
          <Faq q="can i stop and start it whenever?">
            yes. the network is designed to handle nodes going offline — any 10
            of 14 pieces can rebuild a file.
          </Faq>
          <Faq q="how do credits work?">
            you earn credits for storing shards and keeping good uptime. spend
            them to upload files larger than the 1 gb free limit.
          </Faq>
          <Faq q="is it safe? can i get in trouble for what's on my drive?">
            shards are encrypted and meaningless on their own. you literally
            cannot decrypt them, see the filenames, or reconstruct them without
            other nodes.
          </Faq>
        </div>
      </div>

      <Footer />
    </main>
  );
}

function PlatformTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex-1 px-4 py-3 font-bold flex items-center justify-center gap-2 border-r-2 border-scatter-border last:border-r-0 transition
        ${active ? 'bg-scatter-text text-scatter-bg' : 'hover:bg-scatter-bg'}
      `}
    >
      {icon} {label}
    </button>
  );
}

function StepCard({
  n,
  title,
  desc,
}: {
  n: number;
  title: string;
  desc: string;
}) {
  return (
    <div className="border-2 border-scatter-border bg-scatter-surface p-4 flex items-start gap-4">
      <span className="flex-shrink-0 w-8 h-8 flex items-center justify-center font-black border-2 border-scatter-border bg-scatter-bg">
        {n}
      </span>
      <div>
        <span className="font-bold">{title}</span>
        <p className="text-sm text-scatter-muted mt-1">{desc}</p>
      </div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="border-2 border-scatter-border bg-scatter-surface group">
      <summary className="p-4 font-bold cursor-pointer select-none flex items-center justify-between">
        {q}
        <span className="text-xl group-open:rotate-45 transition-transform">
          +
        </span>
      </summary>
      <div className="px-4 pb-4 text-scatter-muted text-sm leading-relaxed">
        {children}
      </div>
    </details>
  );
}
