/**
 * Scatter crypto layer.
 * - AES-256-GCM encryption
 * - Key is random 256 bits, shared via URL fragment (never hits server)
 * - Streams chunks so huge files don't blow up memory
 */

const KEY_LENGTH_BITS = 256;
const IV_LENGTH_BYTES = 12;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB chunks

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

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: KEY_LENGTH_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a Blob in chunks.
 * Format: for each chunk: [4-byte BE length of ciphertext][12-byte IV][ciphertext+tag]
 */
export async function encryptStream(
  source: Blob,
  key: EncryptionKey,
): Promise<Blob> {
  const cryptoKey = await importKey(key.raw);
  const chunks: BlobPart[] = [];

  for (let offset = 0; offset < source.size; offset += CHUNK_SIZE) {
    const chunk = source.slice(offset, offset + CHUNK_SIZE);
    const plaintext = new Uint8Array(await chunk.arrayBuffer());
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));

    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        plaintext,
      ),
    );

    const lengthHeader = new Uint8Array(4);
    new DataView(lengthHeader.buffer).setUint32(0, ciphertext.length, false);

    chunks.push(lengthHeader, iv, ciphertext);
  }

  // Handle empty file case — still need something to write
  if (source.size === 0) {
    // Encrypt empty plaintext so we have a valid chunk
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new Uint8Array(0),
      ),
    );
    const lengthHeader = new Uint8Array(4);
    new DataView(lengthHeader.buffer).setUint32(0, ciphertext.length, false);
    chunks.push(lengthHeader, iv, ciphertext);
  }

  return new Blob(chunks);
}

/**
 * Decrypt a blob produced by encryptStream.
 */
export async function decryptStream(
  source: Blob,
  key: EncryptionKey,
): Promise<Blob> {
  const cryptoKey = await importKey(key.raw);
  const full = new Uint8Array(await source.arrayBuffer());
  const chunks: BlobPart[] = [];
  let offset = 0;

  while (offset < full.length) {
    if (offset + 4 > full.length) {
      throw new Error('Corrupt ciphertext: missing length header');
    }
    const ctLen = new DataView(
      full.buffer,
      full.byteOffset + offset,
      4,
    ).getUint32(0, false);
    offset += 4;

    if (offset + IV_LENGTH_BYTES + ctLen > full.length) {
      throw new Error('Corrupt ciphertext: truncated chunk');
    }

    const iv = full.subarray(offset, offset + IV_LENGTH_BYTES);
    offset += IV_LENGTH_BYTES;

    const ct = full.subarray(offset, offset + ctLen);
    offset += ctLen;

    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct),
    );
    chunks.push(plaintext);
  }

  return new Blob(chunks);
}

/** SHA-256 hex digest of bytes. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
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
      : Buffer.from(bytes).toString('base64');
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
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
