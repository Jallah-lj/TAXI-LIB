import type * as THREE from 'three';
import {
  circleIntersectsOrientedBox, orientedBoxesIntersect, type OrientedFootprint, type PlanePoint,
} from './collision-geometry';

interface CircleActor {
  id: string;
  kind: 'person' | 'object';
  x: number;
  z: number;
  radius: number;
}

interface VehicleActor extends OrientedFootprint { id: string }
export interface ActorContact { id: string; kind: 'person' | 'object' | 'vehicle' }

/** A rebuilt spatial layer for normal gameplay actors; it is not a server-physics anti-cheat boundary. */
export class ActorCollisionWorld {
  private readonly circles: CircleActor[] = [];
  private readonly vehicles: VehicleActor[] = [];

  clear() {
    this.circles.length = 0;
    this.vehicles.length = 0;
  }

  addPerson(id: string, position: THREE.Vector3, radius = 0.36) {
    this.circles.push({ id, kind: 'person', x: position.x, z: position.z, radius });
  }

  addObject(id: string, position: THREE.Vector3, radius: number) {
    this.circles.push({ id, kind: 'object', x: position.x, z: position.z, radius });
  }

  addVehicle(id: string, position: THREE.Vector3, heading: number, halfWidth = 1.02, halfLength = 2.35) {
    this.vehicles.push({ id, x: position.x, z: position.z, heading, halfWidth, halfLength });
  }

  blockedPerson(x: number, z: number, radius: number, ignoreId?: string, current?: PlanePoint) {
    for (const actor of this.circles) {
      if (actor.id === ignoreId) continue;
      const nextDistance = Math.hypot(x - actor.x, z - actor.z);
      if (nextDistance >= radius + actor.radius) continue;
      if (current && nextDistance > Math.hypot(current.x - actor.x, current.z - actor.z) + 0.000001
        && Math.hypot(current.x - actor.x, current.z - actor.z) < radius + actor.radius) continue;
      return true;
    }
    for (const vehicle of this.vehicles) {
      if (vehicle.id === ignoreId || !circleIntersectsOrientedBox(x, z, radius, vehicle)) continue;
      if (current && circleIntersectsOrientedBox(current.x, current.z, radius, vehicle)
        && Math.hypot(x - vehicle.x, z - vehicle.z) > Math.hypot(current.x - vehicle.x, current.z - vehicle.z) + 0.000001) continue;
      return true;
    }
    return false;
  }

  vehicleContact(footprint: OrientedFootprint, ignoreId?: string, padding = 0, current?: OrientedFootprint): ActorContact | null {
    const candidate = { ...footprint, halfWidth: footprint.halfWidth + padding, halfLength: footprint.halfLength + padding };
    const previous = current ? { ...current, halfWidth: current.halfWidth + padding, halfLength: current.halfLength + padding } : undefined;
    for (const actor of this.circles) {
      if (actor.id === ignoreId || !circleIntersectsOrientedBox(actor.x, actor.z, actor.radius, candidate)) continue;
      if (previous && circleIntersectsOrientedBox(actor.x, actor.z, actor.radius, previous)
        && Math.hypot(candidate.x - actor.x, candidate.z - actor.z) > Math.hypot(previous.x - actor.x, previous.z - actor.z) + 0.000001) continue;
      return { id: actor.id, kind: actor.kind };
    }
    for (const vehicle of this.vehicles) {
      if (vehicle.id === ignoreId || !orientedBoxesIntersect(candidate, vehicle)) continue;
      if (previous && orientedBoxesIntersect(previous, vehicle)
        && Math.hypot(candidate.x - vehicle.x, candidate.z - vehicle.z) > Math.hypot(previous.x - vehicle.x, previous.z - vehicle.z) + 0.000001) continue;
      return { id: vehicle.id, kind: 'vehicle' };
    }
    return null;
  }

  blockedVehicle(footprint: OrientedFootprint, ignoreId?: string, padding = 0, current?: OrientedFootprint) {
    return this.vehicleContact(footprint, ignoreId, padding, current) !== null;
  }

  get actorCount() { return this.circles.length + this.vehicles.length; }
}
