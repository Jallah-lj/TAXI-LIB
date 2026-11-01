import { randomUUID } from 'node:crypto';
import type { Database } from './database.js';
import { WORLD_LOCATIONS, getLocation } from '../../shared/world.js';
import { routeDistance } from '../../shared/navigation.js';
import { getSimulationState, quoteFare } from '../../shared/simulation.js';
import { VEHICLE_CATALOG } from '../../shared/catalog.js';

const passengerNames = [
  'Musu Kollie', 'Korto Davis', 'Famatta Johnson', 'Varney Brown', 'Mamawa Konneh',
  'Josephine Toe', 'James Nyumah', 'Grace Dolo', 'Emmanuel Kromah', 'Comfort Duo',
];

const routePairs = [
  ['taxi-stand', 'sinkor-market'],
  ['sinkor-market', 'oceanview-hotel'],
  ['oceanview-hotel', 'community-clinic'],
  ['community-clinic', 'cooperative-garage'],
  ['cooperative-garage', 'taxi-stand'],
  ['beach-access', 'sinkor-market'],
  ['taxi-stand', 'community-clinic'],
  ['oceanview-hotel', 'taxi-stand'],
] as const;

export function seedDatabase(database: Database) {
  const now = new Date().toISOString();
  const insertModel = database.connection.prepare(`INSERT OR IGNORE INTO vehicle_models
    (id, name, class_name, max_speed, acceleration, braking, steering, grip, seats)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const model of VEHICLE_CATALOG) {
    insertModel.run(model.modelId, model.name, model.className, model.maxSpeed, model.acceleration,
      model.braking, model.steering, model.grip, model.seats);
  }
  ensureTaxiJobs(database, 7);
  database.audit(null, 'world.seeded', { at: now, locations: WORLD_LOCATIONS.length });
}

export function ensureTaxiJobs(database: Database, desiredCount = 7) {
  database.connection.prepare("UPDATE taxi_jobs SET status = 'expired', updated_at = ? WHERE status = 'requested' AND expires_at <= ?")
    .run(new Date().toISOString(), new Date().toISOString());
  const countRow = database.connection.prepare("SELECT COUNT(*) AS count FROM taxi_jobs WHERE status = 'requested'").get() as { count: number };
  let missing = Math.max(0, desiredCount - Number(countRow.count));
  if (!missing) return;

  const totalRow = database.connection.prepare('SELECT COUNT(*) AS count FROM taxi_jobs').get() as { count: number };
  let serial = Number(totalRow.count);
  const insert = database.connection.prepare(`INSERT INTO taxi_jobs
    (id, passenger_name, pickup_location_id, destination_location_id, fare_lrd, status, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'requested', ?, ?, ?)`);

  database.transaction(() => {
    while (missing > 0) {
      const pair = routePairs[serial % routePairs.length]!;
      const pickup = getLocation(pair[0]);
      const destination = getLocation(pair[1]);
      const now = new Date();
      const distance = routeDistance(pickup, destination);
      const fare = quoteFare(distance, getSimulationState(now.getTime()).rainIntensity);
      insert.run(
        randomUUID(), passengerNames[serial % passengerNames.length]!, pickup.id, destination.id, fare,
        new Date(now.getTime() + 20 * 60_000).toISOString(), now.toISOString(), now.toISOString(),
      );
      serial += 1;
      missing -= 1;
    }
  });
}
