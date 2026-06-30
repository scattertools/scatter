import { db } from './db.ts';
import { env } from './env.ts';

interface Candidate {
  id: string;
  free_bytes: number;
  last_seen_at: number;
}

const ONLINE_WINDOW_MS = 2 * 60_000;

/**
 * Pick `count` nodeIds to host shards. Prefers distinct nodes for redundancy,
 * falling back to reuse when ALLOW_SHARD_STACKING is set (dev).
 */
export function pickNodesForShards(shardSize: number, count: number): string[] {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;

  const candidates = db
    .prepare<[number, number], Candidate>(
      `SELECT id, (capacity_bytes - used_bytes) AS free_bytes, last_seen_at
       FROM nodes
       WHERE last_seen_at > ? AND (capacity_bytes - used_bytes) >= ?
       ORDER BY free_bytes DESC
       LIMIT 500`,
    )
    .all(cutoff, shardSize);

  if (candidates.length === 0) {
    throw new Error('No nodes online');
  }

  if (candidates.length >= count) {
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map((c) => c.id);
  }

  if (!env.ALLOW_SHARD_STACKING) {
    throw new Error(
      `Not enough nodes online: need ${count}, have ${candidates.length}. ` +
        `Set ALLOW_SHARD_STACKING=true in .env for development.`,
    );
  }

  const totalFree = candidates.reduce((sum, c) => sum + c.free_bytes, 0);
  const totalNeeded = shardSize * count;
  if (totalFree < totalNeeded) {
    throw new Error(
      `Not enough total capacity: need ${totalNeeded} bytes, have ${totalFree} bytes`,
    );
  }

  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(candidates[i % candidates.length].id);
  }
  return out;
}
