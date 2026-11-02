import { WORLD_BOUNDS } from '../../shared/world';
import { orientedBoxIntersectsAABB, orientedCorners } from './collision-geometry';

export interface Collider { minX: number; maxX: number; minZ: number; maxZ: number }

export class CollisionWorld {
  readonly colliders: Collider[] = [];

  add(x: number, z: number, width: number, depth: number) {
    this.colliders.push({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
  }

  blocked(x: number, z: number, radius = 0.35) {
    if (x - radius < WORLD_BOUNDS.minX || x + radius > WORLD_BOUNDS.maxX || z - radius < WORLD_BOUNDS.minZ || z + radius > WORLD_BOUNDS.maxZ) return true;
    if (x - radius < -173) return true;
    return this.colliders.some((box) => x + radius > box.minX && x - radius < box.maxX && z + radius > box.minZ && z - radius < box.maxZ);
  }

  blockedVehicle(x: number, z: number, heading: number, halfWidth: number, halfLength: number) {
    const footprint = { x, z, heading, halfWidth, halfLength };
    const corners = orientedCorners(footprint);
    if (corners.some((point) => point.x < WORLD_BOUNDS.minX || point.x > WORLD_BOUNDS.maxX
      || point.z < WORLD_BOUNDS.minZ || point.z > WORLD_BOUNDS.maxZ || point.x < -173)) return true;
    return this.colliders.some((box) => orientedBoxIntersectsAABB(footprint, box));
  }
}
