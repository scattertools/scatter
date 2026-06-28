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
  SESSION_TTL_DAYS: z.coerce.number().default(30),

  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Scatter <noreply@scatter.tools>'),

  ANONYMOUS_MAX_FILE_BYTES: z.coerce.number().default(100 * 1024 * 1024),
  FREE_MAX_FILE_BYTES: z.coerce.number().default(1024 * 1024 * 1024),
  MAX_SHARD_BYTES: z.coerce.number().default(4 * 1024 * 1024),

  INITIAL_CREDITS: z.coerce.number().default(100),

  // Dev: allow one node to hold multiple shards of the same file
  // In production, leave as false for actual redundancy
  ALLOW_SHARD_STACKING: z
    .string()
    .transform((s) => s === 'true' || s === '1')
    .default('false'),
});

export const env = schema.parse(process.env);
export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) =>
  s.trim(),
);
