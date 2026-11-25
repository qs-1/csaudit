-- Seat alerts database (Cloudflare D1). Apply with: npx wrangler d1 execute fccu-seats --remote --file schema.sql
-- Nothing here identifies a person: a device is a random id, a secret's hash and, when allowed, a push address.

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,               -- random, shown to nobody
  secret TEXT NOT NULL,              -- SHA-256 of the device's secret
  endpoint TEXT UNIQUE,              -- push subscription; null when notifications aren't on
  p256dh TEXT,
  auth TEXT,
  push_dead INTEGER,                 -- when the push service said the subscription is gone (404/410)
  admin INTEGER NOT NULL DEFAULT 0,  -- also gets "seat checks paused/resumed" alerts
  created INTEGER NOT NULL,
  seen INTEGER NOT NULL              -- last API call from this device
);

CREATE TABLE IF NOT EXISTS watches (
  device TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  course TEXT NOT NULL,
  sec TEXT NOT NULL,
  dept TEXT NOT NULL,
  armed INTEGER NOT NULL,            -- 1: alert when the section opens
  alerts TEXT NOT NULL DEFAULT '[]', -- recent alert times, for the hourly cap
  last_alert INTEGER,
  test INTEGER,                      -- 1: the next check sends an alert whatever the count ("Test a real alert")
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (device, term, course, sec)
);
CREATE INDEX IF NOT EXISTS watches_dept ON watches (term, dept);

-- Pushes waiting to go out. Sent in their own run, a few dozen at a time.
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device TEXT NOT NULL,
  message TEXT NOT NULL,             -- JSON shown by the service worker
  topic TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  next INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

-- Poller state, and each term's latest seat counts as one row (live:<term>).
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- New devices per address per day, hashed with a daily salt.
CREATE TABLE IF NOT EXISTS signups (who TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (who, day));

-- What the poller did, kept 7 days, for debugging.
CREATE TABLE IF NOT EXISTS events (t INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT);
CREATE INDEX IF NOT EXISTS events_t ON events (t);
