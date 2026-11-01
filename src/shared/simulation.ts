export type WeatherPhase = 'clear' | 'cloudy' | 'rain' | 'storm';

export interface SimulationState {
  serverTime: number;
  timeOfDaySeconds: number;
  dayNumber: number;
  weather: WeatherPhase;
  rainIntensity: number;
  temperatureC: number;
}

/** A compressed 20-minute day. This is a game clock, not Liberia's live weather. */
export function getSimulationState(now = Date.now()): SimulationState {
  const seconds = now / 1000;
  const dayDuration = 20 * 60;
  const timeOfDaySeconds = (seconds * 72 + 6 * 3600) % 86400;
  const dayNumber = Math.floor((seconds * 72 + 6 * 3600) / 86400) + 1;
  const weatherCycle = (seconds + 105) % 720;
  let weather: WeatherPhase = 'clear';
  let rainIntensity = 0;

  if (weatherCycle >= 390 && weatherCycle < 465) weather = 'cloudy';
  if (weatherCycle >= 465 && weatherCycle < 565) {
    weather = 'rain';
    rainIntensity = Math.min(1, (weatherCycle - 465) / 18, (565 - weatherCycle) / 18);
  }
  if (weatherCycle >= 565 && weatherCycle < 620) {
    weather = 'storm';
    rainIntensity = 0.85 + 0.15 * Math.sin((weatherCycle - 565) / 55 * Math.PI);
  }
  if (weatherCycle >= 620 && weatherCycle < 675) weather = 'cloudy';

  return {
    serverTime: now,
    timeOfDaySeconds,
    dayNumber,
    weather,
    rainIntensity: Math.max(0, Math.min(1, rainIntensity)),
    temperatureC: weather === 'clear' ? 29 : weather === 'cloudy' ? 27 : 25,
  };
}

export function formatGameTime(timeOfDaySeconds: number): string {
  const hours = Math.floor(timeOfDaySeconds / 3600) % 24;
  const minutes = Math.floor(timeOfDaySeconds / 60) % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export const FARE_RULES = Object.freeze({ baseLrd: 250, perMeterLrd: 4.25, perMinuteLrd: 55 });

export function quoteFare(routeMeters: number, rainIntensity: number): number {
  const expectedMinutes = routeMeters / 8.5 / 60;
  const weatherModifier = 1 + Math.min(1, Math.max(0, rainIntensity)) * 0.18;
  const raw = (FARE_RULES.baseLrd + routeMeters * FARE_RULES.perMeterLrd + expectedMinutes * FARE_RULES.perMinuteLrd) * weatherModifier;
  return Math.max(250, Math.round(raw / 25) * 25);
}

export function formatLrd(amount: number): string {
  return `L$ ${Math.round(amount).toLocaleString('en-US')}`;
}
