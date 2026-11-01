import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import { DomainError } from '../domain-error.js';
import type { PlayerService } from './player-service.js';
import type { PresenceService } from './presence-service.js';
import { ensureTaxiJobs } from '../db/seed.js';
import { distance2D, getLocation } from '../../shared/world.js';
import { routeDistance } from '../../shared/navigation.js';
import type { TaxiJob, TaxiTrip } from '../../shared/types.js';
import type { MovementState } from '../../shared/protocol.js';

interface TripRow {
  id: string; job_id: string; driver_id: string; vehicle_id: string; status: TaxiTrip['status']; fare_lrd: number;
  quoted_distance_m: number; accepted_at: string; picked_up_at: string | null; completed_at: string | null;
  passenger_name: string; pickup_location_id: string; destination_location_id: string;
}

export class TaxiService {
  constructor(private readonly database: Database, private readonly players: PlayerService, private readonly presence: PresenceService) {}

  availableJobs(): TaxiJob[] {
    ensureTaxiJobs(this.database);
    const rows = this.database.connection.prepare(`SELECT id, passenger_name, pickup_location_id, destination_location_id,
      fare_lrd, status, expires_at FROM taxi_jobs WHERE status = 'requested' AND expires_at > ?
      ORDER BY created_at LIMIT 12`).all(new Date().toISOString()) as unknown as Record<string, string | number>[];
    return rows.map((row) => ({
      id: String(row.id), passengerName: String(row.passenger_name), pickupLocationId: String(row.pickup_location_id),
      destinationLocationId: String(row.destination_location_id), fareLrd: Number(row.fare_lrd),
      status: 'requested', expiresAt: String(row.expires_at),
    }));
  }

  activeTrip(driverId: string): TaxiTrip | null {
    const row = this.database.connection.prepare(`${this.tripSelect()} WHERE t.driver_id = ? AND t.status IN ('accepted', 'active')`).get(driverId) as TripRow | undefined;
    return row ? this.mapTrip(row) : null;
  }

  getTrip(driverId: string, tripId: string): TaxiTrip {
    const row = this.database.connection.prepare(`${this.tripSelect()} WHERE t.id = ? AND t.driver_id = ?`).get(tripId, driverId) as TripRow | undefined;
    if (!row) throw new DomainError(404, 'Trip not found.', 'trip_not_found');
    return this.mapTrip(row);
  }

  accept(driverId: string, jobId: string, vehicleId: string) {
    if (!this.players.vehicles(driverId).some((vehicle) => vehicle.id === vehicleId)) {
      throw new DomainError(403, 'You are not authorized to use that vehicle.', 'vehicle_not_owned');
    }
    const result = this.database.transaction(() => {
      const open = this.database.connection.prepare("SELECT id FROM taxi_trips WHERE driver_id = ? AND status IN ('accepted', 'active')").get(driverId);
      if (open) throw new DomainError(409, 'Finish or cancel your current trip first.', 'trip_already_open');
      const citizenTask = this.database.connection.prepare("SELECT id FROM citizen_tasks WHERE owner_id = ? AND status = 'active'").get(driverId);
      if (citizenTask) throw new DomainError(409, 'Finish or cancel your active citizen task before accepting a passenger.', 'task_already_open');
      const job = this.database.connection.prepare('SELECT * FROM taxi_jobs WHERE id = ?').get(jobId) as Record<string, string | number> | undefined;
      const now = new Date();
      if (!job || job.status !== 'requested' || String(job.expires_at) <= now.toISOString()) {
        throw new DomainError(409, 'This request is no longer available.', 'job_unavailable');
      }
      const pickup = getLocation(String(job.pickup_location_id));
      const destination = getLocation(String(job.destination_location_id));
      const distance = routeDistance(pickup, destination);
      const changed = this.database.connection.prepare(`UPDATE taxi_jobs SET status = 'assigned', assigned_driver_id = ?, updated_at = ?
        WHERE id = ? AND status = 'requested'`).run(driverId, now.toISOString(), jobId);
      if (changed.changes !== 1) throw new DomainError(409, 'Another driver accepted this request.', 'job_unavailable');
      const tripId = randomUUID();
      this.database.connection.prepare(`INSERT INTO taxi_trips
        (id, job_id, driver_id, vehicle_id, status, fare_lrd, quoted_distance_m, accepted_at, updated_at)
        VALUES (?, ?, ?, ?, 'accepted', ?, ?, ?, ?)`)
        .run(tripId, jobId, driverId, vehicleId, Number(job.fare_lrd), distance, now.toISOString(), now.toISOString());
      this.database.audit(driverId, 'taxi.accepted', { tripId, jobId, vehicleId, fareLrd: Number(job.fare_lrd) });
      return tripId;
    });
    return this.getTrip(driverId, result);
  }

