import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import {
  FiHardDrive,
  FiWifi,
  FiWifiOff,
  FiSettings,
  FiArrowUp,
  FiArrowDown,
  FiGift,
  FiExternalLink,
  FiArrowLeft,
  FiUser,
  FiLogOut,
  FiMail,
  FiKey,
  FiCheck,
  FiSave,
  FiLoader,
} from 'react-icons/fi';

const VERSION = '0.1.0';
const GB = 1024 * 1024 * 1024;

interface NodeState {
  connected: boolean;
  nodeId: string | null;
  usedBytes: number;
  capacityBytes: number;
  shardCount: number;
  creditsEarned: number;
  uptimeSeconds: number;
}

interface ActivityEvent {
  kind: 'uploaded' | 'downloaded';
  fileId: string;
  shardIndex: number;
  size: number;
  timestamp: number;
}

interface Account {
  email: string;
  username: string;
  balance: number;
}

type View = 'main' | 'settings' | 'account';

function App() {
  const [state, setState] = useState<NodeState>({
    connected: false,
    nodeId: null,
    usedBytes: 0,
    capacityBytes: 50 * GB,
    shardCount: 0,
    creditsEarned: 0,
    uptimeSeconds: 0,
  });
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [view, setView] = useState<View>('main');
  const [starting, setStarting] = useState(false);

  // Poll node state once per second.
  useEffect(() => {
    const poll = async () => {
      try {
        setState(await invoke<NodeState>('get_state'));
      } catch {
        /* backend not ready */
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, []);

  // Poll activity every two seconds.
  useEffect(() => {
    const poll = async () => {
      try {
        setActivity(await invoke<ActivityEvent[]>('get_activity'));
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await invoke<Account | null>('get_account'));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshAccount();
  }, [refreshAccount]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await invoke('start_node');
    } catch (e) {
      console.error(e);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await invoke('stop_node');
    } catch (e) {
      console.error(e);
    }
  };

  const handleSetCapacity = async (gb: number) => {
    try {
      await invoke('set_capacity', { bytes: gb * GB });
    } catch (e) {
      console.error(e);
    }
  };

  if (view === 'settings') {
    return (
      <SettingsView
        capacityGb={Math.round(state.capacityBytes / GB)}
        connected={state.connected}
        onSetCapacity={handleSetCapacity}
        onBack={() => setView('main')}
      />
    );
  }
  if (view === 'account') {
    return (
      <AccountView
        account={account}
        onChange={refreshAccount}
        onBack={() => setView('main')}
      />
    );
  }

  return (
    <div className="h-screen flex flex-col p-4 bg-scatter-bg text-scatter-text">
      <Header
        account={account}
        onAccount={() => setView('account')}
        onSettings={() => setView('settings')}
      />

      {/* Connection status */}
      <div
        className={`mb-3 p-4 border-2 border-scatter-border shadow-brutal-sm ${
          state.connected ? 'bg-scatter-primary/10' : 'bg-scatter-surface'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {state.connected ? (
              <FiWifi
                size={24}
                className="text-scatter-primary flex-shrink-0"
              />
            ) : (
              <FiWifiOff
                size={24}
                className="text-scatter-muted flex-shrink-0"
              />
            )}
            <div className="min-w-0">
              <p className="font-bold leading-tight">
                {state.connected ? 'connected' : 'not connected'}
              </p>
              <p className="text-xs text-scatter-muted font-mono truncate">
                {state.nodeId ? state.nodeId : 'no node id yet'}
              </p>
            </div>
          </div>
          {state.connected ? (
            <button
              onClick={handleStop}
              className="brutal-btn-sm flex-shrink-0 px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold text-sm shadow-brutal-sm"
            >
              stop
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={starting}
              className="brutal-btn-sm flex-shrink-0 px-4 py-2 bg-scatter-primary text-white border-2 border-scatter-border font-bold text-sm shadow-brutal-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {starting ? 'starting...' : 'start'}
            </button>
          )}
        </div>
      </div>

      {/* Storage */}
      <div className="mb-3 p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm">
        <div className="flex items-center gap-2 mb-2">
          <FiHardDrive size={14} className="text-scatter-muted" />
          <span className="text-xs font-bold uppercase tracking-wider text-scatter-muted">
            storage
          </span>
        </div>
        <div className="h-4 border-2 border-scatter-border bg-scatter-bg mb-2 overflow-hidden">
          <div
            className="h-full bg-scatter-primary transition-all duration-300"
            style={{
              width: `${Math.min(100, pct(state.usedBytes, state.capacityBytes))}%`,
            }}
          />
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-mono font-bold">
            {formatSize(state.usedBytes)} used
          </span>
          <span className="text-scatter-muted font-mono">
            {formatSize(state.capacityBytes)} allocated
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatBox label="shards" value={state.shardCount.toLocaleString()} />
        <StatBox label="uptime" value={formatUptime(state.uptimeSeconds)} />
        <StatBox
          label="credits"
          value={state.creditsEarned.toLocaleString()}
          icon={<FiGift size={12} className="text-scatter-primary" />}
        />
      </div>

      {/* Activity */}
      <div className="flex-1 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b-2 border-scatter-border bg-scatter-bg">
          <span className="text-xs font-bold uppercase tracking-wider text-scatter-muted">
            recent activity
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {activity.length === 0 ? (
            <div className="p-6 text-center text-scatter-muted text-sm">
              {state.connected
                ? 'waiting for activity...'
                : 'start the node to begin'}
            </div>
          ) : (
            <div className="divide-y-2 divide-scatter-border">
              {activity.map((e, i) => (
                <div
                  key={`${e.fileId}-${e.shardIndex}-${i}`}
                  className="px-3 py-2 flex items-center gap-2 text-sm"
                >
                  {e.kind === 'uploaded' ? (
                    <FiArrowUp
                      size={14}
                      className="text-scatter-primary flex-shrink-0"
                    />
                  ) : (
                    <FiArrowDown
                      size={14}
                      className="text-scatter-accent flex-shrink-0"
                    />
                  )}
                  <span className="font-mono text-scatter-muted truncate">
                    {e.fileId.slice(0, 8)}#{e.shardIndex}
                  </span>
                  <span className="ml-auto text-scatter-dim font-mono text-xs flex-shrink-0">
                    {formatSize(e.size)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 flex items-center justify-between text-xs text-scatter-muted">
        <span className="font-mono">scatter v{VERSION}</span>
        <button
          onClick={() => open('https://scatter.tools')}
          className="flex items-center gap-1 hover:text-scatter-primary transition-colors"
        >
          scatter.tools <FiExternalLink size={10} />
        </button>
      </div>
    </div>
  );
}

function Header({
  account,
  onAccount,
  onSettings,
}: {
  account: Account | null;
  onAccount: () => void;
  onSettings: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="Scatter" className="w-8 h-8" />
        <span className="font-black text-lg tracking-tight">Scatter</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onAccount}
          title={account ? account.email : 'sign in'}
          className="brutal-link p-2 flex items-center gap-1.5 font-semibold text-sm"
        >
          <FiUser size={16} />
          {account && (
            <span className="max-w-[90px] truncate">
              {account.username || account.email.split('@')[0]}
            </span>
          )}
        </button>
        <button
          onClick={onSettings}
          title="settings"
          className="brutal-link p-2"
        >
          <FiSettings size={18} />
        </button>
      </div>
    </div>
  );
}

function SettingsView({
  capacityGb,
  connected,
  onSetCapacity,
  onBack,
}: {
  capacityGb: number;
  connected: boolean;
  onSetCapacity: (gb: number) => void;
  onBack: () => void;
}) {
  const [gb, setGb] = useState(capacityGb);
  const [saved, setSaved] = useState(false);

  const [coordinator, setCoordinator] = useState('http://localhost:4000');
  const [coordinatorInput, setCoordinatorInput] = useState('');
  const [editingCoordinator, setEditingCoordinator] = useState(false);
  const [coordinatorError, setCoordinatorError] = useState<string | null>(null);
  const [coordinatorSaved, setCoordinatorSaved] = useState(false);

  useEffect(() => {
    invoke<string>('get_coordinator')
      .then((url) => setCoordinator(url))
      .catch(() => {
        /* fall back to default */
      });
  }, []);

  const startEditCoordinator = () => {
    setCoordinatorInput(coordinator);
    setCoordinatorError(null);
    setCoordinatorSaved(false);
    setEditingCoordinator(true);
  };

  const saveCoordinator = async () => {
    const next = coordinatorInput.trim();
    if (!next || next === coordinator) {
      setEditingCoordinator(false);
      return;
    }
    setCoordinatorError(null);
    try {
      await invoke('set_coordinator', { url: next });
      setCoordinator(next.replace(/\/$/, ''));
      setEditingCoordinator(false);
      setCoordinatorSaved(true);
    } catch (e) {
      setCoordinatorError(String(e));
    }
  };

  return (
    <div className="h-screen flex flex-col p-4 bg-scatter-bg text-scatter-text">
      <ViewHeader title="settings" onBack={onBack} />

      <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm mb-4">
        <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-3 block">
          storage allocation
        </label>
        <div className="flex items-center gap-4 mb-2">
          <input
            type="range"
            min={10}
            max={500}
            step={10}
            value={gb}
            onChange={(e) => {
              setGb(Number(e.target.value));
              setSaved(false);
            }}
            className="flex-1"
          />
          <span className="font-mono font-black w-20 text-right">{gb} GB</span>
        </div>
        <p className="text-xs text-scatter-muted">
          how much disk space scatter can use to store shards for others.
        </p>
      </div>

      <button
        onClick={() => {
          onSetCapacity(gb);
          setSaved(true);
        }}
        className="brutal-btn w-full px-4 py-3 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal flex items-center justify-center gap-2"
      >
        {saved ? (
          <>
            <FiCheck size={18} /> saved
          </>
        ) : (
          'save'
        )}
      </button>

      {connected && (
        <p className="mt-3 text-xs text-scatter-warning font-semibold text-center">
          changes apply on next heartbeat.
        </p>
      )}

      <div className="mt-auto pt-4 border-t-2 border-scatter-border">
        <p className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-1">
          coordinator
        </p>
        {editingCoordinator ? (
          <>
            <input
              type="text"
              value={coordinatorInput}
              autoFocus
              onChange={(e) => {
                setCoordinatorInput(e.target.value);
                setCoordinatorError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCoordinator();
                if (e.key === 'Escape') setEditingCoordinator(false);
              }}
              placeholder="http://localhost:4000"
              className="w-full px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm mb-2 outline-none focus:bg-white"
            />
            <div className="flex gap-2">
              <button
                onClick={saveCoordinator}
                disabled={!coordinatorInput.trim()}
                className="brutal-btn-sm flex-1 px-4 py-2 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiSave size={14} /> save
              </button>
              <button
                onClick={() => setEditingCoordinator(false)}
                className="brutal-btn-sm px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold shadow-brutal-sm"
              >
                cancel
              </button>
            </div>
            {coordinatorError && (
              <p className="text-xs text-scatter-danger font-semibold mt-2">
                {coordinatorError}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-sm break-all">{coordinator}</p>
            <button
              onClick={startEditCoordinator}
              className="brutal-btn-sm px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold text-sm shadow-brutal-sm flex-shrink-0"
            >
              edit
            </button>
          </div>
        )}
        {coordinatorSaved && (
          <p className="mt-2 text-xs text-scatter-warning font-semibold">
            restart the node for the new coordinator to take effect.
          </p>
        )}
      </div>
    </div>
  );
}

function AccountView({
  account,
  onChange,
  onBack,
}: {
  account: Account | null;
  onChange: () => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'token' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const startEditName = () => {
    setUsernameInput(account?.username ?? '');
    setNameError(null);
    setEditingName(true);
  };

  const saveUsername = async () => {
    const next = usernameInput.trim();
    if (!next || next === account?.username) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      await invoke<Account>('update_username', { username: next });
      onChange();
      setEditingName(false);
    } catch (e) {
      setNameError(String(e));
    } finally {
      setSavingName(false);
    }
  };

  const requestLink = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await invoke('request_login', { email: email.trim() });
      setStage('token');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<Account>('verify_login', { token: token.trim() });
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loginWithCode = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<Account>('login_with_code', { code: code.trim() });
      onChange();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await invoke('logout');
      onChange();
      setStage('email');
      setEmail('');
      setToken('');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col p-4 bg-scatter-bg text-scatter-text">
      <ViewHeader title="account" onBack={onBack} />

      {account ? (
        <>
          <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm mb-3">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 border-2 border-scatter-border bg-scatter-bg flex items-center justify-center flex-shrink-0">
                <FiUser size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-scatter-muted uppercase tracking-wider font-bold">
                  signed in
                </p>
                <p className="font-bold truncate">{account.email}</p>
              </div>
            </div>
            <div className="p-3 border-2 border-scatter-border bg-scatter-bg flex items-center justify-between">
              <span className="text-sm font-bold flex items-center gap-2">
                <FiGift size={16} className="text-scatter-primary" /> credits
              </span>
              <span className="font-mono font-black text-xl">
                {account.balance.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm mb-3">
            <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-2 block">
              username
            </label>
            {editingName ? (
              <>
                <input
                  type="text"
                  value={usernameInput}
                  autoFocus
                  maxLength={24}
                  onChange={(e) => {
                    setUsernameInput(e.target.value);
                    setNameError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveUsername();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  placeholder="your-username"
                  className="w-full px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm mb-2 outline-none focus:bg-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={saveUsername}
                    disabled={savingName || !usernameInput.trim()}
                    className="brutal-btn-sm flex-1 px-4 py-2 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {savingName ? (
                      <FiLoader size={14} className="animate-spin" />
                    ) : (
                      <FiSave size={14} />
                    )}
                    save
                  </button>
                  <button
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="brutal-btn-sm px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold shadow-brutal-sm disabled:opacity-60"
                  >
                    cancel
                  </button>
                </div>
                <p className="text-xs text-scatter-muted mt-2">
                  3–24 chars: letters, numbers, hyphens and underscores.
                </p>
                {nameError && (
                  <p className="text-xs text-scatter-danger font-semibold mt-2">
                    {nameError}
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono font-bold truncate">
                  {account.username || '—'}
                </span>
                <button
                  onClick={startEditName}
                  className="brutal-btn-sm px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold text-sm shadow-brutal-sm flex-shrink-0"
                >
                  edit
                </button>
              </div>
            )}
          </div>

          <p className="text-xs text-scatter-muted mb-3 leading-relaxed">
            credits are earned by running your node and can be spent on bigger
            uploads.
          </p>

          <button
            onClick={signOut}
            disabled={busy}
            className="brutal-btn-sm w-full px-4 py-3 bg-scatter-surface border-2 border-scatter-border font-bold shadow-brutal-sm flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <FiLogOut size={16} /> sign out
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-scatter-muted mb-4 leading-relaxed">
            sign in to link this node to your account and earn credits toward
            bigger uploads.
          </p>

          {stage === 'email' ? (
            <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm">
              <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-2 block">
                email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && requestLink()}
                placeholder="you@example.com"
                className="w-full px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm mb-3 outline-none focus:bg-white"
              />
              <button
                onClick={requestLink}
                disabled={busy || !email.trim()}
                className="brutal-btn w-full px-4 py-3 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <FiMail size={18} />{' '}
                {busy ? 'sending...' : 'send sign-in link'}
              </button>
              <div className="flex items-center gap-2 my-3 text-xs text-scatter-muted">
                <div className="flex-1 h-px bg-scatter-border" />
                or
                <div className="flex-1 h-px bg-scatter-border" />
              </div>
              <button
                onClick={() => {
                  setStage('code');
                  setError(null);
                }}
                className="brutal-btn-sm w-full px-4 py-2 bg-scatter-surface border-2 border-scatter-border font-bold text-sm shadow-brutal-sm flex items-center justify-center gap-2"
              >
                <FiKey size={14} /> use a login code
              </button>
            </div>
          ) : stage === 'code' ? (
            <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm">
              <p className="text-sm mb-3 leading-relaxed">
                already signed in on the web? open{' '}
                <span className="font-bold">account settings</span> on
                scatter.tools, generate a one-time login code, then paste it
                here.
              </p>
              <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-2 block">
                login code
              </label>
              <input
                type="text"
                value={code}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loginWithCode()}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm mb-3 outline-none focus:bg-white uppercase tracking-widest"
              />
              <button
                onClick={loginWithCode}
                disabled={busy || !code.trim()}
                className="brutal-btn w-full px-4 py-3 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'signing in...' : 'sign in with code'}
              </button>
              <button
                onClick={() => {
                  setStage('email');
                  setError(null);
                }}
                className="brutal-link w-full mt-2 px-4 py-2 font-semibold text-sm"
              >
                back to email sign-in
              </button>
            </div>
          ) : (
            <div className="p-4 border-2 border-scatter-border bg-scatter-surface shadow-brutal-sm">
              <p className="text-sm mb-3 leading-relaxed">
                check <span className="font-bold">{email}</span> for a sign-in
                link. open it, then paste the code from the page below.
              </p>
              <label className="text-xs font-bold uppercase tracking-wider text-scatter-muted mb-2 block">
                sign-in code
              </label>
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && verify()}
                placeholder="paste code here"
                className="w-full px-3 py-2 border-2 border-scatter-border bg-scatter-bg font-mono text-sm mb-3 outline-none focus:bg-white"
              />
              <button
                onClick={verify}
                disabled={busy || !token.trim()}
                className="brutal-btn w-full px-4 py-3 bg-scatter-primary text-white border-2 border-scatter-border font-bold shadow-brutal disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? 'verifying...' : 'verify & sign in'}
              </button>
              <button
                onClick={() => {
                  setStage('email');
                  setError(null);
                }}
                className="brutal-link w-full mt-2 px-4 py-2 font-semibold text-sm"
              >
                use a different email
              </button>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 border-2 border-scatter-danger bg-scatter-danger/10 text-sm font-semibold">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ViewHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <button onClick={onBack} className="brutal-link p-2" title="back">
        <FiArrowLeft size={18} />
      </button>
      <span className="font-black text-lg tracking-tight lowercase">
        {title}
      </span>
    </div>
  );
}

function StatBox({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="p-3 border-2 border-scatter-border bg-scatter-surface text-center">
      <p className="text-xs text-scatter-muted uppercase tracking-wider mb-1 font-semibold">
        {label}
      </p>
      <p className="font-black font-mono flex items-center justify-center gap-1 truncate">
        {icon}
        {value}
      </p>
    </div>
  );
}

function pct(used: number, total: number): number {
  if (total <= 0) return 0;
  return (used / total) * 100;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default App;
