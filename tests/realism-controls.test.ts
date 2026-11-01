import { describe, expect, it } from 'vitest';
import { sirenGainForDistance } from '../src/client/systems/audio';
import { conversationInput, type InputFrame } from '../src/client/systems/controls';

describe('local police siren mix', () => {
  it('attenuates smoothly with distance and remains bounded', () => {
    expect(sirenGainForDistance(0)).toBeCloseTo(0.04);
    expect(sirenGainForDistance(67.5)).toBeCloseTo(0.01);
    expect(sirenGainForDistance(20)).toBeGreaterThan(sirenGainForDistance(80));
    expect(sirenGainForDistance(135)).toBe(0);
    expect(sirenGainForDistance(500)).toBe(0);
    expect(sirenGainForDistance(Number.NaN)).toBe(0);
    expect(sirenGainForDistance(-5)).toBeCloseTo(0.04);
  });
});

describe('conversation movement controls', () => {
  it('zeroes every movement input only while the local conversation field is active', () => {
    const held: InputFrame = { forward: 1, right: -1, run: true, brake: true };
    expect(conversationInput(true, held)).toEqual({ forward: 0, right: 0, run: false, brake: false });
    expect(conversationInput(false, held)).toBe(held);
    expect(conversationInput(false, held)).toEqual({ forward: 1, right: -1, run: true, brake: true });
  });
});
