# Relational schema

The executable migrations are `src/server/db/migrations/001_initial.sql` through `007_onboarding.sql`, applied transactionally in filename order with a schema-migration record. SQLite enforces foreign keys and transactional writes in the local slice. IDs are UUID text values; money is integer LRD (never floating point); timestamps are ISO UTC strings.

| Table | Purpose and important constraints |
| --- | --- |
| `user_accounts` | Unique case-insensitive handle and bcrypt password hash. |
| `player_profiles` | 1:1 display identity, reputation and timestamps. |
| `character_appearances` | 1:1 validated skin/hair/top/bottom style indices. |
| `player_onboarding` | 1:1 `completed`/`dismissed` first-trip guide preference and update timestamp. No row means `new`; existing accounts at migration are backfilled as dismissed. Current step progress is session-only. |
| `player_sessions` | SHA-256 token hash, expiry and revocation; raw token is never stored. |
| `player_wallets` | 1:1 non-negative LRD balance with a check constraint. |
| `ledger_transactions` | Signed amount, unique idempotency reference and resulting balance. |
| `vehicle_models` | Data-driven handling/economic specifications. |
| `player_vehicles` | Owner FK, unique plate, model, condition/fuel, lifecycle, nullable saved `paint_id`/default-gloss `paint_finish`, and checked 0–3 engine/brake/tire levels. |
| `player_properties` | Owner FK, unique owner/listing title and checked 1–3 home level; each level contributes one garage slot. |
| `player_vehicle_preferences` | Per-user selected-vehicle preference; service queries verify same-user active ownership when reading and writing. |
| `citizen_tasks` | Owner, template, lifecycle, current step, optional linked civic incident and reward; a partial unique index permits one active citizen task per owner. |
| `citizen_task_requests` | Unique request UUID, user, operation kind and target for task-mutation replay protection. |
| `civic_incidents` | Canonical site/template/kind, persistent open/assigned/resolved lifecycle, optional reporter/assignee and timestamps. A partial unique index permits one unresolved incident per site. |
| `civic_requests` | Unique request UUID, user, operation kind and target for replay-safe civic reports. |
| `safety_violations` | Per-user/zone server-derived speed/limit, warning/fine outcome, integer LRD amount and creation time used for the 45-second cooldown. |
| `lifestyle_requests` | Globally unique request UUID with user, operation kind and target for transactional replay protection. Configured vehicle purchases include paint/finish in the target; legacy rows are backfilled with their default appearance. |
| `taxi_jobs` | NPC request locations, quote, expiry and assignment lifecycle. |
| `taxi_trips` | Unique job, driver/vehicle FK, accepted/active/completed/cancelled states and paid timestamp. A partial unique index permits only one open trip per driver. |
| `chat_messages` | Proximity text for moderation, with position and creation time. |
| `audit_events` | Append-oriented important account/economic events. |

Foreign keys and indexes cover session lookup, open jobs, driver trips, ownership and audit history. Multiple dependent writes use `BEGIN IMMEDIATE` / `COMMIT`, rolling back on any failure. The wallet balance and ledger are updated in the same transaction as trip completion. Civic task completion similarly resolves the incident and pays its reward atomically; cancellation releases the incident without a ledger credit.

## Production migration

Before horizontal scaling, port these migrations to PostgreSQL with `BIGINT` LRD columns, partial unique indexes, `TIMESTAMPTZ`, appropriate isolation, row/version constraints and managed backups. Do not run multiple game processes against the local SQLite file. A production schema should continue to grow only with implemented domains; player-to-player market and rental tables remain uncreated because those systems are not implemented.

## Backup and recovery (local)

Stop the process or use SQLite's online backup mechanism, copy the database and verify a restore into a new path. Production requires scheduled PostgreSQL base backups/WAL, encrypted off-site copies, retention policy and documented restore drills. Never commit database files or production credentials.