  pickup(driverId: string, tripId: string) {
    const trip = this.getTrip(driverId, tripId);
    if (trip.status === 'active') return trip;
    if (trip.status !== 'accepted') throw new DomainError(409, 'This trip cannot be picked up.', 'invalid_trip_state');
    this.validateCheckpoint(driverId, trip, trip.pickupLocationId);
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const changed = this.database.connection.prepare(`UPDATE taxi_trips SET status = 'active', picked_up_at = ?, updated_at = ?
        WHERE id = ? AND driver_id = ? AND status = 'accepted'`).run(now, now, tripId, driverId);
      if (changed.changes !== 1) throw new DomainError(409, 'Trip state changed; please refresh.', 'invalid_trip_state');
      this.database.connection.prepare("UPDATE taxi_jobs SET status = 'picked_up', updated_at = ? WHERE id = ?").run(now, trip.jobId);
      this.database.audit(driverId, 'taxi.passenger_picked_up', { tripId });
    });
    return this.getTrip(driverId, tripId);
  }

  complete(driverId: string, tripId: string) {
    const existing = this.database.connection.prepare(`${this.tripSelect()} WHERE t.id = ? AND t.driver_id = ?`).get(tripId, driverId) as TripRow | undefined;
    if (!existing) throw new DomainError(404, 'Trip not found.', 'trip_not_found');
    if (existing.status === 'completed') return { trip: this.mapTrip(existing), wallet: this.players.wallet(driverId), duplicate: true };
    if (existing.status !== 'active') throw new DomainError(409, 'Pick up the passenger before completing this trip.', 'invalid_trip_state');
    const trip = this.mapTrip(existing);
    this.validateCheckpoint(driverId, trip, trip.destinationLocationId);
    const minimumSeconds = Math.max(4, existing.quoted_distance_m / 30);
    if (Date.now() - new Date(existing.picked_up_at!).getTime() < minimumSeconds * 1000) {
      throw new DomainError(409, 'The journey is still in progress. Follow the route to your destination.', 'trip_too_early');
    }

    const result = this.database.transaction(() => {
      const current = this.database.connection.prepare('SELECT status FROM taxi_trips WHERE id = ?').get(tripId) as { status: string };
      if (current.status === 'completed') return { duplicate: true };
      const now = new Date().toISOString();
      const changed = this.database.connection.prepare(`UPDATE taxi_trips SET status = 'completed', completed_at = ?, paid_at = ?, updated_at = ?
        WHERE id = ? AND driver_id = ? AND status = 'active'`).run(now, now, now, tripId, driverId);
      if (changed.changes !== 1) throw new DomainError(409, 'Trip state changed; no payment was made.', 'invalid_trip_state');
      this.database.connection.prepare("UPDATE taxi_jobs SET status = 'completed', updated_at = ? WHERE id = ?").run(now, trip.jobId);
      const wallet = this.database.connection.prepare('SELECT balance_lrd FROM player_wallets WHERE user_id = ?').get(driverId) as { balance_lrd: number };
      const newBalance = wallet.balance_lrd + trip.fareLrd;
      const walletChanged = this.database.connection.prepare('UPDATE player_wallets SET balance_lrd = ?, updated_at = ? WHERE user_id = ?')
        .run(newBalance, now, driverId);
      if (walletChanged.changes !== 1) throw new DomainError(500, 'Wallet update failed.', 'wallet_error');
      this.database.connection.prepare(`INSERT INTO ledger_transactions
        (id, user_id, amount_lrd, balance_after_lrd, kind, reference, description, created_at)
        VALUES (?, ?, ?, ?, 'taxi_fare', ?, ?, ?)`)
        .run(randomUUID(), driverId, trip.fareLrd, newBalance, `taxi-fare:${trip.id}`, `Taxi fare · ${trip.passengerName}`, now);
      this.database.audit(driverId, 'taxi.completed_paid', { tripId, fareLrd: trip.fareLrd, balanceAfterLrd: newBalance });
      return { duplicate: false };
    });
    ensureTaxiJobs(this.database);
    return { trip: this.getTrip(driverId, tripId), wallet: this.players.wallet(driverId), duplicate: result.duplicate };
  }

  cancel(driverId: string, tripId: string) {
    const trip = this.getTrip(driverId, tripId);
    if (trip.status === 'cancelled') return trip;
    if (trip.status === 'completed') throw new DomainError(409, 'A completed trip cannot be cancelled.', 'invalid_trip_state');
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const changed = this.database.connection.prepare(`UPDATE taxi_trips SET status = 'cancelled', cancelled_at = ?, updated_at = ?
        WHERE id = ? AND driver_id = ? AND status IN ('accepted', 'active')`).run(now, now, tripId, driverId);
      if (changed.changes !== 1) throw new DomainError(409, 'Trip state changed; please refresh.', 'invalid_trip_state');
      this.database.connection.prepare("UPDATE taxi_jobs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, trip.jobId);
      this.database.audit(driverId, 'taxi.cancelled', { tripId, previousStatus: trip.status });
    });
    ensureTaxiJobs(this.database);
    return this.getTrip(driverId, tripId);
  }

  private validateCheckpoint(driverId: string, trip: TaxiTrip, locationId: string) {
    const state: MovementState | null = this.presence.recent(driverId);
    if (!state) throw new DomainError(409, 'Realtime driving position is unavailable. Reconnect and try again.', 'position_stale');
    if (state.mode !== 'driving' || state.vehicleId !== trip.vehicleId) {
      throw new DomainError(409, 'You must be in the assigned taxi.', 'wrong_vehicle');
    }
    if (Math.abs(state.speed) > 2.5) throw new DomainError(409, 'Stop the taxi before this interaction.', 'vehicle_moving');
    const destination = getLocation(locationId);
    if (distance2D({ x: state.position[0], z: state.position[2] }, destination) > 13) {
      throw new DomainError(409, `Drive to ${destination.name} and stop in the marked area.`, 'wrong_location');
    }
  }

  private tripSelect() {
    return `SELECT t.id, t.job_id, t.driver_id, t.vehicle_id, t.status, t.fare_lrd, t.quoted_distance_m,
      t.accepted_at, t.picked_up_at, t.completed_at, j.passenger_name, j.pickup_location_id, j.destination_location_id
      FROM taxi_trips t JOIN taxi_jobs j ON j.id = t.job_id`;
  }

  private mapTrip(row: TripRow): TaxiTrip {
    return {
      id: row.id, jobId: row.job_id, vehicleId: row.vehicle_id, status: row.status, fareLrd: Number(row.fare_lrd),
      passengerName: row.passenger_name, pickupLocationId: row.pickup_location_id, destinationLocationId: row.destination_location_id,
      acceptedAt: row.accepted_at, pickedUpAt: row.picked_up_at, completedAt: row.completed_at,
    };
  }
}
