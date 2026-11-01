import { describe, expect, it } from 'vitest';
import { INITIAL_CONNECTION_STATUS, connectionPhaseLabel, reconnectDelay } from '../src/client/connection';

describe('connection recovery policy', () => {
  it('uses bounded, increasing retry delays and tolerates invalid attempts', () => {
    expect(reconnectDelay(1)).toBe(1200);
    expect(reconnectDelay(2)).toBe(2400);
    expect(reconnectDelay(3)).toBe(4800);
    expect(reconnectDelay(4)).toBe(9600);
    expect(reconnectDelay(5)).toBe(10000);
    expect(reconnectDelay(Number.NaN)).toBe(1200);
  });

  it('provides explicit labels for every user-facing connection phase', () => {
    expect(INITIAL_CONNECTION_STATUS).toEqual({ phase: 'idle', attempt: 0, lastError: null, nextRetryAt: null });
    expect(['idle', 'connecting', 'online', 'reconnecting', 'offline'] as const).toSatisfy((phases) => phases.every((phase) => connectionPhaseLabel(phase).length > 0));
    expect(connectionPhaseLabel('online')).toBe('LIVE');
    expect(connectionPhaseLabel('reconnecting')).toBe('RECONNECTING');
  });
});
