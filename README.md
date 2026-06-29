<div align="center">
  <img src="apps/web/public/logo.svg" alt="Scatter" width="100" />
  <h1>Scatter</h1>
  <p><strong>Your files, scattered across the world.</strong></p>
  <p>
    Decentralized file sharing. End-to-end encrypted. Powered by people, not servers.
  </p>
  <p>
    <a href="https://scatter.tools">scatter.tools</a> ·
    <a href="#getting-started">Get Started</a> ·
    <a href="#node-cli-reference">CLI</a> ·
    <a href="#how-it-works">How It Works</a> ·
    <a href="#contributing">Contributing</a>
  </p>
</div>

---

## What is Scatter?

Scatter is a distributed file sharing platform where your files are:

1. **Encrypted** on your device with AES-256-GCM before leaving
2. **Split** into shards using Reed-Solomon erasure coding
3. **Scattered** across contributor hardware around the world
4. **Retrievable** from anywhere with just a link

No one can read your files. The decryption key lives in the URL fragment, which browsers never send to servers.

### Why?

- **Privacy by default.** Zero-knowledge architecture means the server literally cannot see your data.
- **Resilient.** Files are split with erasure coding — even if some nodes go offline, your file still works.
- **Community-powered.** Anyone can contribute storage and earn credits toward larger uploads.
- **Self-hostable.** The whole stack runs on a single server. Roll your own Scatter for your team or community.

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser   │────▶│ Coordinator  │◀────│  Node Apps   │
│  (encrypts) │     │   (relays)   │     │ (store data) │
└─────────────┘     └──────────────┘     └──────────────┘
```

1. You drop a file in the browser. It's encrypted client-side with a random key.
2. The encrypted file is split into 14 shards (10 data + 4 parity) via Reed-Solomon.
3. The coordinator assigns each shard to a different node in the network.
4. You get a link like `scatter.tools/f/ABC12345#[key]`. Share it.
5. On download, shards are pulled from nodes, reassembled, and decrypted — all in the browser.

Any 10 of the 14 shards are enough to rebuild the file, so up to 4 nodes can go offline without data loss.

## Repository Layout

Scatter is a pnpm monorepo:

```
apps/
  web/          Next.js front end — upload, download, auth, dashboard
  coordinator/  Fastify API — assigns shards, relays uploads/downloads, auth + credits
  node/         CLI storage agent (`scatter`) — stores shards, talks to the coordinator
  gui/          Tauri desktop app for running a node with a UI
packages/
  protocol/     Shared core — crypto, Reed-Solomon sharding, manifests, link codecs
```

## Getting Started

