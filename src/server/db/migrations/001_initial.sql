CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  reputation INTEGER NOT NULL DEFAULT 50 CHECK (reputation BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_appearances (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  skin INTEGER NOT NULL DEFAULT 2 CHECK (skin BETWEEN 0 AND 5),
  hair INTEGER NOT NULL DEFAULT 0 CHECK (hair BETWEEN 0 AND 3),
  top INTEGER NOT NULL DEFAULT 0 CHECK (top BETWEEN 0 AND 5),
  bottom INTEGER NOT NULL DEFAULT 0 CHECK (bottom BETWEEN 0 AND 3),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON player_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON player_sessions(expires_at);

CREATE TABLE IF NOT EXISTS player_wallets (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  balance_lrd INTEGER NOT NULL DEFAULT 12500 CHECK (balance_lrd >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  amount_lrd INTEGER NOT NULL,
  balance_after_lrd INTEGER NOT NULL CHECK (balance_after_lrd >= 0),
  kind TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_name TEXT NOT NULL,
  max_speed REAL NOT NULL,
  acceleration REAL NOT NULL,
  braking REAL NOT NULL,
  steering REAL NOT NULL,
  grip REAL NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0)
);

CREATE TABLE IF NOT EXISTS player_vehicles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_accounts(id),
  model_id TEXT NOT NULL REFERENCES vehicle_models(id),
  plate TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL,
  fuel_percent REAL NOT NULL DEFAULT 80 CHECK (fuel_percent BETWEEN 0 AND 100),
  condition_percent REAL NOT NULL DEFAULT 90 CHECK (condition_percent BETWEEN 0 AND 100),
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'stored', 'impounded', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON player_vehicles(owner_id, lifecycle);

CREATE TABLE IF NOT EXISTS taxi_jobs (
  id TEXT PRIMARY KEY,
  passenger_name TEXT NOT NULL,
  pickup_location_id TEXT NOT NULL,
  destination_location_id TEXT NOT NULL,
  fare_lrd INTEGER NOT NULL CHECK (fare_lrd > 0),
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'picked_up', 'completed', 'cancelled', 'expired')),
  assigned_driver_id TEXT REFERENCES user_accounts(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (pickup_location_id <> destination_location_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_available ON taxi_jobs(status, expires_at);

CREATE TABLE IF NOT EXISTS taxi_trips (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES taxi_jobs(id),
  driver_id TEXT NOT NULL REFERENCES user_accounts(id),
  vehicle_id TEXT NOT NULL REFERENCES player_vehicles(id),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'active', 'completed', 'cancelled')),
  fare_lrd INTEGER NOT NULL CHECK (fare_lrd > 0),
  quoted_distance_m REAL NOT NULL CHECK (quoted_distance_m > 0),
  accepted_at TEXT NOT NULL,
  picked_up_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  paid_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_trip_per_driver
  ON taxi_trips(driver_id) WHERE status IN ('accepted', 'active');
CREATE INDEX IF NOT EXISTS idx_trips_driver_created ON taxi_trips(driver_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES user_accounts(id),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 200),
  x REAL NOT NULL,
  z REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES user_accounts(id),
  kind TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user_created ON audit_events(user_id, created_at DESC);
