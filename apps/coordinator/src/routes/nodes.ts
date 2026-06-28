import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { nodeHub } from "../node-hub.ts";
import { issueNodeToken, verifyNodeToken } from "../auth.ts";

export async function nodeRoutes(app: FastifyInstance) {
  // WebSocket endpoint — nodes connect here and stay connected
  app.get(
    "/nodes/:id/connect",
    { websocket: true },
    async (socket, req) => {
      const { id } = req.params as { id: string };

      // Verify node exists
      const exists = db.prepare(`SELECT id FROM nodes WHERE id = ?`).get(id);
      if (!exists) {
        socket.send(JSON.stringify({ error: "unknown node id" }));
        socket.close();
        return;
      }

      // Authenticate the handshake using the node token. WS clients can set
      // an Authorization header or a custom x-node-token header.
      const authHeader = req.headers.authorization ?? "";
      const bearer = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : "";
      const headerToken = req.headers["x-node-token"];
      const nodeToken =
        bearer ||
        (typeof headerToken === "string" ? headerToken : "") ||
        (Array.isArray(headerToken) ? headerToken[0] ?? "" : "");

      const claims = await verifyNodeToken(nodeToken);
      if (!claims || claims.nodeId !== id) {
        socket.send(JSON.stringify({ error: "unauthorized" }));
        socket.close();
        return;
      }

      // Mark as online
      db.prepare(`UPDATE nodes SET last_seen_at = ? WHERE id = ?`).run(Date.now(), id);

      nodeHub.register(id, socket);
      app.log.info({ nodeId: id }, "node connected");

      // Keep last_seen fresh while connected
      const keepAlive = setInterval(() => {
        if (nodeHub.isOnline(id)) {
          db.prepare(`UPDATE nodes SET last_seen_at = ? WHERE id = ?`).run(Date.now(), id);
        } else {
          clearInterval(keepAlive);
        }
      }, 30_000);

      socket.on("close", () => {
        clearInterval(keepAlive);
        app.log.info({ nodeId: id }, "node disconnected");
      });
    },
  );

  // Regular HTTP registration — binds owner if a session is present and
  // returns a long-lived node token used to authenticate later requests.
  app.post("/nodes/register", async (req) => {
    const body = z
      .object({
        capacityBytes: z.number().int().positive(),
        version: z.string(),
      })
      .parse(req.body);

    const id = `node_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = Date.now();
    const ownerUserId = req.user?.sub ?? null;

    db.prepare(
      `INSERT INTO nodes (id, owner_user_id, capacity_bytes, used_bytes, version, last_seen_at, registered_at)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
    ).run(id, ownerUserId, body.capacityBytes, body.version, now, now);

    const nodeToken = await issueNodeToken(id);
    return { nodeId: id, nodeToken };
  });

  app.post("/nodes/:id/heartbeat", async (req, reply) => {
    const { id } = req.params as { id: string };

    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const claims = await verifyNodeToken(token);
    if (!claims || claims.nodeId !== id) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const body = z
      .object({
        usedBytes: z.number().int().nonnegative().optional(),
        capacityBytes: z.number().int().positive().optional(),
      })
      .parse(req.body ?? {});

    const sets: string[] = ["last_seen_at = ?"];
    const vals: (number | string)[] = [Date.now()];
    if (body.usedBytes !== undefined) {
      sets.push("used_bytes = ?");
      vals.push(body.usedBytes);
    }
    if (body.capacityBytes !== undefined) {
      sets.push("capacity_bytes = ?");
      vals.push(body.capacityBytes);
    }
    vals.push(id);

    const result = db.prepare(`UPDATE nodes SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

    if (result.changes === 0) return reply.code(404).send({ error: "unknown node" });
    return { ok: true };
  });

  app.get("/nodes/stats", async () => {
    const cutoff = Date.now() - 2 * 60_000;
    const row = db
      .prepare<
        [number],
        { active_nodes: number; total_capacity: number; total_used: number }
      >(
        `SELECT
           COUNT(*) AS active_nodes,
           COALESCE(SUM(capacity_bytes), 0) AS total_capacity,
           COALESCE(SUM(used_bytes), 0) AS total_used
         FROM nodes WHERE last_seen_at > ?`,
      )
      .get(cutoff);

    const fileRow = db
      .prepare<[], { total: number }>(
        `SELECT COUNT(*) AS total FROM files WHERE deleted_at IS NULL`,
      )
      .get();

    return {
      activeNodes: row?.active_nodes ?? 0,
      totalCapacityBytes: row?.total_capacity ?? 0,
      totalUsedBytes: row?.total_used ?? 0,
      filesScattered: fileRow?.total ?? 0,
    };
  });
}