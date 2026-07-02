import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { env } from './env.ts';

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

export const db = new Database(env.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// =============================================================================
// Versioned migrations
//
// We track schema state with SQLite's built-in `PRAGMA user_version` (an
// integer stored in the database header). On startup we run every migration
// whose index is greater than the current user_version, in order, each inside
// its own transaction, then bump user_version. This replaces the previous
// ad-hoc `CREATE TABLE IF NOT EXISTS` + hand-rolled ALTER approach and gives a
// deterministic, ordered upgrade path for databases carrying real data.
//
// RULES for adding a migration:
//   - Append a new entry to the end of the array. NEVER edit or reorder an
//     already-released migration — existing databases have already applied it.
//   - Keep each migration self-contained and idempotent where practical.
//   - The array index + 1 is the version the migration advances the db TO.
// =============================================================================

type Migration = {
  name: string;
  up: (database: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    name: '0001_initial_schema',
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id              TEXT PRIMARY KEY,
          email           TEXT UNIQUE NOT NULL,
          username        TEXT,
          credits         INTEGER NOT NULL DEFAULT 0,
          created_at      INTEGER NOT NULL,
          last_login_at   INTEGER
        );

        CREATE TABLE IF NOT EXISTS magic_links (
          token       TEXT PRIMARY KEY,
          email       TEXT NOT NULL,
          expires_at  INTEGER NOT NULL,
          used        INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_magic_links_expires ON magic_links(expires_at);

        CREATE TABLE IF NOT EXISTS login_codes (
          code        TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL,
          expires_at  INTEGER NOT NULL,
          used        INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_login_codes_expires ON login_codes(expires_at);

        -- Device authorization flow (OAuth-style): the desktop app starts a
        -- pending session keyed by a secret device_code it polls, plus a short
        -- user_code the person approves in the browser while signed in on web.
        CREATE TABLE IF NOT EXISTS device_codes (
          device_code  TEXT PRIMARY KEY,
          user_code    TEXT NOT NULL UNIQUE,
          user_id      TEXT,
          approved     INTEGER NOT NULL DEFAULT 0,
          expires_at   INTEGER NOT NULL,
          created_at   INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON device_codes(expires_at);

        CREATE TABLE IF NOT EXISTS nodes (
          id                TEXT PRIMARY KEY,
          owner_user_id     TEXT,
          capacity_bytes    INTEGER NOT NULL,
          used_bytes        INTEGER NOT NULL DEFAULT 0,
          version           TEXT NOT NULL,
          last_seen_at      INTEGER NOT NULL,
          registered_at     INTEGER NOT NULL,
          total_uptime_sec  INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_at);

        CREATE TABLE IF NOT EXISTS files (
          id               TEXT PRIMARY KEY,
          owner_user_id    TEXT,
          size_bytes       INTEGER NOT NULL,
          encrypted_bytes  INTEGER NOT NULL,
          manifest         TEXT NOT NULL,
          created_at       INTEGER NOT NULL,
          expires_at       INTEGER,
          deleted_at       INTEGER,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_files_expires ON files(expires_at);

        CREATE TABLE IF NOT EXISTS shards (
          file_id        TEXT NOT NULL,
          shard_index    INTEGER NOT NULL,
          node_id        TEXT NOT NULL,
          size_bytes     INTEGER NOT NULL,
          hash           TEXT NOT NULL,
          uploaded_at    INTEGER,
          PRIMARY KEY (file_id, shard_index, node_id),
          FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
          FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_shards_node ON shards(node_id);

        CREATE TABLE IF NOT EXISTS credit_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     TEXT NOT NULL,
          delta       INTEGER NOT NULL,
          reason      TEXT NOT NULL,
          ref_id      TEXT,
          created_at  INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_credit_events_user ON credit_events(user_id);
      `);
    },
  },
  {
    name: '0002_users_username',
    up: (d) => {
      // `CREATE TABLE IF NOT EXISTS` never alters an existing table, so add the
      // username column (and backfill it) for databases created before it
      // existed. The column check keeps this safe on databases where 0001
      // already created `users` with the column present.
      const userColumns = d
        .prepare<[], { name: string }>(`PRAGMA table_info(users)`)
        .all() as Array<{ name: string }>;
      if (!userColumns.some((c) => c.name === 'username')) {
        d.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
      }

      // Backfill any user missing a username with the local-part of their
      // email, de-duplicated by appending a short suffix derived from their id.
      const needsUsername = d
        .prepare<[], { id: string; email: string }>(
          `SELECT id, email FROM users WHERE username IS NULL OR username = ''`,
        )
        .all() as Array<{ id: string; email: string }>;
      const setUsername = d.prepare(`UPDATE users SET username = ? WHERE id = ?`);
      const usernameExists = d.prepare<[string, string], { id: string }>(
        `SELECT id FROM users WHERE username = ? AND id != ?`,
      );
      for (const u of needsUsername) {
        const base = (u.email.split('@')[0] || 'user').toLowerCase();
        let candidate = base;
        if (usernameExists.get(candidate, u.id)) {
          candidate = `${base}-${u.id.slice(0, 6)}`;
        }
        setUsername.run(candidate, u.id);
      }

      d.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
      );
    },
  },
];

/**
 * Apply every migration newer than the database's current user_version, each
 * in its own transaction. Idempotent: re-running with no pending migrations is
 * a no-op. Exported so tests can run it against an in-memory database.
 */
export function runMigrations(database: Database.Database): void {
  const current = database.pragma('user_version', { simple: true }) as number;
  if (current > migrations.length) {
    throw new Error(
      `[db] database user_version ${current} is newer than the ${migrations.length} known migrations — ` +
        `running an older build against a newer database is unsafe.`,
    );
  }
  for (let version = current; version < migrations.length; version++) {
    const migration = migrations[version];
    const apply = database.transaction(() => {
      migration.up(database);
      // user_version can't be parameterized; version+1 is a trusted integer.
      database.pragma(`user_version = ${version + 1}`);
    });
    apply();
    console.log(`[db] applied migration ${migration.name} (-> v${version + 1})`);
  }
}

runMigrations(db);

console.log(`[db] ready at ${env.DATABASE_PATH} (schema v${migrations.length})`);
