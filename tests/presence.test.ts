import { describe, expect, it, vi } from 'vitest';
import { PresenceService } from '../src/server/services/presence-service';
import { PLAYER_SPAWN } from '../src/shared/world';
import type { PlayerProfile } from '../src/shared/types';
import { randomUUID } from 'node:crypto';

const profile: PlayerProfile = {
  id: randomUUID(), handle: 'presence_driver', displayName: 'Presence Driver', reputation: 50,
  appearance: { skin: 2, hair: 0, top: 0, bottom: 0 },
};

describe('movement validation and reconnect recovery', () => {
  it('rejects unowned vehicles and impossible position bursts', () => {
    const presence = new PresenceService();
    presence.join(profile);
    const vehicleId = randomUUID();
    expect(presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, sequence: 1,
    }, new Set())).toBeNull();
    expect(presence.update(profile.id, {
      position: [150, 0, 150], heading: 0, speed: 0, mode: 'walking', sequence: 2,
    }, new Set())).toBeNull();
    expect(presence.recent(profile.id)?.position).toEqual([PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z]);
  });

  it('replicates indoor state only for an owned property and clears it on exit', () => {
    const presence = new PresenceService();
    presence.join(profile);
    const propertyId = randomUUID();
    const vehicleId = randomUUID();
    const indoor = presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', interiorPropertyId: propertyId, sequence: 1,
    }, new Set(), new Set([propertyId]));
    expect(indoor?.interiorPropertyId).toBe(propertyId);

    const rejected = presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', interiorPropertyId: randomUUID(), sequence: 2,
    }, new Set(), new Set([propertyId]));
    expect(rejected).toBeNull();
    expect(presence.recent(profile.id)?.interiorPropertyId).toBe(propertyId);

    const outside = presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', sequence: 3,
    }, new Set(), new Set([propertyId]));
    expect(outside?.interiorPropertyId).toBeUndefined();
    expect(presence.recent(profile.id)?.interiorPropertyId).toBeUndefined();

    expect(presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, interiorPropertyId: propertyId, sequence: 4,
    }, new Set([vehicleId]), new Set([propertyId]))).toBeNull();
  });

  it('keeps the latest accepted pose available after the freshness window expires', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const presence = new PresenceService();
      presence.join(profile);
      expect(presence.update(profile.id, {
        position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', sequence: 1,
      }, new Set())).not.toBeNull();
      vi.advanceTimersByTime(9000);
      expect(presence.recent(profile.id)).toBeNull();
      expect(presence.latest(profile.id)?.position).toEqual([PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets realtime pose and sequence consistently when a citizen reconnects', () => {
    const presence = new PresenceService();
    presence.join(profile);
    const vehicleId = randomUUID();
    expect(presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, lightsOn: true, sequence: 50,
    }, new Set([vehicleId]))).not.toBeNull();
    expect(presence.recent(profile.id)?.lightsOn).toBe(true);
    presence.leave(profile.id);
    presence.join(profile);
    expect(presence.recent(profile.id)?.mode).toBe('walking');
    expect(presence.recent(profile.id)?.sequence).toBe(0);
    expect(presence.update(profile.id, {
      position: [PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', sequence: 1,
    }, new Set())).not.toBeNull();
    expect(presence.recent(profile.id)?.lightsOn).toBeUndefined();
  });
});
