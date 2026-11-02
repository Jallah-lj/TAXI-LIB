import { randomUUID } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ModernVehicle } from '../src/client/entities/modern-vehicle';
import { VehicleHeadlights } from '../src/client/entities/vehicle-lights';
import { VEHICLE_CATALOG } from '../src/shared/catalog';
import { purchaseVehicleSchema } from '../src/shared/validation';

describe('modern showroom vehicles', () => {
  it('offers two distinct modern models with valid handling and purchase contracts', () => {
    const modern = VEHICLE_CATALOG.filter((entry) => entry.visual === 'modern-sedan' || entry.visual === 'modern-suv');
    expect(modern.map((entry) => entry.modelId)).toEqual(['modern-sedan', 'modern-suv']);
    expect(new Set(VEHICLE_CATALOG.map((entry) => entry.modelId)).size).toBe(VEHICLE_CATALOG.length);
    for (const listing of modern) {
      expect(listing.priceLrd).toBeGreaterThan(0);
      expect(listing.maxSpeed * 1.18).toBeLessThanOrEqual(38);
      expect(purchaseVehicleSchema.parse({ modelId: listing.modelId, requestId: randomUUID() }).modelId).toBe(listing.modelId);
    }
    expect(modern[0]!.acceleration).toBeGreaterThan(modern[1]!.acceleration);
    expect(modern[1]!.seats).toBeGreaterThan(modern[0]!.seats);
  });

  it('builds drivable sedan and SUV geometry with four animated alloy wheels', () => {
    const sedan = new ModernVehicle('#315c73', 'modern-sedan');
    const suv = new ModernVehicle('#6b746c', 'modern-suv');
    expect(suv.size.y).toBeGreaterThan(sedan.size.y);
    expect(suv.size.x).toBeGreaterThan(sedan.size.x);
    for (const vehicle of [sedan, suv]) {
      const wheels = vehicle.group.children.flatMap((child) => child.children).filter((child) => child.name.startsWith('modern-wheel-'));
      expect(wheels).toHaveLength(4);
      let meshCount = 0;
      vehicle.group.traverse((object) => { if (object instanceof THREE.Mesh) meshCount += 1; });
      expect(meshCount).toBeGreaterThan(60);
      vehicle.update(0.5, 8, 0.5);
      expect(wheels.every((wheel) => wheel.rotation.x < 0)).toBe(true);
      const steeringPivots = vehicle.group.children.filter((child) => child.name.startsWith('front-'));
      expect(steeringPivots).toHaveLength(2);
      expect(steeringPivots.every((pivot) => Math.abs(pivot.rotation.y - 0.21) < 0.0001)).toBe(true);
      vehicle.dispose();
      expect(vehicle.group.children).toHaveLength(0);
    }
  });

  it('supports the same functional spotlights and emissive LED materials as other vehicles', () => {
    const model = new ModernVehicle('#315c73', 'modern-sedan');
    const rig = new VehicleHeadlights();
    rig.configure(model.size);
    rig.collectMaterials(model.group);
    const spotlights: THREE.SpotLight[] = [];
    const headlightMaterials = new Set<THREE.MeshStandardMaterial>();
    rig.group.traverse((object) => { if (object instanceof THREE.SpotLight) spotlights.push(object); });
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshStandardMaterial && material.name === 'HeadlightLED') headlightMaterials.add(material);
      }
    });
    expect(spotlights).toHaveLength(2);
    expect(headlightMaterials.size).toBe(1);
    rig.set(true);
    expect(spotlights.every((light) => light.visible && light.intensity > 0)).toBe(true);
    expect([...headlightMaterials].every((material) => material.emissiveIntensity === 3.2)).toBe(true);
    rig.set(false);
    expect(spotlights.every((light) => !light.visible)).toBe(true);
    expect([...headlightMaterials].every((material) => material.emissiveIntensity === 0.28)).toBe(true);
    rig.dispose();
    model.dispose();
  });
});
