import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Companion to assign.test.ts. node:test runs each test FILE in its own
// process, so here we leave ALLOW_SHARD_STACKING at its default (false) to
// cover the production redundancy guard that refuses to stack shards.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
delete process.env.ALLOW_SHARD_STACKING;
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-assign-nostack-')),
  'scatter.db',
);

const { db } = await import('../src/db.ts');
const { pickNodesForShards } = await import('../src/assign.ts');

const MB = 1024 * 1024;

function seedNode(id: string, capacity: number) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO nodes
       (id, owner_user_id, capacity_bytes, used_bytes, version, last_seen_at, registered_at, total_uptime_sec)
     VALUES (?, NULL, ?, 0, '1.0.0', ?, ?, 0)`,
  ).run(id, capacity, now, now);
}

beforeEach(() => {
  db.prepare(`DELETE FROM nodes`).run();
});

test('without stacking: fewer distinct nodes than shards throws "Not enough nodes online"', () => {
  seedNode('only-a', 100 * MB);
  seedNode('only-b', 100 * MB);
  assert.throws(
    () => pickNodesForShards(1 * MB, 5),
    /Not enough nodes online: need 5, have 2/,
  );
});

test('without stacking: exactly enough distinct nodes still succeeds', () => {
  for (let i = 0; i < 4; i++) seedNode(`d-${i}`, 100 * MB);
  const picked = pickNodesForShards(1 * MB, 4);
  assert.equal(picked.length, 4);
  assert.equal(new Set(picked).size, 4);
});
