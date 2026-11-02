CREATE TABLE IF NOT EXISTS player_onboarding (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('completed', 'dismissed')),
  updated_at TEXT NOT NULL
);

-- Existing citizens keep their established workflow. Accounts created after this
-- migration have no onboarding row and therefore receive the first-trip offer.
INSERT OR IGNORE INTO player_onboarding (user_id, status, updated_at)
SELECT id, 'dismissed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM user_accounts;
