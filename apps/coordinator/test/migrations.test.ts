import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// db.ts reads env at import. Point at a throwaway path; the tests below operate
// on their OWN in-memory databases via the exported runMigrations(), so the
// module-level db is irrelevant to the assertions.
process.env.JWT_SECRET ??= 'test-secret-at-least-32-chars-long-xx';
process.env.DATABASE_PATH ??= join(
  mkdtempSync(join(tmpdir(), 'scatter-migrate-')),
  'scatter.db',
);

const Database = (await import('better-sqlite3')).default;
const { runMigrations } = await import('../src/db.ts');

const EXPECTED_TABLES = [
  'credit_events',
  'device_codes',
  'files',
  'login_codes',
  'magic_links',
  'nodes',
  'shards',
  'users',
];

function tableNames(d: InstanceType<typeof Database>): string[] {
  return (
    d
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

const LATEST_VERSION = 2;

test('a fresh database migrates to the latest version with the full schema', () => {
  const d = new Database(':memory:');
  runMigrations(d);

  assert.equal(d.pragma('user_version', { simple: true }), LATEST_VERSION);
  assert.deepEqual(tableNames(d), EXPECTED_TABLES);

  // The 0002 migration's column + unique index are present.
  const cols = (
    d.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>
  ).map((c) => c.name);
  assert.ok(cols.includes('username'), 'users.username exists');
  const idx = d
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_username'`,
    )
    .get();
  assert.ok(idx, 'unique username index exists');
});

test('running migrations again is a no-op (idempotent)', () => {
  const d = new Database(':memory:');
  runMigrations(d);
  const before = d.pragma('user_version', { simple: true });

  // Insert a row, then re-run: data and version must be untouched.
  d.prepare(
    `INSERT INTO users (id, email, username, credits, created_at) VALUES (?,?,?,?,?)`,
  ).run('u1', 'u1@example.com', 'u1', 10, Date.now());

  runMigrations(d);
  assert.equal(d.pragma('user_version', { simple: true }), before);
  assert.equal(
    (d.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c,
    1,
  );
});

test('an existing v0 database (pre-migration-system) upgrades cleanly', () => {
  // Simulate a database created before user_version tracking: user_version is
  // 0 by default. runMigrations should apply both migrations in order.
  const d = new Database(':memory:');
  assert.equal(d.pragma('user_version', { simple: true }), 0);
  runMigrations(d);
  assert.equal(d.pragma('user_version', { simple: true }), LATEST_VERSION);
});

test('the unique username index actually enforces uniqueness', () => {
  const d = new Database(':memory:');
  runMigrations(d);
  d.prepare(
    `INSERT INTO users (id, email, username, credits, created_at) VALUES (?,?,?,?,?)`,
  ).run('a', 'a@example.com', 'dupe', 0, Date.now());

  assert.throws(
    () =>
      d
        .prepare(
          `INSERT INTO users (id, email, username, credits, created_at) VALUES (?,?,?,?,?)`,
        )
        .run('b', 'b@example.com', 'dupe', 0, Date.now()),
    /UNIQUE/,
  );
});

test('refuses to run against a database newer than the known migrations', () => {
  const d = new Database(':memory:');
  d.pragma('user_version = 999');
  assert.throws(() => runMigrations(d), /newer than/);
});
