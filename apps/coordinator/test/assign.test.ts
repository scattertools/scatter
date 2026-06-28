import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// env must be set before db.ts/env.ts import. We enable ALLOW_SHARD_STACKING
// so this single process can exercise BOTH the distinct-node path and the
// stacking fallback (round-robin + total-capacity check). env is parsed once
// at import, so the disabled-stacking throw lives in a sibling test file's
// process if needed; here every assertion is valid with stacking ON.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.ALLOW_SHARD_STACKING = 'true';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-assign-')),
  'scatter.db',
);

const { db } = await import('../src/db.ts');
const { pickNodesForShards } = await import('../src/assign.ts');

const MB = 1024 * 1024;

interface SeedNode {
  id: string;
  capacity: number;
  used?: number;
  /** seconds in the past for last_seen_at; default fresh (0). */
  lastSeenAgoSec?: number;
}

function seedNode(n: SeedNode) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO nodes
       (id, owner_user_id, capacity_bytes, used_bytes, version, last_seen_at, registered_at, total_uptime_sec)
     VALUES (?, NULL, ?, ?, '1.0.0', ?, ?, 0)`,
  ).run(
    n.id,
    n.capacity,
    n.used ?? 0,
    now - (n.lastSeenAgoSec ?? 0) * 1000,
    now,
  );
}

beforeEach(() => {
  db.prepare(`DELETE FROM nodes`).run();
});

test('throws "No nodes online" when there are no candidates at all', () => {
  assert.throws(() => pickNodesForShards(1 * MB, 3), /No nodes online/);
});

test('stale nodes (outside the 2-minute online window) are ignored', () => {
  seedNode({ id: 'stale', capacity: 100 * MB, lastSeenAgoSec: 5 * 60 });
  assert.throws(() => pickNodesForShards(1 * MB, 1), /No nodes online/);
});

test('nodes without enough free space for the shard are excluded', () => {
  // free = capacity - used = 1MB, but the shard needs 4MB.
  seedNode({ id: 'tight', capacity: 5 * MB, used: 4 * MB });
  assert.throws(() => pickNodesForShards(4 * MB, 1), /No nodes online/);
});

test('returns the requested count of DISTINCT nodes when enough are online', () => {
  for (let i = 0; i < 5; i++) seedNode({ id: `node-${i}`, capacity: 100 * MB });
  const picked = pickNodesForShards(1 * MB, 3);
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked).size, 3, 'all picked nodes are distinct');
  for (const id of picked) assert.match(id, /^node-\d$/);
});

test('stacking fallback: reuses nodes via round-robin when distinct nodes are too few', () => {
  // Only 2 nodes online but 5 shards requested; each has ample capacity.
  seedNode({ id: 'a', capacity: 100 * MB });
  seedNode({ id: 'b', capacity: 100 * MB });
  const picked = pickNodesForShards(1 * MB, 5);
  assert.equal(picked.length, 5);
  // Every assignment is one of the two real nodes.
  for (const id of picked) assert.ok(id === 'a' || id === 'b');
  // Both nodes are actually used (round-robin spreads load).
  assert.equal(new Set(picked).size, 2);
});

test('stacking fallback throws when total free capacity is insufficient', () => {
  // One node, 3MB free, asked for 2 shards x 2MB = 4MB total.
  seedNode({ id: 'small', capacity: 3 * MB });
  assert.throws(
    () => pickNodesForShards(2 * MB, 2),
    /Not enough total capacity/,
  );
});

test('exactly enough distinct nodes returns each exactly once', () => {
  for (let i = 0; i < 3; i++) seedNode({ id: `exact-${i}`, capacity: 50 * MB });
  const picked = pickNodesForShards(1 * MB, 3);
  assert.equal(picked.length, 3);
  assert.deepEqual([...picked].sort(), ['exact-0', 'exact-1', 'exact-2']);
});
