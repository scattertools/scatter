import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Same setup contract as auth.test.ts / login-code.test.ts: env must be
// populated before db.ts/auth.ts import (env.ts validates with zod at import
// time and requires a 32-char JWT_SECRET), and DATABASE_PATH points at a
// throwaway temp file so we never touch ./data.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-magiclink-')),
  'scatter.db',
);

const { db } = await import('../src/db.ts');
const auth = await import('../src/auth.ts');
const { env } = await import('../src/env.ts');

function userByEmail(email: string) {
  return db
    .prepare<
      [string],
      { id: string; email: string; username: string; credits: number }
    >(`SELECT id, email, username, credits FROM users WHERE email = ?`)
    .get(email.toLowerCase());
}

test('createMagicLink stores a single-use, base64url token for the lower-cased email', () => {
  const token = auth.createMagicLink('Fresh.User@Example.COM');
  assert.match(token, /^[A-Za-z0-9_-]+$/);

  const row = db
    .prepare<
      [string],
      { email: string; used: number; expires_at: number }
    >(`SELECT email, used, expires_at FROM magic_links WHERE token = ?`)
    .get(token);
  assert.ok(row);
  assert.equal(row.email, 'fresh.user@example.com');
  assert.equal(row.used, 0);
  assert.ok(row.expires_at > Date.now());
});

test('consumeMagicLink creates a new user with initial credits + signup bonus event', () => {
  const email = 'newcomer@example.com';
  const token = auth.createMagicLink(email);

  assert.equal(userByEmail(email), undefined, 'user should not exist yet');

  const result = auth.consumeMagicLink(token);
  assert.ok(result);
  assert.equal(result.email, email);

  const user = userByEmail(email);
  assert.ok(user);
  assert.equal(user.id, result.userId);
  assert.equal(user.credits, env.INITIAL_CREDITS);
  // Username derived from the email local-part.
  assert.equal(user.username, 'newcomer');

  // A signup_bonus credit event was recorded for the new user.
  const event = db
    .prepare<
      [string],
      { delta: number; reason: string }
    >(
      `SELECT delta, reason FROM credit_events WHERE user_id = ? AND reason = 'signup_bonus'`,
    )
    .get(user.id);
  assert.ok(event);
  assert.equal(event.delta, env.INITIAL_CREDITS);
});

test('a magic link is single-use', () => {
  const token = auth.createMagicLink('singleuse@example.com');
  assert.ok(auth.consumeMagicLink(token));
  assert.equal(auth.consumeMagicLink(token), null);
});

test('consuming a magic link for an existing user reuses the account (no new credits)', () => {
  const email = 'returning@example.com';

  const first = auth.consumeMagicLink(auth.createMagicLink(email));
  assert.ok(first);
  const created = userByEmail(email);
  assert.ok(created);
  const creditsAfterSignup = created.credits;

  const second = auth.consumeMagicLink(auth.createMagicLink(email));
  assert.ok(second);
  assert.equal(second.userId, first.userId, 'same user id reused');

  const after = userByEmail(email);
  assert.ok(after);
  assert.equal(after.credits, creditsAfterSignup, 'no extra credits granted');

  // Only ONE signup bonus ever.
  const bonusCount = db
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n FROM credit_events WHERE user_id = ? AND reason = 'signup_bonus'`,
    )
    .get(after.id);
  assert.equal(bonusCount?.n, 1);
});

test('email casing is normalized so different-cased logins hit one account', () => {
  const lower = auth.consumeMagicLink(auth.createMagicLink('case@example.com'));
  const upper = auth.consumeMagicLink(auth.createMagicLink('CASE@example.com'));
  assert.ok(lower);
  assert.ok(upper);
  assert.equal(lower.userId, upper.userId);
});

test('two new users from the same local-part get distinct usernames', () => {
  const a = auth.consumeMagicLink(auth.createMagicLink('dup@aaa.com'));
  const b = auth.consumeMagicLink(auth.createMagicLink('dup@bbb.com'));
  assert.ok(a);
  assert.ok(b);
  const ua = auth.getUserById(a.userId);
  const ub = auth.getUserById(b.userId);
  assert.ok(ua);
  assert.ok(ub);
  assert.equal(ua.username, 'dup'); // first claims the bare local-part
  assert.notEqual(ub.username, ua.username); // second is suffixed for uniqueness
  assert.match(ub.username, /^dup-[0-9a-f]{4}$/);
});

test('consumeMagicLink returns null for unknown / expired tokens', () => {
  assert.equal(auth.consumeMagicLink('definitely-not-a-real-token'), null);

  const token = auth.createMagicLink('expired@example.com');
  db.prepare(`UPDATE magic_links SET expires_at = ? WHERE token = ?`).run(
    Date.now() - 1000,
    token,
  );
  assert.equal(auth.consumeMagicLink(token), null);
});

test('getUserById returns null for an unknown id', () => {
  assert.equal(auth.getUserById('no-such-user'), null);
});
