import { randomUUID } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PROPERTY_CATALOG } from '../src/shared/catalog';
import { HOME_ROOMS, homeOrigin, homeRoomAt, homeRooms } from '../src/shared/homes';
import { getLocation } from '../src/shared/world';
import { HomeInterior } from '../src/client/world/home-interior';
import type { PlayerProperty } from '../src/shared/types';

function ownedProperty(listingId: string, level = 1): PlayerProperty {
  const now = new Date().toISOString();
  return { id: randomUUID(), listingId, level, purchasedAt: now, updatedAt: now };
}

function visibleMeshCount(group: THREE.Group) {
  let count = 0;
  group.traverseVisible((object) => { if (object instanceof THREE.Mesh) count += 1; });
  return count;
}

describe('walkable owned-home layouts', () => {
  it('provides a canonical entrance, four furnished rooms and a hall for every listing', () => {
    for (const listing of PROPERTY_CATALOG) {
      const entrance = getLocation(listing.locationId);
      expect(homeOrigin(listing)).toEqual({ x: entrance.x, z: entrance.z - 7 });
      const rooms = homeRooms(listing.id);
      expect(rooms.map((room) => room.id)).toEqual(['hall', 'living', 'kitchen', 'bedroom', 'bathroom']);
      expect(new Set(rooms.map((room) => room.id)).size).toBe(5);
      expect(HOME_ROOMS[listing.id]).toBe(rooms);
      for (const room of rooms) expect(homeRoomAt(listing.id, room.spawn).id).toBe(room.id);
    }
  });

  it.each(PROPERTY_CATALOG.map((listing) => [listing.name, listing] as const))('builds safe room spawns, solid walls and working lights for %s', (_name, listing) => {
    const scene = new THREE.Scene();
    const interior = new HomeInterior(ownedProperty(listing.id), listing, scene);
    expect(scene.children).toContain(interior.group);
    expect(interior.collision.colliders.length).toBeGreaterThan(15);
    expect(interior.collision.blocked(interior.origin.x, interior.origin.z - 6)).toBe(true);
    expect(interior.collision.blocked(interior.entryPosition.x, interior.entryPosition.z)).toBe(false);
    expect(interior.nearExit(interior.entryPosition)).toBe(true);

    for (const room of interior.rooms) {
      const spawn = interior.roomSpawn(room.id);
      expect(interior.collision.blocked(spawn.x, spawn.z)).toBe(false);
      expect(interior.roomAt(spawn).id).toBe(room.id);
    }
    expect(interior.nearExit(interior.roomSpawn('bedroom'))).toBe(false);

    const lights: THREE.PointLight[] = [];
    interior.group.traverse((object) => { if (object instanceof THREE.PointLight) lights.push(object); });
    expect(lights).toHaveLength(4);
    expect(lights.every((light) => light.visible)).toBe(true);
    expect(interior.toggleLights()).toBe(false);
    expect(lights.every((light) => !light.visible)).toBe(true);
    expect(interior.toggleLights()).toBe(true);
    expect(lights.every((light) => light.visible)).toBe(true);

    interior.dispose();
    expect(scene.children).not.toContain(interior.group);
    expect(interior.collision.colliders).toHaveLength(0);
  });

  it('adds visible furniture at higher persistent property levels', () => {
    const listing = PROPERTY_CATALOG[0]!;
    const interior = new HomeInterior(ownedProperty(listing.id), listing, new THREE.Scene());
    const levelOneMeshes = visibleMeshCount(interior.group);
    interior.setLevel(2);
    const levelTwoMeshes = visibleMeshCount(interior.group);
    interior.setLevel(3);
    const levelThreeMeshes = visibleMeshCount(interior.group);
    expect(levelTwoMeshes).toBeGreaterThan(levelOneMeshes);
    expect(levelThreeMeshes).toBeGreaterThan(levelTwoMeshes);
    interior.setLevel(1);
    expect(visibleMeshCount(interior.group)).toBe(levelOneMeshes);
    interior.dispose();
  });
});
