/**
 * Link format: https://scatter.tools/f/<fileId>#<keyBase64Url>
 * The fragment (#...) is never sent to our server — true zero-knowledge.
 */

import { type EncryptionKey, keyFromBase64Url } from './crypto.ts';

export interface ParsedLink {
  fileId: string;
  key: EncryptionKey;
}

export function buildLink(
  baseUrl: string,
  fileId: string,
  key: EncryptionKey,
): string {
  return `${baseUrl.replace(/\/$/, '')}/f/${fileId}#${key.base64Url}`;
}

export function parseLink(url: string): ParsedLink {
  const u = new URL(url);
  const match = u.pathname.match(/\/f\/([A-Za-z0-9_-]+)/);
  if (!match) throw new Error('Invalid Scatter link: missing file ID');
  const fileId = match[1];
  const keyStr = u.hash.slice(1);
  if (!keyStr) throw new Error('Invalid Scatter link: missing key in fragment');
  return { fileId, key: keyFromBase64Url(keyStr) };
}

/** Generate a Crockford-base32 file ID: 26 chars, ~130 bits of entropy.
 * Alphabet omits I/L/O/U; 256 % 32 === 0 so `b % 32` has no modulo bias. */
export function generateFileId(): string {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(26));
  let out = '';
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}
