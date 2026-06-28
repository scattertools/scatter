import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'crypto';

interface Pending {
  resolve: (resp: NodeResponse) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface NodeResponse {
  id: string;
  ok: boolean;
  error?: string;
  data?: string; // base64
  size?: number;
}

interface Connection {
  socket: WebSocket;
  pending: Map<string, Pending>;
}

const REQUEST_TIMEOUT_MS = 60_000;

class NodeHub {
  private connections = new Map<string, Connection>();

  register(nodeId: string, socket: WebSocket) {
    // If already connected, kick the old one
    const existing = this.connections.get(nodeId);
    if (existing) {
      try {
        existing.socket.close();
      } catch {}
    }

    const conn: Connection = { socket, pending: new Map() };
    this.connections.set(nodeId, conn);

    socket.on('message', (raw: Buffer) => {
      try {
        const resp = JSON.parse(raw.toString()) as NodeResponse;
        const pending = conn.pending.get(resp.id);
        if (pending) {
          clearTimeout(pending.timeout);
          conn.pending.delete(resp.id);
          pending.resolve(resp);
        }
      } catch {
        // malformed, ignore
      }
    });

    socket.on('close', () => {
      if (this.connections.get(nodeId) === conn) {
        this.connections.delete(nodeId);
      }
      for (const pending of conn.pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('node disconnected'));
      }
      conn.pending.clear();
    });
  }

  isOnline(nodeId: string): boolean {
    return this.connections.has(nodeId);
  }

  connectedNodes(): string[] {
    return Array.from(this.connections.keys());
  }

  async send(
    nodeId: string,
    command: {
      cmd: 'store' | 'retrieve' | 'delete' | 'ping';
      fileId?: string;
      shardIndex?: number;
      hash?: string;
      data?: string;
    },
  ): Promise<NodeResponse> {
    const conn = this.connections.get(nodeId);
    if (!conn) throw new Error(`node ${nodeId} not connected`);

    const id = randomUUID();
    const message = { id, ...command };

    return new Promise<NodeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`node ${nodeId} request timeout`));
      }, REQUEST_TIMEOUT_MS);

      conn.pending.set(id, { resolve, reject, timeout });

      try {
        conn.socket.send(JSON.stringify(message));
      } catch (e) {
        clearTimeout(timeout);
        conn.pending.delete(id);
        reject(e as Error);
      }
    });
  }
}

export const nodeHub = new NodeHub();
