import {
  DEFAULT_SHARD_CONFIG,
  PROTOCOL_VERSION,
  type FileManifest,
  type ShardConfig,
} from './types.ts';
import {
  encryptStream,
  decryptStream,
  generateKey,
  base64UrlEncode,
  base64UrlDecode,
  sha256Hex,
  type EncryptionKey,
} from './crypto.ts';
import { encodeShards, decodeShards, hashShards } from './sharding.ts';
import { generateFileId, buildLink } from './links.ts';

export interface PreparedUpload {
  fileId: string;
  key: EncryptionKey;
  manifest: FileManifest;
  shards: Uint8Array[];
  link: string;
}

/** Encrypt, shard, and build the manifest + share link for a file. */
export async function prepareUpload(
  file: File,
  baseUrl: string,
  config: ShardConfig = DEFAULT_SHARD_CONFIG,
): Promise<PreparedUpload> {
  const key = await generateKey();
  const fileId = generateFileId();

  // Per-file salt for HKDF key derivation (see crypto.ts deriveKey).
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const encrypted = await encryptStream(file, key, salt);
  const encryptedBytes = new Uint8Array(await encrypted.arrayBuffer());
  const encryptedSize = encryptedBytes.length;

  const shards = encodeShards(encryptedBytes, config);
  const shardInfos = await hashShards(shards, config.dataShards);

  const manifest: FileManifest = {
    version: PROTOCOL_VERSION,
    fileId,
    fileName: file.name,
    fileSize: file.size,
    encryptedSize,
    mimeType: file.type || 'application/octet-stream',
    createdAt: Date.now(),
    encryption: {
      algorithm: 'AES-256-GCM',
      ivLength: 12,
      salt: base64UrlEncode(salt),
    },
    sharding: config,
    shards: shardInfos,
  };

  return {
    fileId,
    key,
    manifest,
    shards,
    link: buildLink(baseUrl, fileId, key),
  };
}

/** Verify shard hashes, RS-decode, and decrypt back into the original Blob. */
export async function reassemble(
  manifest: FileManifest,
  shards: (Uint8Array | null)[],
  key: EncryptionKey,
): Promise<Blob> {
  // Null out hash-mismatched shards so RS decode routes around corruption
  // rather than producing garbage; too many nulls -> decodeShards throws.
  const verified: (Uint8Array | null)[] = await Promise.all(
    shards.map(async (shard, i) => {
      if (!shard) return null;
      const expected = manifest.shards[i]?.hash;
      if (expected && (await sha256Hex(shard)) !== expected) return null;
      return shard;
    }),
  );

  const encryptedData = decodeShards(
    verified,
    manifest.sharding,
    manifest.encryptedSize,
  );
  const salt = base64UrlDecode(manifest.encryption.salt);
  const decrypted = await decryptStream(
    new Blob([encryptedData as Uint8Array<ArrayBuffer>]),
    key,
    salt,
  );
  return new Blob([decrypted], { type: manifest.mimeType });
}
