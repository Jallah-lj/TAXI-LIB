CREATE TABLE IF NOT EXISTS citizen_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
  step_index INTEGER NOT NULL DEFAULT 0 CHECK (step_index >= 0),
  reward_lrd INTEGER NOT NULL CHECK (reward_lrd > 0),
  accepted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_citizen_tasks_one_active
  ON citizen_tasks(owner_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_citizen_tasks_owner_history
  ON citizen_tasks(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS citizen_task_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citizen_task_requests_user
  ON citizen_task_requests(user_id, created_at DESC);
