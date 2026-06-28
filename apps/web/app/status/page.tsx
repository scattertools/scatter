'use client';

import { useEffect, useState } from 'react';
import { FiCheck, FiAlertCircle, FiLoader } from 'react-icons/fi';
import { api, NetworkStats } from '@/lib/api';
import { API_URL } from '@/lib/env';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

type Health = 'ok' | 'degraded' | 'down' | 'loading';

export default function Status() {
  const [apiHealth, setApiHealth] = useState<Health>('loading');
  const [stats, setStats] = useState<NetworkStats | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API_URL}/health`);
        if (!r.ok) throw new Error('bad response');
        setApiHealth('ok');
      } catch {
        setApiHealth('down');
      }

      try {
        const s = await api.stats();
        setStats(s);
      } catch {
        setStats(null);
      }
    };
    check();
    const interval = setInterval(check, 30_000);
    return () => clearInterval(interval);
  }, []);

  const networkHealth: Health =
    apiHealth === 'loading'
      ? 'loading'
      : apiHealth === 'down'
        ? 'down'
        : !stats || stats.activeNodes === 0
          ? 'degraded'
          : 'ok';

  const overall: Health =
    apiHealth === 'loading' || networkHealth === 'loading'
      ? 'loading'
      : apiHealth === 'down' || networkHealth === 'down'
        ? 'down'
        : networkHealth === 'degraded'
          ? 'degraded'
          : 'ok';

  return (
    <main className="min-h-screen bg-scatter-bg text-scatter-text">
      <Nav />

      <div className="max-w-2xl mx-auto px-6 py-12">
        <p className="text-scatter-muted font-mono text-sm mb-2">{'// status'}</p>
        <h1 className="text-5xl font-black tracking-tight mb-8">
          system status.
        </h1>

        {/* Overall banner */}
        <div
          className={`mb-8 p-6 border-2 border-scatter-border shadow-brutal ${
            overall === 'ok'
              ? 'bg-scatter-primary text-white'
              : overall === 'degraded'
                ? 'bg-scatter-warning text-white'
                : overall === 'down'
                  ? 'bg-scatter-danger text-white'
                  : 'bg-scatter-surface'
          }`}
        >
          <div className="flex items-center gap-3">
            {overall === 'loading' ? (
              <FiLoader size={28} className="animate-spin" />
            ) : overall === 'ok' ? (
              <FiCheck size={28} />
            ) : (
              <FiAlertCircle size={28} />
            )}
            <div>
              <h2 className="text-2xl font-black">
                {overall === 'ok' && 'all systems operational'}
                {overall === 'degraded' && 'partial outage'}
                {overall === 'down' && 'major outage'}
                {overall === 'loading' && 'checking...'}
              </h2>
              <p className="text-sm opacity-90">
                last checked: {new Date().toLocaleTimeString()}
              </p>
            </div>
          </div>
        </div>

        {/* Component list */}
        <div className="border-2 border-scatter-border bg-scatter-surface shadow-brutal">
          <Component
            name="coordinator api"
            desc="authentication, file metadata"
            status={apiHealth}
          />
          <Component
            name="node network"
            desc={
              stats
                ? `${stats.activeNodes} nodes active, ${formatSize(
                    stats.totalCapacityBytes - stats.totalUsedBytes,
                  )} free`
                : 'checking...'
            }
            status={networkHealth}
          />
          <Component
            name="website"
            desc="you're looking at it"
            status="ok"
            last
          />
        </div>

        <p className="mt-8 text-center text-sm text-scatter-muted">
          auto-refreshes every 30 seconds
        </p>
      </div>

      <Footer />
    </main>
  );
}

function Component({
  name,
  desc,
  status,
  last,
}: {
  name: string;
  desc: string;
  status: Health;
  last?: boolean;
}) {
  return (
    <div
      className={`p-4 flex items-center justify-between gap-4 ${
        !last ? 'border-b-2 border-scatter-border' : ''
      }`}
    >
      <div>
        <p className="font-black">{name}</p>
        <p className="text-sm text-scatter-muted">{desc}</p>
      </div>
      <div className="flex items-center gap-2 font-bold font-mono text-sm">
        {status === 'loading' && (
          <>
            <FiLoader className="animate-spin" size={16} />
            <span className="text-scatter-muted">checking</span>
          </>
        )}
        {status === 'ok' && (
          <>
            <span className="w-2 h-2 rounded-full bg-scatter-primary" />
            <span className="text-scatter-primary">operational</span>
          </>
        )}
        {status === 'degraded' && (
          <>
            <span className="w-2 h-2 rounded-full bg-scatter-warning" />
            <span className="text-scatter-warning">degraded</span>
          </>
        )}
        {status === 'down' && (
          <>
            <span className="w-2 h-2 rounded-full bg-scatter-danger" />
            <span className="text-scatter-danger">down</span>
          </>
        )}
      </div>
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
