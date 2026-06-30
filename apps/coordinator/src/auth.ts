import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, randomUUID } from 'crypto';
import { env } from './env.ts';
import { db } from './db.ts';

const secret = new TextEncoder().encode(env.JWT_SECRET);

export interface SessionPayload {
  sub: string;
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
 * Generate a one-time login code for an already-signed-in user, typed into the
 * GUI app to sign in without the email magic-link flow.
 */
export function createLoginCode(userId: string): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    raw += alphabet[bytes[i] % alphabet.length];
  }
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
 * Consume a one-time login code, returning the owning user (or null when
 * unknown, used, or expired). Matched case-insensitively, dashes optional.
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

// --- Device authorization flow (OAuth-style): the desktop app starts a
// pending session, opens /link, and polls until the user approves the code.

/** Readable alphabet shared by login codes and device user codes. */
const READABLE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomReadable(len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += READABLE_ALPHABET[bytes[i] % READABLE_ALPHABET.length];
  return out;
}

export interface DeviceCodeRecord {
  deviceCode: string;
  userCode: string;
  expiresInMinutes: number;
}

/**
 * Begin a device authorization. Returns a secret `deviceCode` the app polls and
 * a short, readable `userCode` (XXXX-XXXX) the person types/approves in the
 * browser. No user is associated until approval.
 */
export function createDeviceCode(): DeviceCodeRecord {
  const deviceCode = randomBytes(32).toString('base64url');
  const raw = randomReadable(8);
  const userCode = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  const now = Date.now();
  const expiresAt = now + env.DEVICE_CODE_TTL_MINUTES * 60_000;
  db.prepare(
    `INSERT INTO device_codes (device_code, user_code, user_id, approved, expires_at, created_at) VALUES (?, ?, NULL, 0, ?, ?)`,
  ).run(deviceCode, userCode, expiresAt, now);
  return {
    deviceCode,
    userCode,
    expiresInMinutes: env.DEVICE_CODE_TTL_MINUTES,
  };
}

/** Normalize a user-entered device user code into canonical XXXX-XXXX form. */
function normalizeUserCode(code: string): string | null {
  const compact = code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (compact.length !== 8) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
}

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'approved'; userId: string; email: string };

/**
 * Poll a device authorization by its secret device code. Returns the current
 * status; once approved, the pending record is consumed (deleted) so the
 * session is issued exactly once.
 */
export function pollDeviceCode(deviceCode: string): DevicePollResult {
  const row = db
    .prepare<
      [string],
      {
        device_code: string;
        user_id: string | null;
        approved: number;
        expires_at: number;
      }
    >(
      `SELECT device_code, user_id, approved, expires_at FROM device_codes WHERE device_code = ?`,
    )
    .get(deviceCode);
  if (!row) return { status: 'not_found' };
  if (row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM device_codes WHERE device_code = ?`).run(deviceCode);
    return { status: 'expired' };
  }
  if (!row.approved || !row.user_id) return { status: 'pending' };

  const user = getUserById(row.user_id);
  if (!user) {
    db.prepare(`DELETE FROM device_codes WHERE device_code = ?`).run(deviceCode);
    return { status: 'not_found' };
  }

  // Consume the pending record so it can't be replayed.
  db.prepare(`DELETE FROM device_codes WHERE device_code = ?`).run(deviceCode);
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(
    Date.now(),
    user.id,
  );
  return { status: 'approved', userId: user.id, email: user.email };
}

/**
 * Approve a pending device authorization by its short user code, binding it to
 * the signed-in user. Returns false when the code is unknown or expired.
 */
export function approveDeviceCode(code: string, userId: string): boolean {
  const normalized = normalizeUserCode(code);
  if (!normalized) return false;

  const row = db
    .prepare<
      [string],
      { user_code: string; expires_at: number; approved: number }
    >(
      `SELECT user_code, expires_at, approved FROM device_codes WHERE user_code = ?`,
    )
    .get(normalized);
  if (!row) return false;
  if (row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM device_codes WHERE user_code = ?`).run(normalized);
    return false;
  }

  db.prepare(
    `UPDATE device_codes SET approved = 1, user_id = ? WHERE user_code = ?`,
  ).run(userId, normalized);
  return true;
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
