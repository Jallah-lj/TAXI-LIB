import type { PropertyCatalogEntry } from './catalog.js';
import { getLocation, type Point2 } from './world.js';

export type HomeRoomId = 'hall' | 'living' | 'kitchen' | 'bedroom' | 'bathroom';

export interface HomeRoomDefinition {
  id: HomeRoomId;
  name: string;
  description: string;
  spawn: Point2;
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const HOME_WIDTH = 14;
export const HOME_DEPTH = 12;
export const HOME_ENTRY_LOCAL: Point2 = Object.freeze({ x: 0, z: 4.6 });

const hall: HomeRoomDefinition = {
  id: 'hall', name: 'Entry hall', description: 'Front door, room navigator and home lighting.',
  spawn: { x: 0, z: 4.2 },
};

export const HOME_ROOMS: Readonly<Record<string, readonly HomeRoomDefinition[]>> = Object.freeze({
  'sinkor-studio': Object.freeze<HomeRoomDefinition[]>([
    hall,
    { id: 'living', name: 'Living room', description: 'Sofa, media console, rug and reading corner.', spawn: { x: -2.3, z: 2.6 }, bounds: { minX: -6.9, maxX: -1, minZ: 0, maxZ: 6 } },
    { id: 'kitchen', name: 'Kitchen', description: 'Fitted counters, refrigerator, sink and dining table.', spawn: { x: 2.1, z: 4.4 }, bounds: { minX: 1, maxX: 6.9, minZ: 0, maxZ: 6 } },
    { id: 'bedroom', name: 'Bedroom', description: 'Bed, wardrobe, bedside tables and storage.', spawn: { x: -2.3, z: -2.4 }, bounds: { minX: -6.9, maxX: -1, minZ: -6, maxZ: 0 } },
    { id: 'bathroom', name: 'Bathroom', description: 'Walk-in shower, vanity, mirror and toilet.', spawn: { x: 3.5, z: -2.5 }, bounds: { minX: 1, maxX: 6.9, minZ: -6, maxZ: 0 } },
  ]),
  'coastal-cottage': Object.freeze<HomeRoomDefinition[]>([
    hall,
    { id: 'living', name: 'Coastal lounge', description: 'A bright lounge with natural textures and coastal accents.', spawn: { x: -2.3, z: 2.6 }, bounds: { minX: -6.9, maxX: -1, minZ: 0, maxZ: 6 } },
    { id: 'kitchen', name: 'Family kitchen', description: 'Full kitchen, breakfast table and modern appliances.', spawn: { x: 2.1, z: 4.4 }, bounds: { minX: 1, maxX: 6.9, minZ: 0, maxZ: 6 } },
    { id: 'bedroom', name: 'Main bedroom', description: 'Double bed, wardrobe and a quiet reading space.', spawn: { x: -2.3, z: -2.4 }, bounds: { minX: -6.9, maxX: -1, minZ: -6, maxZ: 0 } },
    { id: 'bathroom', name: 'Bathroom', description: 'Tiled shower, vanity, mirror and toilet.', spawn: { x: 3.5, z: -2.5 }, bounds: { minX: 1, maxX: 6.9, minZ: -6, maxZ: 0 } },
  ]),
});

export function homeRooms(listingId: string): readonly HomeRoomDefinition[] {
  return HOME_ROOMS[listingId] ?? HOME_ROOMS['sinkor-studio']!;
}

export function homeRoomAt(listingId: string, point: Point2): HomeRoomDefinition {
  return homeRooms(listingId).find((room) => room.bounds
    && point.x >= room.bounds.minX && point.x <= room.bounds.maxX
    && point.z >= room.bounds.minZ && point.z <= room.bounds.maxZ) ?? hall;
}

/** Canonical exterior building center. The map destination remains outside the front door. */
export function homeOrigin(property: PropertyCatalogEntry): Point2 {
  const entrance = getLocation(property.locationId);
  return { x: entrance.x, z: entrance.z - 7 };
}
