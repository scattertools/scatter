// Protocol version. v2 = HKDF-SHA-256 key derivation + per-chunk AAD (see crypto.ts).
export const PROTOCOL_VERSION = 2;

export interface ShardConfig {
  dataShards: number;
  parityShards: number;
  shardSize: number;
}

/** Default 10+4 Reed-Solomon with 4MB shards (tolerates losing any 4 of 14). */
export const DEFAULT_SHARD_CONFIG: ShardConfig = {
  dataShards: 10,
  parityShards: 4,
  shardSize: 4 * 1024 * 1024,
};

export interface ShardInfo {
  index: number;
  isParity: boolean;
  size: number;
  hash: string; // hex SHA-256 of shard bytes
}

/** Recipe to reassemble an encrypted, sharded file (see manifest.ts). */
export interface FileManifest {
  version: number;
  fileId: string; // public ID used in URLs
  fileName: string; // encrypted when stored server-side
  fileSize: number; // original size in bytes
  encryptedSize: number; // exact ciphertext size before sharding
  mimeType: string;
  createdAt: number; // unix ms
  expiresAt?: number;
  encryption: {
    algorithm: 'AES-256-GCM';
    ivLength: 12;
    salt: string; // base64, used for HKDF key derivation
  };
  sharding: ShardConfig;
  shards: ShardInfo[];
}

/** Upload request to the coordinator: manifest plus per-shard node assignments. */
export interface UploadPlan {
  fileId: string;
  manifest: FileManifest;
  assignments: Array<{
    shardIndex: number;
    nodeId: string;
    uploadToken: string; // short-lived JWT scoped to that shard
  }>;
}

export interface NodeInfo {
  id: string;
  version: string;
  capacityBytes: number;
  usedBytes: number;
  uptime: number; // 0-1
  lastSeen: number; // unix ms
  online: boolean;
}
