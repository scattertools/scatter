import WebSocket from 'ws';
import type { ShardStorage } from './storage.ts';
import type { Events } from './events.ts';

interface Message {
  id: string;
  cmd: 'store' | 'retrieve' | 'delete' | 'ping';
  fileId?: string;
  shardIndex?: number;
  hash?: string;
  data?: string; // base64
}

interface Response {
  id: string;
  ok: boolean;
  error?: string;
  data?: string; // base64
  size?: number;
}

export interface NodeWSOptions {
  coordinatorUrl: string;
  nodeId: string;
  nodeToken: string;
  storage: ShardStorage;
  events: Events;
  getUsedBytes: () => number;
  capacityBytes: number;
  version: string;
  onReconnect?: () => void;
}

export class NodeWSClient {
  private ws: WebSocket | null = null;
  private opts: NodeWSOptions;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30_000;

  constructor(opts: NodeWSOptions) {
    this.opts = opts;
  }

  start() {
    this.connect();
  }

  private wsUrl(): string {
    const url = new URL(this.opts.coordinatorUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/nodes/${this.opts.nodeId}/connect`;
    return url.toString();
  }

  private connect() {
    if (this.closed) return;

    const url = this.wsUrl();
    this.ws = new WebSocket(url, {
      headers: {
        'x-node-version': this.opts.version,
        'x-node-capacity': String(this.opts.capacityBytes),
        'x-node-token': this.opts.nodeToken,
        Authorization: `Bearer ${this.opts.nodeToken}`,
      },
    });

    this.ws.on('open', () => {
      this.opts.events.log({
        kind: 'registered',
        message: 'connected to coordinator',
        at: Date.now(),
      });
      this.reconnectDelay = 1000;
      this.opts.onReconnect?.();
    });

    this.ws.on('message', async (raw) => {
      let msg: Message;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const response = await this.handleMessage(msg);
      if (response && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(response));
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      this.opts.events.log({
        kind: 'error',
        message: `ws: ${err.message}`,
        at: Date.now(),
      });
    });
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      this.connect();
    }, this.reconnectDelay);
  }

  private async handleMessage(msg: Message): Promise<Response | null> {
    const { opts } = this;
    try {
      switch (msg.cmd) {
        case 'ping':
          return { id: msg.id, ok: true };

        case 'store': {
          if (
            !msg.fileId ||
            msg.shardIndex === undefined ||
            !msg.hash ||
            !msg.data
          ) {
            return { id: msg.id, ok: false, error: 'missing fields' };
          }
          const data = new Uint8Array(Buffer.from(msg.data, 'base64'));
          await opts.storage.store(msg.fileId, msg.shardIndex, data, msg.hash);
          opts.events.log({
            kind: 'uploaded',
            fileId: msg.fileId,
            shardIndex: msg.shardIndex,
            size: data.length,
            at: Date.now(),
          });
          return { id: msg.id, ok: true, size: data.length };
        }

        case 'retrieve': {
          if (!msg.fileId || msg.shardIndex === undefined) {
            return { id: msg.id, ok: false, error: 'missing fields' };
          }
          const data = await opts.storage.retrieve(msg.fileId, msg.shardIndex);
          if (!data) {
            return { id: msg.id, ok: false, error: 'not found' };
          }
          opts.events.log({
            kind: 'downloaded',
            fileId: msg.fileId,
            shardIndex: msg.shardIndex,
            size: data.length,
            at: Date.now(),
          });
          return {
            id: msg.id,
            ok: true,
            data: Buffer.from(data).toString('base64'),
            size: data.length,
          };
        }

        case 'delete': {
          if (!msg.fileId || msg.shardIndex === undefined) {
            return { id: msg.id, ok: false, error: 'missing fields' };
          }
          const removed = await opts.storage.remove(msg.fileId, msg.shardIndex);
          if (removed) {
            opts.events.log({
              kind: 'deleted',
              fileId: msg.fileId,
              shardIndex: msg.shardIndex,
              size: 0,
              at: Date.now(),
            });
          }
          return { id: msg.id, ok: true };
        }
      }
    } catch (e) {
      return { id: msg.id, ok: false, error: (e as Error).message };
    }
    return null;
  }

  async close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
