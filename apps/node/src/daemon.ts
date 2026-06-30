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
 * transient startup outage does not crash the node. Rethrows after exhausting
 * all attempts.
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

  // Register when missing a node id or token (pre-token-auth installs); the
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

  // The storage index is the source of truth for usage counters; `state` reads
  // through to it so usedBytes/shardCount stay correct with no drift.
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

  // Heartbeat loop — tells the coordinator we're alive between WS messages.
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
