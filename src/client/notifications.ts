export type NotificationCategory = 'transaction' | 'civic' | 'connection' | 'social' | 'system';
export type NotificationTone = 'success' | 'error' | 'info';
export type NotificationFilter = 'all' | NotificationCategory;
export type NotificationActionType = 'wallet' | 'civic' | 'social' | 'connection' | 'reconnect' | 'refresh-dispatch' | 'refresh-civic' | 'refresh-wallet' | 'sign-in';

export interface NotificationAction {
  type: NotificationActionType;
  label: string;
}

export interface NotificationInput {
  category: NotificationCategory;
  tone: NotificationTone;
  title: string;
  message: string;
  action?: NotificationAction;
}

export interface AppNotification extends NotificationInput {
  id: string;
  createdAt: string;
  read: boolean;
}

/** A deliberately small, session-scoped activity feed; it is not a ledger. */
export class NotificationCenter {
  private readonly items: AppNotification[] = [];
  private nextId = 1;

  constructor(private readonly limit = 30, private readonly clock: () => string = () => new Date().toISOString()) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Notification history limit must be positive.');
  }

  add(input: NotificationInput) {
    const item: AppNotification = {
      ...input,
      title: input.title.trim() || 'District update',
      message: input.message.trim(),
      id: `notification-${this.nextId++}`,
      createdAt: this.clock(),
      read: false,
    };
    this.items.unshift(item);
    if (this.items.length > this.limit) this.items.length = this.limit;
    return { ...item };
  }

  list(filter: NotificationFilter = 'all') {
    return this.items.filter((item) => filter === 'all' || item.category === filter).map((item) => ({ ...item }));
  }

  unreadCount(filter: NotificationFilter = 'all') {
    return this.items.filter((item) => !item.read && (filter === 'all' || item.category === filter)).length;
  }

  markAllRead() {
    let changed = 0;
    for (const item of this.items) {
      if (!item.read) { item.read = true; changed += 1; }
    }
    return changed;
  }

  markCategoryRead(category: NotificationCategory) {
    let changed = 0;
    for (const item of this.items) {
      if (item.category === category && !item.read) { item.read = true; changed += 1; }
    }
    return changed;
  }

  clear() { this.items.length = 0; }
}
