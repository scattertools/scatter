import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKey,
  encryptStream,
  decryptStream,
  sha256Hex,
  base64UrlEncode,
  base64UrlDecode,
} from '../src/crypto.ts';

// Fill a buffer with random bytes in <=64KB slices (getRandomValues caps at
// 65536 bytes per call).
function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  const CHUNK = 65_536;
  for (let i = 0; i < size; i += CHUNK) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + CHUNK, size)));
  }
  return out;
}

function freshSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

// Split a framed ciphertext blob into its individual chunk frames.
// Frame layout: [4-byte BE ct length][12-byte IV][ciphertext+tag].
function splitChunks(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const ctLen = new DataView(
      bytes.buffer,
      bytes.byteOffset + offset,
      4,
    ).getUint32(0, false);
    const frameLen = 4 + 12 + ctLen;
    frames.push(bytes.subarray(offset, offset + frameLen));
    offset += frameLen;
  }
  return frames;
}

test('multi-chunk: tamper inside a LATER chunk is detected', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  // ~9MB => 3 chunks (4 + 4 + 1).
  const data = randomBytes(9 * 1024 * 1024);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  const frames = splitChunks(bytes);
  assert.equal(frames.length, 3, 'expected 3 chunk frames for ~9MB');

  // Flip a byte deep inside the SECOND chunk's ciphertext body. Locate the
  // start of chunk 2 in the flat buffer, then skip its 4+12 header bytes.
  const chunk2Start = frames[0].length;
  bytes[chunk2Start + 4 + 12 + 5] ^= 0xff;

  await assert.rejects(() => decryptStream(new Blob([bytes]), key, salt));
});

test('chunk reorder is rejected (AAD binds the chunk index)', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  // Two full chunks so swapping them is meaningful (8MB => exactly 2 chunks).
  const data = randomBytes(8 * 1024 * 1024);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  const frames = splitChunks(bytes);
  assert.equal(frames.length, 2, 'expected 2 chunk frames for 8MB');

  // Reassemble with the two chunks swapped. Each frame is self-describing
  // (length header), so the blob still parses but the GCM AAD (chunk index)
  // no longer matches -> auth failure.
  const reordered = new Blob([frames[1], frames[0]]);
  await assert.rejects(() => decryptStream(reordered, key, salt));
});

test('corrupt length header (claims more bytes than exist) throws truncated', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  const data = randomBytes(10_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  // Inflate the 4-byte BE length header so the declared chunk over-runs the
  // available bytes.
  new DataView(bytes.buffer, bytes.byteOffset, 4).setUint32(0, 0xffffff, false);

  await assert.rejects(
    () => decryptStream(new Blob([bytes]), key, salt),
    /Corrupt ciphertext: truncated chunk/,
  );
});

test('dangling partial header (< 4 trailing bytes) throws missing header', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  const data = randomBytes(10_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  // Append 2 stray bytes: a full chunk is consumed, then 2 bytes remain which
  // is fewer than the 4-byte header the parser needs.
  const trailing = new Uint8Array(bytes.length + 2);
  trailing.set(bytes);
  trailing[bytes.length] = 0x00;
  trailing[bytes.length + 1] = 0x01;

  await assert.rejects(
    () => decryptStream(new Blob([trailing]), key, salt),
    /Corrupt ciphertext: missing length header/,
  );
});

test('sha256Hex matches a known non-empty vector ("abc")', async () => {
  // SHA-256("abc") per FIPS 180-4.
  const abc = new Uint8Array([0x61, 0x62, 0x63]);
  const hex = await sha256Hex(abc);
  assert.equal(
    hex,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('sha256Hex output is always 64 lowercase hex chars', async () => {
  for (const size of [1, 32, 1000]) {
    const hex = await sha256Hex(randomBytes(size));
    assert.match(hex, /^[0-9a-f]{64}$/);
  }
});

test('base64UrlDecode tolerates input with no padding regardless of length', () => {
  // Encode lengths whose base64 would normally need 0, 1 or 2 '=' pads.
  for (const len of [1, 2, 3, 4, 5]) {
    const original = randomBytes(len);
    const encoded = base64UrlEncode(original);
    assert.equal(/[=]/.test(encoded), false);
    assert.deepEqual(base64UrlDecode(encoded), original);
  }
});
