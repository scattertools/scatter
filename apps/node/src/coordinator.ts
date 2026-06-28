interface RegisterResponse {
  nodeId: string;
  nodeToken: string;
}

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
}
