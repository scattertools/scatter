import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// Mirror auth.test.ts setup: env must be populated before auth.ts/db.ts import
// (env.ts validates with zod at import time and requires a 32-char JWT_SECRET),
// and DATABASE_PATH points at a throwaway temp file so we never touch ./data.
// Unlike the auth round-trip tests, login codes DO hit the DB, so we insert a
// user row first and let db.ts create the schema (including login_codes).
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-logincode-')),
  'scatter.db',
);

const { db } = await import('../src/db.ts');
const auth = await import('../src/auth.ts');

const USER_ID = 'user-login-code';
const EMAIL = 'codeuser@example.com';

// Seed a user the codes can belong to.
db.prepare(
  `INSERT INTO users (id, email, username, credits, created_at, last_login_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
).run(USER_ID, EMAIL, 'codeuser', 0, Date.now(), Date.now());

test('createLoginCode produces a XXXX-XXXX-XXXX code', () => {
  const code = auth.createLoginCode(USER_ID);
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

test('consumeLoginCode returns the owning user for a fresh code', () => {
  const code = auth.createLoginCode(USER_ID);
  const result = auth.consumeLoginCode(code);
  assert.ok(result);
  assert.equal(result.userId, USER_ID);
  assert.equal(result.email, EMAIL);
});

test('a login code is single-use', () => {
  const code = auth.createLoginCode(USER_ID);
  assert.ok(auth.consumeLoginCode(code));
  assert.equal(auth.consumeLoginCode(code), null);
});

test('consumeLoginCode tolerates whitespace, case and missing dashes', () => {
  const code = auth.createLoginCode(USER_ID);
  const compact = code.replace(/-/g, '').toLowerCase();
  const result = auth.consumeLoginCode(`  ${compact}  `);
  assert.ok(result);
  assert.equal(result.userId, USER_ID);
});

test('consumeLoginCode returns null for unknown / malformed codes', () => {
  assert.equal(auth.consumeLoginCode('ZZZZ-ZZZZ-ZZZZ'), null);
  assert.equal(auth.consumeLoginCode('too-short'), null);
  assert.equal(auth.consumeLoginCode(''), null);
});

test('consumeLoginCode returns null for an expired code', () => {
  const code = auth.createLoginCode(USER_ID);
  // Force-expire it in the DB.
  db.prepare(`UPDATE login_codes SET expires_at = ? WHERE code = ?`).run(
    Date.now() - 1000,
    code,
  );
  assert.equal(auth.consumeLoginCode(code), null);
});
