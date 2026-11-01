import type { MovementState, Vec3 } from '../../shared/protocol.js';
import type { PlayerProfile } from '../../shared/types.js';
import { isInWorld, PLAYER_SPAWN } from '../../shared/world.js';
import { z } from 'zod';

export const movementStateInput = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  heading: z.number().finite(), speed: z.number().finite(), mode: z.enum(['walking', 'driving']),
  vehicleId: z.string().uuid().optional(), lightsOn: z.boolean().optional(), interiorPropertyId: z.string().uuid().optional(), sequence: z.number().int().nonnegative(),
});
export type PresenceInput = z.infer<typeof movementStateInput>;

interface PresenceRecord {
  state: MovementState;
  profile: PlayerProfile;
  connected: boolean;
  acceptedAt: number;
}

export class PresenceService {
  private readonly records = new Map<string, PresenceRecord>();

  join(profile: PlayerProfile) {
    const previous = this.records.get(profile.id);
    if (previous) {
      previous.connected = true;
      previous.profile = profile;
      previous.acceptedAt = Date.now();
      previous.state = {
        playerId: profile.id, position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0,
        mode: 'walking', sequence: 0, sentAt: Date.now(),
      };
      return;
    }
    this.records.set(profile.id, {
      profile, connected: true, acceptedAt: Date.now(),
      state: {
        playerId: profile.id, position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0,
        mode: 'walking', sequence: 0, sentAt: Date.now(),
      },
    });
  }

  leave(playerId: string) {
    const record = this.records.get(playerId);
    if (record) record.connected = false;
  }

  update(playerId: string, input: PresenceInput, ownedVehicleIds: Set<string>, ownedPropertyIds = new Set<string>()): MovementState | null {
    const record = this.records.get(playerId);
    if (!record || !record.connected || input.sequence <= record.state.sequence) return null;
    const [x, y, z] = input.position;
    if (!isInWorld({ x, z }) || y < -1 || y > 8 || Math.abs(input.speed) > 38) return null;
    if (input.mode === 'driving' && (!input.vehicleId || !ownedVehicleIds.has(input.vehicleId))) return null;
    if (input.interiorPropertyId && (input.mode !== 'walking' || !ownedPropertyIds.has(input.interiorPropertyId))) return null;

    const now = Date.now();
    const dt = Math.max(0.05, Math.min(2, (now - record.acceptedAt) / 1000));
    const previous = record.state.position;
    const distance = Math.hypot(x - previous[0], z - previous[2]);
    const maxDistance = (input.mode === 'driving' ? 34 : 10) * dt + 2.5;
    if (distance > maxDistance) return null;

    const state: MovementState = {
      playerId, position: [x, y, z] as Vec3, heading: input.heading, speed: input.speed,
      mode: input.mode, ...(input.mode === 'driving' && input.vehicleId ? { vehicleId: input.vehicleId } : {}),
      ...(input.mode === 'driving' ? { lightsOn: input.lightsOn === true } : {}),
      ...(input.interiorPropertyId ? { interiorPropertyId: input.interiorPropertyId } : {}),
      sequence: input.sequence, sentAt: now,
    };
    record.state = state;
    record.acceptedAt = now;
    return state;
  }

  respawn(playerId: string): MovementState | null {
    const record = this.records.get(playerId);
    if (!record?.connected) return null;
    record.state = {
      playerId, position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0,
      mode: 'walking', sequence: record.state.sequence, sentAt: Date.now(),
    };
    record.acceptedAt = Date.now();
    return { ...record.state, position: [...record.state.position] };
  }

  /** Latest accepted pose for server-side derived history; unlike recent(), this has no freshness requirement. */
  latest(playerId: string): MovementState | null {
    return this.records.get(playerId)?.state ?? null;
  }

  recent(playerId: string): MovementState | null {
    const record = this.records.get(playerId);
    if (!record?.connected || Date.now() - record.acceptedAt > 8_000) return null;
    return record.state;
  }

  nearby(playerId: string, radius = 190) {
    const origin = this.records.get(playerId)?.state.position;
    if (!origin) return [];
    return [...this.records.values()].filter((record) => {
      if (!record.connected || record.profile.id === playerId) return false;
      const position = record.state.position;
      return Math.hypot(position[0] - origin[0], position[2] - origin[2]) <= radius;
    });
  }

  snapshot(playerId: string) {
    return this.nearby(playerId).map((record) => ({ ...record.state, profile: record.profile }));
  }

  profile(playerId: string) {
    return this.records.get(playerId)?.profile;
  }
}
