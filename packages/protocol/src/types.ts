// Protocol version for future-proofing
export const PROTOCOL_VERSION = 1;

// Sharding parameters
export interface ShardConfig {
  dataShards: number; // e.g. 10
  parityShards: number; // e.g. 4 (can lose any 4 of 14 total)
  shardSize: number; // bytes per shard
}

// Default: 10+4 Reed-Solomon, 4MB shards
export const DEFAULT_SHARD_CONFIG: ShardConfig = {
  dataShards: 10,
  parityShards: 4,
  shardSize: 4 * 1024 * 1024,
};

// One shard's worth of info
export interface ShardInfo {
  index: number; // position in the sequence
  isParity: boolean;
  size: number; // bytes
  hash: string; // hex-encoded SHA-256 of shard bytes
}

// The manifest = "recipe" to reassemble a file
export interface FileManifest {
  version: number;
  fileId: string; // public ID, used in URLs
  fileName: string; // ENCRYPTED when stored server-side
  fileSize: number; // original size in bytes
  encryptedSize: number; // exact ciphertext size before sharding
  mimeType: string;
  createdAt: number; // unix ms
  expiresAt?: number;
  encryption: {
    algorithm: 'AES-256-GCM';
    ivLength: 12;
    // The salt used to derive encryption key from user's random key
    salt: string; // base64
  };
  sharding: ShardConfig;
  shards: ShardInfo[]; // all shards in order
}

// What we hand to the coordinator when uploading
export interface UploadPlan {
  fileId: string;
  manifest: FileManifest;
  // Which node should store which shard
  assignments: Array<{
    shardIndex: number;
    nodeId: string;
    uploadToken: string; // short-lived JWT for that specific shard
  }>;
}

// Node in the network
export interface NodeInfo {
  id: string;
  version: string;
  capacityBytes: number;
  usedBytes: number;
  uptime: number; // 0-1
  lastSeen: number; // unix ms
  online: boolean;
}
