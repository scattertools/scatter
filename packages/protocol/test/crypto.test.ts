import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKey,
  keyFromBase64Url,
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

async function roundTrip(bytes: Uint8Array): Promise<Uint8Array> {
  const key = await generateKey();
  const salt = freshSalt();
  const encrypted = await encryptStream(new Blob([bytes]), key, salt);
  const decrypted = await decryptStream(encrypted, key, salt);
  return new Uint8Array(await decrypted.arrayBuffer());
}

test('round-trip empty file (0 bytes)', async () => {
  const data = new Uint8Array(0);
  const recovered = await roundTrip(data);
  assert.equal(recovered.length, 0);
});

test('round-trip small file (single chunk, <4MB)', async () => {
  const data = randomBytes(1_000_000);
  const recovered = await roundTrip(data);
  assert.equal(recovered.length, data.length);
  assert.deepEqual(recovered, data);
});

test('round-trip multi-chunk file (>4MB, spans 3 chunks)', async () => {
  // ~9MB => CHUNK_SIZE is 4MB, so 3 chunks (4 + 4 + 1).
  const data = randomBytes(9 * 1024 * 1024);
  const recovered = await roundTrip(data);
  assert.equal(recovered.length, data.length);
  assert.deepEqual(recovered, data);
});

test('round-trip file exactly at chunk boundary (8MB)', async () => {
  const data = randomBytes(8 * 1024 * 1024);
  const recovered = await roundTrip(data);
  assert.equal(recovered.length, data.length);
  assert.deepEqual(recovered, data);
});

test('tamper detection: flipping a ciphertext byte rejects', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  const data = randomBytes(50_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  // Flip a byte well inside the ciphertext body (past the 4-byte header + 12
  // byte IV of the first chunk).
  bytes[40] ^= 0xff;
  const tampered = new Blob([bytes]);

  await assert.rejects(() => decryptStream(tampered, key, salt));
});

test('wrong key fails to decrypt', async () => {
  const key = await generateKey();
  const wrongKey = await generateKey();
  const salt = freshSalt();
  const data = randomBytes(50_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);

  await assert.rejects(() => decryptStream(encrypted, wrongKey, salt));
});

test('wrong salt fails to decrypt', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  const wrongSalt = freshSalt();
  const data = randomBytes(50_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);

  await assert.rejects(() => decryptStream(encrypted, key, wrongSalt));
});

test('truncated ciphertext (drop trailing bytes) throws', async () => {
  const key = await generateKey();
  const salt = freshSalt();
  const data = randomBytes(50_000);
  const encrypted = await encryptStream(new Blob([data]), key, salt);
  const bytes = new Uint8Array(await encrypted.arrayBuffer());

  // Drop the last 16 bytes (part of the GCM tag / ciphertext). The framed
  // length header now over-runs the available bytes -> "Corrupt ciphertext"
  // or GCM auth failure.
  const truncated = new Blob([bytes.subarray(0, bytes.length - 16)]);
  await assert.rejects(() => decryptStream(truncated, key, salt));
});

test('keyFromBase64Url accepts a valid 32-byte key', async () => {
  const key = await generateKey();
  const reparsed = keyFromBase64Url(key.base64Url);
  assert.deepEqual(reparsed.raw, key.raw);
  assert.equal(reparsed.base64Url, key.base64Url);
});

test('keyFromBase64Url rejects wrong-length input', () => {
  // 16 bytes encoded -> too short.
  const short = base64UrlEncode(new Uint8Array(16));
  assert.throws(() => keyFromBase64Url(short), /Invalid key length/);
  // 64 bytes -> too long.
  const long = base64UrlEncode(new Uint8Array(64));
  assert.throws(() => keyFromBase64Url(long), /Invalid key length/);
});

test('base64Url round-trips arbitrary bytes (incl. +,/,= producers)', () => {
  // Bytes 0xfb 0xff 0xbf produce +, / and padding in standard base64.
  const samples: Uint8Array[] = [
    new Uint8Array(0),
    new Uint8Array([0]),
    new Uint8Array([0xfb, 0xff, 0xbf]),
    new Uint8Array([255, 254, 253, 252, 251]),
    randomBytes(1000),
  ];
  for (const s of samples) {
    const encoded = base64UrlEncode(s);
    // URL-safe: never contains +, /, or =.
    assert.equal(/[+/=]/.test(encoded), false, `encoded has unsafe chars: ${encoded}`);
    const decoded = base64UrlDecode(encoded);
    assert.deepEqual(decoded, s);
  }
});

test('sha256Hex matches a known vector', async () => {
  // SHA-256 of empty input.
  const hex = await sha256Hex(new Uint8Array(0));
  assert.equal(
    hex,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});
