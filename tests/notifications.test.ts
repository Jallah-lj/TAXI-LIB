import { describe, expect, it } from 'vitest';
import { NotificationCenter } from '../src/client/notifications';

const input = (title: string, category: 'transaction' | 'civic' | 'connection' | 'social' | 'system' = 'system') => ({
  category, tone: 'info' as const, title, message: `${title} detail`,
});

describe('session notification history', () => {
  it('retains a bounded newest-first history without replacing the financial ledger', () => {
    let now = 0;
    const center = new NotificationCenter(3, () => `2026-11-02T06:00:0${now++}.000Z`);
    for (const title of ['one', 'two', 'three', 'four']) center.add(input(title));
    expect(center.list().map((item) => item.title)).toEqual(['four', 'three', 'two']);
    expect(center.list()[0]?.createdAt).toBe('2026-11-02T06:00:03.000Z');
  });

  it('filters categories and tracks unread, read-all and clear operations', () => {
    const center = new NotificationCenter();
    center.add(input('Fare paid', 'transaction'));
    center.add(input('Civic report', 'civic'));
    center.add(input('Nearby message', 'social'));
    expect(center.unreadCount()).toBe(3);
    expect(center.list('civic')).toHaveLength(1);
    expect(center.markCategoryRead('social')).toBe(1);
    expect(center.unreadCount()).toBe(2);
    expect(center.markAllRead()).toBe(2);
    expect(center.unreadCount()).toBe(0);
    center.clear();
    expect(center.list()).toEqual([]);
  });

  it('preserves actionable recovery metadata with each event', () => {
    const center = new NotificationCenter();
    center.add({ ...input('Connection lost', 'connection'), tone: 'error', action: { type: 'reconnect', label: 'Retry now' } });
    expect(center.list('connection')[0]).toMatchObject({ read: false, tone: 'error', action: { type: 'reconnect', label: 'Retry now' } });
  });
});
