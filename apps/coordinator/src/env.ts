import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_PATH: z.string().default('./data/scatter.db'),

  JWT_SECRET: z.string().min(32),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().default(15),
  LOGIN_CODE_TTL_MINUTES: z.coerce.number().default(10),
  DEVICE_CODE_TTL_MINUTES: z.coerce.number().default(10),
  SESSION_TTL_DAYS: z.coerce.number().default(30),

  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // Fastify trustProxy. Set ONLY behind a trusted proxy, else clients can spoof
  // X-Forwarded-For to evade rate limits. false | true | <hops> | <csv IPs/CIDRs>.
  TRUST_PROXY: z.string().default('false'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Scatter <noreply@scatter.tools>'),

  ANONYMOUS_MAX_FILE_BYTES: z.coerce.number().default(100 * 1024 * 1024),
  FREE_MAX_FILE_BYTES: z.coerce.number().default(1024 * 1024 * 1024),
  MAX_SHARD_BYTES: z.coerce.number().default(4 * 1024 * 1024),

  INITIAL_CREDITS: z.coerce.number().default(100),

  // Dev only: allow one node to hold multiple shards of a file (false in prod).
  ALLOW_SHARD_STACKING: z
    .string()
    .transform((s) => s === 'true' || s === '1')
    .default('false'),
});

export const env = schema.parse(process.env);
export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) =>
  s.trim(),
);

/**
 * Normalize TRUST_PROXY into the shape Fastify's `trustProxy` option accepts:
 *   "false"/"" -> false   "true" -> true   "2" -> 2 (hop count)
 *   "10.0.0.0/8,127.0.0.1" -> ["10.0.0.0/8", "127.0.0.1"]
 */
function parseTrustProxy(raw: string): boolean | number | string[] {
  const v = raw.trim();
  if (v === '' || v.toLowerCase() === 'false') return false;
  if (v.toLowerCase() === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const trustProxy = parseTrustProxy(env.TRUST_PROXY);
