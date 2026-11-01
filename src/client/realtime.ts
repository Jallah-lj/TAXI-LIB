import type { ClientMessage, MovementState, ServerMessage } from '../shared/protocol';
import type { PlayerProfile, Wallet } from '../shared/types';
import type { CivicIncident, PlayerSafetyState } from '../shared/civic';
import type { PlayerHealthState } from '../shared/health';
import { INITIAL_CONNECTION_STATUS, reconnectDelay, type ConnectionStatus } from './connection';
import { api } from './api';

interface RealtimeCallbacks {
  onStatus: (status: ConnectionStatus) => void;
  onWelcome: (playerId: string) => void;
  onSnapshot: (players: (MovementState & { profile: PlayerProfile })[]) => void;
  onProfile: (profile: PlayerProfile) => void;
  onState: (state: MovementState) => void;
  onLeave: (playerId: string) => void;
  onChat: (message: Extract<ServerMessage, { type: 'chat' }>) => void;
  onEmote: (playerId: string) => void;
  onSimulation: (simulation: Extract<ServerMessage, { type: 'world' }>['simulation']) => void;
  onCivicIncidents: (incidents: CivicIncident[]) => void;
  onPlayerHealth: (playerId: string, health: PlayerHealthState, state?: MovementState) => void;
  onSafety: (safety: PlayerSafetyState, wallet: Wallet, notice: string) => void;
  onError: (message: string) => void;
}

export class RealtimeClient {
  private socket?: WebSocket;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private manuallyClosed = false;
  private connecting = false;
  private generation = 0;
  private attempt = 0;
  private hasConnected = false;
  private status: ConnectionStatus = { ...INITIAL_CONNECTION_STATUS };

  constructor(private readonly callbacks: RealtimeCallbacks) {}

  getStatus() { return { ...this.status }; }

  private updateStatus(patch: Partial<ConnectionStatus>) {
    this.status = { ...this.status, ...patch };
    this.callbacks.onStatus({ ...this.status });
  }

  private isCurrent(generation: number) { return generation === this.generation && !this.manuallyClosed; }

  async connect() {
    if (this.connecting || this.socket?.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    this.manuallyClosed = false;
    const generation = ++this.generation;
    this.connecting = true;
    this.attempt += 1;
    this.updateStatus({
      phase: this.hasConnected ? 'reconnecting' : 'connecting', attempt: Math.max(1, this.attempt), nextRetryAt: null,
    });
    let ticket = '';
    try { ticket = (await api.realtimeTicket()).ticket; } catch { /* Secure cookie auth remains available. */ }
    if (!this.isCurrent(generation)) return;
    try {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
      const socket = new WebSocket(`${protocol}//${location.host}/ws${query}`);
      this.socket = socket;
      this.connecting = false;
      socket.addEventListener('open', () => {
        if (!this.isCurrent(generation)) return;
        this.hasConnected = true;
        this.attempt = 0;
        this.updateStatus({ phase: 'online', attempt: 0, lastError: null, nextRetryAt: null });
      });
      socket.addEventListener('error', () => {
        if (this.isCurrent(generation)) this.updateStatus({ lastError: 'The district connection reported a network error. Retry or check your connection.' });
      });
      socket.addEventListener('close', () => {
        if (!this.isCurrent(generation)) return;
        this.socket = undefined;
        this.scheduleReconnect(generation, 'The district connection was interrupted. Your work is not cancelled; reconnect to resume live updates.');
      });
      socket.addEventListener('message', (event) => {
        if (!this.isCurrent(generation)) return;
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          if (message.type === 'welcome') { this.sequence = 0; this.callbacks.onWelcome(message.playerId); this.callbacks.onSimulation(message.simulation); }
          if (message.type === 'snapshot') this.callbacks.onSnapshot(message.players);
          if (message.type === 'player-joined') this.callbacks.onProfile(message.profile);
          if (message.type === 'player-state') this.callbacks.onState(message.state);
          if (message.type === 'player-left') this.callbacks.onLeave(message.playerId);
          if (message.type === 'chat') this.callbacks.onChat(message);
          if (message.type === 'emote') this.callbacks.onEmote(message.playerId);
          if (message.type === 'world') this.callbacks.onSimulation(message.simulation);
          if (message.type === 'civic-incidents') this.callbacks.onCivicIncidents(message.incidents);
          if (message.type === 'player-health') this.callbacks.onPlayerHealth(message.playerId, message.health, message.state);
          if (message.type === 'safety') this.callbacks.onSafety(message.safety, message.wallet, message.notice);
          if (message.type === 'error') this.callbacks.onError(message.error);
        } catch { /* Ignore malformed frames without compromising game state. */ }
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.connecting = false;
      this.socket = undefined;
      this.scheduleReconnect(generation, error instanceof Error ? error.message : 'Unable to open the district connection.');
    }
  }

  private scheduleReconnect(generation: number, message: string) {
    if (!this.isCurrent(generation)) return;
    this.connecting = false;
    const delay = reconnectDelay(this.attempt);
    this.updateStatus({
      phase: 'reconnecting', attempt: Math.max(1, this.attempt), lastError: message, nextRetryAt: Date.now() + delay,
    });
    this.reconnectTimer = setTimeout(() => {
      if (this.isCurrent(generation)) void this.connect();
    }, delay);
  }

  reconnect() {
    this.generation += 1;
    this.connecting = false;
    this.manuallyClosed = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    const previous = this.socket;
    this.socket = undefined;
    previous?.close();
    void this.connect();
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try { this.socket.send(JSON.stringify(message)); return true; } catch { return false; }
  }

  sendState(state: Omit<MovementState, 'playerId' | 'sentAt' | 'sequence'>) {
    this.sequence += 1;
    return this.send({ type: 'state', ...state, sequence: this.sequence });
  }

  chat(text: string) { return this.send({ type: 'chat', text }); }
  emote() { return this.send({ type: 'emote', emote: 'wave' }); }

  close() {
    this.manuallyClosed = true;
    this.generation += 1;
    this.connecting = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    this.socket?.close();
    this.socket = undefined;
    this.updateStatus({ phase: 'offline', attempt: 0, nextRetryAt: null });
  }
}
