-- Pugglenaut D1 schema. Idempotent — safe to run repeatedly.
-- Apply with: npm run db:init  (wrangler d1 execute pugglenaut --file schema.sql)

CREATE TABLE IF NOT EXISTS guestbook (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS highscores (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Leaderboard reads are ORDER BY score DESC — index to keep them cheap.
CREATE INDEX IF NOT EXISTS idx_highscores_score ON highscores (score DESC);
