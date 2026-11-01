import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (path !== ':memory:') this.connection.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate() {
    this.connection.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );`);
    const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
    const sourceDir = resolve(process.cwd(), 'src/server/db/migrations');
    const directory = existsSync(`${migrationDir}/001_initial.sql`) ? migrationDir : sourceDir;
    for (const version of ['001_initial', '002_lifestyle', '003_citizen_tasks', '004_vehicle_configuration', '005_vehicle_request_configuration', '006_civic_operations']) {
      const applied = this.connection.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version);
      if (applied) continue;
      const sql = readFileSync(`${directory}/${version}.sql`, 'utf8');
      this.transaction(() => {
        this.connection.exec(sql);
        this.connection.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      });
    }
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.connection.exec('COMMIT');
      return result;
    } catch (error) {
      this.connection.exec('ROLLBACK');
      throw error;
    }
  }

  audit(userId: string | null, kind: string, details: Record<string, unknown> = {}) {
    this.connection.prepare('INSERT INTO audit_events (id, user_id, kind, details_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, kind, JSON.stringify(details), new Date().toISOString());
  }

  close() {
    this.connection.close();
  }
}
