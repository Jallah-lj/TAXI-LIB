import type { SimulationState } from './simulation.js';
import type { RoadEdge, RoadNode, WorldLocation } from './world.js';
import type { CitizenTask, CitizenTaskStats } from './tasks.js';
import type { CivicState } from './civic.js';
import type { VehiclePaintFinish, VehiclePaintId } from './catalog.js';

export interface CharacterAppearance {
  skin: number;
  hair: number;
  top: number;
  bottom: number;
}

export interface PlayerProfile {
  id: string;
  handle: string;
  displayName: string;
  reputation: number;
  appearance: CharacterAppearance;
}

export interface Wallet {
  balanceLrd: number;
}

export interface LedgerEntry {
  id: string;
  amountLrd: number;
  balanceAfterLrd: number;
  kind: string;
  description: string;
  createdAt: string;
}

export interface VehicleModel {
  id: string;
  name: string;
  className: string;
  maxSpeed: number;
  acceleration: number;
  braking: number;
  steering: number;
  grip: number;
  seats: number;
}

export interface PlayerVehicle {
  id: string;
  modelId: string;
  plate: string;
  color: string;
  paintId: VehiclePaintId;
  finish: VehiclePaintFinish;
  taxi: boolean;
  fuelPercent: number;
  conditionPercent: number;
  model: VehicleModel;
  upgrades: Record<'engine' | 'brakes' | 'tires', number>;
}

export interface PlayerProperty {
  id: string;
  listingId: string;
  level: number;
  purchasedAt: string;
  updatedAt: string;
}

export type TaxiJobStatus = 'requested' | 'assigned' | 'picked_up' | 'completed' | 'cancelled' | 'expired';
export interface TaxiJob {
  id: string;
  passengerName: string;
  pickupLocationId: string;
  destinationLocationId: string;
  fareLrd: number;
  status: TaxiJobStatus;
  expiresAt: string;
}

export type TaxiTripStatus = 'accepted' | 'active' | 'completed' | 'cancelled';
export interface TaxiTrip {
  id: string;
  jobId: string;
  vehicleId: string;
  status: TaxiTripStatus;
  fareLrd: number;
  passengerName: string;
  pickupLocationId: string;
  destinationLocationId: string;
  acceptedAt: string;
  pickedUpAt: string | null;
  completedAt: string | null;
}

export interface LifestyleState {
  wallet: Wallet;
  vehicles: PlayerVehicle[];
  properties: PlayerProperty[];
  selectedVehicleId: string;
  garageCapacity: number;
}

export interface LifestyleMutationResult extends LifestyleState {
  duplicate: boolean;
}

export interface CitizenTaskState {
  activeTask: CitizenTask | null;
  taskStats: CitizenTaskStats;
}

export interface CitizenTaskMutationResult extends CitizenTaskState {
  task: CitizenTask | null;
  wallet: Wallet;
  duplicate: boolean;
}

export interface WorldBootstrap extends LifestyleState, CitizenTaskState {
  player: PlayerProfile;
  jobs: TaxiJob[];
  activeTrip: TaxiTrip | null;
  civic: CivicState;
  locations: readonly WorldLocation[];
  roadNodes: readonly RoadNode[];
  roadEdges: readonly RoadEdge[];
  simulation: SimulationState;
  disclaimer: string;
}
