import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createMagicLink,
  consumeMagicLink,
  createLoginCode,
  consumeLoginCode,
  createDeviceCode,
  pollDeviceCode,
  approveDeviceCode,
  issueSession,
  getUserById,
} from '../auth.ts';
import { db } from '../db.ts';
import { sendMagicLink } from '../mailer.ts';
import { env } from '../env.ts';

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'username must be at least 3 characters')
  .max(24, 'username must be at most 24 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'username may only contain letters, numbers, hyphens and underscores',
  );

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/request',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          // Key on IP + email so one IP can't blast many addresses and one
          // address can't be bombed from one source.
          keyGenerator: (req) => {
            const email =
              req.body &&
              typeof req.body === 'object' &&
              'email' in req.body &&
              typeof (req.body as { email?: unknown }).email === 'string'
                ? (req.body as { email: string }).email.toLowerCase().trim()
                : '';
            return `${req.ip}:${email}`;
          },
        },
      },
    },
    async (req, reply) => {
      const body = z.object({ email: z.string().email() }).parse(req.body);
      const token = createMagicLink(body.email);
      const link = `${env.WEB_BASE_URL}/auth/callback?token=${token}`;
      await sendMagicLink(body.email, link);
      return { ok: true };
    },
  );

  app.post(
    '/auth/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ token: z.string() }).parse(req.body);
      const result = consumeMagicLink(body.token);
      if (!result)
        return reply.code(400).send({ error: 'invalid or expired token' });
      const session = await issueSession(result.userId, result.email);
      const user = getUserById(result.userId);
      return {
        session,
        user: user ?? { id: result.userId, email: result.email, username: '' },
      };
    },
  );

  // Issue a one-time login code for the signed-in user (typed into the GUI app).
  app.post(
    '/auth/code',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req) => {
      const code = createLoginCode(req.user!.sub);
      return { code, expiresInMinutes: env.LOGIN_CODE_TTL_MINUTES };
    },
  );

  // Exchange a one-time login code for a session. Public but rate-limited.
  app.post(
    '/auth/code/verify',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ code: z.string() }).parse(req.body);
      const result = consumeLoginCode(body.code);
      if (!result)
        return reply.code(400).send({ error: 'invalid or expired code' });
      const session = await issueSession(result.userId, result.email);
      const user = getUserById(result.userId);
      return {
        session,
        user: user ?? { id: result.userId, email: result.email, username: '' },
      };
    },
  );

  // Device authorization flow (OAuth-style): start a session, then poll.
  app.post(
    '/auth/device/start',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async () => {
      const { deviceCode, userCode, expiresInMinutes } = createDeviceCode();
      return {
        deviceCode,
        userCode,
        verificationUrl: `${env.WEB_BASE_URL}/link`,
        verificationUrlComplete: `${env.WEB_BASE_URL}/link?code=${encodeURIComponent(userCode)}`,
        expiresInMinutes,
        pollIntervalSeconds: 3,
      };
    },
  );

  // Poll a pending device authorization; issues the session once approved.
  app.post(
    '/auth/device/poll',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z.object({ deviceCode: z.string() }).parse(req.body);
      const result = pollDeviceCode(body.deviceCode);
      if (result.status === 'not_found')
        return reply.code(404).send({ status: 'not_found' });
      if (result.status === 'expired')
        return reply.code(410).send({ status: 'expired' });
      if (result.status === 'pending') return { status: 'pending' };

      const session = await issueSession(result.userId, result.email);
      const user = getUserById(result.userId);
      return {
        status: 'approved',
        session,
        user: user ?? { id: result.userId, email: result.email, username: '' },
      };
    },
  );

  // Approve a pending device authorization by user code (requires web sign-in).
  app.post(
    '/auth/device/approve',
    {
      preHandler: app.requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const body = z.object({ userCode: z.string() }).parse(req.body);
      const ok = approveDeviceCode(body.userCode, req.user!.sub);
      if (!ok)
        return reply.code(400).send({ error: 'invalid or expired code' });
      return { ok: true };
    },
  );

  app.get('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const user = getUserById(req.user!.sub);
    if (!user) return reply.code(404).send({ error: 'user not found' });
    return { user };
  });

  // Update the signed-in user's profile (currently just username).
  app.patch('/auth/me', { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = z
      .object({ username: usernameSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: parsed.error.issues[0]?.message ?? 'invalid username' });
    }
    const username = parsed.data.username;
    const userId = req.user!.sub;

    // Enforce case-insensitive uniqueness.
    const clash = db
      .prepare<
        [string, string],
        { id: string }
      >(`SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?`)
      .get(username, userId);
    if (clash) {
      return reply.code(409).send({ error: 'username is already taken' });
    }

    try {
      db.prepare(`UPDATE users SET username = ? WHERE id = ?`).run(
        username,
        userId,
      );
    } catch {
      return reply.code(409).send({ error: 'username is already taken' });
    }

    const user = getUserById(userId);
    if (!user) return reply.code(404).send({ error: 'user not found' });
    return { user };
  });
}
