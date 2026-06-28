import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeShards, decodeShards, hashShards } from '../src/sharding.ts';
import { DEFAULT_SHARD_CONFIG, type ShardConfig } from '../src/types.ts';

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const CHUNK = 65_536;
  for (let i = 0; i < size; i += CHUNK) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + CHUNK, size)));
  }
  return out;
}

const cfg: ShardConfig = DEFAULT_SHARD_CONFIG; // 10 data + 4 parity

test('empty data: encodes to zero-length shards and decodes back to empty', () => {
  const data = new Uint8Array(0);
  const shards = encodeShards(data, cfg);
  assert.equal(shards.length, cfg.dataShards + cfg.parityShards);
  for (const s of shards) assert.equal(s.length, 0);
  const recovered = decodeShards(shards, cfg, 0);
  assert.equal(recovered.length, 0);
});

test('single byte: round-trips and recovers after dropping parity-count shards', () => {
  const data = new Uint8Array([0xab]);
  const shards = encodeShards(data, cfg);
  // Each shard is ceil(1/10) = 1 byte.
  for (const s of shards) assert.equal(s.length, 1);

  const received: (Uint8Array | null)[] = shards.slice();
  // Drop the maximum recoverable count (parityShards = 4), mixing data+parity.
  received[1] = null;
  received[2] = null;
  received[11] = null;
  received[12] = null;
  const recovered = decodeShards(received, cfg, 1);
  assert.deepEqual(recovered, data);
});

test('forced matrix inversion: keep ONLY parity + minimal data shards', () => {
  // Drop enough data shards that recovery MUST use parity rows, exercising the
  // invertMatrix() path rather than the all-data quick path.
  const size = 33_333;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const received: (Uint8Array | null)[] = shards.slice();
  // Drop 4 data shards (0..3); the 4 parity shards (10..13) must fill in.
  received[0] = null;
  received[1] = null;
  received[2] = null;
  received[3] = null;
  const recovered = decodeShards(received, cfg, size);
  assert.deepEqual(recovered, data);
});

test('recovery using a non-contiguous mix of survivors', () => {
  const size = 50_000;
  const data = randomBytes(size);
  const shards = encodeShards(data, cfg);
  const received: (Uint8Array | null)[] = shards.slice();
  // Drop an interleaved set: data 2,5,7 and parity 11.
  received[2] = null;
  received[5] = null;
  received[7] = null;
  received[11] = null;
  const recovered = decodeShards(received, cfg, size);
  assert.deepEqual(recovered, data);
});

test('single data shard config (1 data + 1 parity) mirrors the input', () => {
  const oneEach: ShardConfig = { dataShards: 1, parityShards: 1, shardSize: 64 };
  const size = 40;
  const data = randomBytes(size);
  const shards = encodeShards(data, oneEach);
  assert.equal(shards.length, 2);
  // With a single data shard the parity row is just a copy of the data shard.
  assert.deepEqual(shards[1], shards[0]);

  // Recover from ONLY the parity shard (data shard lost).
  const recovered = decodeShards([null, shards[1]], oneEach, size);
  assert.deepEqual(recovered, data);
});

test('hashShards marks exactly the parity shards as isParity', async () => {
  const data = randomBytes(2048);
  const shards = encodeShards(data, cfg);
  const infos = await hashShards(shards, cfg.dataShards);
  const parityCount = infos.filter((i) => i.isParity).length;
  assert.equal(parityCount, cfg.parityShards);
  // The first dataShards entries must NOT be parity.
  for (let i = 0; i < cfg.dataShards; i++) assert.equal(infos[i].isParity, false);
});
