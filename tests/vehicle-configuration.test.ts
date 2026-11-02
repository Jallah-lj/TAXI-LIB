import { randomUUID } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ModernVehicle } from '../src/client/entities/modern-vehicle';
import { applyVehicleAppearance } from '../src/client/entities/vehicle-appearance';
import {
  VEHICLE_CATALOG, VEHICLE_PAINT_FINISHES, VEHICLE_PAINTS,
  defaultVehicleConfiguration, vehicleConfigurationPrice, vehiclePaint,
} from '../src/shared/catalog';
import { purchaseVehicleSchema } from '../src/shared/validation';

describe('vehicle factory configuration', () => {
  it('uses canonical model defaults and shared authoritative finish pricing', () => {
    for (const listing of VEHICLE_CATALOG) {
      const configuration = defaultVehicleConfiguration(listing);
      expect(vehiclePaint(configuration.paintId)?.color).toBe(listing.defaultColor);
      expect(vehicleConfigurationPrice(listing, configuration)).toBe(listing.priceLrd);
      expect(vehicleConfigurationPrice(listing, { ...configuration, finish: 'metallic' })).toBe(listing.priceLrd + 450);
      expect(vehicleConfigurationPrice(listing, { ...configuration, finish: 'matte' })).toBe(listing.priceLrd + 650);
    }
    expect(new Set(VEHICLE_PAINTS.map((paint) => paint.id)).size).toBe(VEHICLE_PAINTS.length);
    expect(Object.keys(VEHICLE_PAINT_FINISHES)).toEqual(['gloss', 'metallic', 'matte']);
  });

  it('accepts supported configurations and rejects unknown or prototype-like finishes', () => {
    const base = { modelId: 'modern-sedan', requestId: randomUUID() };
    expect(purchaseVehicleSchema.parse({ ...base, configuration: { paintId: 'pearl', finish: 'metallic' } }).configuration)
      .toEqual({ paintId: 'pearl', finish: 'metallic' });
    expect(purchaseVehicleSchema.safeParse({ ...base, configuration: { paintId: 'not-a-paint', finish: 'gloss' } }).success).toBe(false);
    expect(purchaseVehicleSchema.safeParse({ ...base, configuration: { paintId: 'pearl', finish: 'toString' } }).success).toBe(false);
  });

  it('updates physical paint and clearcoat without touching vehicle handling data', () => {
    const model = new ModernVehicle('#315c73', 'modern-sedan');
    applyVehicleAppearance(model.group, '#8f3232', 'matte');
    const materials = new Set<THREE.MeshPhysicalMaterial>();
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material instanceof THREE.MeshPhysicalMaterial && material.name === 'Paint') materials.add(material);
      }
    });
    expect(materials.size).toBe(1);
    const paint = [...materials][0]!;
    expect(paint.color.getHexString()).toBe('8f3232');
    expect(paint.roughness).toBeCloseTo(0.72);
    expect(paint.clearcoat).toBe(0);
    applyVehicleAppearance(model.group, '#e8e6df', 'metallic');
    expect(paint.color.getHexString()).toBe('e8e6df');
    expect(paint.metalness).toBeCloseTo(0.74);
    expect(paint.clearcoat).toBeGreaterThan(0);
    const listing = VEHICLE_CATALOG.find((entry) => entry.modelId === 'modern-sedan')!;
    expect(listing.maxSpeed).toBe(32);
    expect(listing.grip).toBe(1.02);
    model.dispose();
  });
});
