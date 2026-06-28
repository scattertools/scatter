import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// env must be set before db.ts/env.ts/auth.ts import. Stacking ON so a single
// online node can back all 14 shards of a manifest in this one process.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.ALLOW_SHARD_STACKING = 'true';
process.env.INITIAL_CREDITS ??= '100';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-files-')),
  'scatter.db',
);

const Fastify = (await import('fastify')).default;
const { db } = await import('../src/db.ts');
const { fileRoutes } = await import('../src/routes/files.ts');
const { issueSession, verifySession } = await import('../src/auth.ts');

const MB = 1024 * 1024;

/**
 * Build a minimal Fastify app wired exactly like src/index.ts for the bits the
 * file routes depend on: the Bearer -> req.user onRequest hook and the
 * requireAuth decorator. No network — exercised via app.inject().
 */
async function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const user = await verifySession(auth.slice(7));
      if (user) (req as { user?: unknown }).user = user;
    }
  });
  app.decorate('requireAuth', async (req: any, reply: any) => {
    if (!req.user) reply.code(401).send({ error: 'authentication required' });
  });
  await app.register(fileRoutes);
  await app.ready();
  return app;
}

function seedNode(id: string, capacity = 1024 * MB) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO nodes
       (id, owner_user_id, capacity_bytes, used_bytes, version, last_seen_at, registered_at, total_uptime_sec)
     VALUES (?, NULL, ?, 0, '1.0.0', ?, ?, 0)`,
  ).run(id, capacity, now, now);
}

function seedUser(id: string, credits: number) {
  db.prepare(
    `INSERT INTO users (id, email, username, credits, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, `${id}@example.com`, id, credits, Date.now());
}

/** Build a valid manifest with `shardCount` shards of `shardSize` bytes each. */
function makeManifest(opts: {
  fileId: string;
  encryptedSize: number;
  fileSize?: number;
  shardCount?: number;
  shardSize?: number;
}) {
  const shardCount = opts.shardCount ?? 14;
  const shardSize = opts.shardSize ?? 1 * MB;
  return {
    version: 2,
    fileId: opts.fileId,
    fileName: 'enc-name',
    fileSize: opts.fileSize ?? opts.encryptedSize,
    encryptedSize: opts.encryptedSize,
    mimeType: 'application/octet-stream',
    createdAt: Date.now(),
    encryption: { algorithm: 'AES-256-GCM', ivLength: 12, salt: 'c2FsdA==' },
    sharding: { dataShards: 10, parityShards: 4, shardSize },
    shards: Array.from({ length: shardCount }, (_, i) => ({
      index: i,
      isParity: i >= 10,
      size: shardSize,
      hash: `hash-${i}`,
    })),
  };
}

let app: Awaited<ReturnType<typeof buildApp>>;
before(async () => {
  app = await buildApp();
});

beforeEach(() => {
  // FK-safe order. credit_events/shards reference users/files.
  db.prepare(`DELETE FROM credit_events`).run();
  db.prepare(`DELETE FROM shards`).run();
  db.prepare(`DELETE FROM files`).run();
  db.prepare(`DELETE FROM nodes`).run();
  db.prepare(`DELETE FROM users`).run();
});

test('anonymous upload plan is free and stores the file with a 24h expiry', async () => {
  seedNode('n1');
  const manifest = makeManifest({ fileId: 'f-anon', encryptedSize: 3 * MB });

  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    payload: manifest,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.fileId, 'f-anon');
  assert.equal(body.assignments.length, 14);
  // Anonymous responses omit credit fields.
  assert.equal(body.creditsCost, undefined);

  const file = db
    .prepare(`SELECT owner_user_id, expires_at FROM files WHERE id = ?`)
    .get('f-anon') as { owner_user_id: string | null; expires_at: number };
  assert.equal(file.owner_user_id, null);
  assert.ok(file.expires_at > Date.now(), 'anonymous file has a future expiry');
});

