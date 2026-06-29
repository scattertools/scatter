interface RegisterResponse {
  nodeId: string;
  nodeToken: string;
}

export interface AccountUser {
  id?: string;
  email: string;
  username: string;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresInMinutes: number;
  pollIntervalSeconds: number;
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'approved'; session: string; user: AccountUser };

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class CoordinatorClient {
  public baseUrl: string;
  public nodeToken: string | null = null;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS) {
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(
          `${init.method ?? 'GET'} ${path} -> request timed out after ${this.timeoutMs}ms`,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `${init.method ?? 'GET'} ${path} -> ${res.status}: ${body}`,
      );
    }
    return res.json() as Promise<T>;
  }

  async register(
    capacityBytes: number,
    version: string,
    sessionToken?: string | null,
  ): Promise<{ nodeId: string; nodeToken: string }> {
    const headers: Record<string, string> = {};
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    const r = await this.request<RegisterResponse>('/nodes/register', {
      method: 'POST',
      headers,
      body: JSON.stringify({ capacityBytes, version }),
    });
    return { nodeId: r.nodeId, nodeToken: r.nodeToken };
  }

  async heartbeat(
    nodeId: string,
    opts: { usedBytes?: number; capacityBytes?: number } = {},
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (this.nodeToken) headers['Authorization'] = `Bearer ${this.nodeToken}`;
    await this.request(`/nodes/${nodeId}/heartbeat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts),
    });
  }

  /**
   * Step 1 of the OAuth-style device login: ask the coordinator for a device
   * code + short user code the user approves in the browser.
   */
  async startDeviceLogin(): Promise<DeviceStart> {
    return this.request<DeviceStart>('/auth/device/start', { method: 'POST' });
  }

  /**
   * Step 2: poll with the secret device code. Resolves to the current status;
   * `approved` carries the session + user. Unlike most requests, the 404/410
   * "gone"/"expired" responses are surfaced as states rather than thrown.
   */
  async pollDeviceLogin(deviceCode: string): Promise<DevicePoll> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl}/auth/device/poll`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) return { status: 'not_found' };
    if (res.status === 410) return { status: 'expired' };
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`POST /auth/device/poll -> ${res.status}: ${body}`);
    }
    return res.json() as Promise<DevicePoll>;
  }

  /** Exchange a one-time login code (from web account settings) for a session. */
  async loginWithCode(
    code: string,
  ): Promise<{ session: string; user: AccountUser }> {
    return this.request('/auth/code/verify', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
  }

  /** Fetch the signed-in user's profile. */
  async me(session: string): Promise<AccountUser> {
    const r = await this.request<{ user: AccountUser }>('/auth/me', {
      headers: { Authorization: `Bearer ${session}` },
    });
    return r.user;
  }

  /** Fetch the signed-in user's credit balance. */
  async credits(session: string): Promise<number> {
    const r = await this.request<{ balance: number }>('/credits', {
      headers: { Authorization: `Bearer ${session}` },
    });
    return r.balance;
  }

  /** Update the signed-in user's username. */
  async updateUsername(
    session: string,
    username: string,
  ): Promise<AccountUser> {
    const r = await this.request<{ user: AccountUser }>('/auth/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session}` },
      body: JSON.stringify({ username: username.trim() }),
    });
    return r.user;
  }
}
