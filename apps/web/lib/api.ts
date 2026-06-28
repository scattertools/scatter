import type { FileManifest } from '@scatter/protocol';
import { API_URL } from './env';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

interface FetchOptions extends RequestInit {
  auth?: string | null;
  json?: unknown;
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers = new Headers(opts.headers);
  if (opts.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (opts.auth) {
    headers.set('Authorization', `Bearer ${opts.auth}`);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const msg =
      (body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string'
        ? body.error
        : null) ?? `Request failed: ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }

  return body as T;
}

export interface User {
  id: string;
  email: string;
  username: string;
}

export interface NetworkStats {
  activeNodes: number;
  totalCapacityBytes: number;
  totalUsedBytes: number;
  filesScattered: number;
}

export interface ShardAssignment {
  shardIndex: number;
  nodeId: string;
  uploadToken: string;
}

export interface UploadPlan {
  fileId: string;
  assignments: ShardAssignment[];
}

export interface DownloadPlan {
  manifest: FileManifest;
  locations: Array<{
    shardIndex: number;
    nodeId: string;
    size: number;
    hash: string;
  }>;
}

export interface UserFile {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
  expiresAt: number | null;
}

export interface CreditEvent {
  delta: number;
  reason: string;
  createdAt: number;
  refId: string | null;
}

export interface Credits {
  balance: number;
  history: CreditEvent[];
}

export const api = {
  requestMagicLink: (email: string) =>
    request<{ ok: boolean }>('/auth/request', {
      method: 'POST',
      json: { email },
    }),

  verifyMagicLink: (token: string) =>
    request<{ session: string; user: User }>('/auth/verify', {
      method: 'POST',
      json: { token },
    }),

  me: (session: string) =>
    request<{ user: User }>('/auth/me', { auth: session }),

  updateUsername: (username: string, session: string) =>
    request<{ user: User }>('/auth/me', {
      method: 'PATCH',
      json: { username },
      auth: session,
    }),

  createLoginCode: (session: string) =>
    request<{ code: string; expiresInMinutes: number }>('/auth/code', {
      method: 'POST',
      auth: session,
    }),

  stats: () => request<NetworkStats>('/nodes/stats'),

  uploadPlan: (manifest: FileManifest, session?: string | null) =>
    request<UploadPlan>('/files/upload/plan', {
      method: 'POST',
      json: manifest,
      auth: session ?? null,
    }),

  downloadPlan: (fileId: string) =>
    request<DownloadPlan>(`/files/${fileId}/plan`),

  listFiles: (session: string) =>
    request<{ files: UserFile[] }>('/files', { auth: session }),

  deleteFile: (fileId: string, session: string) =>
    request<{ ok: boolean }>(`/files/${fileId}`, {
      method: 'DELETE',
      auth: session,
    }),

  getCredits: (session: string) =>
    request<Credits>('/credits', { auth: session }),
};
