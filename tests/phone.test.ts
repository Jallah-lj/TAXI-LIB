import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONE_CONTACTS, PhoneSystem, type PhoneCallSnapshot } from '../src/client/systems/phone';

describe('simulated citizen phone', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects a scripted NPC call, reveals responses and ends all timers', () => {
    const snapshots: (PhoneCallSnapshot | null)[] = [];
    const phone = new PhoneSystem((call) => snapshots.push(call));
    phone.start('dispatch');
    expect(snapshots.at(-1)?.status).toBe('connecting');

    vi.advanceTimersByTime(750);
    expect(snapshots.at(-1)?.status).toBe('connected');
    expect(snapshots.at(-1)?.visibleLines).toEqual([PHONE_CONTACTS[0]!.lines[0]]);

    vi.advanceTimersByTime(1600);
    expect(snapshots.at(-1)?.visibleLines).toHaveLength(2);
    expect(snapshots.at(-1)?.elapsedSeconds).toBe(1);

    phone.end();
    const endedCount = snapshots.length;
    expect(snapshots.at(-1)).toBeNull();
    vi.advanceTimersByTime(10_000);
    expect(snapshots).toHaveLength(endedCount);
  });

  it('does not leak a previous call transcript into a new service call', () => {
    let current: PhoneCallSnapshot | null = null;
    const phone = new PhoneSystem((call) => { current = call; });
    phone.start('dispatch');
    vi.advanceTimersByTime(500);
    phone.start('homes');
    vi.advanceTimersByTime(750);
    expect(current?.contact.id).toBe('homes');
    expect(current?.visibleLines[0]).toBe(PHONE_CONTACTS.find((contact) => contact.id === 'homes')!.lines[0]);
    phone.end();
  });
});
