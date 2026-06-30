import type { FileManifest } from "@scatter/protocol";
import { keyFromBase64Url, reassemble } from "@scatter/protocol";
import type { DownloadPlan } from "./api";
import { API_URL } from "./env";

export interface DownloadProgress {
  received: number;
  total: number;
  currentShard: number;
  totalShards: number;
}

/**
 * Download a file: fetch enough shards in parallel, RS-reassemble, decrypt with
 * the key from the URL fragment, and return a saveable Blob (see @scatter/protocol).
 */
export async function downloadFile(
  fileId: string,
  keyFragment: string,
  plan: DownloadPlan,
  onProgress?: (p: DownloadProgress) => void,
): Promise<Blob> {
  const manifest = plan.manifest as FileManifest;
  const { dataShards, parityShards } = manifest.sharding;
  const totalShards = dataShards + parityShards;
  const neededShards = dataShards;

  const totalBytes = manifest.shards.reduce((s, x) => s + x.size, 0);
  let received = 0;
  let fetched = 0;

  // Try data shards first (no RS math needed when all are present).
  const fetchedData: (Uint8Array | null)[] = new Array(totalShards).fill(null);
  const tryOrder = [...Array(totalShards).keys()].sort(
    (a, b) => Number(manifest.shards[a].isParity) - Number(manifest.shards[b].isParity),
  );

  const fetchShard = async (idx: number): Promise<void> => {
    const res = await fetch(`${API_URL}/files/${fileId}/shards/${idx}`);
    if (!res.ok) throw new Error(`shard ${idx}: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    fetchedData[idx] = buf;
    received += buf.length;
    fetched++;
    onProgress?.({
      received,
      total: totalBytes,
      currentShard: fetched,
      totalShards: neededShards,
    });
  };

  // Fetch shards with bounded concurrency until we have enough.
  const CONCURRENCY = 3;
  let nextTry = 0;
  const workers: Promise<void>[] = [];
  const got = () => fetchedData.filter((s) => s !== null).length;

  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (got() < neededShards && nextTry < tryOrder.length) {
          const idx = tryOrder[nextTry++];
          try {
            await fetchShard(idx);
          } catch {
            // Skip failed shards — RS handles missing ones.
          }
        }
      })(),
    );
  }
  await Promise.all(workers);

  if (got() < neededShards) {
    throw new Error(
      `Could only fetch ${got()} of ${neededShards} required shards. File unavailable.`,
    );
  }

  const key = keyFromBase64Url(keyFragment);
  const blob = await reassemble(manifest, fetchedData, key);
  return blob;
}

/** Trigger a browser download of a Blob with a filename. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}