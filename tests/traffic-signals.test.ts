import { describe, expect, it } from 'vitest';
import {
  SIGNALIZED_INTERSECTIONS, signalAtWaypoint, signalLimitedSpeed, trafficSignalLamp,
} from '../src/shared/traffic';

function horizontalGreenStart(id: string) {
  for (let time = 100; time <= 30_000; time += 100) {
    if (trafficSignalLamp('horizontal', time, id) === 'green' && trafficSignalLamp('horizontal', time - 100, id) === 'red') return time;
  }
  throw new Error(`No horizontal green phase for ${id}`);
}

describe('deterministic street signals', () => {
  it('coordinates both axes with yellow transitions and all-red clearance', () => {
    for (const intersection of SIGNALIZED_INTERSECTIONS) {
      const start = horizontalGreenStart(intersection.id);
      expect(trafficSignalLamp('horizontal', start, intersection.id)).toBe('green');
      expect(trafficSignalLamp('vertical', start, intersection.id)).toBe('red');
      expect(trafficSignalLamp('horizontal', start + 11_100, intersection.id)).toBe('yellow');
      expect(trafficSignalLamp('horizontal', start + 13_100, intersection.id)).toBe('red');
      expect(trafficSignalLamp('vertical', start + 13_100, intersection.id)).toBe('red');
      expect(trafficSignalLamp('vertical', start + 15_100, intersection.id)).toBe('green');
      expect(trafficSignalLamp('horizontal', start + 15_100, intersection.id)).toBe('red');
      expect(trafficSignalLamp('vertical', start + 26_100, intersection.id)).toBe('yellow');
      expect(trafficSignalLamp('vertical', start + 28_100, intersection.id)).toBe('red');
      expect(trafficSignalLamp('horizontal', start + 28_100, intersection.id)).toBe('red');
      expect(trafficSignalLamp('horizontal', start + 30_000, intersection.id)).toBe(trafficSignalLamp('horizontal', start, intersection.id));
    }
  });

  it('associates right-hand lane corner waypoints with the correct intersection', () => {
    expect(signalAtWaypoint(116, 116)?.id).toBe('signal_120_120');
    expect(signalAtWaypoint(-4, 4)?.id).toBe('signal_0_0');
    expect(signalAtWaypoint(40, 40)).toBeUndefined();
  });

  it('brakes before a red stop line but lets committed vehicles clear the junction', () => {
    const intersection = SIGNALIZED_INTERSECTIONS[0]!;
    const green = horizontalGreenStart(intersection.id);
    const red = green + 14_000;
    expect(signalLimitedSpeed('horizontal', red, intersection.id, 30, 6)).toBe(6);
    expect(signalLimitedSpeed('horizontal', red, intersection.id, 14, 6)).toBeLessThan(6);
    expect(signalLimitedSpeed('horizontal', red, intersection.id, 11.2, 6)).toBe(0);
    expect(signalLimitedSpeed('horizontal', red, intersection.id, 7.9, 6)).toBe(6);
    expect(signalLimitedSpeed('horizontal', green, intersection.id, 11.2, 6)).toBe(6);
  });
});
