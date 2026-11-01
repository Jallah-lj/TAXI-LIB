import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { CivicService } from '../src/server/services/civic-service';
import type { MovementState } from '../src/shared/protocol';

describe('server-derived road safety enforcement', () => {
  let database: Database;
  let players: PlayerService;
  let civic: CivicService;
  let playerId: string;
  let now: number;
  let sequence: number;

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    const auth = new AuthService(database);
    players = new PlayerService(database, auth);
    now = Date.parse('2026-10-29T08:00:00.000Z');
    civic = new CivicService(database, players, new PresenceService(), () => now);
    playerId = (await auth.register('safety_driver', 'correct-horse', 'Safety Driver')).userId;
    sequence = 0;
  });

  afterEach(() => database.close());

  function sample(x: number, offsetMs: number): MovementState {
    return {
      playerId, position: [x, 0.14, 30], heading: Math.PI / 2, speed: 0, mode: 'driving',
      sequence: ++sequence, sentAt: now + offsetMs,
    };
  }

  function speedingPass() {
    const start = now;
    const observations = [0, 500, 1000, 1500].map((offset, index) => {
      const state = sample(index * 5, offset);
      state.sentAt = start + offset;
      return civic.observeMovement(playerId, state);
    });
    return observations.at(-1) ?? null;
  }

  it('uses displacement rather than client speed, warns first and protects the wallet', () => {
    const warning = speedingPass();
    expect(warning?.safety.warnings).toBe(1);
    expect(warning?.safety.finesLrd).toBe(0);
    expect(warning?.wallet.balanceLrd).toBe(12500);
    expect(warning?.notice).toMatch(/36 km\/h in a 30 km\/h/);
    expect(players.ledger(playerId)).toHaveLength(0);

    now += 5000;
    expect(speedingPass()).toBeNull();
    expect(civic.safety(playerId).warnings).toBe(1);

    now += 46_000;
    const fine = speedingPass();
    expect(fine?.safety.finesLrd).toBe(250);
    expect(fine?.wallet.balanceLrd).toBe(12250);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'civic_fine')).toHaveLength(1);

    database.connection.prepare('UPDATE player_wallets SET balance_lrd = 100 WHERE user_id = ?').run(playerId);
    now += 46_000;
    const insufficient = speedingPass();
    expect(insufficient?.safety.violations[0]?.outcome).toBe('warning');
    expect(insufficient?.wallet.balanceLrd).toBe(100);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'civic_fine')).toHaveLength(1);
  });
});
