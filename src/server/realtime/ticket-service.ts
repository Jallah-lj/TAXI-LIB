import { createHash, randomBytes } from 'node:crypto';

interface TicketRecord { userId: string; expiresAt: number }

/** Short-lived, single-use WebSocket credentials; raw tickets are never retained. */
export class RealtimeTicketService {
  private readonly tickets = new Map<string, TicketRecord>();

  issue(userId: string) {
    const now = Date.now();
    for (const [hash, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(hash);
    }
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now + 30_000);
    this.tickets.set(this.hash(ticket), { userId, expiresAt: expiresAt.getTime() });
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  consume(ticket: string | null): string | null {
    if (!ticket || ticket.length > 128) return null;
    const hash = this.hash(ticket);
    const record = this.tickets.get(hash);
    if (!record) return null;
    this.tickets.delete(hash);
    if (record.expiresAt <= Date.now()) return null;
    return record.userId;
  }

  private hash(ticket: string) {
    return createHash('sha256').update(ticket).digest('hex');
  }
}
