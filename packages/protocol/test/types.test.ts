import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTOCOL_VERSION,
  DEFAULT_SHARD_CONFIG,
  type ShardConfig,
} from '../src/types.ts';

test('PROTOCOL_VERSION is the current v2', () => {
  assert.equal(PROTOCOL_VERSION, 2);
});

test('DEFAULT_SHARD_CONFIG is a valid 10+4 / 4MB configuration', () => {
  const c: ShardConfig = DEFAULT_SHARD_CONFIG;
  assert.equal(c.dataShards, 10);
  assert.equal(c.parityShards, 4);
  assert.equal(c.shardSize, 4 * 1024 * 1024);
});

test('DEFAULT_SHARD_CONFIG invariants hold', () => {
  const c = DEFAULT_SHARD_CONFIG;
  assert.ok(c.dataShards > 0, 'must have at least one data shard');
  assert.ok(c.parityShards >= 0, 'parity count cannot be negative');
  // Total shards must stay within a single GF(256) coding group (<= 255 rows).
  assert.ok(c.dataShards + c.parityShards <= 255);
  assert.ok(Number.isInteger(c.shardSize) && c.shardSize > 0);
});
