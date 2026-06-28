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

**Current scope (stub node).** The backend is a *node shell*: it does
register + heartbeat against the coordinator and persists local config, but it
does **not** itself serve shards over the wire. Shard serving is the job of the
full TypeScript node daemon (`apps/node`). The GUI is intentionally decoupled
from that daemon for now — see [§9 Future work](#9-future-work).

**Non-goals (today).** No real shard storage/transfer, no P2P transport, no
file upload UI (that lives in the web app).

---

## 2. Where it fits in the monorepo

```
apps/
  web/         Next.js landing + upload UI       ← visual design reference
  coordinator/ Fastify + better-sqlite3 API      ← GUI talks to this
  node/        TS daemon, real WS shard node      ← NOT used by the GUI (yet)
  gui/         Tauri 2 + React (this app)
```

Run it from the repo root:

```bash
pnpm dev:gui        # → pnpm --filter scatter-gui tauri dev
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
                                            │  /auth/request|verify  │
                                            │  /auth/me  /credits    │
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
    node_state:  Mutex<NodeState>,
    activity:    Mutex<Vec<ActivityEvent>>,
    started_at:  Mutex<Option<Instant>>,   // for live uptime
    shutdown_tx: Mutex<Option<mpsc::Sender<()>>>, // cancels heartbeat loop
    account:     Mutex<Option<Account>>,
}
```

`NodeState`, `ActivityEvent`, and `Account` all `#[serde(rename_all = "camelCase")]`
so the frontend receives idiomatic JS shapes.

### On-disk config — `~/.scatter/gui-config.json`

```jsonc
{
  "node_id": "…",                       // assigned by coordinator on register
  "capacity_bytes": 53687091200,        // user-chosen allocation
  "coordinator": "http://localhost:4000",
  "session": "…"                        // bearer token, optional
}
```

Loaded with sane defaults if missing/corrupt (`load_config` never panics).
`save_config` writes pretty JSON. The `session` field is `#[serde(default)]`
so older config files remain forward-compatible.

---

## 5. IPC command contract

All commands are registered in `tauri::generate_handler!`. The frontend calls
them with `invoke('<name>', args)`.

| Command | Args | Returns | Effect |
|---|---|---|---|
| `get_state` | – | `NodeState` | Snapshot + live `uptimeSeconds` (from `started_at`) and `creditsEarned` (from account balance). |
| `get_activity` | – | `ActivityEvent[]` | Current activity buffer. |
| `get_account` | – | `Account \| null` | Signed-in account, if any. |
| `start_node` | – | `Result<()>` | Registers with coordinator on first run (persists `node_id`), marks connected, starts uptime clock, spawns heartbeat loop. |
| `stop_node` | – | `Result<()>` | Signals the heartbeat loop to stop, marks disconnected, clears uptime. |
| `set_capacity` | `{ bytes: u64 }` | `Result<()>` | Persists new allocation; takes effect on next heartbeat. |
| `request_login` | `{ email: string }` | `Result<()>` | `POST /auth/request` — coordinator emails a magic link. |
| `verify_login` | `{ token: string }` | `Result<Account>` | `POST /auth/verify`, persists `session`, fetches credit balance. |
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
  kind: 'uploaded' | 'downloaded';
  fileId: string;
  shardIndex: number;
  size: number;
  timestamp: number;
}

interface Account {
  email: string;
  balance: number;
}
```

### Coordinator endpoints used

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/nodes/register` | POST | – | `{capacityBytes, version}` → `{nodeId}` |
| `/nodes/:id/heartbeat` | POST | – | `{usedBytes, capacityBytes}` keep-alive |
| `/auth/request` | POST | – | `{email}` → emails magic link |
| `/auth/verify` | POST | – | `{token}` → `{session, user:{email}}` |
| `/auth/me` | GET | Bearer | restore session on launch |
| `/credits` | GET | Bearer | `{balance}` |

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
- Read-only coordinator URL at the bottom.

### `AccountView`

Two modes:

- **Signed in** — avatar + email, a credits card with the balance, an
  explainer, and a `sign out` button.
- **Signed out** — two-stage magic-link flow:
  1. **email** stage → `request_login`,
  2. **token** stage → paste the code from the magic-link page → `verify_login`.

  Includes "use a different email" to reset, inline error banner, Enter-to-submit.

### Shared pieces

- **`ViewHeader`** — back arrow + lowercase title (settings / account).
- **`StatBox`** — label + mono value + optional icon.
- **Helpers** — `pct`, `formatSize` (B/KB/MB/GB), `formatUptime` (s/m/h m).

---

## 8. State model & lifecycle

```
launch
  └─ load_config()  →  hydrate NodeState (capacity, node_id)
  └─ if session: restore Account (GET /auth/me + /credits) on temp runtime
  └─ Tauri builder runs, window opens

user clicks "start"
  └─ start_node: register if needed → connected=true → started_at=now
                 → spawn heartbeat loop (every 30s: POST /heartbeat)

user clicks "stop"
  └─ stop_node: send () on shutdown channel → loop breaks
              → connected=false, started_at=None

login: request_login → (email) → verify_login → Account + persisted session
logout: clears session + account
```

- **Uptime** is derived live from `started_at.elapsed()` inside `get_state`,
  so it never drifts from a stored counter.
- **Credits** in `NodeState.creditsEarned` are mirrored from the signed-in
  account balance (clamped to ≥ 0), so the main view shows real credits once
  signed in.
- **`shardCount`, `usedBytes`, activity** are currently always zero/empty
  because the stub does not serve shards (see below).

---

## 9. Future work

The backend is deliberately a node *shell*. To become a real node it would need:

1. **Shard serving** — connect to the coordinator's WebSocket node protocol
   (as `apps/node` does), accept/serve shards, and write them to the allocated
   disk space.
2. **Real metrics** — populate `usedBytes`, `shardCount`, and emit
   `ActivityEvent`s as shards are uploaded/downloaded (the UI already renders
   these the moment the backend produces them).
3. **Embedding the node daemon** — either port the TS node logic to Rust or
   supervise the existing daemon as a sidecar via the Tauri shell plugin.
4. **Configurable coordinator** — surface the coordinator URL as an editable
   setting (today it is read-only and fixed to the default).

The frontend, IPC contract, and design system are built to absorb this without
structural change: the views already bind to `usedBytes`, `shardCount`, and the
activity stream.

---

## 10. Build & run

```bash
# from repo root
pnpm install
pnpm dev:gui          # dev with hot reload (Vite + Tauri)

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
