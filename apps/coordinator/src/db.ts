import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { env } from './env.ts';

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });

export const db = new Database(env.DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
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

// --- Migrations for existing databases ---------------------------------------
// `CREATE TABLE IF NOT EXISTS` never alters an existing table, so add the
// username column (and backfill it) for databases created before it existed.
const userColumns = db
  .prepare<[], { name: string }>(`PRAGMA table_info(users)`)
  .all() as Array<{ name: string }>;
if (!userColumns.some((c) => c.name === 'username')) {
  db.exec(`ALTER TABLE users ADD COLUMN username TEXT`);
}

// Backfill any user missing a username with the local-part of their email,
// de-duplicated by appending a short suffix derived from their id.
const needsUsername = db
  .prepare<[], { id: string; email: string }>(
    `SELECT id, email FROM users WHERE username IS NULL OR username = ''`,
  )
  .all() as Array<{ id: string; email: string }>;
const setUsername = db.prepare(`UPDATE users SET username = ? WHERE id = ?`);
const usernameExists = db.prepare<[string, string], { id: string }>(
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

db.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
);

console.log(`[db] ready at ${env.DATABASE_PATH}`);
