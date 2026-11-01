import { WORLD_LOCATIONS, isInWorld, type Point2 } from './world.js';
import { CIVIC_REPORT_SITES, type CivicDepartmentId, type CivicIncidentKind } from './civic.js';

export type CitizenTaskAction = 'collect' | 'deliver' | 'clean' | 'repair' | 'inspect';
export type CitizenTaskObject = 'crate' | 'supplies' | 'litter' | 'toolbox' | 'clipboard' | 'drain' | 'barrier';
export type CitizenTaskStatus = 'active' | 'completed' | 'cancelled';

export interface CitizenTaskStep extends Point2 {
  id: string;
  label: string;
  locationId: string;
  action: CitizenTaskAction;
  object: CitizenTaskObject;
}

export interface CitizenTaskDefinition {
  id: string;
  title: string;
  category: 'Logistics' | 'Community care' | 'Environment' | 'Maintenance';
  description: string;
  rewardLrd: number;
  departmentId?: CivicDepartmentId;
  incidentKind?: CivicIncidentKind;
  steps: readonly CitizenTaskStep[];
}

export interface CitizenTask {
  id: string;
  templateId: string;
  incidentId: string | null;
  status: CitizenTaskStatus;
  stepIndex: number;
  rewardLrd: number;
  acceptedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CitizenTaskStats {
  completed: number;
  earnedLrd: number;
}

export const CITIZEN_TASK_INTERACTION_RADIUS = 3.4;

export const CITIZEN_TASKS: readonly CitizenTaskDefinition[] = Object.freeze([
  {
    id: 'market-restock',
    title: 'Market Restock',
    category: 'Logistics',
    description: 'Collect packed provisions at the cooperative and stock a neighborhood market stall on foot.',
    rewardLrd: 650,
    steps: [
      { id: 'collect-provisions', label: 'Collect the packed market provisions', locationId: 'cooperative-garage', x: 102, z: 82, action: 'collect', object: 'crate' },
      { id: 'stock-stall', label: 'Stock the community market stall', locationId: 'sinkor-market', x: -20, z: -82, action: 'deliver', object: 'crate' },
    ],
  },
  {
    id: 'clinic-supply-run',
    title: 'Clinic Supply Run',
    category: 'Community care',
    description: 'Pick up a sealed game-world supply parcel and deliver it to the community clinic reception.',
    rewardLrd: 500,
    steps: [
      { id: 'collect-clinic-parcel', label: 'Collect the sealed clinic parcel', locationId: 'sinkor-market', x: -18, z: -86, action: 'collect', object: 'supplies' },
      { id: 'deliver-clinic-parcel', label: 'Deliver the parcel to clinic reception', locationId: 'community-clinic', x: 104, z: -72, action: 'deliver', object: 'supplies' },
    ],
  },
  {
    id: 'beach-cleanup',
    title: 'Beach Cleanup',
    category: 'Environment',
    departmentId: 'sanitation',
    description: 'Clear three marked litter points along the sandy public access area. The ocean remains scenic.',
    rewardLrd: 450,
    steps: [
      { id: 'cleanup-north', label: 'Collect litter beside the beach path', locationId: 'beach-access', x: -142, z: 10, action: 'clean', object: 'litter' },
      { id: 'cleanup-palms', label: 'Clear litter near the palms', locationId: 'beach-access', x: -153, z: 26, action: 'clean', object: 'litter' },
      { id: 'cleanup-south', label: 'Finish the southern beach cleanup', locationId: 'beach-access', x: -136, z: -8, action: 'clean', object: 'litter' },
    ],
  },
  {
    id: 'streetlight-maintenance',
    title: 'Streetlight Maintenance',
    category: 'Maintenance',
    departmentId: 'public-works',
    description: 'Inspect and repair two 12th Street lamp cabinets. Each stop is a real on-foot interaction.',
    rewardLrd: 450,
    steps: [
      { id: 'repair-taxi-lamp', label: 'Repair the taxi-stand lamp cabinet', locationId: 'taxi-stand', x: 11.8, z: 24, action: 'repair', object: 'toolbox' },
      { id: 'repair-homes-lamp', label: 'Inspect the homes-block lamp cabinet', locationId: 'sinkor-homes', x: 11.8, z: 120, action: 'repair', object: 'toolbox' },
    ],
  },
  {
    id: 'market-standards-inspection',
    title: 'Market Standards Inspection',
    category: 'Community care',
    departmentId: 'market-services',
    description: 'Collect a fictional municipal checklist, inspect the community market and file the report on foot.',
    rewardLrd: 550,
    steps: [
      { id: 'collect-inspection-checklist', label: 'Collect the municipal inspection checklist', locationId: 'municipal-services', x: 165, z: 80, action: 'collect', object: 'clipboard' },
      { id: 'inspect-market-stall', label: 'Inspect the community market stall', locationId: 'sinkor-market', x: -20, z: -82, action: 'inspect', object: 'clipboard' },
      { id: 'file-inspection-report', label: 'File the completed market inspection', locationId: 'municipal-services', x: 165, z: 80, action: 'deliver', object: 'clipboard' },
    ],
  },
  {
    id: 'civic-market-litter-response', title: 'Market Litter Response', category: 'Environment', departmentId: 'sanitation', incidentKind: 'litter', rewardLrd: 180,
    description: 'Resolve one assigned public-space incident at the reported market walkway.',
    steps: [{ id: 'resolve-market-litter', label: 'Clear the reported market walkway litter', locationId: 'sinkor-market', x: -30, z: -82, action: 'clean', object: 'litter' }],
  },
  {
    id: 'civic-taxi-drain-response', title: 'Taxi-stand Drain Response', category: 'Maintenance', departmentId: 'public-works', incidentKind: 'drain', rewardLrd: 200,
    description: 'Resolve one assigned drain obstruction near the taxi stand.',
    steps: [{ id: 'resolve-taxi-drain', label: 'Clear the reported taxi-stand drain', locationId: 'taxi-stand', x: 18, z: 18, action: 'clean', object: 'drain' }],
  },
  {
    id: 'civic-municipal-light-response', title: 'Municipal Lamp Response', category: 'Maintenance', departmentId: 'public-works', incidentKind: 'streetlight', rewardLrd: 220,
    description: 'Resolve one assigned lamp fault on the municipal approach.',
    steps: [{ id: 'resolve-municipal-light', label: 'Repair the reported municipal lamp cabinet', locationId: 'municipal-services', x: 131.8, z: 72, action: 'repair', object: 'toolbox' }],
  },
  {
    id: 'civic-beach-obstruction-response', title: 'Beach-path Access Response', category: 'Environment', departmentId: 'public-works', incidentKind: 'road-obstruction', rewardLrd: 200,
    description: 'Resolve one assigned obstruction beside the public beach path.',
    steps: [{ id: 'resolve-beach-obstruction', label: 'Clear the reported beach-path obstruction', locationId: 'beach-access', x: -140, z: -12, action: 'clean', object: 'barrier' }],
  },
  {
    id: 'civic-market-obstruction-response', title: 'Market Safety-route Response', category: 'Community care', departmentId: 'community-safety', incidentKind: 'road-obstruction', rewardLrd: 230,
    description: 'Resolve one assigned obstruction along the fictional market safety route.',
    steps: [{ id: 'resolve-market-obstruction', label: 'Clear the reported market safety route', locationId: 'sinkor-market', x: -14, z: -25, action: 'clean', object: 'barrier' }],
  },
]);

export function getCitizenTaskDefinition(templateId: string): CitizenTaskDefinition {
  const definition = CITIZEN_TASKS.find((entry) => entry.id === templateId);
  if (!definition) throw new Error(`Unknown citizen task: ${templateId}`);
  return definition;
}

export function currentCitizenTaskStep(task: CitizenTask | null): CitizenTaskStep | null {
  if (!task || task.status !== 'active') return null;
  return getCitizenTaskDefinition(task.templateId).steps[task.stepIndex] ?? null;
}

/** Returns exact objective coordinates only when the current route belongs to this task step. */
export function citizenTaskRoutePoint(task: CitizenTask | null, destinationId: string): CitizenTaskStep | null {
  const step = currentCitizenTaskStep(task);
  return step?.locationId === destinationId ? step : null;
}

export function validateCitizenTaskCatalog(): string[] {
  const issues: string[] = [];
  const taskIds = new Set<string>();
  for (const task of CITIZEN_TASKS) {
    if (taskIds.has(task.id)) issues.push(`Duplicate task id: ${task.id}`);
    taskIds.add(task.id);
    if (!Number.isInteger(task.rewardLrd) || task.rewardLrd <= 0) issues.push(`Invalid reward: ${task.id}`);
    if (task.incidentKind ? task.steps.length !== 1 : task.steps.length < 2 || task.steps.length > 4) {
      issues.push(`Task has an invalid step count: ${task.id}`);
    }
    if (task.incidentKind) {
      const site = CIVIC_REPORT_SITES.find((entry) => entry.templateId === task.id);
      if (!site) issues.push(`Missing civic report site for ${task.id}`);
      else if (site.kind !== task.incidentKind || site.departmentId !== task.departmentId
        || site.locationId !== task.steps[0]?.locationId || site.x !== task.steps[0]?.x || site.z !== task.steps[0]?.z) {
        issues.push(`Civic incident task does not match its report site: ${task.id}`);
      }
    }
    const stepIds = new Set<string>();
    for (const step of task.steps) {
      if (stepIds.has(step.id)) issues.push(`Duplicate step id ${step.id} in ${task.id}`);
      stepIds.add(step.id);
      if (!WORLD_LOCATIONS.some((location) => location.id === step.locationId)) issues.push(`Unknown location ${step.locationId} in ${task.id}`);
      if (!isInWorld(step)) issues.push(`Out-of-world step ${step.id} in ${task.id}`);
      if (!step.label.trim()) issues.push(`Missing step label ${step.id} in ${task.id}`);
    }
  }
  return issues;
}
