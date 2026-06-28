import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.ts';
import { env } from '../env.ts';
import { pickNodesForShards } from '../assign.ts';
import { issueShardToken } from '../auth.ts';
import { nodeHub } from '../node-hub.ts';

// Credit cost model: 1 credit per started MB of encryptedSize (min 1 credit).
// Anonymous uploads are free; only logged-in users are charged.
function creditCostForUpload(encryptedSize: number): number {
  return Math.max(1, Math.ceil(encryptedSize / (1024 * 1024)));
}

const manifestSchema = z.object({
  version: z.number(),
  fileId: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  encryptedSize: z.number().int().nonnegative(),
  mimeType: z.string(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
  encryption: z.object({
    algorithm: z.literal('AES-256-GCM'),
    ivLength: z.literal(12),
    salt: z.string(),
  }),
  sharding: z.object({
    dataShards: z.number().int().positive(),
    parityShards: z.number().int().nonnegative(),
    shardSize: z.number().int().positive(),
  }),
  shards: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      isParity: z.boolean(),
      size: z.number().int().positive(),
      hash: z.string(),
    }),
  ),
});

export async function fileRoutes(app: FastifyInstance) {
  // Upload plan (unchanged)
  app.post('/files/upload/plan', async (req, reply) => {
    const manifest = manifestSchema.parse(req.body);
    const userId = req.user?.sub ?? null;

    const limit = userId
      ? env.FREE_MAX_FILE_BYTES
      : env.ANONYMOUS_MAX_FILE_BYTES;
    if (manifest.fileSize > limit) {
      return reply.code(413).send({
        error: userId
          ? `File too large. Max ${formatSize(limit)} with free account.`
          : `File too large. Sign in to upload up to ${formatSize(env.FREE_MAX_FILE_BYTES)}.`,
      });
    }

    const maxShard = Math.max(...manifest.shards.map((s) => s.size));
    if (maxShard > env.MAX_SHARD_BYTES) {
      return reply.code(413).send({ error: 'Shards too large' });
    }

    const existing = db
      .prepare(`SELECT id FROM files WHERE id = ?`)
      .get(manifest.fileId);
    if (existing) {
      return reply.code(409).send({ error: 'File ID conflict, retry' });
    }

    // Credit enforcement (logged-in users only; anonymous uploads are free).
    const creditsCost = userId ? creditCostForUpload(manifest.encryptedSize) : 0;
    let creditsRemaining: number | null = null;
    if (userId) {
      const user = db
        .prepare<[string], { credits: number }>(
          `SELECT credits FROM users WHERE id = ?`,
        )
        .get(userId);
      const have = user?.credits ?? 0;
      if (have < creditsCost) {
        return reply.code(402).send({
          error: `Insufficient credits. Need ${creditsCost}, have ${have}.`,
        });
      }
      creditsRemaining = have - creditsCost;
    }

    const totalShards = manifest.shards.length;
    let assignedNodes: string[];
    try {
      assignedNodes = pickNodesForShards(maxShard, totalShards);
    } catch (e) {
      const message = (e as Error).message;
      app.log.warn({ err: message }, 'shard assignment failed');
      return reply
        .code(503)
        .send({ error: `Cannot upload right now: ${message}` });
    }

    const now = Date.now();
    const expiresAt = userId ? null : now + 24 * 60 * 60_000;
    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO files (id, owner_user_id, size_bytes, encrypted_bytes, manifest, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        manifest.fileId,
        userId,
        manifest.fileSize,
        manifest.encryptedSize,
        JSON.stringify(manifest),
        now,
        expiresAt,
      );
      const insertShard = db.prepare(
        `INSERT INTO shards (file_id, shard_index, node_id, size_bytes, hash) VALUES (?, ?, ?, ?, ?)`,
      );
      manifest.shards.forEach((s, i) => {
        insertShard.run(
          manifest.fileId,
          s.index,
          assignedNodes[i],
          s.size,
          s.hash,
        );
      });
      // Charge credits for logged-in users (atomic with the file/shard inserts).
      if (userId) {
        db.prepare(
          `UPDATE users SET credits = credits - ? WHERE id = ?`,
        ).run(creditsCost, userId);
        db.prepare(
          `INSERT INTO credit_events (user_id, delta, reason, ref_id, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(userId, -creditsCost, 'upload', manifest.fileId, now);
      }
    });
    tx();

    const assignments = await Promise.all(
      manifest.shards.map(async (s, i) => ({
        shardIndex: s.index,
        nodeId: assignedNodes[i],
        uploadToken: await issueShardToken({
          fileId: manifest.fileId,
          shardIndex: s.index,
          nodeId: assignedNodes[i],
          maxSize: s.size + 1024,
        }),
      })),
    );

    return {
      fileId: manifest.fileId,
      assignments,
      ...(userId ? { creditsCost, creditsRemaining } : {}),
    };
  });

  // Download plan (unchanged)
  app.get('/files/:id/plan', async (req, reply) => {
    const { id } = req.params as { id: string };

    const file = db
      .prepare<
        [string],
        {
          manifest: string;
          deleted_at: number | null;
          expires_at: number | null;
        }
      >(`SELECT manifest, deleted_at, expires_at FROM files WHERE id = ?`)
      .get(id);

    if (!file || file.deleted_at)
      return reply.code(404).send({ error: 'not found' });
    if (file.expires_at && file.expires_at < Date.now()) {
      return reply.code(410).send({ error: 'expired' });
    }

    const shards = db
      .prepare<
        [string],
        {
          shard_index: number;
          node_id: string;
          size_bytes: number;
          hash: string;
        }
      >(`SELECT shard_index, node_id, size_bytes, hash FROM shards WHERE file_id = ? ORDER BY shard_index`)
      .all(id);

    return {
      manifest: JSON.parse(file.manifest),
      locations: shards.map((s) => ({
        shardIndex: s.shard_index,
        nodeId: s.node_id,
        size: s.size_bytes,
        hash: s.hash,
      })),
    };
  });

  // List user's files
  app.get('/files', { preHandler: app.requireAuth }, async (req) => {
    const files = db
      .prepare<
        [string],
        {
          id: string;
          size_bytes: number;
          created_at: number;
          expires_at: number | null;
          manifest: string;
        }
      >(
        `SELECT id, size_bytes, created_at, expires_at, manifest
         FROM files
         WHERE owner_user_id = ? AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(req.user!.sub);

    return {
      files: files.map((f) => {
        const m = JSON.parse(f.manifest);
        return {
          id: f.id,
          fileName: m.fileName,
          fileSize: f.size_bytes,
          mimeType: m.mimeType,
          createdAt: f.created_at,
          expiresAt: f.expires_at,
        };
      }),
    };
  });

  // Delete file
  app.delete(
    '/files/:id',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };

      // Look up the file's shards before soft-deleting so we can free node
      // bytes and propagate the delete to storage nodes afterwards.
      const shards = db
        .prepare<
          [string],
          { shard_index: number; node_id: string; size_bytes: number }
        >(`SELECT shard_index, node_id, size_bytes FROM shards WHERE file_id = ?`)
        .all(id);

      const result = db
        .prepare(
          `UPDATE files SET deleted_at = ? WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL`,
        )
        .run(Date.now(), id, req.user!.sub);
      if (result.changes === 0) {
        return reply.code(404).send({ error: 'not found or not yours' });
      }

      // Decrement each affected node's used_bytes regardless of reachability
      // (these are synchronous DB writes — no async in between).
      const freeBytes = db.prepare(
        `UPDATE nodes SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?`,
      );
      for (const s of shards) {
        freeBytes.run(s.size_bytes, s.node_id);
      }

      // Propagate the delete to any online storage nodes, concurrently. A
      // single failing/unreachable node must not abort the others; these async
      // sends happen strictly after the DB writes above (never in a tx).
      await Promise.allSettled(
        shards
          .filter((s) => nodeHub.isOnline(s.node_id))
          .map(async (s) => {
            try {
              await nodeHub.send(s.node_id, {
                cmd: 'delete',
                fileId: id,
                shardIndex: s.shard_index,
              });
            } catch (err) {
              app.log.warn(
                { err, nodeId: s.node_id, fileId: id, shardIndex: s.shard_index },
                'failed to propagate shard delete to node',
              );
            }
          }),
      );

      return { ok: true };
    },
  );

  // Get user credits
  app.get('/credits', { preHandler: app.requireAuth }, async (req) => {
    const user = db
      .prepare<
        [string],
        { credits: number }
      >(`SELECT credits FROM users WHERE id = ?`)
      .get(req.user!.sub);

    const history = db
      .prepare<
        [string],
        {
          delta: number;
          reason: string;
          created_at: number;
          ref_id: string | null;
        }
      >(
        `SELECT delta, reason, created_at, ref_id
         FROM credit_events
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(req.user!.sub);

    return {
      balance: user?.credits ?? 0,
      history: history.map((h) => ({
        delta: h.delta,
        reason: h.reason,
        createdAt: h.created_at,
        refId: h.ref_id,
      })),
    };
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
