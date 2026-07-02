-- losthusky inbox — D1 schema

CREATE TABLE IF NOT EXISTS links (
  slug        TEXT PRIMARY KEY,
  title       TEXT,
  prompt      TEXT NOT NULL DEFAULT 'send me a message!',
  created_at  INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1
);

-- One row per unique sender we can distinguish.
CREATE TABLE IF NOT EXISTS visitors (
  id          TEXT PRIMARY KEY,   -- stable clientId (localStorage + cookie)
  device_fp   TEXT,               -- device fingerprint (survives IP changes)
  fp_hash     TEXT,               -- ip+ua fallback hash
  handle      TEXT,               -- optional self-declared @handle
  label       TEXT,               -- admin-assigned nickname
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitors_fp ON visitors(fp_hash);
CREATE INDEX IF NOT EXISTS idx_visitors_dfp ON visitors(device_fp);

-- Every view + message captures a fingerprint snapshot.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,     -- 'view' | 'message'
  slug         TEXT,
  visitor_id   TEXT,
  device_fp    TEXT,
  fp_hash      TEXT,
  ip           TEXT,
  country      TEXT, region TEXT, city TEXT,
  lat REAL, lon REAL, timezone TEXT, postal TEXT,
  asn INTEGER, isp TEXT, colo TEXT,
  ua           TEXT,
  browser      TEXT, browser_version TEXT,
  os           TEXT, os_version TEXT,
  device       TEXT,              -- mobile | tablet | desktop
  device_model TEXT,             -- resolved model name
  model_source TEXT,             -- 'ua' | 'viewport' | ''
  source       TEXT,             -- 'Instagram', 'Snapchat', 'Web browser', etc.
  is_mobile    INTEGER,
  lang         TEXT,
  referer      TEXT,
  viewport     TEXT,             -- CSS viewport e.g. 390x844
  screen       TEXT,             -- physical px e.g. 1170x2532
  dpr          TEXT,
  platform     TEXT,
  cores        INTEGER,
  mem          TEXT,
  touch        INTEGER,
  color_depth  INTEGER,
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
  event_id    INTEGER,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_slug ON messages(slug, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_visitor ON messages(visitor_id);

INSERT OR IGNORE INTO links (slug, title, prompt, created_at, active)
VALUES ('', 'losthusky', 'send me a message!', 0, 1);
