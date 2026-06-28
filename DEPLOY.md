# Deploying Scatter to production

Scatter has three deployable pieces, with very different hosting needs:

| Component       | Stateful? | Host (this guide)        | Why |
| --------------- | --------- | ------------------------ | --- |
| **coordinator** | **Yes**   | Fly.io (1 always-on VM + volume) | In-memory WebSocket map + local SQLite — cannot be serverless or multi-replica |
| **web**         | No        | Vercel (free tier)       | Plain Next.js app, scales anywhere |
| **node**        | n/a       | Run by you/contributors  | Storage agents dial *into* the coordinator over `wss://` |

> The decryption key never leaves the browser (it lives in the URL fragment),
> so "production" here is about availability and abuse-resistance, not key
> custody.

---

## 0. Prerequisites

- A domain on Cloudflare (this guide assumes `scatter.tools`).
- [`flyctl`](https://fly.io/docs/flyctl/install/) installed and `fly auth login` done.
- A [Vercel](https://vercel.com) account connected to your GitHub repo.
- `openssl` for generating the JWT secret.

Pick two hostnames:
- `scatter.tools` → the web app (Vercel)
- `api.scatter.tools` → the coordinator (Fly)

---

## 1. Coordinator → Fly.io

`fly.toml` in the repo root is already configured (single always-on machine,
`/data` volume, `TRUST_PROXY=true`, health check, connection cap).

```bash
# From the repo root.

# 1. Create the app (reuses the committed fly.toml; does not deploy yet).
fly launch --no-deploy --copy-config --name scatter-coordinator

# 2. Create the persistent volume for SQLite (same region as primary_region).
fly volume create scatter_data --size 3 --region iad

# 3. Secrets (NOT in fly.toml — these are encrypted at rest on Fly).
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly secrets set \
  ALLOWED_ORIGINS=https://scatter.tools \
  WEB_BASE_URL=https://scatter.tools
# Optional real email (otherwise magic links are logged to the app's stdout):
#   fly secrets set SMTP_HOST=... SMTP_USER=... SMTP_PASS=... \
#                   SMTP_FROM="Scatter <noreply@scatter.tools>"

# 4. Deploy (builds apps/coordinator/Dockerfile from the repo-root context).
fly deploy
```

Verify:

```bash
fly status                       # one machine, "started", check passing
curl https://scatter-coordinator.fly.dev/health
# -> {"ok":true,"version":"0.1.0","time":...}
```

### Point `api.scatter.tools` at Fly

```bash
fly certs add api.scatter.tools
fly certs show api.scatter.tools   # shows the DNS records to create
```

In **Cloudflare DNS** add the records Fly prints. **Set the `api` record to
"DNS only" (grey cloud), not proxied.** Reasons:

- The node agents hold long-lived WebSocket connections; Cloudflare's free
  proxy has a ~100s idle cap that would churn them.
- The coordinator relays whole shards (base64) through itself; keeping the
  subdomain unproxied avoids Cloudflare's request-size/buffering limits.

Fly terminates TLS itself, so `https://api.scatter.tools` / `wss://api.scatter.tools`
work directly. (You do **not** need the Caddy overlay when hosting on Fly —
`docker-compose.prod.yml` + `Caddyfile` are for self-hosting on a plain VPS.)

---

## 2. Web app → Vercel

The repo is a pnpm monorepo, so configure Vercel for the `apps/web` subdir.

In the Vercel dashboard → **New Project** → import the repo, then:

| Setting             | Value |
| ------------------- | ----- |
| Root Directory      | `apps/web` |
| Framework Preset    | Next.js |
| Install Command     | `pnpm install --frozen-lockfile` |
| Build Command       | `pnpm build` (default) |

Environment variables (Production):

```
NEXT_PUBLIC_API_URL = https://api.scatter.tools
NEXT_PUBLIC_WEB_URL = https://scatter.tools
```

> `NEXT_PUBLIC_*` are inlined into the client bundle at build time, so set them
> before the first build and redeploy if you change them.

Then add the domain in Vercel → **Domains** → `scatter.tools`, and create the
CNAME Vercel gives you in Cloudflare DNS. The apex/web record **can** stay
proxied (orange cloud) — it's plain HTTP(S), no WebSockets.

> Note: `apps/web/` currently has its own nested `pnpm-workspace.yaml` +
> `pnpm-lock.yaml`. If Vercel's install errors on `@scatter/protocol`
> (`workspace:*`), set the Root Directory to the repo root instead and use
> `pnpm --filter web build`, or remove the nested workspace files so the root
> workspace is authoritative.

---

## 3. Storage nodes → anywhere

Nodes are not "hosted" — they run on machines that donate storage and connect
out to the coordinator. On any always-on box:

```bash
pnpm --filter node build
node apps/node/dist/cli.js start --coordinator https://api.scatter.tools
```

Each node authenticates with a node token and reconnects automatically with
backoff. They need outbound `wss://` to `api.scatter.tools` — no inbound ports.

---

## 4. After deploy — checklist

- [ ] `curl https://api.scatter.tools/health` returns ok.
- [ ] Web app loads at `https://scatter.tools` and can reach the API (open
      devtools; no CORS errors — `ALLOWED_ORIGINS` must list the exact origin).
- [ ] At least one node shows up: `GET /nodes/stats` reports `activeNodes >= 1`.
- [ ] A full upload → download round-trip of a small file works.
- [ ] `fly secrets list` shows `JWT_SECRET` set (rotating it logs everyone out
      and disconnects nodes — see below).

---

## 5. Operational notes (read before real traffic)

- **Backups.** SQLite is in WAL mode on the Fly volume; don't copy the `.db`
  file directly. Snapshot with the Fly volume snapshots, or `fly ssh console`
  and run `sqlite3 /data/scatter.db ".backup '/data/backup.db'"` on a schedule.
- **Scaling is vertical only.** Never `fly scale count 2` — a second machine
  wouldn't share the in-memory node map or the SQLite file. To handle more
  load, increase machine memory/CPU in `fly.toml`'s `[[vm]]`.
- **Memory / the relay.** Every concurrent transfer buffers a shard (~5.5 MB
  base64 for a 4 MB shard) in RAM on the coordinator. If you see OOM under
  load, raise `memory` in `fly.toml` and/or lower the `http_service.concurrency`
  limits. This single-relay design is the main scaling ceiling until a direct
  node↔client transfer path exists.
- **JWT secret rotation** invalidates every session and node token at once.
  Plan it for a maintenance window; nodes will re-register on reconnect.
- **Secrets management.** All secrets live in `fly secrets` (encrypted), never
  in `fly.toml` or git.
