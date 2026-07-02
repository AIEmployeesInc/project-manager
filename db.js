import pg from 'pg';

// BIGINT (int8) columns come back from pg as strings by default. Our timestamps
// and file sizes fit safely in a JS number, so parse them as numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const DATABASE_URL = process.env.DATABASE_URL;

// Two backends behind one `query(text, params)` interface:
//   - Production / any real deploy: Postgres via `pg` (e.g. a free Neon database),
//     selected when DATABASE_URL is set.
//   - Local development: an embedded Postgres (PGlite) persisted to ./pgdata,
//     so `npm start` works with zero setup and no DATABASE_URL needed.
async function makeBackend() {
  if (DATABASE_URL) {
    const pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon and most hosts require SSL
    });
    return { query: (text, params) => pool.query(text, params) };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite('./pgdata');
  return { query: (text, params) => pglite.query(text, params) };
}

const backend = await makeBackend();

export function query(text, params) {
  return backend.query(text, params);
}

export async function initDb() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS channels (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      author      TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS todos (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      text        TEXT NOT NULL,
      done        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS fixes (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      text        TEXT NOT NULL,
      done        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at  BIGINT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS files (
      id            TEXT PRIMARY KEY,
      channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      size          BIGINT NOT NULL,
      mime          TEXT,
      uploader      TEXT,
      content       BYTEA NOT NULL,
      created_at    BIGINT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_todos_channel    ON todos(channel_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_fixes_channel    ON fixes(channel_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_files_channel     ON files(channel_id, created_at)`,
  ];
  for (const sql of statements) await query(sql);
}
