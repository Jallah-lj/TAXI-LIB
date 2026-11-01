import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { TaxiService } from '../src/server/services/taxi-service';
import { getLocation, PLAYER_SPAWN } from '../src/shared/world';
import type { TaxiTrip } from '../src/shared/types';

function moveTo(presence: PresenceService, playerId: string, vehicleId: string, target: { x: number; z: number }, startSequence: number) {
  let state = presence.recent(playerId);
  if (!state) throw new Error('No presence');
  let sequence = startSequence;
  while (Math.hypot(state.position[0] - target.x, state.position[2] - target.z) > 0.3) {
    const dx = target.x - state.position[0];
    const dz = target.z - state.position[2];
    const distance = Math.hypot(dx, dz);
    const step = Math.min(2, distance);
    const next: [number, number, number] = [state.position[0] + dx / distance * step, 0.08, state.position[2] + dz / distance * step];
    const accepted = presence.update(playerId, { position: next, heading: Math.atan2(dx, dz), speed: 0, mode: 'driving', vehicleId, sequence: ++sequence }, new Set([vehicleId]));
    if (!accepted) throw new Error('Movement was rejected');
    state = accepted;
  }
  return sequence;
}

describe('authoritative taxi economy', () => {
  let database: Database;
  let auth: AuthService;
  let players: PlayerService;
  let presence: PresenceService;
  let taxi: TaxiService;
  let playerId: string;
  let vehicleId: string;

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    auth = new AuthService(database);
    players = new PlayerService(database, auth);
    presence = new PresenceService();
    taxi = new TaxiService(database, players, presence);
    playerId = (await auth.register('driver_one', 'correct-horse', 'Driver One')).userId;
    vehicleId = players.vehicles(playerId)[0]!.id;
    presence.join(auth.profile(playerId));
    const initial = presence.update(playerId, {
      position: [PLAYER_SPAWN.x, 0.08, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, sequence: 1,
    }, new Set([vehicleId]));
    expect(initial).not.toBeNull();
  });

  afterEach(() => database.close());

  function acceptFirst(): TaxiTrip {
    const job = taxi.availableJobs()[0]!;
    return taxi.accept(playerId, job.id, vehicleId);
  }

  it('pays exactly once and persists the wallet and ledger', () => {
    const trip = acceptFirst();
    const initial = players.wallet(playerId).balanceLrd;
    moveTo(presence, playerId, vehicleId, getLocation(trip.pickupLocationId), 1000);
    const active = taxi.pickup(playerId, trip.id);
    expect(active.status).toBe('active');
    database.connection.prepare('UPDATE taxi_trips SET picked_up_at = ? WHERE id = ?').run(new Date(Date.now() - 60_000).toISOString(), trip.id);
    moveTo(presence, playerId, vehicleId, getLocation(trip.destinationLocationId), 2000);
    const completed = taxi.complete(playerId, trip.id);
    expect(completed.trip.status).toBe('completed');
    expect(completed.duplicate).toBe(false);
    expect(completed.wallet.balanceLrd).toBe(initial + trip.fareLrd);
    const duplicate = taxi.complete(playerId, trip.id);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.wallet.balanceLrd).toBe(initial + trip.fareLrd);
    const fares = players.ledger(playerId).filter((entry) => entry.kind === 'taxi_fare');
    expect(fares).toHaveLength(1);
    expect(players.wallet(playerId).balanceLrd).toBe(initial + trip.fareLrd);
  });

  it('rejects pickup away from the passenger and completion in the wrong vehicle state', () => {
    const job = taxi.availableJobs().find((entry) => entry.pickupLocationId !== 'taxi-stand')!;
    const trip = taxi.accept(playerId, job.id, vehicleId);
    expect(() => taxi.pickup(playerId, trip.id)).toThrow(/Drive to/);
    expect(() => taxi.complete(playerId, trip.id)).toThrow(/Pick up/);
    expect(players.wallet(playerId).balanceLrd).toBe(12500);
  });

  it('prevents a second driver claiming an assigned request', async () => {
    const otherId = (await auth.register('driver_two', 'correct-horse', 'Driver Two')).userId;
    const otherVehicle = players.vehicles(otherId)[0]!.id;
    const job = taxi.availableJobs()[0]!;
    taxi.accept(playerId, job.id, vehicleId);
    expect(() => taxi.accept(otherId, job.id, otherVehicle)).toThrow(/no longer available/);
  });

  it('rejects use of another citizen vehicle', async () => {
    const otherId = (await auth.register('driver_three', 'correct-horse', 'Driver Three')).userId;
    const job = taxi.availableJobs()[0]!;
    expect(() => taxi.accept(otherId, job.id, vehicleId)).toThrow(/not authorized/);
  });

  it('cancels without creating a fare and allows another job', () => {
    const trip = acceptFirst();
    expect(taxi.cancel(playerId, trip.id).status).toBe('cancelled');
    expect(players.ledger(playerId)).toHaveLength(0);
    expect(players.wallet(playerId).balanceLrd).toBe(12500);
    expect(acceptFirst().status).toBe('accepted');
  });

  it('enforces one open trip per driver', () => {
    acceptFirst();
    const job = taxi.availableJobs()[0]!;
    expect(() => taxi.accept(playerId, job.id, vehicleId)).toThrow(/current trip/);
  });
});
