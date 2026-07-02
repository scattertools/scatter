# Scatter Desktop GUI

A [Tauri 2](https://tauri.app) desktop app for running a Scatter storage node
with a UI — the consumer-facing companion to [scatter.tools](https://scatter.tools).
Donate spare disk space to the network, watch your node's activity, sign in, and
track the credits you earn.

It is **feature-equivalent to the [`scatter` CLI](../../README.md#node-cli-reference)**:
the Rust backend is a full shard-serving node (register, heartbeat, and the
coordinator WebSocket protocol for storing/serving/deleting shards), implemented
natively in Rust rather than shelling out to the `apps/node` daemon.

- **Frontend:** React 18 + Vite + Tailwind v4 (`src/`)
- **Backend:** Rust / Tauri 2 (`src-tauri/`)
- **Talks to:** the coordinator API (defaults to `http://localhost:4000`)

See [DESIGN.md](./DESIGN.md) for the full architecture, IPC contract, and design
system.

## Prerequisites

- [Node.js](https://nodejs.org) 22+ and [pnpm](https://pnpm.io) 10+ (see the
  repo root [`.nvmrc`](../../.nvmrc))
- A [Rust toolchain](https://rustup.rs) (Tauri compiles a native binary)
- Platform Tauri deps — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
- A running coordinator on `:4000` for register/heartbeat/auth to succeed
  (`pnpm dev:api` from the repo root)

## Develop

```bash
# from the repo root
pnpm install
pnpm dev:app          # → pnpm --filter scatter-gui tauri dev (hot reload)
```

Or from inside `apps/gui`:

```bash
pnpm dev              # Vite dev server only (no Tauri shell)
pnpm tauri dev        # full app with hot reload
```

## Build

```bash
# inside apps/gui
pnpm build                              # tsc + vite build (bundles fonts into dist/)
pnpm tauri build                        # production bundle for the current platform

# inside apps/gui/src-tauri
cargo check                             # type-check the Rust backend
cargo fmt && cargo clippy               # format + lint
```

Bundles are emitted under `src-tauri/target/release/bundle/`.

## What it does

| Area | Detail |
| ---- | ------ |
| **Node** | Registers with the coordinator, sends authenticated heartbeats, and stores/serves/deletes shards over the coordinator WebSocket protocol. |
| **Storage** | Shards + config live under `~/.scatter` (GUI config in `gui-config.json`). Allocation is adjustable (applies on next heartbeat). |
| **Sign-in** | OAuth-style device flow (browser) or a one-time login code from the web account settings. Sessions are restored on launch. |
| **Account** | View email, username, and live credit balance; change your username; sign out. |
| **Coordinator** | Editable in Settings; restart the node to take effect. |

The window is fixed at 380 × 580 (identifier `tools.scatter.app`). All network
I/O happens in the Rust layer; the webview never makes network requests.
