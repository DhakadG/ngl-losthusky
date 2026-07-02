-- losthusky inbox — D1 schema

CREATE TABLE IF NOT EXISTS links (
  slug        TEXT PRIMARY KEY,
  title       TEXT,
  prompt      TEXT NOT NULL DEFAULT 'send me a message!',
  created_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

-- One row per unique sender we can distinguish (first-party cookie primarily).
CREATE TABLE IF NOT EXISTS visitors (
  id          TEXT PRIMARY KEY,   -- first-party visitorId cookie (uuid)
  fp_hash     TEXT,               -- server-side fingerprint fallback
  handle      TEXT,               -- optional self-declared @handle
  label       TEXT,               -- admin-assigned nickname
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitors_fp ON visitors(fp_hash);

-- Every view + message captures a fingerprint snapshot.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,     -- 'view' | 'message'
  slug         TEXT,
  visitor_id   TEXT,
  fp_hash      TEXT,
  ip           TEXT,
  country      TEXT, region TEXT, city TEXT,
  lat REAL, lon REAL, timezone TEXT, postal TEXT,
  asn INTEGER, isp TEXT, colo TEXT,
  ua           TEXT,
  browser      TEXT, browser_version TEXT,
  os           TEXT, os_version TEXT,
  device       TEXT,              -- mobile | tablet | desktop
  device_model TEXT,             -- Android model when available
  source       TEXT,             -- 'Instagram', 'Snapchat', 'Web browser', etc.
  is_mobile    INTEGER,
  lang         TEXT,
  referer      TEXT,
  screen       TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug, created_at);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT,
  visitor_id  TEXT,
  body        TEXT NOT NULL,
  event_id    INTEGER,           -- fingerprint snapshot at send time
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_slug ON messages(slug, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_visitor ON messages(visitor_id);

-- Seed the owner's default link (slug '' = root domain page).
INSERT OR IGNORE INTO links (slug, title, prompt, created_at, active)
VALUES ('', 'losthusky', 'send me a message!', 0, 1);
