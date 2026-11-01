import { distance2D, isInWorld, WORLD_LOCATIONS, type Point2 } from './world.js';

export type CivicDepartmentId = 'public-works' | 'sanitation' | 'market-services' | 'community-safety';
export type CivicIncidentKind = 'litter' | 'drain' | 'streetlight' | 'road-obstruction';
export type CivicIncidentStatus = 'open' | 'assigned' | 'resolved';
export type CivicSection = 'services' | 'incidents' | 'safety';

export interface CivicDepartment {
  id: CivicDepartmentId;
  name: string;
  shortName: string;
  description: string;
  locationId: string;
  serviceHours: string;
}

export interface CivicWorkerDefinition {
  id: string;
  name: string;
  role: string;
  departmentId: CivicDepartmentId;
  appearance: { skin: number; hair: number; top: number; bottom: number };
  route: readonly Point2[];
  shelter: Point2;
  shiftStart: number;
  shiftEnd: number;
  speed: number;
}

export interface CivicServicePoint extends Point2 {
  id: string;
  label: string;
  departmentId: CivicDepartmentId;
  locationId: string;
  section: CivicSection;
}

export interface CivicReportSite extends Point2 {
  id: string;
  title: string;
  detail: string;
  kind: CivicIncidentKind;
  departmentId: CivicDepartmentId;
  templateId: string;
  locationId: string;
  initialIncidentId?: string;
}

