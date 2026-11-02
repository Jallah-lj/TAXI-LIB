ALTER TABLE citizen_tasks ADD COLUMN civic_incident_id TEXT;

CREATE TABLE IF NOT EXISTS civic_incidents (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('litter', 'drain', 'streetlight', 'road-obstruction')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  location_id TEXT NOT NULL,
  x REAL NOT NULL,
  z REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved')),
  reporter_id TEXT REFERENCES user_accounts(id),
  assigned_task_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_civic_incidents_status ON civic_incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_civic_incidents_site ON civic_incidents(site_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_civic_incidents_task ON civic_incidents(assigned_task_id) WHERE assigned_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citizen_tasks_incident ON citizen_tasks(civic_incident_id);

CREATE TABLE IF NOT EXISTS civic_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id),
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS safety_violations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id),
  zone_id TEXT NOT NULL,
  zone_name TEXT NOT NULL,
  speed_kmh REAL NOT NULL,
  limit_kmh REAL NOT NULL,
  amount_lrd INTEGER NOT NULL CHECK (amount_lrd >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('warning', 'fine')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_safety_violations_user ON safety_violations(user_id, created_at DESC);
