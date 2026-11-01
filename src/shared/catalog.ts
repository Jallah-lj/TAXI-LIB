export type VehicleVisualKind = 'sedan' | 'hatchback' | 'minibus' | 'modern-sedan' | 'modern-suv';
export type VehicleUpgradeKind = 'engine' | 'brakes' | 'tires';
export type VehiclePaintId = 'atlantic-blue' | 'farmington-sage' | 'duala-teal' | 'cooperative-gold' | 'savannah-cream' | 'obsidian' | 'pearl' | 'bomi-red';
export type VehiclePaintFinish = 'gloss' | 'metallic' | 'matte';

export interface VehicleConfiguration {
  paintId: VehiclePaintId;
  finish: VehiclePaintFinish;
}

export interface VehicleCatalogEntry {
  modelId: string;
  name: string;
  className: string;
  priceLrd: number;
  defaultColor: string;
  maxSpeed: number;
  acceleration: number;
  braking: number;
  steering: number;
  grip: number;
  seats: number;
  visual: VehicleVisualKind;
  taxi: boolean;
  description: string;
}

export interface PropertyCatalogEntry {
  id: string;
  name: string;
  locationId: string;
  priceLrd: number;
  upgradeBaseLrd: number;
  description: string;
}

export const BASE_GARAGE_CAPACITY = 2;
export const MAX_PROPERTY_LEVEL = 3;
export const MAX_VEHICLE_UPGRADE_LEVEL = 3;

export const VEHICLE_CATALOG: readonly VehicleCatalogEntry[] = Object.freeze([
  {
    modelId: 'modern-sedan', name: 'Mesurado Aero', className: 'Modern sport sedan', priceLrd: 16_800, defaultColor: '#315c73', visual: 'modern-sedan', taxi: false,
    maxSpeed: 32, acceleration: 10.6, braking: 17.2, steering: 2.05, grip: 1.02, seats: 4,
    description: 'A sleek aerodynamic sedan with LED lighting, alloy wheels and responsive modern handling.',
  },
  {
    modelId: 'modern-suv', name: 'Farmington Cross', className: 'Modern urban SUV', priceLrd: 22_800, defaultColor: '#6b746c', visual: 'modern-suv', taxi: false,
    maxSpeed: 27.5, acceleration: 8.4, braking: 16.4, steering: 1.62, grip: 1.06, seats: 5,
    description: 'A contemporary five-seat crossover with a raised stance, panoramic glazing and roof rails.',
  },
  {
    modelId: 'city-hatchback', name: 'Duala Hatchback', className: 'Private compact', priceLrd: 11_000, defaultColor: '#39746b', visual: 'hatchback', taxi: false,
    maxSpeed: 25, acceleration: 9, braking: 15.5, steering: 2.05, grip: 0.95, seats: 4,
    description: 'A nimble private compact for city driving, with lower running speed and responsive steering.',
  },
  {
    modelId: 'taxi-sedan', name: 'Kendeja Sedan', className: 'Standard taxi', priceLrd: 15_500, defaultColor: '#e9ad32', visual: 'sedan', taxi: true,
    maxSpeed: 27, acceleration: 8.2, braking: 15, steering: 1.85, grip: 0.92, seats: 4,
    description: 'A cooperative-ready four-door sedan with balanced handling and passenger livery.',
  },
  {
    modelId: 'city-minibus', name: 'Kakata Minibus', className: 'Passenger minibus', priceLrd: 24_000, defaultColor: '#d4c5a4', visual: 'minibus', taxi: true,
    maxSpeed: 22, acceleration: 5.4, braking: 11, steering: 1.15, grip: 0.82, seats: 12,
    description: 'A high-capacity passenger vehicle with deliberate steering and a longer wheelbase.',
  },
]);

