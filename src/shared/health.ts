export type HealthCondition = 'healthy' | 'injured' | 'dead';

export interface PlayerHealthState {
  playerId: string;
  condition: HealthCondition;
  impactSpeedKmh: number;
  updatedAt: number;
  recoverAt: number | null;
}

export const INJURY_IMPACT_SPEED = 4.5;
export const FATAL_IMPACT_SPEED = 12.5;
export const INJURY_RECOVERY_MS = 18_000;
export const RESPAWN_MS = 7_000;

/** Non-graphic gameplay severity; low-speed contact remains a collision stop. */
export function conditionAfterImpact(speed: number, current: HealthCondition = 'healthy'): Exclude<HealthCondition, 'healthy'> | null {
  if (!Number.isFinite(speed) || speed < INJURY_IMPACT_SPEED || current === 'dead') return null;
  if (speed >= FATAL_IMPACT_SPEED || (current === 'injured' && speed >= 6)) return 'dead';
  return 'injured';
}

export function healthyHealth(playerId: string, updatedAt = 0): PlayerHealthState {
  return { playerId, condition: 'healthy', impactSpeedKmh: 0, updatedAt, recoverAt: null };
}