test('logged-in upload charges ceil(encryptedSize/MB) credits atomically', async () => {
  seedNode('n1');
  seedUser('u1', 100);
  const token = await issueSession('u1', 'u1@example.com');

  // 5MB + 1 byte -> ceil = 6 credits.
  const manifest = makeManifest({ fileId: 'f1', encryptedSize: 5 * MB + 1 });
  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    headers: { authorization: `Bearer ${token}` },
    payload: manifest,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.creditsCost, 6);
  assert.equal(body.creditsRemaining, 94);

  // Balance actually debited.
  const user = db
    .prepare(`SELECT credits FROM users WHERE id = ?`)
    .get('u1') as { credits: number };
  assert.equal(user.credits, 94);

  // A matching credit_event ledger row was written in the same tx.
  const event = db
    .prepare(
      `SELECT delta, reason, ref_id FROM credit_events WHERE user_id = ?`,
    )
    .get('u1') as { delta: number; reason: string; ref_id: string };
  assert.equal(event.delta, -6);
  assert.equal(event.reason, 'upload');
  assert.equal(event.ref_id, 'f1');

  // The file + all shards persisted.
  const shardCount = db
    .prepare(`SELECT COUNT(*) AS c FROM shards WHERE file_id = ?`)
    .get('f1') as { c: number };
  assert.equal(shardCount.c, 14);
});

test('insufficient credits returns 402 and charges nothing (no partial writes)', async () => {
  seedNode('n1');
  seedUser('poor', 2);
  const token = await issueSession('poor', 'poor@example.com');

  // Needs 6 credits, has 2.
  const manifest = makeManifest({ fileId: 'f-deny', encryptedSize: 6 * MB });
  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    headers: { authorization: `Bearer ${token}` },
    payload: manifest,
  });

  assert.equal(res.statusCode, 402);
  assert.match(res.json().error, /Insufficient credits/);

  // Nothing was written: balance untouched, no file, no shards, no ledger.
  const user = db
    .prepare(`SELECT credits FROM users WHERE id = ?`)
    .get('poor') as { credits: number };
  assert.equal(user.credits, 2);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM files`).get() as { c: number }).c,
    0,
  );
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM credit_events`).get() as { c: number })
      .c,
    0,
  );
});

test('minimum charge is 1 credit even for a tiny file', async () => {
  seedNode('n1');
  seedUser('u2', 100);
  const token = await issueSession('u2', 'u2@example.com');

  const manifest = makeManifest({ fileId: 'f-tiny', encryptedSize: 1 });
  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    headers: { authorization: `Bearer ${token}` },
    payload: manifest,
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().creditsCost, 1);
});

test('file too large for an anonymous uploader is rejected with 413', async () => {
  seedNode('n1');
  const tooBig = Number(process.env.ANONYMOUS_MAX_FILE_BYTES ?? 100 * MB) + 1;
  const manifest = makeManifest({
    fileId: 'f-big',
    encryptedSize: 1 * MB,
    fileSize: tooBig,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    payload: manifest,
  });

  assert.equal(res.statusCode, 413);
  assert.match(res.json().error, /too large/i);
});

test('duplicate fileId is rejected with 409', async () => {
  seedNode('n1');
  const manifest = makeManifest({ fileId: 'dup', encryptedSize: 1 * MB });
  const first = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    payload: manifest,
  });
  assert.equal(first.statusCode, 200);

  const second = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    payload: manifest,
  });
  assert.equal(second.statusCode, 409);
});

test('no online nodes yields 503 and the upload is not persisted', async () => {
  // No seedNode call -> assignment fails.
  seedUser('u3', 100);
  const token = await issueSession('u3', 'u3@example.com');
  const manifest = makeManifest({ fileId: 'f-503', encryptedSize: 1 * MB });

  const res = await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    headers: { authorization: `Bearer ${token}` },
    payload: manifest,
  });

  assert.equal(res.statusCode, 503);
  // Credits were checked but not charged because assignment threw before the tx.
  const user = db
    .prepare(`SELECT credits FROM users WHERE id = ?`)
    .get('u3') as { credits: number };
  assert.equal(user.credits, 100);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS c FROM files`).get() as { c: number }).c,
    0,
  );
});

test('download plan returns the manifest and shard locations', async () => {
  seedNode('n1');
  const manifest = makeManifest({ fileId: 'f-dl', encryptedSize: 2 * MB });
  await app.inject({
    method: 'POST',
    url: '/files/upload/plan',
    payload: manifest,
  });

  const res = await app.inject({ method: 'GET', url: '/files/f-dl/plan' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.manifest.fileId, 'f-dl');
  assert.equal(body.locations.length, 14);
  assert.equal(body.locations[0].shardIndex, 0);
});

test('download plan for an unknown file is 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/files/nope/plan' });
  assert.equal(res.statusCode, 404);
});
