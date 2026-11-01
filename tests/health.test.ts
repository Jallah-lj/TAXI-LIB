import { describe, expect, it } from 'vitest';
import { conditionAfterImpact, FATAL_IMPACT_SPEED, INJURY_IMPACT_SPEED, INJURY_RECOVERY_MS, RESPAWN_MS } from '../src/shared/health';
import { PlayerHealthService } from '../src/server/services/player-health-service';
import type { MovementState } from '../src/shared/protocol';

function state(playerId: string, z: number, sentAt: number, mode: 'walking' | 'driving' = 'driving', speed = 0): MovementState {
  return { playerId, position: [0, 0, z], heading: 0, speed, mode, sequence: sentAt, sentAt };
}

describe('non-graphic impact health rules', () => {
  it('keeps low-speed contact harmless and escalates serious or repeat impacts', () => {
    expect(conditionAfterImpact(INJURY_IMPACT_SPEED - 0.01)).toBeNull();
    expect(conditionAfterImpact(INJURY_IMPACT_SPEED)).toBe('injured');
    expect(conditionAfterImpact(FATAL_IMPACT_SPEED)).toBe('dead');
    expect(conditionAfterImpact(6, 'injured')).toBe('dead');
    expect(conditionAfterImpact(5.9, 'injured')).toBe('injured');
    expect(conditionAfterImpact(50, 'dead')).toBeNull();
  });

  it('derives injury from accepted displacement and schedules timed recovery', () => {
    const service = new PlayerHealthService();
    const impacts = service.observe('driver', state('driver', -1, 0, 'driving', 99), state('driver', 0, 100, 'driving', 0), [state('victim', 2.8, 100, 'walking')], 1000);
    expect(impacts).toHaveLength(1);
    expect(impacts[0]?.health.condition).toBe('injured');
    expect(impacts[0]?.health.impactSpeedKmh).toBe(36);
    expect(impacts[0]?.health.recoverAt).toBe(1000 + INJURY_RECOVERY_MS);
    expect(service.recoveries(1000 + INJURY_RECOVERY_MS - 1)).toHaveLength(0);
    expect(service.recoveries(1000 + INJURY_RECOVERY_MS)[0]).toMatchObject({ playerId: 'victim', respawn: false });
    expect(service.health('victim').condition).toBe('healthy');
  });

  it('uses a measured approach sample when the accepted stop has no displacement', () => {
    const service = new PlayerHealthService();
    const approach = state('driver', -1, 100, 'driving', 10);
    service.observe('driver', state('driver', -2, 0), approach, [state('victim', 10, 100, 'walking')], 100);
    const stopped = state('driver', -1, 200, 'driving', 0);
    const impacts = service.observe('driver', approach, stopped, [state('victim', 1.8, 200, 'walking')], 200);
    expect(impacts[0]?.health.condition).toBe('injured');
  });

  it('retains a measured approach when contact deceleration is small but nonzero', () => {
    const service = new PlayerHealthService();
    const approach = state('driver', -1, 100, 'driving', 8);
    service.observe('driver', state('driver', -2, 0), approach, [state('victim', 10, 100, 'walking')], 100);
    const contact = state('driver', -1.05, 200, 'driving', 0.75);
    const impacts = service.observe('driver', approach, contact, [state('victim', 1.8, 200, 'walking')], 200);
    expect(impacts[0]?.health.condition).toBe('injured');
  });

  it('accepts a closing network contact with a small interpolated-footprint discrepancy', () => {
    const service = new PlayerHealthService();
    const previous = state('driver', 37.69052049446776, 0, 'driving', 9.48);
    const current = state('driver', 37.19729981743694, 100, 'driving', 0);
    const impacts = service.observe('driver', previous, current, [state('victim', 34, 100, 'walking')], 100);
    expect(impacts[0]?.health.condition).toBe('injured');
    expect(impacts[0]?.health.impactSpeedKmh).toBe(18);
  });

  it('does not treat a client speed claim without accepted movement as an impact', () => {
    const service = new PlayerHealthService();
    const previous = state('driver', 0, 0, 'driving', 80);
    const current = state('driver', 0, 100, 'driving', 80);
    expect(service.observe('driver', previous, current, [state('victim', 2.8, 100, 'walking')], 100)).toHaveLength(0);
  });

  it('schedules a fatal respawn separately from injury recovery', () => {
    const service = new PlayerHealthService();
    const impacts = service.observe('driver', state('driver', -2, 0), state('driver', 0, 100), [state('victim', 2.8, 100, 'walking')], 5000);
    expect(impacts[0]?.health.condition).toBe('dead');
    expect(impacts[0]?.health.recoverAt).toBe(5000 + RESPAWN_MS);
    expect(service.recoveries(5000 + RESPAWN_MS)[0]).toMatchObject({ playerId: 'victim', respawn: true });
  });
});
