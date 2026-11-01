import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { TaxiService } from '../src/server/services/taxi-service';
import { LifestyleService } from '../src/server/services/lifestyle-service';
import { PROPERTY_CATALOG, VEHICLE_CATALOG, VEHICLE_UPGRADES, propertyUpgradeCost, vehicleUpgradeCost } from '../src/shared/catalog';
import { PLAYER_SPAWN } from '../src/shared/world';

describe('authoritative lifestyle commerce', () => {
  let database: Database;
  let auth: AuthService;
  let players: PlayerService;
  let presence: PresenceService;
  let taxi: TaxiService;
  let lifestyle: LifestyleService;
  let playerId: string;
  let starterVehicleId: string;

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    auth = new AuthService(database);
    players = new PlayerService(database, auth);
    presence = new PresenceService();
    taxi = new TaxiService(database, players, presence);
    lifestyle = new LifestyleService(database, players, presence);
    playerId = (await auth.register('home_owner', 'correct-horse', 'Home Owner')).userId;
    starterVehicleId = players.vehicles(playerId)[0]!.id;
  });

  afterEach(() => database.close());

  it('buys and selects a vehicle with replay-safe payment and persistent selection', () => {
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === 'city-hatchback')!;
    const requestId = randomUUID();
    const purchased = lifestyle.purchaseVehicle(playerId, listing.modelId, requestId);
    expect(purchased.duplicate).toBe(false);
    expect(purchased.wallet.balanceLrd).toBe(12_500 - listing.priceLrd);
    expect(purchased.vehicles).toHaveLength(2);
    const vehicle = purchased.vehicles.find((entry) => entry.modelId === listing.modelId)!;
    expect(vehicle.taxi).toBe(false);
    expect(vehicle.fuelPercent).toBe(100);

    const replay = lifestyle.purchaseVehicle(playerId, listing.modelId, requestId);
    expect(replay.duplicate).toBe(true);
    expect(replay.wallet.balanceLrd).toBe(purchased.wallet.balanceLrd);
    expect(replay.vehicles).toHaveLength(2);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'vehicle_purchase')).toHaveLength(1);

    const selected = lifestyle.selectVehicle(playerId, vehicle.id, randomUUID());
    expect(selected.selectedVehicleId).toBe(vehicle.id);
    expect(players.lifestyleState(playerId).selectedVehicleId).toBe(vehicle.id);
  });

  it('persists modern vehicle ownership, canonical specifications and selection', () => {
    database.connection.prepare('UPDATE player_wallets SET balance_lrd = 50000 WHERE user_id = ?').run(playerId);
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === 'modern-sedan')!;
    const purchased = lifestyle.purchaseVehicle(playerId, listing.modelId, randomUUID());
    expect(purchased.wallet.balanceLrd).toBe(50000 - listing.priceLrd);
    const modern = purchased.vehicles.find((entry) => entry.modelId === listing.modelId)!;
    expect(modern.model).toMatchObject({ name: 'Mesurado Aero', maxSpeed: 32, acceleration: 10.6, seats: 4 });
    expect(modern.taxi).toBe(false);
    const selected = lifestyle.selectVehicle(playerId, modern.id, randomUUID());
    expect(selected.selectedVehicleId).toBe(modern.id);
    expect(players.vehicles(playerId).find((entry) => entry.id === modern.id)?.model.className).toBe('Modern sport sedan');
  });

  it('persists factory paint and finish with authoritative pricing and configuration-safe replay', () => {
    database.connection.prepare('UPDATE player_wallets SET balance_lrd = 50000 WHERE user_id = ?').run(playerId);
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === 'modern-suv')!;
    const requestId = randomUUID();
    const configuration = { paintId: 'bomi-red' as const, finish: 'matte' as const };
    const purchased = lifestyle.purchaseVehicle(playerId, listing.modelId, requestId, configuration);
    expect(purchased.wallet.balanceLrd).toBe(50000 - listing.priceLrd - 650);
    const vehicle = purchased.vehicles.find((entry) => entry.modelId === listing.modelId)!;
    expect(vehicle).toMatchObject({ paintId: 'bomi-red', finish: 'matte', color: '#8f3232' });
    expect(players.vehicles(playerId).find((entry) => entry.id === vehicle.id)).toMatchObject(configuration);
    expect(players.ledger(playerId).find((entry) => entry.kind === 'vehicle_purchase')?.description).toContain('Matte finish');

    const replay = lifestyle.purchaseVehicle(playerId, listing.modelId, requestId, configuration);
    expect(replay.duplicate).toBe(true);
    expect(replay.wallet.balanceLrd).toBe(purchased.wallet.balanceLrd);
    expect(() => lifestyle.purchaseVehicle(playerId, listing.modelId, requestId, { ...configuration, finish: 'gloss' })).toThrow(/request identifier/i);
  });

  it('checks the configured total rather than only the base price before debiting', () => {
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === 'city-hatchback')!;
    database.connection.prepare('UPDATE player_wallets SET balance_lrd = 11500 WHERE user_id = ?').run(playerId);
    expect(() => lifestyle.purchaseVehicle(playerId, listing.modelId, randomUUID(), { paintId: 'pearl', finish: 'matte' })).toThrow(/Insufficient LRD/);
    expect(players.wallet(playerId).balanceLrd).toBe(11500);
    expect(players.vehicles(playerId)).toHaveLength(1);
    expect(players.ledger(playerId).filter((entry) => entry.kind === 'vehicle_purchase')).toHaveLength(0);
  });

  it('buys and upgrades homes to increase enforced garage capacity exactly once', () => {
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === 'sinkor-studio')!;
    const purchased = lifestyle.purchaseProperty(playerId, listing.id, randomUUID());
    expect(purchased.wallet.balanceLrd).toBe(12_500 - listing.priceLrd);
    expect(purchased.garageCapacity).toBe(3);
    expect(purchased.properties[0]).toMatchObject({ listingId: listing.id, level: 1 });

    const requestId = randomUUID();
    const upgraded = lifestyle.upgradeProperty(playerId, purchased.properties[0]!.id, requestId);
    const levelTwoCost = propertyUpgradeCost(listing, 2);
    expect(upgraded.wallet.balanceLrd).toBe(purchased.wallet.balanceLrd - levelTwoCost);
    expect(upgraded.properties[0]!.level).toBe(2);
    expect(upgraded.garageCapacity).toBe(4);

    const replay = lifestyle.upgradeProperty(playerId, purchased.properties[0]!.id, requestId);
    expect(replay.duplicate).toBe(true);
    expect(replay.wallet.balanceLrd).toBe(upgraded.wallet.balanceLrd);
    expect(replay.properties[0]!.level).toBe(2);
    expect(() => lifestyle.upgradeProperty(playerId, purchased.properties[0]!.id, randomUUID())).toThrow(/Insufficient LRD/);
    expect(() => lifestyle.purchaseProperty(playerId, listing.id, randomUUID())).toThrow(/already own/);
    expect(players.wallet(playerId).balanceLrd).toBe(upgraded.wallet.balanceLrd);
  });

  it('rejects unaffordable vehicles and garage overflow without debiting the wallet', () => {
    const minibus = VEHICLE_CATALOG.find((entry) => entry.modelId === 'city-minibus')!;
    const hatchback = VEHICLE_CATALOG.find((entry) => entry.modelId === 'city-hatchback')!;
    expect(() => lifestyle.purchaseVehicle(playerId, minibus.modelId, randomUUID())).toThrow(/Insufficient LRD/);
    expect(players.wallet(playerId).balanceLrd).toBe(12_500);

    lifestyle.purchaseVehicle(playerId, hatchback.modelId, randomUUID());
    const balance = players.wallet(playerId).balanceLrd;
    expect(() => lifestyle.purchaseVehicle(playerId, hatchback.modelId, randomUUID())).toThrow(/garage is full/);
    expect(players.wallet(playerId).balanceLrd).toBe(balance);
    expect(players.vehicles(playerId)).toHaveLength(2);
  });

  it('applies real engine handling upgrades through level three without replay charges', () => {
    const base = players.vehicles(playerId)[0]!.model;
    let expectedBalance = 12_500;
    let firstRequest = '';
    for (let level = 1; level <= 3; level += 1) {
      firstRequest = level === 1 ? randomUUID() : firstRequest;
      const requestId = level === 1 ? firstRequest : randomUUID();
      const result = lifestyle.upgradeVehicle(playerId, starterVehicleId, 'engine', requestId);
      expectedBalance -= vehicleUpgradeCost('engine', level);
      expect(result.wallet.balanceLrd).toBe(expectedBalance);
      expect(result.vehicles[0]!.upgrades.engine).toBe(level);
      if (level === 1) {
        const replay = lifestyle.upgradeVehicle(playerId, starterVehicleId, 'engine', requestId);
        expect(replay.duplicate).toBe(true);
        expect(replay.wallet.balanceLrd).toBe(expectedBalance);
      }
    }
    const upgraded = players.vehicles(playerId)[0]!.model;
    expect(upgraded.acceleration).toBeCloseTo(base.acceleration * 1.3);
    expect(upgraded.maxSpeed).toBeCloseTo(base.maxSpeed * 1.18);
    expect(() => lifestyle.upgradeVehicle(playerId, starterVehicleId, 'engine', randomUUID())).toThrow(/maximum level/);
    expect(players.wallet(playerId).balanceLrd).toBe(expectedBalance);
  });

  it('requires citizens to step outside before vehicle selection or workshop upgrades', () => {
    const listing = PROPERTY_CATALOG.find((entry) => entry.id === 'sinkor-studio')!;
    const purchased = lifestyle.purchaseProperty(playerId, listing.id, randomUUID());
    const propertyId = purchased.properties[0]!.id;
    presence.join(auth.profile(playerId));
    expect(presence.update(playerId, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', interiorPropertyId: propertyId, sequence: 1,
    }, new Set([starterVehicleId]), new Set([propertyId]))).not.toBeNull();
    const balance = players.wallet(playerId).balanceLrd;
    expect(() => lifestyle.selectVehicle(playerId, starterVehicleId, randomUUID())).toThrow(/Step outside/);
    expect(() => lifestyle.upgradeVehicle(playerId, starterVehicleId, 'tires', randomUUID())).toThrow(/Step outside/);
    expect(players.wallet(playerId).balanceLrd).toBe(balance);
  });

  it('prevents unauthorized vehicle changes and changes while occupied or on a trip', async () => {
    const otherId = (await auth.register('other_driver', 'correct-horse', 'Other Driver')).userId;
    expect(() => lifestyle.upgradeVehicle(otherId, starterVehicleId, 'brakes', randomUUID())).toThrow(/not authorized/);
    expect(() => lifestyle.selectVehicle(otherId, starterVehicleId, randomUUID())).toThrow(/not authorized/);
    expect(players.wallet(otherId).balanceLrd).toBe(12_500);

    presence.join(auth.profile(playerId));
    presence.update(playerId, {
      position: [PLAYER_SPAWN.x, 0.08, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId: starterVehicleId, sequence: 1,
    }, new Set([starterVehicleId]));
    expect(() => lifestyle.upgradeVehicle(playerId, starterVehicleId, 'tires', randomUUID())).toThrow(/Park and exit/);
    presence.update(playerId, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', sequence: 2,
    }, new Set([starterVehicleId]));
    taxi.accept(playerId, taxi.availableJobs()[0]!.id, starterVehicleId);
    expect(() => lifestyle.upgradeVehicle(playerId, starterVehicleId, 'tires', randomUUID())).toThrow(/active trip/);
    expect(players.wallet(playerId).balanceLrd).toBe(12_500);
  });
});
