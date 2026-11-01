import type { SimulationState } from './simulation.js';

export interface DistrictLightingProfile {
  daylight: number;
  nightFactor: number;
  sunIntensity: number;
  moonIntensity: number;
  hemisphereIntensity: number;
  exposure: number;
  fogDensity: number;
  lampEmissive: number;
  windowEmissive: number;
  streetlightIntensity: number;
  starOpacity: number;
  moonOpacity: number;
}

function clamp01(value: number) { return Math.max(0, Math.min(1, value)); }
function smoothstep(min: number, max: number, value: number) {
  const normalized = clamp01((value - min) / (max - min));
  return normalized * normalized * (3 - 2 * normalized);
}

/** A readable cinematic night, with cool fill and warm practical lights rather than flat brightness. */
export function getDistrictLighting(simulation: SimulationState): DistrictLightingProfile {
  const hour = simulation.timeOfDaySeconds / 3600;
  const elevation = Math.sin((hour - 6) / 12 * Math.PI) * 62;
  const daylight = smoothstep(-5, 20, elevation);
  const nightFactor = 1 - daylight;
  const rain = clamp01(simulation.rainIntensity);
  const clarity = simulation.weather === 'clear' ? 1 : simulation.weather === 'cloudy' ? 0.82 : 0.62;
  return {
    daylight,
    nightFactor,
    sunIntensity: daylight * 3.05 * clarity,
    moonIntensity: nightFactor * Math.max(0.32, 0.68 - rain * 0.26),
    // Preserve the established daylight while adding a soft night-only floor for faces and clothing.
    hemisphereIntensity: 0.46 + daylight * 1.12 * clarity + nightFactor * 0.22,
    exposure: 1.05 + nightFactor * (0.27 - rain * 0.05),
    fogDensity: 0.00145 + rain * 0.0055 + nightFactor * 0.0003,
    lampEmissive: nightFactor * 2.7,
    windowEmissive: nightFactor * 0.7,
    streetlightIntensity: nightFactor * (58 - rain * 8),
    starOpacity: nightFactor * (1 - rain * 0.82) * 0.9,
    moonOpacity: nightFactor * (1 - rain * 0.9) * 0.85,
  };
}
