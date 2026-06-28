import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, randomUUID } from 'crypto';
import { env } from './env.ts';
import { db } from './db.ts';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface SessionPayload {
  sub: string; // user id
  email: string;
}

export async function issueSession(
  userId: string,
  email: string,
): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_TTL_DAYS}d`)
    .sign(secret);
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return { sub: payload.sub as string, email: payload.email as string };
  } catch {
    return null;
  }
}

export interface ShardUploadToken {
  fileId: string;
  shardIndex: number;
  nodeId: string;
  maxSize: number;
}

export async function issueShardToken(t: ShardUploadToken): Promise<string> {
  return new SignJWT({ ...t, kind: 'shard-upload' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

export async function verifyShardToken(
  token: string,
): Promise<ShardUploadToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== 'shard-upload') return null;
    return {
      fileId: payload.fileId as string,
      shardIndex: payload.shardIndex as number,
      nodeId: payload.nodeId as string,
      maxSize: payload.maxSize as number,
    };
  } catch {
    return null;
  }
}

export interface NodeTokenClaims {
  nodeId: string;
}

export async function issueNodeToken(nodeId: string): Promise<string> {
  return new SignJWT({ nodeId, kind: 'node' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('365d')
    .sign(secret);
}

export async function verifyNodeToken(
  token: string,
): Promise<NodeTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (payload.kind !== 'node') return null;
    return { nodeId: payload.nodeId as string };
  } catch {
    return null;
  }
}

export function createMagicLink(email: string): string {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + env.MAGIC_LINK_TTL_MINUTES * 60_000;
  db.prepare(
    `INSERT INTO magic_links (token, email, expires_at, used) VALUES (?, ?, ?, 0)`,
  ).run(token, email.toLowerCase(), expiresAt);
  return token;
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
}

/** Generate a username from an email local-part that is unique in `users`. */
function generateUsername(email: string): string {
  const base =
    email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24) || 'user';
  const taken = db.prepare<[string], { id: string }>(
    `SELECT id FROM users WHERE username = ?`,
  );
  if (!taken.get(base)) return base;
  for (let i = 0; i < 1000; i++) {
    const candidate = `${base}-${randomBytes(2).toString('hex')}`;
    if (!taken.get(candidate)) return candidate;
  }
  // Extremely unlikely fallback.
  return `${base}-${randomUUID().slice(0, 8)}`;
}

/** Load a single user by id, or null if not found. */
export function getUserById(id: string): UserRecord | null {
  const row = db
    .prepare<
      [string],
      { id: string; email: string; username: string | null }
    >(`SELECT id, email, username FROM users WHERE id = ?`)
    .get(id);
  if (!row) return null;
  return { id: row.id, email: row.email, username: row.username ?? '' };
}

/**
 * Generate a one-time login code for an already-signed-in user. The code is a
 * short, human-friendly string that can be typed into the GUI app to sign in
 * without going through the email magic-link flow.
 */
export function createLoginCode(userId: string): string {
  // Avoid ambiguous characters (0/O, 1/I/L) so codes are easy to read & type.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
  // Format as XXXX-XXXX-XXXX for readability.
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const now = Date.now();
  const expiresAt = now + env.LOGIN_CODE_TTL_MINUTES * 60_000;
  db.prepare(
    `INSERT INTO login_codes (code, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)`,
  ).run(code, userId, expiresAt, now);
  return code;
}

/** Normalize a user-entered code into the canonical XXXX-XXXX-XXXX form. */
function normalizeLoginCode(code: string): string | null {
  const compact = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 12) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`;
}

/**
 * Consume a one-time login code, returning the owning user (or null when the
 * code is unknown, already used, or expired). Codes are matched
 * case-insensitively and tolerate surrounding whitespace / missing dashes.
 */
export function consumeLoginCode(
  code: string,
): { userId: string; email: string } | null {
  const normalized = normalizeLoginCode(code);
  if (!normalized) return null;

  const row = db
    .prepare<
      [string],
      { code: string; user_id: string; expires_at: number; used: number }
    >(`SELECT code, user_id, expires_at, used FROM login_codes WHERE code = ?`)
    .get(normalized);
  if (!row) return null;
  if (row.used) return null;
  if (row.expires_at < Date.now()) return null;

  db.prepare(`UPDATE login_codes SET used = 1 WHERE code = ?`).run(normalized);

  const user = getUserById(row.user_id);
  if (!user) return null;

  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(
    Date.now(),
    user.id,
  );

  return { userId: user.id, email: user.email };
}

export function consumeMagicLink(
  token: string,
): { userId: string; email: string } | null {
  const row = db
    .prepare<
      [string],
      { token: string; email: string; expires_at: number; used: number }
    >(`SELECT token, email, expires_at, used FROM magic_links WHERE token = ?`)
    .get(token);
  if (!row) return null;
  if (row.used) return null;
  if (row.expires_at < Date.now()) return null;

  db.prepare(`UPDATE magic_links SET used = 1 WHERE token = ?`).run(token);

  // Get or create user
  let user = db
    .prepare<[string], { id: string }>(`SELECT id FROM users WHERE email = ?`)
    .get(row.email);

  if (!user) {
    const id = randomUUID();
    const now = Date.now();
    const username = generateUsername(row.email);
    db.prepare(
      `INSERT INTO users (id, email, username, credits, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, row.email, username, env.INITIAL_CREDITS, now, now);
    db.prepare(
      `INSERT INTO credit_events (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)`,
    ).run(id, env.INITIAL_CREDITS, 'signup_bonus', now);
    user = { id };
  } else {
    db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(
      Date.now(),
      user.id,
    );
  }

  return { userId: user.id, email: row.email };
}
