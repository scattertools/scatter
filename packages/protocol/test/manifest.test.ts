import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareUpload, reassemble } from '../src/manifest.ts';
import { PROTOCOL_VERSION } from '../src/types.ts';
import { parseLink } from '../src/links.ts';

function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const CHUNK = 65_536;
  for (let i = 0; i < size; i += CHUNK) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + CHUNK, size)));
  }
  return out;
}

function makeFile(bytes: Uint8Array, name = 'test.bin'): File {
  return new File([bytes], name, { type: 'application/octet-stream' });
}

test('prepareUpload -> reassemble round-trip (small file)', async () => {
  const data = randomBytes(500_000);
  const file = makeFile(data);
  const prep = await prepareUpload(file, 'https://scatter.tools');

  const blob = await reassemble(prep.manifest, prep.shards.slice(), prep.key);
  const recovered = new Uint8Array(await blob.arrayBuffer());
  assert.equal(recovered.length, data.length);
  assert.deepEqual(recovered, data);
});

test('prepareUpload -> reassemble round-trip (multi-chunk >4MB file)', async () => {
  const data = randomBytes(9 * 1024 * 1024);
  const file = makeFile(data, 'big.bin');
  const prep = await prepareUpload(file, 'https://scatter.tools');

  const blob = await reassemble(prep.manifest, prep.shards.slice(), prep.key);
  const recovered = new Uint8Array(await blob.arrayBuffer());
  assert.equal(recovered.length, data.length);
  assert.deepEqual(recovered, data);
});

test('prepareUpload sets manifest.version === PROTOCOL_VERSION (2) and a 26-char fileId', async () => {
  const data = randomBytes(10_000);
  const prep = await prepareUpload(makeFile(data), 'https://scatter.tools');
  assert.equal(prep.manifest.version, PROTOCOL_VERSION);
  assert.equal(prep.manifest.version, 2);
  assert.equal(prep.fileId.length, 26);
  assert.equal(prep.manifest.fileId, prep.fileId);
  // The link encodes the same fileId + key.
  const parsed = parseLink(prep.link);
  assert.equal(parsed.fileId, prep.fileId);
  assert.deepEqual(parsed.key.raw, prep.key.raw);
});

test('reassemble recovers after dropping 3 shards', async () => {
  const data = randomBytes(500_000);
  const prep = await prepareUpload(makeFile(data), 'https://scatter.tools');
  const received: (Uint8Array | null)[] = prep.shards.slice();
  received[0] = null;
  received[1] = null;
  received[2] = null;
  const blob = await reassemble(prep.manifest, received, prep.key);
  const recovered = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(recovered, data);
});

test('reassemble routes around a shard whose BYTES are tampered (decode-time hash verify)', async () => {
  const data = randomBytes(500_000);
  const prep = await prepareUpload(makeFile(data), 'https://scatter.tools');
  const received: (Uint8Array | null)[] = prep.shards.slice();

  // Corrupt the bytes of shard 5 (NOT the stored hash). reassemble recomputes
  // sha256Hex per non-null shard, finds the mismatch, nulls that slot, and RS
  // routes around it.
  const bad = new Uint8Array(received[5] as Uint8Array);
  bad[0] ^= 0xff;
  received[5] = bad;

  const blob = await reassemble(prep.manifest, received, prep.key);
  const recovered = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(recovered, data);
});

test('reassemble fails when too many shards are unrecoverable', async () => {
  const data = randomBytes(200_000);
  const prep = await prepareUpload(makeFile(data), 'https://scatter.tools');
  const received: (Uint8Array | null)[] = prep.shards.slice();
  // Null 5 shards (> parityShards of 4) -> cannot recover.
  for (let i = 0; i < 5; i++) received[i] = null;
  await assert.rejects(
    () => reassemble(prep.manifest, received, prep.key),
    /Not enough shards/,
  );
});
