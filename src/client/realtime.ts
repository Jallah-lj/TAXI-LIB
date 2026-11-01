import type { ClientMessage, MovementState, ServerMessage } from '../shared/protocol';
import type { PlayerProfile, Wallet } from '../shared/types';
import type { CivicIncident, PlayerSafetyState } from '../shared/civic';
import type { PlayerHealthState } from '../shared/health';
import { api } from './api';

interface RealtimeCallbacks {
  onOpen: () => void;
  onClose: () => void;
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

  constructor(private readonly callbacks: RealtimeCallbacks) {}

  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    this.manuallyClosed = false;
    let ticket = '';
    try { ticket = (await api.realtimeTicket()).ticket; } catch { /* Secure cookie auth remains available. */ }
    if (this.manuallyClosed) { this.connecting = false; return; }
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
    const socket = new WebSocket(`${protocol}//${location.host}/ws${query}`);
    this.socket = socket;
    this.connecting = false;
    socket.addEventListener('open', () => this.callbacks.onOpen());
    socket.addEventListener('close', () => {
      this.callbacks.onClose();
      if (!this.manuallyClosed) this.reconnectTimer = setTimeout(() => { void this.connect(); }, 1800);
    });
    socket.addEventListener('message', (event) => {
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
  }

  send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  sendState(state: Omit<MovementState, 'playerId' | 'sentAt' | 'sequence'>) {
    this.sequence += 1;
    this.send({ type: 'state', ...state, sequence: this.sequence });
  }

  chat(text: string) { this.send({ type: 'chat', text }); }
  emote() { this.send({ type: 'emote', emote: 'wave' }); }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }
}