export interface CivicIncident extends Point2 {
  id: string;
  siteId: string;
  templateId: string;
  kind: CivicIncidentKind;
  departmentId: CivicDepartmentId;
  title: string;
  detail: string;
  locationId: string;
  status: CivicIncidentStatus;
  reportedBy: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SafetyZone {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  speedLimitKmh: number;
}

export interface SafetyViolation {
  id: string;
  zoneId: string;
  zoneName: string;
  speedKmh: number;
  limitKmh: number;
  amountLrd: number;
  outcome: 'warning' | 'fine';
  createdAt: string;
}

export interface PlayerSafetyState {
  warnings: number;
  finesLrd: number;
  violations: SafetyViolation[];
}

export interface CivicState {
  incidents: CivicIncident[];
  safety: PlayerSafetyState;
}

export interface CivicPanelTarget {
  section: CivicSection;
  incidentId?: string;
  siteId?: string;
  departmentId?: CivicDepartmentId;
}

export interface CivicMutationResult extends CivicState {
  duplicate: boolean;
}

export const CIVIC_FINE_LRD = 250;
export const CIVIC_REPORT_RADIUS = 6;
export const CIVIC_INTERACTION_RADIUS = 4.2;

export const CIVIC_DEPARTMENTS: readonly CivicDepartment[] = Object.freeze([
  { id: 'public-works', name: 'Department of Public Works', shortName: 'Public Works', description: 'Streetlights, drains, roads and municipal infrastructure in the fictional district.', locationId: 'municipal-services', serviceHours: '06:00–18:00' },
  { id: 'sanitation', name: 'Sanitation & Public Spaces', shortName: 'Sanitation', description: 'Market cleaning, beach access and shared public-space maintenance.', locationId: 'municipal-services', serviceHours: '05:30–19:00' },
  { id: 'market-services', name: 'Market Standards Office', shortName: 'Market Standards', description: 'Fictional stall inspections, public reporting and market-access support.', locationId: 'municipal-services', serviceHours: '07:00–17:00' },
  { id: 'community-safety', name: 'District Safety Office', shortName: 'Community Safety', description: 'Nonviolent patrols, road-safety education and marked-zone enforcement.', locationId: 'district-safety-office', serviceHours: 'Patrols day & night' },
]);

export const CIVIC_SERVICE_POINTS: readonly CivicServicePoint[] = Object.freeze([
  { id: 'municipal-service-counter', label: 'Municipal service counter', departmentId: 'public-works', locationId: 'municipal-services', section: 'services', x: 165, z: 80 },
  { id: 'district-safety-counter', label: 'District Safety service counter', departmentId: 'community-safety', locationId: 'district-safety-office', section: 'safety', x: 207, z: 80 },
]);

export const CIVIC_WORKERS: readonly CivicWorkerDefinition[] = Object.freeze([
  { id: 'sanitation-market', name: 'Musu Kollie', role: 'Sanitation lead', departmentId: 'sanitation', appearance: { skin: 4, hair: 3, top: 0, bottom: 2 }, route: [{ x: -18, z: -24 }, { x: -18, z: -96 }, { x: -30, z: -96 }, { x: -30, z: -32 }], shelter: { x: -14, z: -25 }, shiftStart: 5.5, shiftEnd: 19, speed: 0.85 },
  { id: 'sanitation-beach', name: 'Sekou Kamara', role: 'Public-space caretaker', departmentId: 'sanitation', appearance: { skin: 3, hair: 0, top: 1, bottom: 1 }, route: [{ x: -135, z: -20 }, { x: -135, z: 30 }, { x: -150, z: 30 }, { x: -150, z: -20 }], shelter: { x: -140, z: 10 }, shiftStart: 6, shiftEnd: 18, speed: 0.75 },
  { id: 'works-taxi', name: 'Tamba Kpaki', role: 'Streetlight technician', departmentId: 'public-works', appearance: { skin: 5, hair: 2, top: 0, bottom: 0 }, route: [{ x: 11.8, z: 18 }, { x: 11.8, z: 108 }, { x: 18, z: 108 }, { x: 18, z: 24 }], shelter: { x: 14, z: 36 }, shiftStart: 6, shiftEnd: 18, speed: 0.8 },
  { id: 'works-municipal', name: 'Miatta Dunn', role: 'Drainage inspector', departmentId: 'public-works', appearance: { skin: 2, hair: 1, top: 3, bottom: 2 }, route: [{ x: 131.8, z: 24 }, { x: 131.8, z: 100 }, { x: 165, z: 100 }, { x: 165, z: 84 }], shelter: { x: 165, z: 80 }, shiftStart: 7, shiftEnd: 17, speed: 0.78 },
  { id: 'market-inspector', name: 'Massa Kromah', role: 'Market standards inspector', departmentId: 'market-services', appearance: { skin: 4, hair: 3, top: 1, bottom: 3 }, route: [{ x: -88, z: -76 }, { x: -32, z: -76 }, { x: -32, z: -108 }, { x: -88, z: -108 }], shelter: { x: -20, z: -82 }, shiftStart: 7, shiftEnd: 17, speed: 0.72 },
  { id: 'police-market', name: 'Varney Tokpah', role: 'Community police', departmentId: 'community-safety', appearance: { skin: 3, hair: 0, top: 4, bottom: 0 }, route: [{ x: -14, z: -95 }, { x: -14, z: -20 }, { x: -24, z: -12 }, { x: -24, z: -65 }], shelter: { x: -14, z: -20 }, shiftStart: 6, shiftEnd: 18, speed: 0.92 },
  { id: 'police-night', name: 'Hawa Sheriff', role: 'Community police · night watch', departmentId: 'community-safety', appearance: { skin: 5, hair: 3, top: 4, bottom: 0 }, route: [{ x: 14, z: 20 }, { x: 14, z: 100 }, { x: -14, z: 100 }, { x: -14, z: 20 }], shelter: { x: 10, z: 36 }, shiftStart: 18, shiftEnd: 6, speed: 0.88 },
  { id: 'traffic-municipal', name: 'Joseph Toe', role: 'Traffic safety warden', departmentId: 'community-safety', appearance: { skin: 4, hair: 2, top: 0, bottom: 0 }, route: [{ x: 131.8, z: 30 }, { x: 131.8, z: 100 }, { x: 207, z: 100 }, { x: 207, z: 84 }, { x: 131.8, z: 84 }], shelter: { x: 207, z: 80 }, shiftStart: 6, shiftEnd: 22, speed: 0.9 },
]);

export const CIVIC_REPORT_SITES: readonly CivicReportSite[] = Object.freeze([
  { id: 'market-litter', title: 'Market walkway litter', detail: 'A reported litter point beside the public market walkway.', kind: 'litter', departmentId: 'sanitation', templateId: 'civic-market-litter-response', locationId: 'sinkor-market', x: -30, z: -82, initialIncidentId: '10000000-0000-4000-8000-000000000001' },
  { id: 'taxi-drain', title: 'Taxi-stand drain obstruction', detail: 'A reported drain cabinet requiring a public-works cleanup.', kind: 'drain', departmentId: 'public-works', templateId: 'civic-taxi-drain-response', locationId: 'taxi-stand', x: 18, z: 18, initialIncidentId: '10000000-0000-4000-8000-000000000002' },
  { id: 'municipal-light', title: 'Municipal road lamp fault', detail: 'A reported lamp cabinet fault on the municipal approach.', kind: 'streetlight', departmentId: 'public-works', templateId: 'civic-municipal-light-response', locationId: 'municipal-services', x: 131.8, z: 72, initialIncidentId: '10000000-0000-4000-8000-000000000003' },
  { id: 'beach-obstruction', title: 'Beach-path obstruction', detail: 'A reported obstruction beside the public beach path.', kind: 'road-obstruction', departmentId: 'public-works', templateId: 'civic-beach-obstruction-response', locationId: 'beach-access', x: -140, z: -12 },
  { id: 'market-obstruction', title: 'Market safety-route obstruction', detail: 'A reported obstruction requiring a clear community safety route.', kind: 'road-obstruction', departmentId: 'community-safety', templateId: 'civic-market-obstruction-response', locationId: 'sinkor-market', x: -14, z: -25, initialIncidentId: '10000000-0000-4000-8000-000000000004' },
]);

export const SAFETY_ZONES: readonly SafetyZone[] = Object.freeze([
  { id: 'taxi-safety', name: '12th Street Taxi Stand', minX: -25, maxX: 25, minZ: 15, maxZ: 55, speedLimitKmh: 30 },
  { id: 'market-safety', name: 'Sinkor Market', minX: -45, maxX: 15, minZ: -115, maxZ: -65, speedLimitKmh: 25 },
]);

export const CIVIC_NOTICES = Object.freeze([
  { id: 'rain-operations', title: 'Rain operations', body: 'Outdoor municipal crews shelter during heavy rain. Drive carefully: wet roads already reduce vehicle grip.' },
  { id: 'fictional-institutions', title: 'Fictional civic district', body: 'Municipal departments, police, service rules and safety zones are fictional game systems, not real Liberian agencies or legal procedures.' },
]);

export function getCivicReportSite(id: string) {
  return CIVIC_REPORT_SITES.find((site) => site.id === id);
}

export function safetyZoneAt(point: Point2): SafetyZone | null {
  return SAFETY_ZONES.find((zone) => point.x >= zone.minX && point.x <= zone.maxX && point.z >= zone.minZ && point.z <= zone.maxZ) ?? null;
}

export function civicWorkerDuty(worker: CivicWorkerDefinition, hour: number, rainIntensity: number): 'patrolling' | 'sheltering' | 'off-duty' {
  const onShift = worker.shiftStart < worker.shiftEnd
    ? hour >= worker.shiftStart && hour < worker.shiftEnd
    : hour >= worker.shiftStart || hour < worker.shiftEnd;
  if (!onShift) return 'off-duty';
  if (worker.departmentId !== 'community-safety' && rainIntensity >= 0.55) return 'sheltering';
  return 'patrolling';
}

export function validateCivicCatalog(): string[] {
  const issues: string[] = [];
  const locationIds = new Set(WORLD_LOCATIONS.map((location) => location.id));
  const departmentIds = new Set<CivicDepartmentId>(CIVIC_DEPARTMENTS.map((department) => department.id));
  for (const department of CIVIC_DEPARTMENTS) if (!locationIds.has(department.locationId)) issues.push(`Unknown civic department location: ${department.locationId}`);
  for (const point of CIVIC_SERVICE_POINTS) {
    if (!locationIds.has(point.locationId) || !departmentIds.has(point.departmentId)) issues.push(`Invalid civic service point: ${point.id}`);
    if (!isInWorld(point)) issues.push(`Civic service point outside world: ${point.id}`);
  }
  const workerIds = new Set<string>();
  for (const worker of CIVIC_WORKERS) {
    if (workerIds.has(worker.id)) issues.push(`Duplicate civic worker: ${worker.id}`);
    workerIds.add(worker.id);
    if (!departmentIds.has(worker.departmentId) || worker.route.length < 2 || worker.route.some((point) => !isInWorld(point))) issues.push(`Invalid civic worker route: ${worker.id}`);
    if (worker.speed <= 0) issues.push(`Invalid civic worker speed: ${worker.id}`);
  }
  const siteIds = new Set<string>();
  for (const site of CIVIC_REPORT_SITES) {
    if (siteIds.has(site.id)) issues.push(`Duplicate civic report site: ${site.id}`);
    siteIds.add(site.id);
    if (!locationIds.has(site.locationId) || !departmentIds.has(site.departmentId) || !isInWorld(site)) issues.push(`Invalid civic report site: ${site.id}`);
    if (!site.templateId || !site.title.trim()) issues.push(`Incomplete civic report site: ${site.id}`);
  }
  for (const zone of SAFETY_ZONES) {
    if (zone.minX >= zone.maxX || zone.minZ >= zone.maxZ || zone.speedLimitKmh <= 0) issues.push(`Invalid safety zone: ${zone.id}`);
    if (!isInWorld({ x: zone.minX, z: zone.minZ }) || !isInWorld({ x: zone.maxX, z: zone.maxZ })) issues.push(`Safety zone outside world: ${zone.id}`);
  }
  return issues;
}

export function nearestCivicReportSite(point: Point2) {
  return CIVIC_REPORT_SITES.reduce((nearest, site) => distance2D(point, site) < distance2D(point, nearest) ? site : nearest);
}
