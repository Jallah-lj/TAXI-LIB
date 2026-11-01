import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/client/api';
import { RealtimeClient } from '../src/client/realtime';
import type { ConnectionStatus } from '../src/client/connection';

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) { FakeSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  emit(type: string, event: unknown = {}) { this.listeners.get(type)?.forEach((listener) => listener(event)); }
  open() { this.readyState = FakeSocket.OPEN; this.emit('open'); }
  close() { this.readyState = 3; this.emit('close'); }
  send(message: string) { this.sent.push(message); }
}

function callbacks(statuses: ConnectionStatus[]) {
  return {
    onStatus: (status: ConnectionStatus) => statuses.push(status),
    onWelcome: vi.fn(), onSnapshot: vi.fn(), onProfile: vi.fn(), onState: vi.fn(), onLeave: vi.fn(),
    onChat: vi.fn(), onEmote: vi.fn(), onSimulation: vi.fn(), onCivicIncidents: vi.fn(),
    onPlayerHealth: vi.fn(), onSafety: vi.fn(), onError: vi.fn(),
  };
}

describe('browser realtime recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeSocket.instances = [];
  });

  it('reports online state, sends only while open, and manually replaces a stale socket', async () => {
    vi.stubGlobal('location', { protocol: 'http:', host: 'district.test' });
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.spyOn(api, 'realtimeTicket').mockResolvedValue({ ticket: 'ticket', expiresAt: 'soon' });
    const statuses: ConnectionStatus[] = [];
    const client = new RealtimeClient(callbacks(statuses));
    expect(client.chat('not sent')).toBe(false);

    await client.connect();
    const first = FakeSocket.instances[0]!;
    expect(first.url).toBe('ws://district.test/ws?ticket=ticket');
    first.open();
    expect(client.getStatus().phase).toBe('online');
    expect(client.chat('hello')).toBe(true);
    expect(JSON.parse(first.sent[0]!)).toMatchObject({ type: 'chat', text: 'hello' });

    first.close();
    expect(client.getStatus().phase).toBe('reconnecting');
    client.reconnect();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    FakeSocket.instances[1]!.open();
    expect(client.getStatus().phase).toBe('online');
    expect(statuses.some((status) => status.phase === 'reconnecting')).toBe(true);
    client.close();
    expect(client.getStatus().phase).toBe('offline');
  });
});
