import { describe, expect, it } from 'vitest';
import { getDistrictLighting } from '../src/shared/lighting';
import type { SimulationState } from '../src/shared/simulation';

function simulation(timeOfDaySeconds: number, weather: SimulationState['weather'] = 'clear', rainIntensity = 0): SimulationState {
  return { serverTime: 0, timeOfDaySeconds, dayNumber: 1, weather, rainIntensity, temperatureC: 29 };
}

describe('district character readability lighting', () => {
  it('adds a bounded cool night fill without flattening exposure or practical lights', () => {
    const profile = getDistrictLighting(simulation(23 * 3600));
    expect(profile.nightFactor).toBe(1);
    expect(profile.hemisphereIntensity).toBeCloseTo(0.68);
    expect(profile.moonIntensity).toBeCloseTo(0.68);
    expect(profile.exposure).toBeCloseTo(1.32);
    expect(profile.streetlightIntensity).toBeCloseTo(58);
  });

  it('preserves the established clear-day lighting', () => {
    const profile = getDistrictLighting(simulation(12 * 3600));
    expect(profile.daylight).toBe(1);
    expect(profile.nightFactor).toBe(0);
    expect(profile.sunIntensity).toBeCloseTo(3.05);
    expect(profile.moonIntensity).toBe(0);
    expect(profile.hemisphereIntensity).toBeCloseTo(1.58);
  });

  it('retains character fill during a storm while keeping reduced moonlight', () => {
    const profile = getDistrictLighting(simulation(0, 'storm', 1));
    expect(profile.hemisphereIntensity).toBeCloseTo(0.68);
    expect(profile.moonIntensity).toBeCloseTo(0.42);
    expect(profile.exposure).toBeCloseTo(1.27);
    expect(profile.streetlightIntensity).toBeCloseTo(50);
  });
});
