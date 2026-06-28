'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { FiDownload, FiPackage, FiLoader } from 'react-icons/fi';
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

const REPO = 'scattertools/scatter';
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const SOURCE_URL = `https://github.com/${REPO}`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

const PLATFORM_LABELS: Record<Platform, string> = {
  mac: 'macOS (Apple Silicon)',
  linux: 'Linux (x64)',
  windows: 'Windows (x64)',
};

// A GitHub release asset (only the fields we use).
interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}
interface LatestRelease {
  tag_name: string;
  assets: ReleaseAsset[];
}

// Resolved download links per platform, derived from the latest release's
// assets. A platform maps to null when the release has no matching installer.
type Downloads = Record<Platform, { url: string; name: string } | null>;

// Match the Tauri bundle filenames (bundle.targets: "all") to a platform.
// macOS  -> .dmg          (aarch64 = Apple Silicon, x64/x86_64 = Intel)
// Windows -> *-setup.exe (NSIS, preferred) or .msi
// Linux  -> .AppImage (preferred, portable) or .deb
function resolveDownloads(assets: ReleaseAsset[]): Downloads {
  const find = (pred: (n: string) => boolean) => {
    const a = assets.find((x) => pred(x.name.toLowerCase()));
    return a ? { url: a.browser_download_url, name: a.name } : null;
  };

  const mac =
    // Prefer Apple Silicon; fall back to Intel, then any .dmg.
    find((n) => n.endsWith('.dmg') && n.includes('aarch64')) ??
    find((n) => n.endsWith('.dmg') && (n.includes('x64') || n.includes('x86_64'))) ??
    find((n) => n.endsWith('.dmg'));

  const windows =
    find((n) => n.endsWith('-setup.exe')) ??
    find((n) => n.endsWith('.exe')) ??
    find((n) => n.endsWith('.msi'));

  const linux =
    find((n) => n.endsWith('.appimage')) ?? find((n) => n.endsWith('.deb'));

  return { mac, windows, linux };
}

// The auto-detected platform is a client-only value (navigator.userAgent), so
// it's read via useSyncExternalStore to avoid a hydration mismatch (server
// renders the 'mac' fallback). It never changes, so the store never re-emits.
function subscribePlatform() {
  return () => {};
}

type ReleaseState =
  | { status: 'loading' }
  | { status: 'none' } // no published release yet (404 / no matching assets)
  | { status: 'ready'; version: string; downloads: Downloads };

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

  const [release, setRelease] = useState<ReleaseState>({ status: 'loading' });

  // Fetch the latest GitHub release on mount and derive per-platform asset
  // URLs. Done client-side so a new release is picked up without redeploying
  // the site (no build-time caching of the release list).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(LATEST_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        // 404 = no published (non-draft, non-prerelease) release yet.
        if (!res.ok) {
          if (!cancelled) setRelease({ status: 'none' });
          return;
        }
        const data: LatestRelease = await res.json();
        const downloads = resolveDownloads(data.assets ?? []);
        const hasAny = Object.values(downloads).some(Boolean);
        if (cancelled) return;
        setRelease(
          hasAny
            ? { status: 'ready', version: data.tag_name, downloads }
            : { status: 'none' },
        );
      } catch {
        if (!cancelled) setRelease({ status: 'none' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = release.status === 'ready' ? release.downloads[platform] : null;

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="flex-1 max-w-3xl mx-auto px-6 py-12 md:py-20 w-full">
        <div className="mb-8">
          <p className="text-scatter-muted font-mono text-sm mb-2">
            {'// node app'}
            {release.status === 'ready' && (
              <span className="ml-2 text-scatter-text">{release.version}</span>
            )}
          </p>
          <h1 className="text-5xl font-black tracking-tight mb-3">
            run a scatter node.
          </h1>
          <p className="text-lg text-scatter-muted font-medium">
            download the desktop app. share some spare storage. earn credits.
            help build a better internet.
          </p>
        </div>

        {/* Status banner — only while there is no published release yet. */}
        {release.status === 'none' && (
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
        )}

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

          {/* Big download button — resolves to the real latest-release asset.
              States: loading (disabled), ready+asset (direct download),
              ready-but-no-asset-for-this-platform / none (link to releases). */}
          {release.status === 'loading' ? (
            <div className="w-full px-6 py-4 bg-scatter-bg text-scatter-muted font-bold border-2 border-scatter-border flex items-center justify-center gap-3 text-lg">
              <FiLoader size={22} className="animate-spin" />
              checking latest release…
            </div>
          ) : current ? (
            <a
              href={current.url}
              className="brutal-btn w-full px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-3 text-lg"
            >
              <FiDownload size={22} />
              download for {PLATFORM_LABELS[platform]}
            </a>
          ) : (
            <a
              href={RELEASES_URL}
              className="brutal-btn w-full px-6 py-4 bg-scatter-primary text-white font-bold border-2 border-scatter-border shadow-brutal flex items-center justify-center gap-3 text-lg"
            >
              <FiDownload size={22} />
              {release.status === 'ready'
                ? `no ${PLATFORM_LABELS[platform]} build — see all releases`
                : 'view releases'}
            </a>
          )}

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
