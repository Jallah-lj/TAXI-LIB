export type CharacterMotion = 'idle' | 'walk' | 'sprint';

export function characterMotionForSpeed(speed: number): CharacterMotion {
  const absolute = Math.abs(speed);
  return absolute > 4.5 ? 'sprint' : absolute > 0.15 ? 'walk' : 'idle';
}
