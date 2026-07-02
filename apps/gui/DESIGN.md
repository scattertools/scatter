# Scatter GUI — Design Document

The Scatter desktop app is the consumer-facing "run a node" companion to the
[scatter.tools](https://scatter.tools) web product. It lets a person donate
spare disk space to the network, watch their node's activity, and sign in to
track the credits they earn. It is built with **Tauri 2** (Rust backend +
system webview) and a **React 18 + Vite + Tailwind v4** frontend.

This document describes the architecture, the IPC contract between the
frontend and the Rust backend, the visual design system (inherited from the
web app), the view/component inventory, the state model, and how to build and
run it.

---

## 1. Goals & scope

**Goal.** A small, always-visible "control panel" window that:

- registers this machine as a node with the coordinator,
- keeps the node marked online via heartbeats while running,
- surfaces live state (connection, storage, uptime, credits, recent activity),
- lets the user allocate how much disk space to donate,
- lets the user sign in (magic link) and see their credit balance.

**Current scope (full node).** The backend is a complete shard-serving node,
reimplemented natively in Rust: it registers + heartbeats against the
coordinator, persists local config, and — over the coordinator WebSocket
protocol — stores, serves, and deletes shards on local disk. It is functionally
equivalent to the TypeScript node daemon (`apps/node`); the GUI does **not**
shell out to that daemon.

**Non-goals (today).** No P2P transport (shards relay through the coordinator,
as elsewhere in Scatter), and no file upload UI (that lives in the web app).

---

## 2. Where it fits in the monorepo

```
apps/
  web/         Next.js landing + upload UI       ← visual design reference
  coordinator/ Fastify + better-sqlite3 API      ← GUI talks to this
  node/        TS daemon, real WS shard node      ← feature-equivalent peer
  gui/         Tauri 2 + React (this app)         ← native Rust shard node
```

Run it from the repo root:

```bash
pnpm dev:app        # → pnpm --filter scatter-gui tauri dev
```

The GUI talks to the coordinator over HTTP at **`http://localhost:4000`** by
default (matching `apps/node`'s `config.ts` default).

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri window (380 × 580, fixed size, centered)               │
│                                                               │
│  ┌─────────────────────────┐      invoke()      ┌──────────┐  │
│  │  React frontend          │ ─────────────────▶ │  Rust    │  │
│  │  (src/App.tsx)           │ ◀───────────────── │  backend │  │
│  │  polls get_state (1s)    │   serde camelCase  │ (lib.rs) │  │
│  │  polls get_activity (2s) │                    └────┬─────┘  │
│  └─────────────────────────┘                         │        │
└──────────────────────────────────────────────────────┼────────┘
                                                        │ reqwest
                                                        ▼
                                            ┌───────────────────────┐
                                            │  Coordinator (:4000)   │
                                            │  /nodes/register       │
                                            │  /nodes/:id/heartbeat  │
                                            │  /auth/device/*        │
                                            │  /auth/code/verify     │
                                            │  /auth/me  /credits    │
                                            │  + WS node protocol    │
                                            └───────────────────────┘
```

- **Frontend** is a pure view layer. It owns no durable state; it polls the
  backend and renders. All side effects go through `invoke()`.
- **Backend** owns all state and all network I/O. It exposes a small set of
  commands, persists config to disk, and runs a background heartbeat task.
- **Coordinator** is the only external dependency. Every network call lives in
  the Rust layer (`reqwest`); the webview never makes network requests.

### Process & threading model

- Tauri manages a shared `Arc<AppState>` via `.manage(state)`; commands receive
  it through `tauri::State<Arc<AppState>>`.
- All mutable state lives behind `std::sync::Mutex` fields (cheap, short-lived
  locks; never held across `.await`).
- The heartbeat loop runs as a `tokio::spawn`'d task, cancelled via a
  `tokio::sync::mpsc` shutdown channel when the node is stopped.
- On launch, if a saved session exists, the account is restored on a
  short-lived current-thread tokio runtime before the Tauri builder starts.

---

## 4. Rust backend (`src-tauri/src/lib.rs`)

The crate is split so the same logic works on desktop and (potentially) mobile:

- `src/main.rs` — thin binary entry point:
  ```rust
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  fn main() { scatter_gui_lib::run(); }
  ```
- `src/lib.rs` — the library crate `scatter_gui_lib`, exposing
  `#[cfg_attr(mobile, tauri::mobile_entry_point)] pub fn run()`.
- `Cargo.toml` declares `[lib] name = "scatter_gui_lib"` with
  `crate-type = ["staticlib", "cdylib", "rlib"]`.

### Constants

| Constant | Value |
|---|---|
| `VERSION` | `"0.1.0"` |
| `DEFAULT_CAPACITY_BYTES` | `50 GB` |
| `DEFAULT_COORDINATOR` | `http://localhost:4000` |
| `HEARTBEAT_INTERVAL_SECS` | `30` |

### In-memory state

```rust
struct AppState {
    node_state:      Mutex<NodeState>,
    activity:        Mutex<Vec<ActivityEvent>>,
    started_at:      Mutex<Option<Instant>>,        // for live uptime
    shutdown_tx:     Mutex<Option<mpsc::Sender<()>>>, // cancels heartbeat loop
    ws_shutdown_tx:  Mutex<Option<mpsc::Sender<()>>>, // cancels WS shard loop
    account:         Mutex<Option<Account>>,
    pending_device_code: Mutex<Option<String>>,     // secret device-login code
}
```

`NodeState`, `ActivityEvent`, and `Account` all `#[serde(rename_all = "camelCase")]`
so the frontend receives idiomatic JS shapes.

### On-disk config — `~/.scatter/gui-config.json`

```jsonc
{
  "node_id": "…",                       // assigned by coordinator on register
  "node_token": "…",                    // node auth token (heartbeats + WS)
  "capacity_bytes": 53687091200,        // user-chosen allocation
  "coordinator": "http://localhost:4000",
  "session": "…"                        // user bearer token, optional
}
```

Loaded with sane defaults if missing/corrupt (`load_config` never panics).
`save_config` writes pretty JSON. `node_token` and `session` are
`#[serde(default)]` so older config files remain forward-compatible.

---

## 5. IPC command contract

All commands are registered in `tauri::generate_handler!`. The frontend calls
them with `invoke('<name>', args)`.

| Command | Args | Returns | Effect |
|---|---|---|---|
| `get_state` | – | `NodeState` | Snapshot + live `uptimeSeconds` (from `started_at`) and `creditsEarned` (from account balance). |
| `get_activity` | – | `ActivityEvent[]` | Current activity buffer. |
| `get_account` | – | `Account \| null` | Signed-in account, if any. |
| `start_node` | – | `Result<()>` | Registers with coordinator on first run (persists `node_id` + token, binds to the signed-in user when a session exists), marks connected, starts uptime clock, spawns the heartbeat loop and the WebSocket shard-serving loop. |
| `stop_node` | – | `Result<()>` | Signals the heartbeat + WS loops to stop, marks disconnected, clears uptime. |
| `set_capacity` | `{ bytes: u64 }` | `Result<()>` | Persists new allocation; takes effect on next heartbeat. |
| `set_coordinator` | `{ url: string }` | `Result<()>` | Validates + persists the coordinator URL (restart to take effect). |
| `get_coordinator` | – | `string` | Current coordinator URL. |
| `start_device_login` | – | `Result<DeviceLogin>` | `POST /auth/device/start` — returns user code + verification URL; the secret device code stays in the backend. |
| `poll_device_login` | – | `Result<Account \| null>` | `POST /auth/device/poll` — `null` while pending, `Account` once approved, error when expired. Persists `session`. |
| `login_with_code` | `{ code: string }` | `Result<Account>` | `POST /auth/code/verify` — exchanges a one-time code for a session, persists it, loads balance. |
| `update_username` | `{ username: string }` | `Result<Account>` | `PATCH /auth/me` — sets the account username. |
| `logout` | – | `Result<()>` | Clears `session` from config and in-memory account. |

`Result<_, String>` errors surface to the UI as human-readable strings
(e.g. `"could not reach coordinator: …"`, `"invalid or expired code"`).

### Data shapes (TypeScript mirror)

```ts
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
  kind: 'uploaded' | 'downloaded' | 'deleted';
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
```

### Coordinator endpoints used

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/nodes/register` | POST | optional Bearer (session) | `{capacityBytes, version}` → `{nodeId, nodeToken}`; binds to the user when signed in |
| `/nodes/:id/heartbeat` | POST | Bearer (node token) | `{usedBytes, capacityBytes}` keep-alive |
| `/auth/device/start` | POST | – | → device code + user code + verification URL |
| `/auth/device/poll` | POST | – | `{deviceCode}` → `{status, session, user}` once approved |
| `/auth/code/verify` | POST | – | `{code}` → `{session, user}` (one-time login code) |
| `/auth/me` | GET | Bearer | restore session on launch |
| `/auth/me` | PATCH | Bearer | `{username}` → updated user |
| `/credits` | GET | Bearer | `{balance}` |

Shard storage/serving/deletion happens over the coordinator **WebSocket** node
protocol (see `src-tauri/src/ws_client.rs`), not the HTTP endpoints above.

---

## 6. Design system

The GUI reuses the web app's **neo-brutalist** language (from
`apps/web/app/globals.css`) so the desktop app feels like the same product.
Tokens are declared in Tailwind v4's `@theme` block in `src/index.css`.

### Color tokens

| Token | Hex | Use |
|---|---|---|
| `scatter-primary` | `#059669` | primary actions, "connected", credits |
| `scatter-primary-hover` | `#047857` | hover state |
| `scatter-accent` | `#0891b2` | downloads / secondary accent |
| `scatter-warning` | `#d97706` | warnings (e.g. "applies on next heartbeat") |
| `scatter-danger` | `#dc2626` | errors |
| `scatter-bg` | `#f5f5f4` | window background |
| `scatter-surface` | `#ffffff` | cards |
| `scatter-border` / `scatter-text` | `#0a0a0a` | 2px borders, body text |
| `scatter-muted` | `#525252` | labels, secondary text |
| `scatter-dim` | `#a3a3a3` | tertiary / scrollbar |

### Shadows (hard offset, no blur)

| Token | Value |
|---|---|
| `shadow-brutal-sm` | `2px 2px 0 0 #0a0a0a` |
| `shadow-brutal` | `4px 4px 0 0 #0a0a0a` |
| `shadow-brutal-lg` | `6px 6px 0 0 #0a0a0a` |

### Typography

- **Sans:** Inter (weights 400–900) — `--font-sans`.
- **Mono:** JetBrains Mono (400/500/700) — `--font-mono`, used for all
  numerics, IDs, and the coordinator URL.
- Fonts are bundled **offline** via `@fontsource/*` imports (no runtime
  network fetch), matching the web app's `next/font` weights.

### Conventions

- 2px solid black borders on every card/button/input.
- Hard offset shadows; **no** rounded corners, **no** blur.
- Lowercase headings and labels; `font-black` for emphasis.
- Mono font for every number, hash, and URL.
- Emerald (`scatter-primary`) for primary CTAs; white surface for secondary.

### Interaction classes (`src/index.css`)

| Class | Hover | Active |
|---|---|---|
| `.brutal-btn` | lift `(-2,-2)`, `shadow-brutal-lg` | press `(4,4)`, flat |
| `.brutal-btn-sm` | lift `(-1,-1)`, `shadow-brutal` | press `(2,2)`, flat |
| `.brutal-link` | invert (black bg, light text) | – |

Hover/active transforms are gated on `:not(:disabled)`. The webview chrome is
locked down for an app-like feel: `overflow: hidden`, `user-select: none`,
`cursor: default` globally, with text selection re-enabled on inputs. The
scrollbar and range slider are restyled to match the brutalist system.

---

## 7. Frontend views & components (`src/App.tsx`)

A single `view` state (`'main' | 'settings' | 'account'`) switches between
three full-screen views. There is no router — the window is small and the
navigation is shallow.

### `App` (main view)

- **`Header`** — logo + "Scatter" wordmark, account button (shows email local
  part when signed in), settings button.
- **Connection card** — Wi-Fi icon, `connected` / `not connected`, node id,
  and a `start` / `stop` button. Tints emerald when connected.
- **Storage card** — `FiHardDrive` label, a bordered progress bar
  (`usedBytes / capacityBytes`), `used` and `allocated` readouts.
- **Stat row** — three `StatBox`es: shards, uptime, credits.
- **Activity list** — scrollable; up/down arrows per event, truncated file id
  `#shardIndex`, size. Empty states differ by connection status.
- **Footer** — `scatter v0.1.0` and a `scatter.tools` link opened via the
  Tauri shell plugin (`open(...)`), not the in-app webview.

Polling: `get_state` every **1s**, `get_activity` every **2s**, `get_account`
once on mount and after auth changes.

### `SettingsView`

- Storage allocation `range` input (10–500 GB, step 10) with live GB readout.
- `save` button → `set_capacity`, shows a `✓ saved` confirmation.
- Warning when connected ("changes apply on next heartbeat").
- Editable coordinator URL at the bottom → `get_coordinator` / `set_coordinator`
  (inline edit, validation, save/cancel; restart to take effect).

### `AccountView`

Two modes:

- **Signed in** — avatar + email/username, a credits card with the balance, an
  editable username (`update_username`), an explainer, and a `sign out` button.
- **Signed out** — two ways to authenticate:
  1. **device flow** → `start_device_login` opens the verification URL + shows
     the short user code, then polls `poll_device_login` until approved;
  2. **login code** → paste a one-time code from the web account settings →
     `login_with_code`.

  Inline error banner, Enter-to-submit.

### Shared pieces

- **`ViewHeader`** — back arrow + lowercase title (settings / account).
- **`StatBox`** — label + mono value + optional icon.
- **Helpers** — `pct`, `formatSize` (B/KB/MB/GB), `formatUptime` (s/m/h m).

---

## 8. State model & lifecycle

```
launch
  └─ load_config()  →  hydrate NodeState (capacity, node_id)
  └─ init_storage() →  seed used_bytes + shard_count from on-disk index
  └─ if session: restore Account (GET /auth/me + /credits) on temp runtime
  └─ Tauri builder runs, window opens

user clicks "start"
  └─ start_node: register if needed (persist node_id + token) → connected=true
                 → started_at=now
                 → spawn heartbeat loop (every 30s: POST /heartbeat)
                 → spawn WS loop (store/serve/delete shards, emit activity)

user clicks "stop"
  └─ stop_node: send () on heartbeat + WS shutdown channels → loops break
              → connected=false, started_at=None

login: start_device_login → poll_device_login (or login_with_code)
       → Account + persisted session
logout: clears session + account
```

- **Uptime** is derived live from `started_at.elapsed()` inside `get_state`,
  so it never drifts from a stored counter.
- **Credits** in `NodeState.creditsEarned` are mirrored from the signed-in
  account balance (clamped to ≥ 0), so the main view shows real credits once
  signed in.
- **`shardCount`, `usedBytes`, activity** reflect real on-disk shard storage:
  they are seeded from the persisted shard index on launch and updated live as
  shards are stored/served/deleted over the coordinator WebSocket protocol.

---

## 9. Future work

The node is feature-complete relative to the CLI. Remaining work is polish and
distribution rather than core functionality:

- **Packaging & signing** — produce signed/notarized bundles per platform and
  publish them alongside the CLI binaries (see the repo roadmap).
- **Auto-update** — wire up Tauri's updater so installed apps self-update.
- **Run on login / background tray** — let the node keep contributing without
  the window open (system tray + launch-at-login).
- **Shared core with `apps/node`** — the Rust backend currently reimplements
  the node protocol; longer term the storage/WS logic could be extracted into a
  shared crate to avoid drift with the TS daemon.

Once direct P2P transfers land in the protocol (repo roadmap), the node — CLI
and GUI alike — will gain a peer transport; the GUI's IPC contract and design
system are built to absorb that without structural change.

---

## 10. Build & run

```bash
# from repo root
pnpm install
pnpm dev:app          # dev with hot reload (Vite + Tauri)

# inside apps/gui
pnpm build            # tsc + vite build (also bundles fonts into dist/)
pnpm --filter scatter-gui tauri build   # production bundle

# inside apps/gui/src-tauri
cargo check           # type-check the Rust backend (clean, zero warnings)
```

**Window:** 380 × 580, `resizable: false`, `center: true`,
identifier `tools.scatter.app`.

**Capabilities** (`src-tauri/capabilities/default.json`): `core:default` plus
`shell:allow-open` (needed only for the footer's external `scatter.tools` link).

**Prerequisite:** the coordinator must be running on `:4000` for register,
heartbeat, and auth to succeed — otherwise commands fail gracefully with a
readable error and the UI stays in its disconnected/empty state.