export const VEHICLE_PAINTS: readonly { id: VehiclePaintId; name: string; color: string; priceLrd: number }[] = Object.freeze([
  { id: 'atlantic-blue', name: 'Atlantic Blue', color: '#315c73', priceLrd: 0 },
  { id: 'farmington-sage', name: 'Farmington Sage', color: '#6b746c', priceLrd: 0 },
  { id: 'duala-teal', name: 'Duala Teal', color: '#39746b', priceLrd: 0 },
  { id: 'cooperative-gold', name: 'Cooperative Gold', color: '#e9ad32', priceLrd: 0 },
  { id: 'savannah-cream', name: 'Savannah Cream', color: '#d4c5a4', priceLrd: 0 },
  { id: 'obsidian', name: 'Obsidian', color: '#171d22', priceLrd: 0 },
  { id: 'pearl', name: 'Coastal Pearl', color: '#e8e6df', priceLrd: 0 },
  { id: 'bomi-red', name: 'Bomi Red', color: '#8f3232', priceLrd: 0 },
]);

export const VEHICLE_PAINT_FINISHES: Readonly<Record<VehiclePaintFinish, { name: string; priceLrd: number; description: string }>> = Object.freeze({
  gloss: { name: 'Gloss clearcoat', priceLrd: 0, description: 'Deep clearcoat reflections. Included in the vehicle price.' },
  metallic: { name: 'Metallic clearcoat', priceLrd: 450, description: 'A brighter metallic paint response. Appearance only.' },
  matte: { name: 'Matte finish', priceLrd: 650, description: 'A soft, low-gloss paint response. Appearance only.' },
});

export function vehiclePaint(paintId: string) {
  return VEHICLE_PAINTS.find((paint) => paint.id === paintId);
}

export function defaultVehicleConfiguration(model: VehicleCatalogEntry): VehicleConfiguration {
  const paint = VEHICLE_PAINTS.find((entry) => entry.color.toLowerCase() === model.defaultColor.toLowerCase()) ?? VEHICLE_PAINTS[0]!;
  return { paintId: paint.id, finish: 'gloss' };
}

/** Canonicalizes saved data while keeping old records usable after a catalog change. */
export function normalizeVehicleConfiguration(model: VehicleCatalogEntry, paintId?: string | null, finish?: string | null): VehicleConfiguration {
  const fallback = defaultVehicleConfiguration(model);
  const paint = paintId ? vehiclePaint(paintId) : undefined;
  return {
    paintId: paint?.id ?? fallback.paintId,
    finish: finish === 'metallic' || finish === 'matte' || finish === 'gloss' ? finish : fallback.finish,
  };
}

export function vehicleConfigurationPrice(model: VehicleCatalogEntry, configuration: VehicleConfiguration) {
  const paint = vehiclePaint(configuration.paintId);
  if (!paint) throw new Error('Unknown vehicle paint.');
  return model.priceLrd + paint.priceLrd + VEHICLE_PAINT_FINISHES[configuration.finish].priceLrd;
}

export const PROPERTY_CATALOG: readonly PropertyCatalogEntry[] = Object.freeze([
  {
    id: 'sinkor-studio', name: '12th Street Studio', locationId: 'sinkor-homes', priceLrd: 7_500, upgradeBaseLrd: 2_500,
    description: 'A practical first home. Every owned level adds one permanent garage slot.',
  },
  {
    id: 'coastal-cottage', name: 'Atlantic Cottage', locationId: 'coastal-cottages', priceLrd: 12_500, upgradeBaseLrd: 4_000,
    description: 'A coastal home with room to grow. Every owned level adds one permanent garage slot.',
  },
]);

export const VEHICLE_UPGRADES: Readonly<Record<VehicleUpgradeKind, { name: string; basePriceLrd: number; description: string }>> = Object.freeze({
  engine: { name: 'Engine tuning', basePriceLrd: 1_800, description: '+10% acceleration and +6% top speed per level.' },
  brakes: { name: 'Brake package', basePriceLrd: 1_500, description: '+12% braking force per level.' },
  tires: { name: 'All-weather tires', basePriceLrd: 1_200, description: '+6% grip and +4% steering response per level.' },
});

export function vehicleUpgradeCost(kind: VehicleUpgradeKind, nextLevel: number) {
  return VEHICLE_UPGRADES[kind].basePriceLrd * nextLevel;
}

export function propertyUpgradeCost(property: PropertyCatalogEntry, nextLevel: number) {
  return property.upgradeBaseLrd * (nextLevel - 1);
}
