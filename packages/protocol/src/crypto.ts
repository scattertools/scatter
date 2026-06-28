/**
 * Scatter crypto layer.
 * - AES-256-GCM encryption
 * - Key is random 256 bits, shared via URL fragment (never hits server)
 * - The AES-GCM key is DERIVED from key.raw + a per-file salt via HKDF-SHA-256
 *   (protocol v2). Decrypt reproduces the same key from key.raw + salt only.
 * - TRUE streaming: encrypt/decrypt read the source Blob slice-by-slice so the
 *   whole plaintext + whole ciphertext are never both held in JS memory.
 */

const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks

// HKDF info label binding the derived key to this protocol/version.
const HKDF_INFO = new TextEncoder().encode('scatter-file-key-v2');

// TS 5.7+ types `new Uint8Array(...)` / WebCrypto outputs as
// `Uint8Array<ArrayBufferLike>`, which is not assignable to the
// `ArrayBuffer`-backed `BufferSource`/`BlobPart` that WebCrypto + Blob expect.
// In every runtime we target the backing store IS a plain ArrayBuffer, so this
// narrowing cast is safe and keeps the boundary code readable.
function ab(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

/**
 * Per-chunk Additional Authenticated Data (AAD).
 * Format: 8-byte big-endian chunk index (counter starting at 0).
 * Binding the index into GCM means chunks cannot be silently reordered,
 * duplicated, or truncated — decrypt re-derives the same AAD from its running
 * chunk counter and GCM authentication fails on any mismatch.
 */
function chunkAad(index: number): Uint8Array<ArrayBuffer> {
  const aad = new Uint8Array(8);
  // Big-endian 64-bit counter via two 32-bit halves (index stays well within
  // Number-safe range for any realistic file size).
  const view = new DataView(aad.buffer);
  view.setUint32(0, Math.floor(index / 0x100000000), false);
  view.setUint32(4, index >>> 0, false);
  return ab(aad);
}

export interface EncryptionKey {
  raw: Uint8Array; // 32 bytes
  base64Url: string; // URL-safe for link fragments
}

export async function generateKey(): Promise<EncryptionKey> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return {
    raw,
    base64Url: base64UrlEncode(raw),
  };
}

export function keyFromBase64Url(s: string): EncryptionKey {
  const raw = base64UrlDecode(s);
  if (raw.length !== 32) {
    throw new Error(`Invalid key length: ${raw.length}`);
  }
  return { raw, base64Url: s };
}

/**
 * Derive the AES-256-GCM key from the raw 256-bit key material + per-file salt
 * using HKDF-SHA-256. Reproducible at decrypt time from key.raw + salt only.
 *   hash:  SHA-256
 *   salt:  per-file 16-byte salt (from manifest.encryption.salt)
 *   info:  'scatter-file-key-v2'
 *   usage: ['encrypt', 'decrypt'] as a 256-bit AES-GCM key
 */
async function deriveKey(
  raw: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    ab(raw),
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(HKDF_INFO) },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Read ONLY the given Blob slice's bytes. Uses FileReader where available
 * (often faster in browsers), falling back to Blob.arrayBuffer() elsewhere
 * (e.g. Node, where FileReader may not be a global). */
