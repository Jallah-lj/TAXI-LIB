import type { MovementState, Vec3 } from '../../shared/protocol.js';
import {
  conditionAfterImpact, healthyHealth, INJURY_IMPACT_SPEED, INJURY_RECOVERY_MS, RESPAWN_MS, type PlayerHealthState,
} from '../../shared/health.js';

export interface PlayerImpact {
  driverId: string;
  victimId: string;
  health: PlayerHealthState;
}

interface MotionSample {
  speed: number;
  sentAt: number;
  position: Vec3;
  from: Vec3;
}

function pointToVehicleDistance(state: MovementState, point: MovementState) {
  const dx = point.position[0] - state.position[0];
  const dz = point.position[2] - state.position[2];
  const localX = dx * Math.cos(state.heading) - dz * Math.sin(state.heading);
  const localZ = dx * Math.sin(state.heading) + dz * Math.cos(state.heading);
  const closestX = Math.max(-1.1, Math.min(1.1, localX));
  const closestZ = Math.max(-2.5, Math.min(2.5, localZ));
  return Math.hypot(localX - closestX, localZ - closestZ);
}

function distance(first: Vec3, second: Vec3) {
  return Math.hypot(first[0] - second[0], first[2] - second[2]);
}

/** Session-scoped authoritative player health derived only from accepted movement, never impact claims. */
export class PlayerHealthService {
  private readonly states = new Map<string, PlayerHealthState>();
  private readonly impactCooldowns = new Map<string, number>();
  private readonly motion = new Map<string, MotionSample>();

  health(playerId: string) {
    return { ...(this.states.get(playerId) ?? healthyHealth(playerId)) };
  }

  leave(playerId: string) {
    this.motion.delete(playerId);
  }

  observe(driverId: string, previous: MovementState | null, current: MovementState, nearby: MovementState[], now = Date.now()): PlayerImpact[] {
    if (!previous || previous.mode !== 'driving' || current.mode !== 'driving' || current.interiorPropertyId) {
      this.motion.delete(driverId);
      return [];
    }
    const elapsed = (current.sentAt - previous.sentAt) / 1000;
    if (elapsed <= 0) return [];
    const measuredSpeed = distance(current.position, previous.position) / elapsed;
    const prior = this.motion.get(driverId);
    // A local controller quite correctly stops before overlapping a person. If that stop
    // arrives in the next accepted pose, retain only the short, measured approach sample.
    // The client's speed field is never used as evidence of an injury.
    const recentApproach = prior && current.sentAt - prior.sentAt <= 650 && distance(current.position, prior.position) < 4;
    const usedRecentApproach = measuredSpeed < INJURY_IMPACT_SPEED && recentApproach && prior!.speed > measuredSpeed;
    const speed = usedRecentApproach ? prior!.speed : measuredSpeed;
    this.motion.set(driverId, { speed: measuredSpeed, sentAt: current.sentAt, position: [...current.position], from: [...previous.position] });
    if (!conditionAfterImpact(speed)) return [];

    const impacts: PlayerImpact[] = [];
    for (const victim of nearby) {
      if (victim.playerId === driverId || victim.mode !== 'walking' || victim.interiorPropertyId) continue;
      const currentHealth = this.health(victim.playerId);
      const condition = conditionAfterImpact(speed, currentHealth.condition);
      const lastImpact = this.impactCooldowns.get(victim.playerId);
      if (!condition || (lastImpact !== undefined && now - lastImpact < 1200)) continue;
      // Remote avatars interpolate between accepted poses; allow a small footprint/network
      // discrepancy without accepting a distant or non-closing "impact" claim.
      if (pointToVehicleDistance(current, victim) > 0.9) continue;
      const approachPosition = usedRecentApproach ? prior!.from : previous.position;
      const previousDistance = distance(victim.position, approachPosition);
      const currentDistance = distance(victim.position, current.position);
      if (currentDistance >= previousDistance) continue;
      const health: PlayerHealthState = {
        playerId: victim.playerId, condition, impactSpeedKmh: Math.round(speed * 3.6),
        updatedAt: now, recoverAt: now + (condition === 'dead' ? RESPAWN_MS : INJURY_RECOVERY_MS),
      };
      this.states.set(victim.playerId, health);
      this.impactCooldowns.set(victim.playerId, now);
      impacts.push({ driverId, victimId: victim.playerId, health: { ...health } });
    }
    return impacts;
  }

  recoveries(now = Date.now()) {
    const recovered: { playerId: string; health: PlayerHealthState; respawn: boolean }[] = [];
    for (const state of this.states.values()) {
      if (state.condition === 'healthy' || state.recoverAt === null || now < state.recoverAt) continue;
      const respawn = state.condition === 'dead';
      const health = healthyHealth(state.playerId, now);
      this.states.set(state.playerId, health);
      this.impactCooldowns.delete(state.playerId);
      recovered.push({ playerId: state.playerId, health: { ...health }, respawn });
    }
    return recovered;
  }
}
