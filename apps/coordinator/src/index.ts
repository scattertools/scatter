import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { env, allowedOrigins } from "./env.ts";
import { db } from "./db.ts";
import { verifySession } from "./auth.ts";
import type { SessionPayload } from "./auth.ts";
import { authRoutes } from "./routes/auth.ts";
import { nodeRoutes } from "./routes/nodes.ts";
import { fileRoutes } from "./routes/files.ts";
import { shardRoutes } from "./routes/shards.ts";
import pkg from "../package.json" with { type: "json" };

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionPayload;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  bodyLimit: 10 * 1024 * 1024,
});

await app.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

await app.register(rateLimit, {
  max: 200,
  timeWindow: "1 minute",
});

await app.register(websocket, {
  options: { maxPayload: 16 * 1024 * 1024 }, // up to 16 MB per WS message
});

app.addHook("onRequest", async (req) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    const user = await verifySession(token);
    if (user) req.user = user;
  }
});

app.decorate("requireAuth", async (req: FastifyRequest, reply: FastifyReply) => {
  if (!req.user) reply.code(401).send({ error: "authentication required" });
});

app.get("/health", async () => ({ ok: true, version: pkg.version, time: Date.now() }));

await app.register(authRoutes);
await app.register(nodeRoutes);
await app.register(fileRoutes);
await app.register(shardRoutes);

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  db.prepare(`DELETE FROM magic_links WHERE expires_at < ?`).run(now);
  db.prepare(`DELETE FROM login_codes WHERE expires_at < ?`).run(now);
  db.prepare(
    `UPDATE files SET deleted_at = ? WHERE expires_at IS NOT NULL AND expires_at < ? AND deleted_at IS NULL`,
  ).run(now, now);
}, 60_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "received — shutting down gracefully…");
  clearInterval(cleanupTimer);
  try {
    await app.close();
    if (db.open) db.close();
    app.log.info("Shutdown complete.");
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`🛰️  Coordinator listening on ${env.HOST}:${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}