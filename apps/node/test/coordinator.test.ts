import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { CoordinatorClient } from '../src/coordinator.ts';

// --- minimal fetch stub --------------------------------------------------

type Handler = (
  url: string,
  init: RequestInit,
) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>;

const realFetch = globalThis.fetch;
let lastRequest: { url: string; init: RequestInit } | null = null;

function stubFetch(handler: Handler) {
  globalThis.fetch = (async (input: any, init: RequestInit = {}) => {
    const url = String(input);
    lastRequest = { url, init };
    const { status = 200, body = {} } = await handler(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  lastRequest = null;
});

// --- register ------------------------------------------------------------

test('register posts capacity + version and returns node id/token', async () => {
  stubFetch((url) => {
    assert.equal(url, 'http://c/nodes/register');
    return { body: { nodeId: 'n1', nodeToken: 't1' } };
  });
  const client = new CoordinatorClient('http://c');
  const r = await client.register(100, '0.1.0');
  assert.deepEqual(r, { nodeId: 'n1', nodeToken: 't1' });
  const sent = JSON.parse(lastRequest!.init.body as string);
  assert.equal(sent.capacityBytes, 100);
  assert.equal(sent.version, '0.1.0');
});

test('register forwards session token as bearer auth', async () => {
  stubFetch(() => ({ body: { nodeId: 'n', nodeToken: 't' } }));
  const client = new CoordinatorClient('http://c');
  await client.register(1, '0.1.0', 'sess-123');
  const headers = lastRequest!.init.headers as Record<string, string>;
  assert.equal(headers['Authorization'], 'Bearer sess-123');
});

// --- device login --------------------------------------------------------

test('startDeviceLogin returns the device + user codes', async () => {
  stubFetch((url) => {
    assert.equal(url, 'http://c/auth/device/start');
    return {
      body: {
        deviceCode: 'dev',
        userCode: 'ABCD',
        verificationUrl: 'http://web/link',
        verificationUrlComplete: 'http://web/link?code=ABCD',
        expiresInMinutes: 10,
        pollIntervalSeconds: 3,
      },
    };
  });
  const client = new CoordinatorClient('http://c');
  const d = await client.startDeviceLogin();
  assert.equal(d.deviceCode, 'dev');
  assert.equal(d.userCode, 'ABCD');
});

test('pollDeviceLogin maps pending / approved / expired / not_found', async () => {
  const client = new CoordinatorClient('http://c');

  stubFetch(() => ({ body: { status: 'pending' } }));
  assert.deepEqual(await client.pollDeviceLogin('dev'), { status: 'pending' });

  stubFetch(() => ({
    body: { status: 'approved', session: 's', user: { email: 'a@b.com', username: 'a' } },
  }));
  const approved = await client.pollDeviceLogin('dev');
  assert.equal(approved.status, 'approved');
  if (approved.status === 'approved') assert.equal(approved.session, 's');

  stubFetch(() => ({ status: 410, body: { status: 'expired' } }));
  assert.deepEqual(await client.pollDeviceLogin('dev'), { status: 'expired' });

  stubFetch(() => ({ status: 404, body: { status: 'not_found' } }));
  assert.deepEqual(await client.pollDeviceLogin('dev'), { status: 'not_found' });
});

// --- login with code -----------------------------------------------------

test('loginWithCode trims the code and returns the session', async () => {
  stubFetch((url) => {
    assert.equal(url, 'http://c/auth/code/verify');
    return { body: { session: 'sess', user: { email: 'a@b.com', username: 'a' } } };
  });
  const client = new CoordinatorClient('http://c');
  const r = await client.loginWithCode('  CODE-123  ');
  assert.equal(r.session, 'sess');
  assert.equal(JSON.parse(lastRequest!.init.body as string).code, 'CODE-123');
});

// --- me / credits / username --------------------------------------------

test('me sends bearer auth and unwraps the user', async () => {
  stubFetch((url) => {
    assert.equal(url, 'http://c/auth/me');
    return { body: { user: { email: 'a@b.com', username: 'alice' } } };
  });
  const client = new CoordinatorClient('http://c');
  const user = await client.me('sess');
  assert.equal(user.username, 'alice');
  assert.equal(
    (lastRequest!.init.headers as Record<string, string>)['Authorization'],
    'Bearer sess',
  );
});

test('credits returns the numeric balance', async () => {
  stubFetch((url) => {
    assert.equal(url, 'http://c/credits');
    return { body: { balance: 42 } };
  });
  const client = new CoordinatorClient('http://c');
  assert.equal(await client.credits('sess'), 42);
});

test('updateUsername PATCHes and returns the updated user', async () => {
  stubFetch((url, init) => {
    assert.equal(url, 'http://c/auth/me');
    assert.equal(init.method, 'PATCH');
    return { body: { user: { email: 'a@b.com', username: 'newname' } } };
  });
  const client = new CoordinatorClient('http://c');
  const user = await client.updateUsername('sess', '  newname ');
  assert.equal(user.username, 'newname');
  assert.equal(JSON.parse(lastRequest!.init.body as string).username, 'newname');
});

test('updateUsername surfaces the coordinator error body on failure', async () => {
  stubFetch(() => ({ status: 409, body: { error: 'username is already taken' } }));
  const client = new CoordinatorClient('http://c');
  await assert.rejects(
    () => client.updateUsername('sess', 'taken'),
    /username is already taken/,
  );
});
