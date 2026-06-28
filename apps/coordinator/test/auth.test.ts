import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// auth.ts -> env.ts validates process.env with zod at import time and requires
// JWT_SECRET (min 32 chars). Every other env var has a default. We set the
// required secret BEFORE importing auth.ts. Static imports hoist, so auth.ts is
// pulled in via a dynamic import AFTER process.env is populated.
//
// auth.ts also imports db.ts, which opens (and creates) a better-sqlite3 file
// at env.DATABASE_PATH relative to cwd. Point it at a throwaway temp file so we
// never touch the repo's ./data dir. The auth functions under test never read
// the DB, so an empty schema is fine.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-coord-')),
  'scatter.db',
);

const auth = await import('../src/auth.ts');

test('issueSession -> verifySession returns the same {sub,email}', async () => {
  const token = await auth.issueSession('user-123', 'alice@example.com');
  const payload = await auth.verifySession(token);
  assert.ok(payload);
  assert.equal(payload.sub, 'user-123');
  assert.equal(payload.email, 'alice@example.com');
});

test('verifySession returns null on a garbage token', async () => {
  assert.equal(await auth.verifySession('not.a.jwt'), null);
  assert.equal(await auth.verifySession(''), null);
});

test('verifySession returns null on a tampered token', async () => {
  const token = await auth.issueSession('user-123', 'alice@example.com');
  // Flip the FIRST character of the payload section. (Tampering the final
  // character of a section is unreliable: base64url's last char carries
  // padding bits that are discarded on decode, so some flips decode to the
  // same bytes. The first char has no such padding.)
  const parts = token.split('.');
  parts[1] = (parts[1][0] === 'e' ? 'f' : 'e') + parts[1].slice(1);
  assert.equal(await auth.verifySession(parts.join('.')), null);
});

test('issueNodeToken -> verifyNodeToken returns {nodeId}', async () => {
  const token = await auth.issueNodeToken('node-abc');
  const claims = await auth.verifyNodeToken(token);
  assert.ok(claims);
  assert.equal(claims.nodeId, 'node-abc');
});

test('cross-kind: a session token passed to verifyNodeToken returns null', async () => {
  const sessionToken = await auth.issueSession('user-1', 'a@b.com');
  assert.equal(await auth.verifyNodeToken(sessionToken), null);
});

test('cross-kind: a node token passed to verifySession does not yield a node', async () => {
  // verifySession does not check `kind`, but a node token has no `sub`/`email`,
  // so the returned payload must NOT carry a real session identity.
  const nodeToken = await auth.issueNodeToken('node-xyz');
  const payload = await auth.verifySession(nodeToken);
  // The signature is valid (same secret) so it parses, but there is no subject.
  assert.equal(payload?.sub, undefined);
  assert.equal(payload?.email, undefined);
});

test('issueShardToken -> verifyShardToken round-trips claims', async () => {
  const claims = {
    fileId: 'FILEID',
    shardIndex: 7,
    nodeId: 'node-q',
    maxSize: 4 * 1024 * 1024,
  };
  const token = await auth.issueShardToken(claims);
  const verified = await auth.verifyShardToken(token);
  assert.ok(verified);
  assert.equal(verified.fileId, claims.fileId);
  assert.equal(verified.shardIndex, claims.shardIndex);
  assert.equal(verified.nodeId, claims.nodeId);
  assert.equal(verified.maxSize, claims.maxSize);
});

test('cross-kind: a session token passed to verifyShardToken returns null', async () => {
  const sessionToken = await auth.issueSession('user-1', 'a@b.com');
  assert.equal(await auth.verifyShardToken(sessionToken), null);
});

test('cross-kind: a node token passed to verifyShardToken returns null', async () => {
  const nodeToken = await auth.issueNodeToken('node-1');
  assert.equal(await auth.verifyShardToken(nodeToken), null);
});

test('cross-kind: a shard token passed to verifyNodeToken returns null', async () => {
  const shardToken = await auth.issueShardToken({
    fileId: 'F',
    shardIndex: 0,
    nodeId: 'n',
    maxSize: 1,
  });
  assert.equal(await auth.verifyNodeToken(shardToken), null);
});

test('verifyShardToken / verifyNodeToken return null on garbage', async () => {
  assert.equal(await auth.verifyShardToken('garbage'), null);
  assert.equal(await auth.verifyNodeToken('garbage'), null);
});
