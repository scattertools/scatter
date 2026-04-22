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

## Getting Started

The quickest way to use Scatter is through the hosted service at **[scatter.tools](https://scatter.tools)** — no install needed.

Want to contribute storage and earn credits? Run a node.

### Install the Node App

> 📦 **Coming soon.** Pre-built binaries for macOS, Linux, and Windows.

Once released, you'll be able to install via:

**macOS / Linux (Homebrew):**

```bash
brew install scatter
```

**Linux (Direct):**

```bash
curl -fsSL https://scatter.tools/install.sh | sh
```

**Windows (Scoop):**

```bash
scoop install scatter
```

Or grab a binary from the [releases page](https://github.com/scattertools/scatter/releases).

### Run a Node

```bash
# Headless mode — set and forget
scatter start --storage 50GB

# Terminal UI with live stats
scatter start --storage 50GB --tui

# Sign in to earn credits toward bigger uploads
scatter login
```

Modes:

- `headless` — no UI, logs only
- `tui` — terminal UI with live network stats
- `gui` — desktop app (default) _(planned)_

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 20+ (24+ recommended)
- [pnpm](https://pnpm.io) 9+
- Optional: Docker + Docker Compose for running the full stack

### Download & Install

```bash
git clone https://github.com/YOUR_USERNAME/scatter.git
cd scatter
pnpm install
```

### Run the Web App

```bash
pnpm dev:web
```

Open http://localhost:3000.

### Run the Coordinator _(coming soon)_

```bash
pnpm dev:api
```

### Run a Node _(coming soon)_

```bash
pnpm dev:node
```

## Roadmap

- [x] Landing page
- [x] Protocol: encryption + sharding + manifests
- [ ] Coordinator API
- [ ] Node app (headless + TUI)
- [ ] Web upload/download flow
- [ ] Credits system
- [ ] Desktop GUI app
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
