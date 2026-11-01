ALTER TABLE player_vehicles ADD COLUMN engine_level INTEGER NOT NULL DEFAULT 0 CHECK (engine_level BETWEEN 0 AND 3);
ALTER TABLE player_vehicles ADD COLUMN brakes_level INTEGER NOT NULL DEFAULT 0 CHECK (brakes_level BETWEEN 0 AND 3);
ALTER TABLE player_vehicles ADD COLUMN tires_level INTEGER NOT NULL DEFAULT 0 CHECK (tires_level BETWEEN 0 AND 3);

CREATE TABLE IF NOT EXISTS player_properties (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 3),
  purchased_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_properties_owner ON player_properties(owner_id);

CREATE TABLE IF NOT EXISTS player_vehicle_preferences (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  selected_vehicle_id TEXT NOT NULL REFERENCES player_vehicles(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lifestyle_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifestyle_requests_user ON lifestyle_requests(user_id, created_at DESC);
