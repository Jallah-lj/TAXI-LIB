import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { circleIntersectsOrientedBox, orientedBoxIntersectsAABB, orientedBoxesIntersect, orientedCorners } from '../src/client/systems/collision-geometry';
import { CollisionWorld } from '../src/client/systems/collision';
import { ActorCollisionWorld } from '../src/client/systems/actor-collision';

describe('oriented physical footprints', () => {
  it('rotates the long vehicle axis with heading instead of treating it as a circle', () => {
    const car = { x: 0, z: 0, heading: Math.PI / 2, halfWidth: 1, halfLength: 3 };
    const corners = orientedCorners(car);
    expect(Math.max(...corners.map((point) => point.x))).toBeCloseTo(3);
    expect(Math.max(...corners.map((point) => point.z))).toBeCloseTo(1);
    expect(orientedBoxIntersectsAABB(car, { minX: 2.8, maxX: 3.2, minZ: -2, maxZ: 2 })).toBe(true);
    expect(orientedBoxIntersectsAABB(car, { minX: -1, maxX: 1, minZ: 1.2, maxZ: 1.5 })).toBe(false);
  });

  it('uses the rotated footprint for static building and world-boundary contact', () => {
    const world = new CollisionWorld([]);
    world.add(2.9, 0, 0.2, 4);
    expect(world.blocked(0, 0, 1.25)).toBe(false);
    expect(world.blockedVehicle(0, 0, Math.PI / 2, 1, 3)).toBe(true);
    expect(world.blockedVehicle(0, 4, Math.PI / 2, 1, 3)).toBe(false);
    expect(world.blockedVehicle(-172.5, 0, 0, 1, 2)).toBe(true);
  });

  it('separates oriented vehicles on all four SAT axes', () => {
    const first = { x: 0, z: 0, heading: Math.PI / 4, halfWidth: 1, halfLength: 2.4 };
    expect(orientedBoxesIntersect(first, { ...first, x: 1.2, z: 0.4 })).toBe(true);
    expect(orientedBoxesIntersect(first, { ...first, x: 12, z: -8 })).toBe(false);
    expect(circleIntersectsOrientedBox(3.25, 0, 0.4, { x: 0, z: 0, heading: Math.PI / 2, halfWidth: 1, halfLength: 3 })).toBe(true);
    expect(circleIntersectsOrientedBox(3.6, 0, 0.4, { x: 0, z: 0, heading: Math.PI / 2, halfWidth: 1, halfLength: 3 })).toBe(false);
  });
});

describe('shared dynamic actor collision layer', () => {
  it('blocks people from other people and vehicles while ignoring only their own footprint', () => {
    const world = new ActorCollisionWorld();
    world.addPerson('person:a', new THREE.Vector3(0, 0, 0), 0.35);
    world.addVehicle('vehicle:a', new THREE.Vector3(5, 0, 0), 0, 1, 2.4);
    expect(world.blockedPerson(0.6, 0, 0.35, 'person:b')).toBe(true);
    expect(world.blockedPerson(0.71, 0, 0.35, 'person:b')).toBe(false);
    expect(world.blockedPerson(5, 2.6, 0.32, 'person:b')).toBe(true);
    expect(world.blockedPerson(0, 0, 0.35, 'person:a')).toBe(false);
    expect(world.blockedPerson(0.65, 0, 0.35, 'person:b', { x: 0.6, z: 0 })).toBe(false);
    expect(world.blockedPerson(0.5, 0, 0.35, 'person:b', { x: 0.6, z: 0 })).toBe(true);
    expect(world.blockedPerson(0.6, 0, 0.35, 'person:b', { x: 1, z: 0 })).toBe(true);
  });

  it('blocks vehicles from people, objective props and other vehicles', () => {
    const world = new ActorCollisionWorld();
    world.addPerson('person:a', new THREE.Vector3(0, 0, 4));
    world.addObject('objective:a', new THREE.Vector3(0, 0, -5), 0.72);
    world.addVehicle('vehicle:a', new THREE.Vector3(0, 0, 6), Math.PI / 2, 1, 2.4);
    const car = { x: 0, z: 0, heading: 0, halfWidth: 1, halfLength: 2.4 };
    expect(world.blockedVehicle({ ...car, z: 1.3 }, 'vehicle:b')).toBe(true);
    expect(world.blockedVehicle({ ...car, z: -3 }, 'vehicle:b')).toBe(true);
    expect(world.blockedVehicle({ ...car, z: 6 }, 'vehicle:b')).toBe(true);
    expect(world.blockedVehicle({ ...car, x: 12 }, 'vehicle:b')).toBe(false);
    const selfWorld = new ActorCollisionWorld();
    selfWorld.addVehicle('vehicle:self', new THREE.Vector3(), 0, 1, 2.4);
    expect(selfWorld.blockedVehicle(car, 'vehicle:self')).toBe(false);
  });

  it('rebuilds cleanly so departed actors do not leave invisible obstacles', () => {
    const world = new ActorCollisionWorld();
    world.addPerson('temporary', new THREE.Vector3(0, 0, 0));
    expect(world.actorCount).toBe(1);
    world.clear();
    expect(world.actorCount).toBe(0);
    expect(world.blockedPerson(0, 0, 0.35)).toBe(false);
  });
});
