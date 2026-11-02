import type { CharacterAppearance, CitizenTaskMutationResult, CitizenTaskState, LedgerEntry, LifestyleMutationResult, OnboardingStatus, PlayerProfile, TaxiJob, TaxiTrip, Wallet, WorldBootstrap } from '../shared/types';
import type { VehicleConfiguration, VehicleUpgradeKind } from '../shared/catalog';
import type { CivicMutationResult, CivicState } from '../shared/civic';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

interface AuthResponse { player: PlayerProfile; sessionToken?: string }
const PREVIEW_SESSION_KEY = 'taxilib.preview_session';

function readPreviewSession() {
  try { return sessionStorage.getItem(PREVIEW_SESSION_KEY) ?? ''; } catch { return ''; }
}

let bearerToken = readPreviewSession();

function setBearerToken(token: string) {
  bearerToken = token;
  try {
    if (token) sessionStorage.setItem(PREVIEW_SESSION_KEY, token);
    else sessionStorage.removeItem(PREVIEW_SESSION_KEY);
  } catch { /* Memory storage still keeps the current tab playable. */ }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}`, 'X-TaxiLib-Session': bearerToken } : {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({ error: 'The server returned an invalid response.' })) as { error?: string; code?: string };
  if (!response.ok) {
    if (response.status === 401 && bearerToken) setBearerToken('');
    throw new ApiError(data.error ?? 'Request failed.', response.status, data.code);
  }
  return data as T;
}

async function authRequest(path: string, body: Record<string, string>) {
  const result = await request<AuthResponse>(path, { method: 'POST', body: JSON.stringify(body) });
  // Only the embedded preview exposes this fallback; normal deployments remain cookie-only.
  if (result.sessionToken) setBearerToken(result.sessionToken);
  return result;
}

export const api = {
  session: () => request<{ player: PlayerProfile }>('/api/session'),
  register: (handle: string, password: string, displayName: string) => authRequest('/api/auth/register', { handle, password, displayName }),
  login: (handle: string, password: string) => authRequest('/api/auth/login', { handle, password }),
  logout: async () => {
    try { await request<void>('/api/auth/logout', { method: 'POST' }); }
    finally { setBearerToken(''); }
  },
  realtimeTicket: () => request<{ ticket: string; expiresAt: string }>('/api/realtime/ticket', { method: 'POST' }),
  world: () => request<WorldBootstrap>('/api/world'),
  appearance: (appearance: CharacterAppearance) => request<{ player: PlayerProfile }>('/api/profile/appearance', {
    method: 'PATCH', body: JSON.stringify(appearance),
  }),
  onboarding: (status: Exclude<OnboardingStatus, 'new'>) => request<{ player: PlayerProfile }>('/api/profile/onboarding', {
    method: 'PUT', body: JSON.stringify({ status }),
  }),
  acceptJob: (jobId: string, vehicleId: string) => request<{ trip: TaxiTrip }>(`/api/taxi/jobs/${jobId}/accept`, {
    method: 'POST', body: JSON.stringify({ vehicleId }),
  }),
  pickup: (tripId: string) => request<{ trip: TaxiTrip }>(`/api/taxi/trips/${tripId}/pickup`, { method: 'POST' }),
  complete: (tripId: string) => request<{ trip: TaxiTrip; wallet: Wallet; duplicate: boolean }>(`/api/taxi/trips/${tripId}/complete`, { method: 'POST' }),
  cancel: (tripId: string) => request<{ trip: TaxiTrip }>(`/api/taxi/trips/${tripId}/cancel`, { method: 'POST' }),
  jobs: () => request<{ jobs: TaxiJob[] }>('/api/taxi/jobs'),
  tasks: () => request<CitizenTaskState>('/api/tasks'),
  civic: () => request<CivicState>('/api/civic'),
  reportCivicIncident: (siteId: string, requestId: string) => request<CivicMutationResult>('/api/civic/reports', {
    method: 'POST', body: JSON.stringify({ siteId, requestId }),
  }),
  acceptTask: (templateId: string, requestId: string, incidentId?: string) => request<CitizenTaskMutationResult>('/api/tasks/accept', {
    method: 'POST', body: JSON.stringify({ templateId, requestId, ...(incidentId ? { incidentId } : {}) }),
  }),
  cancelTask: (taskId: string, requestId: string) => request<CitizenTaskMutationResult>(`/api/tasks/${taskId}/cancel`, {
    method: 'POST', body: JSON.stringify({ requestId }),
  }),
  advanceTask: (taskId: string, stepId: string, position: [number, number], requestId: string) => request<CitizenTaskMutationResult>(`/api/tasks/${taskId}/advance`, {
    method: 'POST', body: JSON.stringify({ stepId, position, requestId }),
  }),
  purchaseProperty: (listingId: string, requestId: string) => request<LifestyleMutationResult>('/api/lifestyle/properties/purchase', {
    method: 'POST', body: JSON.stringify({ listingId, requestId }),
  }),
  upgradeProperty: (propertyId: string, requestId: string) => request<LifestyleMutationResult>('/api/lifestyle/properties/upgrade', {
    method: 'POST', body: JSON.stringify({ propertyId, requestId }),
  }),
  purchaseVehicle: (modelId: string, requestId: string, configuration?: VehicleConfiguration) => request<LifestyleMutationResult>('/api/lifestyle/vehicles/purchase', {
    method: 'POST', body: JSON.stringify({ modelId, requestId, ...(configuration ? { configuration } : {}) }),
  }),
  upgradeVehicle: (vehicleId: string, kind: VehicleUpgradeKind, requestId: string) => request<LifestyleMutationResult>('/api/lifestyle/vehicles/upgrade', {
    method: 'POST', body: JSON.stringify({ vehicleId, kind, requestId }),
  }),
  selectVehicle: (vehicleId: string, requestId: string) => request<LifestyleMutationResult>('/api/lifestyle/vehicles/select', {
    method: 'POST', body: JSON.stringify({ vehicleId, requestId }),
  }),
  wallet: () => request<{ wallet: Wallet; ledger: LedgerEntry[] }>('/api/wallet'),
};
