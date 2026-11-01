import { randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import { DomainError } from '../domain-error.js';
import type { PlayerService } from './player-service.js';
import type { PresenceService } from './presence-service.js';
import {
  MAX_PROPERTY_LEVEL, MAX_VEHICLE_UPGRADE_LEVEL, PROPERTY_CATALOG, VEHICLE_CATALOG, VEHICLE_PAINT_FINISHES, VEHICLE_UPGRADES,
  defaultVehicleConfiguration, propertyUpgradeCost, vehicleConfigurationPrice, vehiclePaint, vehicleUpgradeCost,
  type PropertyCatalogEntry, type VehicleCatalogEntry, type VehicleConfiguration, type VehicleUpgradeKind,
} from '../../shared/catalog.js';
import type { LifestyleMutationResult } from '../../shared/types.js';

const upgradeColumns: Record<VehicleUpgradeKind, string> = { engine: 'engine_level', brakes: 'brakes_level', tires: 'tires_level' };

export class LifestyleService {
  constructor(private readonly database: Database, private readonly players: PlayerService, private readonly presence: PresenceService) {}

  purchaseProperty(userId: string, listingId: string, requestId: string): LifestyleMutationResult {
    const listing = this.property(listingId);
    return this.mutate(userId, requestId, 'property.purchase', listingId, () => {
      const existing = this.database.connection.prepare('SELECT id FROM player_properties WHERE owner_id = ? AND listing_id = ?').get(userId, listingId);
      if (existing) throw new DomainError(409, `You already own ${listing.name}.`, 'property_already_owned');
      const now = new Date().toISOString();
      const propertyId = randomUUID();
      this.debit(userId, listing.priceLrd, 'property_purchase', `Bought ${listing.name}`, requestId, now);
      this.database.connection.prepare(`INSERT INTO player_properties (id, owner_id, listing_id, level, purchased_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)`).run(propertyId, userId, listingId, now, now);
      this.database.audit(userId, 'property.purchased', { propertyId, listingId, priceLrd: listing.priceLrd, requestId });
    });
  }

  upgradeProperty(userId: string, propertyId: string, requestId: string): LifestyleMutationResult {
    return this.mutate(userId, requestId, 'property.upgrade', propertyId, () => {
      const row = this.database.connection.prepare('SELECT listing_id, level FROM player_properties WHERE id = ? AND owner_id = ?').get(propertyId, userId) as { listing_id: string; level: number } | undefined;
      if (!row) throw new DomainError(403, 'You do not own that property.', 'property_not_owned');
      if (row.level >= MAX_PROPERTY_LEVEL) throw new DomainError(409, 'This home is already fully upgraded.', 'property_max_level');
      const listing = this.property(row.listing_id);
      const nextLevel = row.level + 1;
      const cost = propertyUpgradeCost(listing, nextLevel);
      const now = new Date().toISOString();
      this.debit(userId, cost, 'property_upgrade', `${listing.name} upgrade · level ${nextLevel}`, requestId, now);
      const changed = this.database.connection.prepare('UPDATE player_properties SET level = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND level = ?')
        .run(nextLevel, now, propertyId, userId, row.level);
      if (changed.changes !== 1) throw new DomainError(409, 'Property state changed; please refresh.', 'property_state_changed');
      this.database.audit(userId, 'property.upgraded', { propertyId, level: nextLevel, priceLrd: cost, requestId });
    });
  }

  purchaseVehicle(userId: string, modelId: string, requestId: string, requestedConfiguration?: VehicleConfiguration): LifestyleMutationResult {
    const model = this.vehicleModel(modelId);
    const configuration = requestedConfiguration ?? defaultVehicleConfiguration(model);
    const paint = vehiclePaint(configuration.paintId);
    if (!paint || !Object.hasOwn(VEHICLE_PAINT_FINISHES, configuration.finish)) {
      throw new DomainError(400, 'Choose a supported factory paint and finish.', 'invalid_vehicle_configuration');
    }
    const totalLrd = vehicleConfigurationPrice(model, configuration);
    const requestTarget = `${modelId}:${configuration.paintId}:${configuration.finish}`;
    return this.mutate(userId, requestId, 'vehicle.purchase', requestTarget, () => {
      const count = this.database.connection.prepare("SELECT COUNT(*) AS count FROM player_vehicles WHERE owner_id = ? AND lifecycle = 'active'").get(userId) as { count: number };
      const capacity = this.players.garageCapacity(userId);
      if (Number(count.count) >= capacity) {
        throw new DomainError(409, 'Your garage is full. Buy or upgrade a home to add permanent parking slots.', 'garage_full');
      }
      const vehicleId = randomUUID();
      const plate = this.availablePlate();
      const now = new Date().toISOString();
      const finishName = VEHICLE_PAINT_FINISHES[configuration.finish].name;
      this.debit(userId, totalLrd, 'vehicle_purchase', `Bought ${model.name} · ${paint.name} · ${finishName}`, requestId, now);
      this.database.connection.prepare(`INSERT INTO player_vehicles
        (id, owner_id, model_id, plate, color, paint_id, paint_finish, fuel_percent, condition_percent, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 100, 100, ?, ?)`)
        .run(vehicleId, userId, modelId, plate, paint.color, configuration.paintId, configuration.finish, now, now);
      this.database.audit(userId, 'vehicle.purchased', {
        vehicleId, modelId, plate, priceLrd: totalLrd, basePriceLrd: model.priceLrd, configuration, requestId,
      });
    });
  }

  upgradeVehicle(userId: string, vehicleId: string, kind: VehicleUpgradeKind, requestId: string): LifestyleMutationResult {
    return this.mutate(userId, requestId, 'vehicle.upgrade', `${vehicleId}:${kind}`, () => {
      this.ensureVehicleServiceAllowed(userId);
      const column = upgradeColumns[kind];
      const row = this.database.connection.prepare(`SELECT ${column} AS level FROM player_vehicles WHERE id = ? AND owner_id = ? AND lifecycle = 'active'`).get(vehicleId, userId) as { level: number } | undefined;
      if (!row) throw new DomainError(403, 'You are not authorized to upgrade that vehicle.', 'vehicle_not_owned');
      if (row.level >= MAX_VEHICLE_UPGRADE_LEVEL) throw new DomainError(409, `${VEHICLE_UPGRADES[kind].name} is already at maximum level.`, 'vehicle_max_upgrade');
      const nextLevel = row.level + 1;
      const cost = vehicleUpgradeCost(kind, nextLevel);
      const now = new Date().toISOString();
      this.debit(userId, cost, 'vehicle_upgrade', `${VEHICLE_UPGRADES[kind].name} · level ${nextLevel}`, requestId, now);
      const changed = this.database.connection.prepare(`UPDATE player_vehicles SET ${column} = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND ${column} = ?`)
        .run(nextLevel, now, vehicleId, userId, row.level);
      if (changed.changes !== 1) throw new DomainError(409, 'Vehicle state changed; please refresh.', 'vehicle_state_changed');
      this.database.audit(userId, 'vehicle.upgraded', { vehicleId, kind, level: nextLevel, priceLrd: cost, requestId });
    });
  }

  selectVehicle(userId: string, vehicleId: string, requestId: string): LifestyleMutationResult {
    return this.mutate(userId, requestId, 'vehicle.select', vehicleId, () => {
      this.ensureVehicleServiceAllowed(userId);
      const owned = this.database.connection.prepare("SELECT id FROM player_vehicles WHERE id = ? AND owner_id = ? AND lifecycle = 'active'").get(vehicleId, userId);
      if (!owned) throw new DomainError(403, 'You are not authorized to use that vehicle.', 'vehicle_not_owned');
      const now = new Date().toISOString();
      this.database.connection.prepare(`INSERT INTO player_vehicle_preferences (user_id, selected_vehicle_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET selected_vehicle_id = excluded.selected_vehicle_id, updated_at = excluded.updated_at`)
        .run(userId, vehicleId, now);
      this.database.audit(userId, 'vehicle.selected', { vehicleId, requestId });
    });
  }

  private mutate(userId: string, requestId: string, kind: string, target: string, work: () => void): LifestyleMutationResult {
    let duplicate = false;
    this.database.transaction(() => {
      const previous = this.database.connection.prepare('SELECT user_id, kind, target FROM lifestyle_requests WHERE request_id = ?').get(requestId) as { user_id: string; kind: string; target: string } | undefined;
      if (previous) {
        if (previous.user_id !== userId || previous.kind !== kind || previous.target !== target) {
          throw new DomainError(409, 'That request identifier was already used for another operation.', 'request_reused');
        }
        duplicate = true;
        return;
      }
      work();
      this.database.connection.prepare('INSERT INTO lifestyle_requests (request_id, user_id, kind, target, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(requestId, userId, kind, target, new Date().toISOString());
    });
    return { duplicate, ...this.players.lifestyleState(userId) };
  }

  private debit(userId: string, amount: number, kind: string, description: string, requestId: string, now: string) {
    const changed = this.database.connection.prepare(`UPDATE player_wallets SET balance_lrd = balance_lrd - ?, updated_at = ?
      WHERE user_id = ? AND balance_lrd >= ?`).run(amount, now, userId, amount);
    if (changed.changes !== 1) throw new DomainError(409, 'Insufficient LRD. Complete more fares before making this purchase.', 'insufficient_funds');
    const wallet = this.database.connection.prepare('SELECT balance_lrd FROM player_wallets WHERE user_id = ?').get(userId) as { balance_lrd: number };
    this.database.connection.prepare(`INSERT INTO ledger_transactions
      (id, user_id, amount_lrd, balance_after_lrd, kind, reference, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), userId, -amount, wallet.balance_lrd, kind, `lifestyle:${requestId}`, description, now);
  }

  private ensureVehicleServiceAllowed(userId: string) {
    const open = this.database.connection.prepare("SELECT id FROM taxi_trips WHERE driver_id = ? AND status IN ('accepted', 'active')").get(userId);
    if (open) throw new DomainError(409, 'Finish or cancel your active trip before using vehicle services.', 'trip_already_open');
    const recent = this.presence.recent(userId);
    if (recent?.mode === 'driving') {
      throw new DomainError(409, 'Park and exit your vehicle before selecting or upgrading it.', 'vehicle_occupied');
    }
    if (recent?.interiorPropertyId) {
      throw new DomainError(409, 'Step outside your home before selecting or upgrading a vehicle.', 'vehicle_not_accessible');
    }
  }

  private availablePlate() {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const plate = `LR-C${randomInt(10000, 100000)}`;
      if (!this.database.connection.prepare('SELECT id FROM player_vehicles WHERE plate = ?').get(plate)) return plate;
    }
    throw new DomainError(500, 'Unable to allocate a vehicle plate. Please retry.', 'plate_unavailable');
  }

  private property(listingId: string): PropertyCatalogEntry {
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === listingId);
    if (!listing) throw new DomainError(404, 'Property listing not found.', 'property_not_found');
    return listing;
  }

  private vehicleModel(modelId: string): VehicleCatalogEntry {
    const model = VEHICLE_CATALOG.find((entry) => entry.modelId === modelId);
    if (!model) throw new DomainError(404, 'Vehicle listing not found.', 'vehicle_not_found');
    return model;
  }
}
