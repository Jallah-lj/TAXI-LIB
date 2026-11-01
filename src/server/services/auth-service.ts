import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Database } from '../db/database.js';
import type { OnboardingStatus, PlayerProfile } from '../../shared/types.js';
import { DomainError } from '../domain-error.js';

const SESSION_COOKIE = 'taxilib_session';

interface AccountRow { id: string; handle: string; password_hash: string }

export class AuthService {
  constructor(private readonly database: Database, private readonly sessionTtlDays = 7) {}

  get cookieName() { return SESSION_COOKIE; }

  async register(handle: string, password: string, displayName: string) {
    const existing = this.database.connection.prepare('SELECT id FROM user_accounts WHERE handle = ?').get(handle);
    if (existing) throw new DomainError(409, 'That handle is already registered.', 'handle_taken');
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = randomUUID();
    const now = new Date().toISOString();

    try {
      this.database.transaction(() => {
        this.database.connection.prepare('INSERT INTO user_accounts (id, handle, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(userId, handle, passwordHash, now, now);
        this.database.connection.prepare('INSERT INTO player_profiles (user_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .run(userId, displayName, now, now);
        this.database.connection.prepare('INSERT INTO character_appearances (user_id, updated_at) VALUES (?, ?)').run(userId, now);
        this.database.connection.prepare('INSERT INTO player_wallets (user_id, balance_lrd, updated_at) VALUES (?, 12500, ?)').run(userId, now);
        this.database.connection.prepare(`INSERT INTO player_vehicles
          (id, owner_id, model_id, plate, color, fuel_percent, condition_percent, created_at, updated_at)
          VALUES (?, ?, 'taxi-sedan', ?, '#e9ad32', 82, 91, ?, ?)`)
          .run(randomUUID(), userId, `LR-T${randomInt(1000, 9999)}`, now, now);
        this.database.audit(userId, 'account.registered', { handle });
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new DomainError(409, 'That handle is already registered.', 'handle_taken');
      throw error;
    }
    return this.createSession(userId);
  }

  async login(handle: string, password: string) {
    const account = this.database.connection.prepare('SELECT id, handle, password_hash FROM user_accounts WHERE handle = ?').get(handle) as AccountRow | undefined;
    const valid = account ? await bcrypt.compare(password, account.password_hash) : false;
    if (!account || !valid) throw new DomainError(401, 'Handle or password is incorrect.', 'invalid_credentials');
    this.database.audit(account.id, 'account.login', {});
    return this.createSession(account.id);
  }

  private createSession(userId: string) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const now = new Date();
    const expires = new Date(now.getTime() + this.sessionTtlDays * 86_400_000);
    this.database.connection.prepare('DELETE FROM player_sessions WHERE expires_at <= ?').run(now.toISOString());
    this.database.connection.prepare('INSERT INTO player_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, tokenHash, expires.toISOString(), now.toISOString());
    return { token, userId, expires };
  }

  userForToken(token: string | undefined): string | null {
    if (!token || token.length > 128) return null;
    const row = this.database.connection.prepare(`SELECT user_id FROM player_sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?`).get(this.hashToken(token), new Date().toISOString()) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  logout(token: string | undefined) {
    if (!token) return;
    this.database.connection.prepare('UPDATE player_sessions SET revoked_at = ? WHERE token_hash = ?')
      .run(new Date().toISOString(), this.hashToken(token));
  }

  profile(userId: string): PlayerProfile {
    const row = this.database.connection.prepare(`SELECT a.id, a.handle, p.display_name, p.reputation,
      c.skin, c.hair, c.top, c.bottom, o.status AS onboarding_status
      FROM user_accounts a
      JOIN player_profiles p ON p.user_id = a.id
      JOIN character_appearances c ON c.user_id = a.id
      LEFT JOIN player_onboarding o ON o.user_id = a.id WHERE a.id = ?`).get(userId) as {
        id: string; handle: string; display_name: string; reputation: number; skin: number; hair: number; top: number; bottom: number;
        onboarding_status: Exclude<OnboardingStatus, 'new'> | null;
      } | undefined;
    if (!row) throw new DomainError(404, 'Player profile not found.', 'profile_not_found');
    return {
      id: row.id, handle: row.handle, displayName: row.display_name, reputation: row.reputation,
      appearance: { skin: row.skin, hair: row.hair, top: row.top, bottom: row.bottom },
      onboardingStatus: row.onboarding_status ?? 'new',
    };
  }

  updateOnboarding(userId: string, status: Exclude<OnboardingStatus, 'new'>) {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      this.database.connection.prepare(`INSERT INTO player_onboarding (user_id, status, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).run(userId, status, now);
      this.database.audit(userId, 'profile.onboarding_updated', { status });
    });
    return this.profile(userId);
  }

  updateAppearance(userId: string, appearance: PlayerProfile['appearance']) {
    this.database.connection.prepare(`UPDATE character_appearances SET skin = ?, hair = ?, top = ?, bottom = ?, updated_at = ? WHERE user_id = ?`)
      .run(appearance.skin, appearance.hair, appearance.top, appearance.bottom, new Date().toISOString(), userId);
    this.database.audit(userId, 'profile.appearance_updated', { ...appearance });
    return this.profile(userId);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
