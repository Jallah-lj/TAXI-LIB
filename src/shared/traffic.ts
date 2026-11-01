export type TrafficAxis = 'horizontal' | 'vertical';
export type TrafficLamp = 'red' | 'yellow' | 'green';

export interface SignalizedIntersection {
  id: string;
  x: number;
  z: number;
}

export const SIGNALIZED_INTERSECTIONS: readonly SignalizedIntersection[] = Object.freeze(
  [-120, 0, 120, 240].flatMap((x) => [-120, 0, 120].map((z) => ({ id: `signal_${x}_${z}`, x, z }))),
);

export const TRAFFIC_SIGNAL_CYCLE_SECONDS = 30;

function intersectionOffset(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return Math.abs(hash % 7) - 3;
}

/** Deterministic right-hand-road signal cycle with two all-red clearance phases. */
export function trafficSignalLamp(axis: TrafficAxis, serverTime: number, intersectionId: string): TrafficLamp {
  const rawPhase = serverTime / 1000 + intersectionOffset(intersectionId);
  const phase = ((rawPhase % TRAFFIC_SIGNAL_CYCLE_SECONDS) + TRAFFIC_SIGNAL_CYCLE_SECONDS) % TRAFFIC_SIGNAL_CYCLE_SECONDS;
  if (axis === 'horizontal') {
    if (phase < 11) return 'green';
    if (phase < 13) return 'yellow';
    return 'red';
  }
  if (phase >= 15 && phase < 26) return 'green';
  if (phase >= 26 && phase < 28) return 'yellow';
  return 'red';
}

export function signalAtWaypoint(x: number, z: number) {
  return SIGNALIZED_INTERSECTIONS.find((intersection) => Math.hypot(x - intersection.x, z - intersection.z) <= 8);
}

/** Limits approach speed while allowing a vehicle already past the stop line to clear the junction. */
export function signalLimitedSpeed(axis: TrafficAxis, serverTime: number, intersectionId: string, distanceToWaypoint: number, desiredSpeed: number) {
  if (distanceToWaypoint < 8 || trafficSignalLamp(axis, serverTime, intersectionId) === 'green') return desiredSpeed;
  const remaining = distanceToWaypoint - 11;
  if (remaining <= 0.35) return 0;
  return Math.min(desiredSpeed, Math.sqrt(Math.max(0, remaining * 2 * 5)));
}
