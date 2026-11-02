import type { Database } from '../db/database.js';
import type { CivicState } from '../../shared/civic.js';
import type { AuthService } from './auth-service.js';
import type { CitizenTaskState, LedgerEntry, LifestyleState, PlayerProperty, PlayerVehicle, Wallet, WorldBootstrap, TaxiTrip } from '../../shared/types.js';
import { ROAD_EDGES, ROAD_NODES, WORLD_LOCATIONS } from '../../shared/world.js';
import { getSimulationState } from '../../shared/simulation.js';
import { BASE_GARAGE_CAPACITY, VEHICLE_CATALOG, normalizeVehicleConfiguration, vehiclePaint } from '../../shared/catalog.js';

export class PlayerService {
  constructor(private readonly database: Database, private readonly auth: AuthService) {}

  wallet(userId: string): Wallet {
    const row = this.database.connection.prepare('SELECT balance_lrd FROM player_wallets WHERE user_id = ?').get(userId) as { balance_lrd: number };
    return { balanceLrd: row.balance_lrd };
  }

  vehicles(userId: string): PlayerVehicle[] {
    const rows = this.database.connection.prepare(`SELECT v.id, v.model_id, v.plate, v.color, v.paint_id, v.paint_finish, v.fuel_percent, v.condition_percent,
      v.engine_level, v.brakes_level, v.tires_level,
      m.name, m.class_name, m.max_speed, m.acceleration, m.braking, m.steering, m.grip, m.seats
      FROM player_vehicles v JOIN vehicle_models m ON m.id = v.model_id
      WHERE v.owner_id = ? AND v.lifecycle = 'active' ORDER BY v.created_at, v.id`).all(userId) as unknown as Record<string, string | number>[];
    return rows.map((row) => {
      const engine = Number(row.engine_level);
      const brakes = Number(row.brakes_level);
      const tires = Number(row.tires_level);
      const modelId = String(row.model_id);
      const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === modelId);
      const configuration = listing
        ? normalizeVehicleConfiguration(listing, String(row.paint_id ?? ''), String(row.paint_finish ?? ''))
        : { paintId: 'cooperative-gold' as const, finish: 'gloss' as const };
      const color = vehiclePaint(configuration.paintId)?.color ?? String(row.color);
      return {
        id: String(row.id), modelId, plate: String(row.plate), color,
        paintId: configuration.paintId, finish: configuration.finish,
        taxi: listing?.taxi ?? true,
        fuelPercent: Number(row.fuel_percent), conditionPercent: Number(row.condition_percent),
        model: {
          id: modelId, name: String(row.name), className: String(row.class_name),
          maxSpeed: Number(row.max_speed) * (1 + engine * 0.06),
          acceleration: Number(row.acceleration) * (1 + engine * 0.1),
          braking: Number(row.braking) * (1 + brakes * 0.12),
          steering: Number(row.steering) * (1 + tires * 0.04),
          grip: Number(row.grip) * (1 + tires * 0.06), seats: Number(row.seats),
        },
        upgrades: { engine, brakes, tires },
      };
    });
  }

  properties(userId: string): PlayerProperty[] {
    const rows = this.database.connection.prepare(`SELECT id, listing_id, level, purchased_at, updated_at
      FROM player_properties WHERE owner_id = ? ORDER BY purchased_at, id`).all(userId) as unknown as Record<string, string | number>[];
    return rows.map((row) => ({
      id: String(row.id), listingId: String(row.listing_id), level: Number(row.level),
      purchasedAt: String(row.purchased_at), updatedAt: String(row.updated_at),
    }));
  }

  selectedVehicleId(userId: string, vehicles = this.vehicles(userId)): string {
    const selected = this.database.connection.prepare(`SELECT p.selected_vehicle_id FROM player_vehicle_preferences p
      JOIN player_vehicles v ON v.id = p.selected_vehicle_id AND v.owner_id = p.user_id AND v.lifecycle = 'active'
      WHERE p.user_id = ?`).get(userId) as { selected_vehicle_id: string } | undefined;
    return selected?.selected_vehicle_id ?? vehicles[0]?.id ?? '';
  }

  garageCapacity(userId: string): number {
    const row = this.database.connection.prepare('SELECT COALESCE(SUM(level), 0) AS home_slots FROM player_properties WHERE owner_id = ?').get(userId) as { home_slots: number };
    return BASE_GARAGE_CAPACITY + Number(row.home_slots);
  }

  lifestyleState(userId: string): LifestyleState {
    const vehicles = this.vehicles(userId);
    return {
      wallet: this.wallet(userId), vehicles, properties: this.properties(userId),
      selectedVehicleId: this.selectedVehicleId(userId, vehicles), garageCapacity: this.garageCapacity(userId),
    };
  }

  ledger(userId: string): LedgerEntry[] {
    const rows = this.database.connection.prepare(`SELECT id, amount_lrd, balance_after_lrd, kind, description, created_at
      FROM ledger_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`).all(userId) as unknown as Record<string, string | number>[];
    return rows.map((row) => ({
      id: String(row.id), amountLrd: Number(row.amount_lrd), balanceAfterLrd: Number(row.balance_after_lrd),
      kind: String(row.kind), description: String(row.description), createdAt: String(row.created_at),
    }));
  }

  bootstrap(userId: string, jobs: WorldBootstrap['jobs'], activeTrip: TaxiTrip | null, taskState: CitizenTaskState, civic: CivicState): WorldBootstrap {
    return {
      player: this.auth.profile(userId), ...this.lifestyleState(userId), ...taskState, jobs, activeTrip, civic,
      locations: WORLD_LOCATIONS, roadNodes: ROAD_NODES, roadEdges: ROAD_EDGES, simulation: getSimulationState(),
      disclaimer: 'Fictionalized, compressed Sinkor game district — not a verified street map.',
    };
  }
}
