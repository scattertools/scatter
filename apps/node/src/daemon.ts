import type { Config } from "./config.ts";
import { saveConfig } from "./config.ts";
import { ShardStorage } from "./storage.ts";
import { CoordinatorClient } from "./coordinator.ts";
import { NodeWSClient } from "./ws-client.ts";
import { Events } from "./events.ts";

export interface Daemon {
  config: Config;
  storage: ShardStorage;
  coordinator: CoordinatorClient;
  events: Events;
  state: {
    startedAt: number;
    usedBytes: number;
    shardCount: number;
  };
  stop: () => Promise<void>;
}

export const VERSION = "0.1.0";
const HEARTBEAT_INTERVAL = 30_000;
const REGISTER_MAX_ATTEMPTS = 5;
const REGISTER_BASE_DELAY = 1_000;
const REGISTER_MAX_DELAY = 30_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Register with the coordinator, retrying with exponential backoff so a
 * transient outage at startup does not crash the node. After exhausting all
 * attempts the final error is rethrown for the caller to handle as fatal.
 */
async function registerWithRetry(
  coordinator: CoordinatorClient,
  config: Config,
  events: Events,
): Promise<{ nodeId: string; nodeToken: string }> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= REGISTER_MAX_ATTEMPTS; attempt++) {
    try {
      return await coordinator.register(
        config.capacityBytes,
        VERSION,
        config.sessionToken ?? null,
      );
    } catch (e) {
      lastErr = e;
      events.log({
        kind: "error",
        message: `registration attempt ${attempt}/${REGISTER_MAX_ATTEMPTS} failed: ${(e as Error).message}`,
        at: Date.now(),
      });
      if (attempt < REGISTER_MAX_ATTEMPTS) {
        const backoff = Math.min(
          REGISTER_BASE_DELAY * 2 ** (attempt - 1),
          REGISTER_MAX_DELAY,
        );
        await delay(backoff);
      }
    }
  }
  events.log({
    kind: "error",
    message: `registration failed after ${REGISTER_MAX_ATTEMPTS} attempts: ${(lastErr as Error).message}`,
    at: Date.now(),
  });
  throw lastErr;
}

export async function startDaemon(config: Config): Promise<Daemon> {
  const storage = new ShardStorage(config.dataDir, config.capacityBytes);
  await storage.init();

  const coordinator = new CoordinatorClient(config.coordinator);
  const events = new Events();

  // Register if we have no node id, or if we have an id but are missing a
  // node token (existing installs from before token auth). In either case the
  // coordinator issues a fresh node row + token.
  if (!config.nodeId || !config.nodeToken) {
    const { nodeId, nodeToken } = await registerWithRetry(
      coordinator,
      config,
      events,
    );
    config = { ...config, nodeId, nodeToken };
    saveConfig(config);
    events.log({
      kind: "registered",
      message: `Registered as ${nodeId}`,
      at: Date.now(),
    });
  }

  coordinator.nodeToken = config.nodeToken!;

  // The storage index is the single source of truth for usage counters. The
  // `state` object reads through to it so usedBytes/shardCount stay correct
  // across both store and delete with no drift and no directory walks.
  const startedAt = Date.now();
  const state = {
    startedAt,
    get usedBytes() {
      return storage.usedBytesSync();
    },
    get shardCount() {
      return storage.shardCountSync();
    },
  };

  // WebSocket client
  const ws = new NodeWSClient({
    coordinatorUrl: config.coordinator,
    nodeId: config.nodeId!,
    nodeToken: config.nodeToken!,
    storage,
    events,
    getUsedBytes: () => state.usedBytes,
    capacityBytes: config.capacityBytes,
    version: VERSION,
  });
  ws.start();

  // Heartbeat loop (still useful — tells coordinator we're alive even between WS messages)
  const heartbeat = async () => {
    try {
      await coordinator.heartbeat(config.nodeId!, {
        usedBytes: state.usedBytes,
        capacityBytes: config.capacityBytes,
      });
    } catch (e) {
      events.log({
        kind: "error",
        message: `heartbeat failed: ${(e as Error).message}`,
        at: Date.now(),
      });
    }
  };

  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL);

  return {
    config,
    storage,
    coordinator,
    events,
    state,
    stop: async () => {
      clearInterval(heartbeatTimer);
      await ws.close();
    },
  };
}
