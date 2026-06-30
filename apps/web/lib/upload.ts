import type { PreparedUpload } from "@scatter/protocol";
import type { UploadPlan } from "./api";
import { API_URL } from "./env";

export interface UploadProgress {
  sent: number;
  total: number;
  currentShard: number;
  totalShards: number;
}

export async function uploadShards(
  prep: PreparedUpload,
  plan: UploadPlan,
  session: string | null,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const total = prep.shards.reduce((s, shard) => s + shard.length, 0);
  let sent = 0;

  // Upload shards in parallel, capping concurrency to spare the coordinator.
  const CONCURRENCY = 3;
  const queue = prep.shards.map((data, i) => ({
    data,
    index: i,
    assignment: plan.assignments[i],
  }));

  const workers: Promise<void>[] = [];
  let nextIdx = 0;
  let completed = 0;

  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (nextIdx < queue.length) {
          const job = queue[nextIdx++];
          if (!job) break;

          const headers: Record<string, string> = {
            "Content-Type": "application/octet-stream",
            Authorization: `Bearer ${job.assignment.uploadToken}`,
          };

          const res = await fetch(
            `${API_URL}/files/${prep.fileId}/shards/${job.assignment.shardIndex}`,
            {
              method: "POST",
              headers,
              body: toArrayBuffer(job.data),
            },
          );

          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`shard ${job.index} failed: ${res.status} ${text}`);
          }

          sent += job.data.length;
          completed++;
          onProgress?.({
            sent,
            total,
            currentShard: completed,
            totalShards: queue.length,
          });
        }
      })(),
    );
  }

  await Promise.all(workers);
}

// Copy into a plain ArrayBuffer-backed view so it satisfies BodyInit (the
// protocol's Uint8Array is generic over ArrayBufferLike).
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}