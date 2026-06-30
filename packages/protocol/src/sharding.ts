/**
 * Reed-Solomon erasure coding over GF(2^8): splits data into N shards where
 * any K reconstruct the original. Minimal, dependency-free implementation.
 */

import type { ShardConfig, ShardInfo } from './types.ts';
import { sha256Hex } from './crypto.ts';

// GF(256) arithmetic using the 0x11d primitive polynomial.
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];

const gfDiv = (a: number, b: number): number => {
  if (b === 0) throw new Error('gf div by 0');
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
};

/** Build the encode matrix: identity rows for data, Vandermonde rows for parity. */
function buildMatrix(dataShards: number, totalShards: number): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let i = 0; i < dataShards; i++) {
    const row = new Uint8Array(dataShards);
    row[i] = 1;
    rows.push(row);
  }
  for (let i = dataShards; i < totalShards; i++) {
    const row = new Uint8Array(dataShards);
    let v = 1;
    for (let j = 0; j < dataShards; j++) {
      row[j] = v;
      v = gfMul(v, i + 1);
    }
    rows.push(row);
  }
  return rows;
}

/** Gauss-Jordan matrix inversion over GF(256). */
function invertMatrix(m: Uint8Array[]): Uint8Array[] {
  const n = m.length;
  const a = m.map((r) => new Uint8Array(r));
  const inv: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const r = new Uint8Array(n);
    r[i] = 1;
    inv.push(r);
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    while (pivot < n && a[pivot][col] === 0) pivot++;
    if (pivot === n) throw new Error('Singular matrix');
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot], a[col]];
      [inv[col], inv[pivot]] = [inv[pivot], inv[col]];
    }
    const pv = a[col][col];
    for (let j = 0; j < n; j++) {
      a[col][j] = gfDiv(a[col][j], pv);
      inv[col][j] = gfDiv(inv[col][j], pv);
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < n; j++) {
        a[r][j] ^= gfMul(f, a[col][j]);
        inv[r][j] ^= gfMul(f, inv[col][j]);
      }
    }
  }
  return inv;
}

/** Encode data into data + parity shards, zero-padded to divide by dataShards. */
export function encodeShards(
  data: Uint8Array,
  config: ShardConfig,
): Uint8Array[] {
  const { dataShards, parityShards } = config;
  const totalShards = dataShards + parityShards;

  const shardLen = Math.ceil(data.length / dataShards);
  const padded = new Uint8Array(shardLen * dataShards);
  padded.set(data);

  const shards: Uint8Array[] = [];
  for (let i = 0; i < dataShards; i++) {
    shards.push(padded.slice(i * shardLen, (i + 1) * shardLen));
  }

  const matrix = buildMatrix(dataShards, totalShards);
  for (let p = dataShards; p < totalShards; p++) {
    const parity = new Uint8Array(shardLen);
    for (let byte = 0; byte < shardLen; byte++) {
      let v = 0;
      for (let d = 0; d < dataShards; d++) {
        v ^= gfMul(matrix[p][d], shards[d][byte]);
      }
      parity[byte] = v;
    }
    shards.push(parity);
  }

  return shards;
}

/**
 * Reconstruct original data from any `dataShards` of the shards. `shards` must
 * have length totalShards; missing shards are null. Trims to originalSize.
 */
export function decodeShards(
  shards: (Uint8Array | null)[],
  config: ShardConfig,
  originalSize: number,
): Uint8Array {
  const { dataShards, parityShards } = config;
  const totalShards = dataShards + parityShards;
  if (shards.length !== totalShards) {
    throw new Error(`Expected ${totalShards} slots, got ${shards.length}`);
  }

  const presentIndices: number[] = [];
  for (let i = 0; i < totalShards && presentIndices.length < dataShards; i++) {
    if (shards[i]) presentIndices.push(i);
  }
  if (presentIndices.length < dataShards) {
    throw new Error(
      `Not enough shards: have ${presentIndices.length}, need ${dataShards}`,
    );
  }

  const allDataPresent = presentIndices.every((i) => i < dataShards);
  const shardLen = shards[presentIndices[0]]!.length;

  let dataRows: Uint8Array[];
  if (allDataPresent) {
    dataRows = presentIndices.slice(0, dataShards).map((i) => shards[i]!);
  } else {
    const full = buildMatrix(dataShards, totalShards);
    const sub = presentIndices.map((i) => full[i]);
    const inv = invertMatrix(sub);
    const present = presentIndices.map((i) => shards[i]!);
    dataRows = [];
    for (let r = 0; r < dataShards; r++) {
      const row = new Uint8Array(shardLen);
      for (let byte = 0; byte < shardLen; byte++) {
        let v = 0;
        for (let c = 0; c < dataShards; c++)
          v ^= gfMul(inv[r][c], present[c][byte]);
        row[byte] = v;
      }
      dataRows.push(row);
    }
  }

  const out = new Uint8Array(shardLen * dataShards);
  for (let i = 0; i < dataShards; i++) out.set(dataRows[i], i * shardLen);
  return out.slice(0, originalSize);
}

/** Hash every shard to build manifest ShardInfo entries (see types.ts). */
export async function hashShards(
  shards: Uint8Array[],
  dataShards: number,
): Promise<ShardInfo[]> {
  const infos: ShardInfo[] = [];
  for (let i = 0; i < shards.length; i++) {
    infos.push({
      index: i,
      isParity: i >= dataShards,
      size: shards[i].length,
      hash: await sha256Hex(shards[i]),
    });
  }
  return infos;
}
