'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { FiDownload } from 'react-icons/fi';
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

// The current shipped version. Used to build direct-download URLs WITHOUT the
// GitHub API, so downloads work even if the API is rate-limited (60 req/hr/IP)
// or unreachable. Bump this when cutting a release (see RELEASE.md).
const FALLBACK_VERSION = '0.1.0';

// Tauri's bundle filenames embed the version, so we can construct stable
// per-platform download URLs from a known version. These resolve directly off
// the published release without any API call.
function downloadsForVersion(version: string): Downloads {
  const v = version.replace(/^v/, '');
  const dl = (name: string) => ({
    url: `https://github.com/${REPO}/releases/download/v${v}/${name}`,
    name,
  });
  return {
    mac: dl(`Scatter_${v}_aarch64.dmg`),
    windows: dl(`Scatter_${v}_x64-setup.exe`),
    linux: dl(`Scatter_${v}_amd64.AppImage`),
  };
}

type ReleaseState = {
  version: string;
  downloads: Downloads;
};

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

  // Start from the known shipped version so the page ALWAYS offers working
  // downloads, even before (or without) the API call. The fetch below only
  // upgrades this to the live latest release + exact asset filenames.
  const [release, setRelease] = useState<ReleaseState>({
    version: FALLBACK_VERSION,
    downloads: downloadsForVersion(FALLBACK_VERSION),
  });

  // Fetch the latest GitHub release on mount to pick up newer versions without
  // redeploying the site. On any failure (404 / rate limit / network) we keep
  // the FALLBACK_VERSION links, which still work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(LATEST_API, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return; // keep fallback
        const data: LatestRelease = await res.json();
        const resolved = resolveDownloads(data.assets ?? []);
        // Prefer exact asset URLs from the API; fall back to constructed URLs
        // for any platform the release happens not to include.
        const constructed = downloadsForVersion(data.tag_name);
        const downloads: Downloads = {
          mac: resolved.mac ?? constructed.mac,
          windows: resolved.windows ?? constructed.windows,
          linux: resolved.linux ?? constructed.linux,
        };
        if (cancelled) return;
        setRelease({ version: data.tag_name, downloads });
      } catch {
        // keep fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const current = release.downloads[platform];

  return (
    <main className="page-wrapper bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="flex-1 max-w-3xl mx-auto px-6 py-12 md:py-20 w-full">
        <div className="mb-8">
          <p className="text-scatter-muted font-mono text-sm mb-2">
            {'// node app'}
            <span className="ml-2 text-scatter-text">{release.version}</span>
          </p>
          <h1 className="text-5xl font-black tracking-tight mb-3">
            run a scatter node.
          </h1>
          <p className="text-lg text-scatter-muted font-medium">
            download the desktop app. share some spare storage. earn credits.
            help build a better internet.
          </p>
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

          {/* Big download button — links directly to the platform's installer
              on the latest release. current is always set (constructed from the
              known version, upgraded to exact asset URLs once the API responds),
              so downloads work even if the GitHub API is rate-limited. */}
          {current ? (
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
              view releases
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