async function readBlob(blob: Blob): Promise<Uint8Array> {
  if (typeof FileReader === 'undefined') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('FileReader did not return ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Encrypt a Blob in chunks, TRUE streaming.
 * Reads the source slice-by-slice (blob.slice -> that slice's bytes only),
 * never materializing the whole plaintext or whole ciphertext at once.
 * Wire format per chunk (unchanged from v1):
 *   [4-byte BE length of ciphertext][12-byte IV][ciphertext+GCM tag]
 * Each chunk's GCM call binds AAD = chunkAad(chunkIndex) (see chunkAad).
 */
export async function encryptStream(
  source: Blob,
  key: EncryptionKey,
  salt: Uint8Array,
): Promise<Blob> {
  const cryptoKey = await deriveKey(key.raw, salt);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const total = source.size;
  let chunkIndex = 0;

  for (let offset = 0; offset < total; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    const plaintext = await readBlob(source.slice(offset, end));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ab(iv), additionalData: chunkAad(chunkIndex) },
        cryptoKey,
        ab(plaintext),
      ),
    );

    const chunkBuffer = new Uint8Array(4 + IV_LENGTH_BYTES + ciphertext.length);
    new DataView(chunkBuffer.buffer).setUint32(0, ciphertext.length, false);
    chunkBuffer.set(iv, 4);
    chunkBuffer.set(ciphertext, 4 + IV_LENGTH_BYTES);
    parts.push(ab(chunkBuffer));
    chunkIndex++;
  }

  // Empty-file behavior preserved: emit exactly one empty-plaintext chunk.
  if (parts.length === 0) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: ab(iv), additionalData: chunkAad(0) },
        cryptoKey,
        ab(new Uint8Array(0)),
      ),
    );
    const chunkBuffer = new Uint8Array(4 + IV_LENGTH_BYTES + ciphertext.length);
    new DataView(chunkBuffer.buffer).setUint32(0, ciphertext.length, false);
    chunkBuffer.set(iv, 4);
    chunkBuffer.set(ciphertext, 4 + IV_LENGTH_BYTES);
    parts.push(ab(chunkBuffer));
  }

  return new Blob(parts);
}

/**
 * Decrypt a blob produced by encryptStream, TRUE streaming.
 * Parses the framed blob by reading ONLY the bytes needed per chunk via
 * blob.slice(...).arrayBuffer() — first the 4-byte length header, then the
 * iv+ciphertext slice — never calling source.arrayBuffer() on the whole blob.
 * Re-derives the same AAD = chunkAad(chunkIndex) from the running counter.
 */
export async function decryptStream(
  source: Blob,
  key: EncryptionKey,
  salt: Uint8Array,
): Promise<Blob> {
  const cryptoKey = await deriveKey(key.raw, salt);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const total = source.size;
  let offset = 0;
  let chunkIndex = 0;

  while (offset < total) {
    if (offset + 4 > total) {
      throw new Error('Corrupt ciphertext: missing length header');
    }
    const header = new Uint8Array(
      await source.slice(offset, offset + 4).arrayBuffer(),
    );
    const ctLen = new DataView(
      header.buffer,
      header.byteOffset,
      4,
    ).getUint32(0, false);
    offset += 4;

    if (offset + IV_LENGTH_BYTES + ctLen > total) {
      throw new Error('Corrupt ciphertext: truncated chunk');
    }

    const body = new Uint8Array(
      await source
        .slice(offset, offset + IV_LENGTH_BYTES + ctLen)
        .arrayBuffer(),
    );
    offset += IV_LENGTH_BYTES + ctLen;

    const iv = body.subarray(0, IV_LENGTH_BYTES);
    const ct = body.subarray(IV_LENGTH_BYTES);

    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ab(iv), additionalData: chunkAad(chunkIndex) },
        cryptoKey,
        ab(ct),
      ),
    );
    parts.push(ab(plaintext));
    chunkIndex++;
  }

  return new Blob(parts);
}

/** SHA-256 hex digest of bytes. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', ab(data));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- base64url helpers (work in both browser and node) ---

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa !== 'undefined'
      ? btoa(binary)
      : nodeBuffer().from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array {
  const b64 =
    s.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (s.length % 4)) % 4);
  if (typeof atob !== 'undefined') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(nodeBuffer().from(b64, 'base64'));
}

// Node-only Buffer fallback, accessed via globalThis so this file needs no
// @types/node and stays browser-safe (browsers take the btoa/atob path above).
interface NodeBufferLike {
  from(input: Uint8Array | string, encoding?: string): {
    toString(encoding: string): string;
  } & Uint8Array;
}
function nodeBuffer(): NodeBufferLike {
  return (globalThis as unknown as { Buffer: NodeBufferLike }).Buffer;
}
