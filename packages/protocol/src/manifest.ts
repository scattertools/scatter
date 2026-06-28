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

export async function prepareUpload(
  file: File,
  baseUrl: string,
  config: ShardConfig = DEFAULT_SHARD_CONFIG,
): Promise<PreparedUpload> {
  const key = await generateKey();
  const fileId = generateFileId();

  // Per-file salt: the AES-GCM key is HKDF-derived from key.raw + this salt.
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

export async function reassemble(
  manifest: FileManifest,
  shards: (Uint8Array | null)[],
  key: EncryptionKey,
): Promise<Blob> {
  // Decode-time integrity check: recompute SHA-256 of each present shard and
  // compare against manifest.shards[i].hash. A shard whose hash mismatches is
  // treated as MISSING (nulled) rather than fed into RS decode, so erasure
  // coding can route around the corruption instead of producing garbage.
  // If too many shards end up nulled, decodeShards throws "Not enough shards".
  const verified: (Uint8Array | null)[] = await Promise.all(
    shards.map(async (shard, i) => {
      if (!shard) return null;
      const expected = manifest.shards[i]?.hash;
      if (expected && (await sha256Hex(shard)) !== expected) return null;
      return shard;
    }),
  );

  // Use exact ciphertext size from manifest — decodeShards will trim padding
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