The quickest way to use Scatter is through the hosted service at **[scatter.tools](https://scatter.tools)** — no install needed.

Want to contribute storage and earn credits? Run a node — see [Run a Node](#run-a-node).

### Download a Node Binary

Prebuilt node binaries are published on the [GitHub Releases page](https://github.com/scattertools/scatter/releases). Download the build for your platform, then start contributing:

```bash
scatter start --storage 50GB --coordinator https://scatter.tools
scatter login                       # link to your account and earn credits
scatter status                      # config, link state, and credit balance
```

Config and shards live in `~/.scatter` by default (override with `--data-dir`).

The CLI is fully featured — it does everything the desktop GUI does (running a
node, account sign-in, credits, settings). See the [Node CLI Reference](#node-cli-reference)
for every command.

Prefer to build it yourself? See [Building from Source](#building-from-source).

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 20+ (24+ recommended — the apps run TypeScript directly via `--experimental-strip-types`)
- [pnpm](https://pnpm.io) 10+
- For the desktop GUI: a [Rust toolchain](https://rustup.rs) (Tauri builds a native binary)
- Optional: Docker + Docker Compose for running the full stack in containers

### Download & Install

```bash
git clone https://github.com/scattertools/scatter.git
cd scatter
pnpm install
```

### Configure

Copy the environment template and set a JWT secret for the coordinator:

```bash
cp .env.example .env
# JWT_SECRET must be at least 32 chars — the coordinator refuses to boot otherwise:
openssl rand -hex 32
```

The only required variable is `JWT_SECRET`. Everything else (ports, SMTP, credits,
upload limits) has sensible defaults documented in `.env.example`. If SMTP is left
unset, magic-link sign-in emails are printed to the coordinator console instead of sent.

### Run the Coordinator

```bash
pnpm dev:api
```

Serves the API on http://localhost:4000 (health check at `/health`).

### Run the Web App

```bash
pnpm dev:web
```

Open http://localhost:3000. Point it at the coordinator with `NEXT_PUBLIC_API_URL`
(defaults to `http://localhost:4000`).

### Run a Node

```bash
# Set and forget — allocate storage and start contributing
pnpm dev:node -- --storage 50GB

# Or, after building, run the compiled `scatter` binary directly:
scatter start --storage 50GB --coordinator http://localhost:4000
scatter login                       # link this node to your account
scatter status                      # config, link state, and credit balance
```

Config and shards live in `~/.scatter` by default (override with `--data-dir`).
The CLI exposes the full feature set — see the [Node CLI Reference](#node-cli-reference).

> Don't want to build it? Grab a prebuilt binary from the
> [GitHub Releases page](https://github.com/scattertools/scatter/releases) instead.

### Run the Desktop GUI _(in progress)_

```bash
pnpm dev:app
```

A [Tauri](https://tauri.app) app that runs a node with a desktop UI. It is
feature-equivalent to the CLI — anything you can do in the GUI (sign in, set
storage, switch coordinator, view credits) you can also do from the
[`scatter` command](#node-cli-reference), and vice versa.

### Run the Full Stack with Docker

The coordinator and web app are containerized:

```bash
cp .env.example .env   # set JWT_SECRET
docker compose up -d --build
# web -> http://localhost:3000   coordinator -> http://localhost:4000
```

The `node` agent and `gui` desktop app are intentionally not containerized — run those
locally as shown above.

## Node CLI Reference

The `scatter` command-line node is a full-featured client — it can do everything
the desktop GUI does: run a shard-serving node, sign in to your account, manage
credits, and adjust settings. It runs headless, which makes it ideal for servers,
Raspberry Pis, and [background services](apps/node/service/README.md).

All state (config + shards) lives under `~/.scatter`. Every command accepts
`--data-dir <path>` to use a different location, which lets you run multiple
independent nodes on one machine.

### Quick start

```bash
scatter start --storage 50GB --coordinator https://scatter.tools  # run the node
scatter login                                                     # link your account
scatter status                                                    # see everything
```

`scatter start` runs in the foreground and streams an activity log (shards
stored/served, reconnects, errors). Stop it with `Ctrl-C`. To run it unattended,
install it as an OS service — see [apps/node/service](apps/node/service/README.md)
for systemd / launchd / Windows templates.

### Commands

| Command | What it does |
| ------- | ------------ |
| `start` | Start the node and serve shards (foreground). |
| `status` | Show config, link state, and — when signed in — your account + credit balance. |
| `login` | Link this node to your Scatter account (browser device flow). |
| `login --code <code>` | Sign in with a one-time login code from the web account settings. |
| `logout` | Unlink this node from your account. |
| `account` (alias `whoami`) | Show the linked account email, username, and credit balance. |
| `username <name>` | Set your account username (3–24 chars: letters, numbers, `-`, `_`). |
| `set-storage <size>` | Change the storage allocation (e.g. `100GB`). Applies on the next heartbeat. |
| `set-coordinator <url>` | Point the node at a different coordinator. Restart to take effect. |
| `reset` | Forget the node ID + token (re-registers on next `start`). |

Run `scatter --help` or `scatter <command> --help` for the full flag list.

### `start`

```bash
scatter start [options]
```

| Flag | Description | Default |
| ---- | ----------- | ------- |
| `--storage <size>` | Disk to allocate for others' shards, e.g. `50GB`, `512MB`, `1TB`. | `10GB` |
| `--coordinator <url>` | Coordinator API URL. | `http://localhost:4000` |
| `--port <n>` | Local HTTP port. | `7878` |
| `--data-dir <path>` | Where config + shards live. | `~/.scatter` |

Flags passed to `start` are persisted, so you only need to set them once.
On first start the node registers itself with the coordinator and saves its
node ID + token; if you ran `scatter login` first, the node is bound to your
account so you earn credits for the storage you contribute.

### Signing in & credits

Running a node earns **credits**, which you spend on larger uploads. Link the
node to your account to collect them. Two ways to sign in:

```bash
# Browser device flow — opens a verification URL and a short code to confirm.
scatter login

# Already signed in on the web? Generate a one-time code in your account
# settings on scatter.tools and paste it:
scatter login --code ABCD-1234-EFGH
```

Then check your balance any time:

```bash
scatter account        # email, username, credits
scatter username alice # claim a username
scatter logout         # unlink
```

### Changing settings

```bash
scatter set-storage 100GB                          # grow/shrink your allocation
scatter set-coordinator https://my-coordinator.example  # self-hosted instance
```

`set-storage` takes effect on the next heartbeat (~30s) — no restart needed.
`set-coordinator` requires a node restart.

### Output & scripting

`status` and `account` accept `--json` for machine-readable output:

```bash
scatter status --json | jq .account.credits
```

Colour is auto-disabled when output isn't a TTY, or set `NO_COLOR=1`.

### Running multiple nodes

Because all state is scoped to `--data-dir`, you can run several nodes side by
side:

```bash
scatter start --data-dir ~/.scatter-a --port 7878 --storage 20GB
scatter start --data-dir ~/.scatter-b --port 7879 --storage 20GB
```

## Roadmap

- [x] Landing page
- [x] Protocol: encryption + sharding + manifests
- [x] Coordinator API
- [x] Node app (headless CLI)
- [x] Web upload/download flow
- [x] Credits system
- [ ] Desktop GUI app
- [ ] Published binaries (Homebrew / Scoop / install script)
- [ ] Public launch
- [ ] Direct P2P transfers (skip the relay)
- [ ] Mobile app?

## Contributing

Contributions are welcome! Whether it's code, bug reports, docs, or design feedback.

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/cool-thing`)
3. Commit your changes (`git commit -m 'feat: add cool thing'`)
4. Push to the branch (`git push origin feat/cool-thing`)
5. Open a pull request

## Security

Found a security issue? Please **do not** open a public issue. Email [security@scatter.tools](mailto:security@scatter.tools) instead.

Scatter is designed with zero-knowledge principles, but cryptography is hard. We welcome audits and reviews.

## License

[AGPL-3.0](https://github.com/scattertools/scatter?tab=AGPL-3.0-1-ov-file) — if you run a modified version as a service, you have to share your changes. Keeps the ecosystem open.
