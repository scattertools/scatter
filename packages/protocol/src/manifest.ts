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

  const encrypted = await encryptStream(file, key);
  const encryptedBytes = new Uint8Array(await encrypted.arrayBuffer());
  const encryptedSize = encryptedBytes.length;

  const shards = encodeShards(encryptedBytes, config);
  const shardInfos = await hashShards(shards, config.dataShards);

  const salt = crypto.getRandomValues(new Uint8Array(16));

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
  // Use exact ciphertext size from manifest — decodeShards will trim padding
  const encryptedData = decodeShards(
    shards,
    manifest.sharding,
    manifest.encryptedSize,
  );
  const decrypted = await decryptStream(new Blob([encryptedData]), key);
  return new Blob([decrypted], { type: manifest.mimeType });
}
