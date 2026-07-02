-- One-time migration: add the settings table for notification toggles.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('notify_messages', '1'),
  ('notify_views', '1'),
  ('skip_bot_views', '1'),
  ('skip_bot_messages', '0');
