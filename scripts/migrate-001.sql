-- One-time migration: add device-signal columns to an existing DB.
ALTER TABLE visitors ADD COLUMN device_fp TEXT;
ALTER TABLE events ADD COLUMN device_fp TEXT;
ALTER TABLE events ADD COLUMN model_source TEXT;
ALTER TABLE events ADD COLUMN viewport TEXT;
ALTER TABLE events ADD COLUMN dpr TEXT;
ALTER TABLE events ADD COLUMN platform TEXT;
ALTER TABLE events ADD COLUMN cores INTEGER;
ALTER TABLE events ADD COLUMN mem TEXT;
ALTER TABLE events ADD COLUMN touch INTEGER;
ALTER TABLE events ADD COLUMN color_depth INTEGER;
CREATE INDEX IF NOT EXISTS idx_visitors_dfp ON visitors(device_fp);
