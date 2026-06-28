import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeShards, decodeShards, hashShards } from '../src/sharding.ts';
import { DEFAULT_SHARD_CONFIG, type ShardConfig } from '../src/types.ts';
import { sha256Hex } from '../src/crypto.ts';

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const CHUNK = 65_536;
  for (let i = 0; i < size; i += CHUNK) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + CHUNK, size)));
  }
  return out;
}

const cfg: ShardConfig = DEFAULT_SHARD_CONFIG; // 10 data + 4 parity = 14 total

test('encode produces dataShards + parityShards shards', () => {
  const data = randomBytes(12_345);
  const shards = encodeShards(data, cfg);
  assert.equal(shards.length, cfg.dataShards + cfg.parityShards);
  // All shards equal length.
  const len = shards[0].length;
  for (const s of shards) assert.equal(s.length, len);
});

test('encode -> decode happy path recovers original exactly', () => {
  // Use a non-multiple-of-dataShards length to exercise padding/trim.
  const size = 12_345; // not divisible by 10
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const recovered = decodeShards(shards, cfg, size);
  assert.equal(recovered.length, size);
  assert.deepEqual(recovered, data);
});

test('parity recovery: drop 4 shards including a data shard', () => {
  const size = 9_999;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const received: (Uint8Array | null)[] = shards.slice();
  // Drop 4 total: data shards 0 and 3, parity shards 10 and 13.
  received[0] = null;
  received[3] = null;
  received[10] = null;
  received[13] = null;
  const recovered = decodeShards(received, cfg, size);
  assert.deepEqual(recovered, data);
});

test('parity recovery: a different drop combination of 4 shards', () => {
  const size = 20_001;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const received: (Uint8Array | null)[] = shards.slice();
  // Drop 4 data shards (0,1,2,3) -> needs all 4 parity to recover.
  received[0] = null;
  received[1] = null;
  received[2] = null;
  received[3] = null;
  const recovered = decodeShards(received, cfg, size);
  assert.deepEqual(recovered, data);
});

test('dropping parityShards+1 (5) shards throws "Not enough shards"', () => {
  const size = 9_999;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const received: (Uint8Array | null)[] = shards.slice();
  received[0] = null;
  received[1] = null;
  received[2] = null;
  received[3] = null;
  received[4] = null;
  assert.throws(() => decodeShards(received, cfg, size), /Not enough shards/);
});

test('decodeShards with wrong slot count throws', () => {
  const size = 5000;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  // Give one fewer slot than totalShards.
  const wrongCount = shards.slice(0, cfg.dataShards + cfg.parityShards - 1);
  assert.throws(
    () => decodeShards(wrongCount, cfg, size),
    /Expected 14 slots/,
  );
});

test('hashShards returns correct ShardInfo entries', async () => {
  const data = randomBytes(3210);
  const shards = encodeShards(data, cfg);
  const infos = await hashShards(shards, cfg.dataShards);
  assert.equal(infos.length, shards.length);
  for (let i = 0; i < shards.length; i++) {
    assert.equal(infos[i].index, i);
    assert.equal(infos[i].isParity, i >= cfg.dataShards);
    assert.equal(infos[i].size, shards[i].length);
    assert.equal(infos[i].hash, await sha256Hex(shards[i]));
  }
});

test('round-trip with a custom small shard config', () => {
  const small: ShardConfig = { dataShards: 3, parityShards: 2, shardSize: 1024 };
  const size = 1000;
  const data = randomBytes(size);
  const shards = encodeShards(data, small);
  assert.equal(shards.length, 5);
  const received: (Uint8Array | null)[] = shards.slice();
  received[0] = null; // drop a data shard
  received[4] = null; // drop a parity shard
  const recovered = decodeShards(received, small, size);
  assert.deepEqual(recovered, data);
});
