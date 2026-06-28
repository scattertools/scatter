import type { FastifyInstance } from "fastify";
import { createHash } from "crypto";
import { verifyShardToken } from "../auth.ts";
import { db } from "../db.ts";
import { nodeHub } from "../node-hub.ts";
import { env } from "../env.ts";

export async function shardRoutes(app: FastifyInstance) {
  // Raw body parser for shard uploads
  app.addContentTypeParser(
    ["application/octet-stream", "application/x-binary"],
    { parseAs: "buffer", bodyLimit: env.MAX_SHARD_BYTES + 1024 * 1024 },
    (_req, body, done) => done(null, body),
  );

  /**
   * Upload a shard. Client provides the upload token from the upload plan.
   * Body: raw shard bytes (application/octet-stream)
   */
  app.post<{ Params: { fileId: string; shardIndex: string } }>(
    "/files/:fileId/shards/:shardIndex",
    async (req, reply) => {
      const { fileId, shardIndex } = req.params;
      const idx = parseInt(shardIndex, 10);
      if (isNaN(idx)) return reply.code(400).send({ error: "bad shard index" });

      const authHeader = req.headers.authorization ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      const claims = await verifyShardToken(token);
      if (!claims) return reply.code(401).send({ error: "invalid upload token" });

      if (claims.fileId !== fileId || claims.shardIndex !== idx) {
        return reply.code(403).send({ error: "token mismatch" });
      }

      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body)) {
        return reply.code(400).send({ error: "missing body" });
      }
      if (body.length > claims.maxSize) {
        return reply.code(413).send({ error: "shard too large" });
      }

      // Find shard row
      const shard = db
        .prepare<
          [string, number, string],
          { node_id: string; hash: string; uploaded_at: number | null }
        >(
          `SELECT node_id, hash, uploaded_at FROM shards
           WHERE file_id = ? AND shard_index = ? AND node_id = ?`,
        )
        .get(fileId, idx, claims.nodeId);

      if (!shard) return reply.code(404).send({ error: "shard not assigned" });
      if (shard.uploaded_at) return reply.code(409).send({ error: "already uploaded" });

      // Relay to node via WebSocket
      if (!nodeHub.isOnline(claims.nodeId)) {
        return reply.code(503).send({ error: "assigned node is offline" });
      }

      try {
        const resp = await nodeHub.send(claims.nodeId, {
          cmd: "store",
          fileId,
          shardIndex: idx,
          hash: shard.hash,
          data: body.toString("base64"),
        });

        if (!resp.ok) {
          return reply.code(502).send({ error: resp.error ?? "node rejected shard" });
        }

        // Mark uploaded
        db.prepare(
          `UPDATE shards SET uploaded_at = ? WHERE file_id = ? AND shard_index = ? AND node_id = ?`,
        ).run(Date.now(), fileId, idx, claims.nodeId);

        return { ok: true };
      } catch (e) {
        return reply.code(502).send({ error: (e as Error).message });
      }
    },
  );

  /**
   * Download a shard — coordinator fetches from the node and streams bytes.
   */
  app.get<{ Params: { fileId: string; shardIndex: string } }>(
    "/files/:fileId/shards/:shardIndex",
    async (req, reply) => {
      const { fileId, shardIndex } = req.params;
      const idx = parseInt(shardIndex, 10);
      if (isNaN(idx)) return reply.code(400).send({ error: "bad shard index" });

      const file = db
        .prepare<[string], { deleted_at: number | null; expires_at: number | null }>(
          `SELECT deleted_at, expires_at FROM files WHERE id = ?`,
        )
        .get(fileId);
      if (!file || file.deleted_at) return reply.code(404).send({ error: "not found" });
      if (file.expires_at && file.expires_at < Date.now()) {
        return reply.code(410).send({ error: "expired" });
      }

      const shard = db
        .prepare<
          [string, number],
          { node_id: string; uploaded_at: number | null; size_bytes: number; hash: string }
        >(
          `SELECT node_id, uploaded_at, size_bytes, hash FROM shards
           WHERE file_id = ? AND shard_index = ? AND uploaded_at IS NOT NULL
           LIMIT 1`,
        )
        .get(fileId, idx);
      if (!shard) return reply.code(404).send({ error: "shard unavailable" });

      if (!nodeHub.isOnline(shard.node_id)) {
        return reply.code(503).send({ error: "node offline" });
      }

      try {
        const resp = await nodeHub.send(shard.node_id, {
          cmd: "retrieve",
          fileId,
          shardIndex: idx,
        });
        if (!resp.ok || !resp.data) {
          return reply.code(502).send({ error: resp.error ?? "retrieve failed" });
        }
        const bytes = Buffer.from(resp.data, "base64");

        // Verify the returned bytes match the recorded shard hash. The
        // manifest hash is WebCrypto SHA-256 hex (@scatter/protocol sha256Hex),
        // which is identical to Node's crypto SHA-256 hex of the same bytes.
        const actualHash = createHash("sha256").update(bytes).digest("hex");
        if (actualHash !== shard.hash) {
          return reply.code(502).send({ error: "shard hash mismatch" });
        }

        reply.header("Content-Type", "application/octet-stream");
        reply.header("Content-Length", bytes.length);
        return reply.send(bytes);
      } catch (e) {
        return reply.code(502).send({ error: (e as Error).message });
      }
    },
  );
}