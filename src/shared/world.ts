export type Point2 = { x: number; z: number };
export type LocationKind = 'transport' | 'market' | 'hotel' | 'clinic' | 'garage' | 'leisure' | 'residential' | 'civic' | 'safety';

export interface WorldLocation extends Point2 {
  id: string;
  name: string;
  shortName: string;
  kind: LocationKind;
  description: string;
}

export interface RoadNode extends Point2 {
  id: string;
}

export interface RoadEdge {
  from: string;
  to: string;
}

export const WORLD_BOUNDS = Object.freeze({ minX: -190, maxX: 260, minZ: -220, maxZ: 220 });
export const PLAYER_SPAWN = Object.freeze({ x: 12, z: 42 });
export const TAXI_SPAWN = Object.freeze({ x: 3, z: 44, heading: Math.PI });

export const WORLD_LOCATIONS: readonly WorldLocation[] = Object.freeze([
  {
    id: 'taxi-stand', name: '12th Street Taxi Stand', shortName: 'Taxi Stand', kind: 'transport', x: 10, z: 36,
    description: 'A fictional neighborhood transport meeting point. Your cooperative taxi is waiting nearby.',
  },
  {
    id: 'sinkor-market', name: 'Sinkor Market', shortName: 'Market', kind: 'market', x: -10, z: -86,
    description: 'Produce stalls, small shops and everyday passenger demand in this fictional game block.',
  },
  {
    id: 'oceanview-hotel', name: 'Oceanview Hotel', shortName: 'Oceanview', kind: 'hotel', x: -108, z: 70,
    description: 'A fictional coastal hotel serving local guests and airport-transfer-style jobs.',
  },
  {
    id: 'community-clinic', name: 'Community Clinic', shortName: 'Clinic', kind: 'clinic', x: 110, z: -72,
    description: 'A neighborhood health destination. This is a gameplay landmark, not a real-world facility.',
  },
  {
    id: 'cooperative-garage', name: 'Cooperative Garage', shortName: 'Garage', kind: 'garage', x: 110, z: 82,
    description: 'Home of the neighborhood transport cooperative and a future repair services hub.',
  },
  {
    id: 'sinkor-homes', name: '12th Street Homes', shortName: 'Homes', kind: 'residential', x: 24, z: 102,
    description: 'A fictional residential block where citizens can own and upgrade a studio home.',
  },
  {
    id: 'coastal-cottages', name: 'Atlantic Cottages', shortName: 'Cottages', kind: 'residential', x: -96, z: 102,
    description: 'A fictional coastal property location. Purchases are simulated and have no real-world value.',
  },
  {
    id: 'beach-access', name: 'Beach Access', shortName: 'Beach', kind: 'leisure', x: -142, z: 10,
    description: 'A sandy Atlantic-inspired coastal viewpoint. The ocean is scenic in this slice.',
  },
  {
    id: 'municipal-services', name: 'Sinkor Municipal Services', shortName: 'Municipal Hall', kind: 'civic', x: 165, z: 80,
    description: 'A fictional public-service counter for maintenance, sanitation and market standards.',
  },
  {
    id: 'district-safety-office', name: 'District Safety Office', shortName: 'Safety Office', kind: 'safety', x: 207, z: 80,
    description: 'A fictional community police and road-safety service point. Not a real Liberian agency.',
  },
]);

const nodes: RoadNode[] = [];
for (const x of [-120, 0, 120, 240]) {
  for (const z of [-180, -120, 0, 120, 180]) {
    const onHorizontal = z === -120 || z === 0 || z === 120;
    const onVerticalEnd = z === -180 || z === 180;
    if (onHorizontal || (onVerticalEnd && x !== 240)) nodes.push({ id: `n_${x}_${z}`, x, z });
  }
}

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const edges: RoadEdge[] = [];
const connect = (ax: number, az: number, bx: number, bz: number) => {
  const from = `n_${ax}_${az}`;
  const to = `n_${bx}_${bz}`;
  if (nodeById.has(from) && nodeById.has(to)) edges.push({ from, to });
};

for (const x of [-120, 0, 120]) {
  connect(x, -180, x, -120);
  connect(x, -120, x, 0);
  connect(x, 0, x, 120);
  connect(x, 120, x, 180);
}
connect(240, -120, 240, 0);
connect(240, 0, 240, 120);
for (const z of [-120, 0, 120]) {
  connect(-120, z, 0, z);
  connect(0, z, 120, z);
  connect(120, z, 240, z);
}

export const ROAD_NODES: readonly RoadNode[] = Object.freeze(nodes);
export const ROAD_EDGES: readonly RoadEdge[] = Object.freeze(edges);
export const ROAD_WIDTH = 18;

export const VEHICLE_ROAD_X = [-120, 0, 120, 240] as const;
export const VEHICLE_ROAD_Z = [-120, 0, 120] as const;

export function getLocation(id: string): WorldLocation {
  const location = WORLD_LOCATIONS.find((entry) => entry.id === id);
  if (!location) throw new Error(`Unknown world location: ${id}`);
  return location;
}

export function distance2D(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isOnRoad(point: Point2): boolean {
  const onVertical = VEHICLE_ROAD_X.some((x) => {
    const inLongitudinalRange = x === 240 ? point.z >= -129 && point.z <= 129 : point.z >= -189 && point.z <= 189;
    return Math.abs(point.x - x) <= ROAD_WIDTH / 2 && inLongitudinalRange;
  });
  const onHorizontal = VEHICLE_ROAD_Z.some(
    (z) => Math.abs(point.z - z) <= ROAD_WIDTH / 2 && point.x >= -129 && point.x <= 249,
  );
  return onVertical || onHorizontal;
}

export function isInWorld(point: Point2): boolean {
  return point.x >= WORLD_BOUNDS.minX && point.x <= WORLD_BOUNDS.maxX
    && point.z >= WORLD_BOUNDS.minZ && point.z <= WORLD_BOUNDS.maxZ;
}
