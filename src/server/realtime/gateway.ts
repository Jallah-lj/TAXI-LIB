import { randomUUID } from 'node:crypto';
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Database } from '../db/database.js';
import type { AuthService } from '../services/auth-service.js';
import type { PlayerService } from '../services/player-service.js';
import type { PresenceService } from '../services/presence-service.js';
import type { CivicService } from '../services/civic-service.js';
import { PlayerHealthService } from '../services/player-health-service.js';
import type { PlayerHealthState } from '../../shared/health.js';
import { clientMessageSchema, type MovementState, type ServerMessage } from '../../shared/protocol.js';
import { getSimulationState } from '../../shared/simulation.js';
import { isOriginAllowed } from '../http.js';
import type { RealtimeTicketService } from './ticket-service.js';

interface AuthenticatedRequest extends IncomingMessage { taxiLibPlayerId?: string }

interface ClientSocket extends WebSocket {
  playerId?: string;
  isAlive?: boolean;
  windowStarted?: number;
  messageCount?: number;
  chatTimes?: number[];
  vehicleIds?: Set<string>;
  propertyIds?: Set<string>;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

export class RealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  private readonly clients = new Set<ClientSocket>();
  private readonly worldTimer: NodeJS.Timeout;
  private readonly heartbeatTimer: NodeJS.Timeout;
  private readonly healthTimer: NodeJS.Timeout;
  private readonly health = new PlayerHealthService();
  private readonly civicUnsubscribe: () => void;

  constructor(
    server: HttpServer,
    private readonly database: Database,
    private readonly auth: AuthService,
    private readonly players: PlayerService,
    private readonly presence: PresenceService,
    private readonly civic: CivicService,
    private readonly tickets: RealtimeTicketService,
    private readonly publicOrigin?: string,
  ) {
    server.on('upgrade', (request, socket, head) => this.upgrade(request, socket, head));
    this.wss.on('connection', (socket: ClientSocket, request) => this.connect(socket, request));
    this.worldTimer = setInterval(() => this.broadcast({ type: 'world', simulation: getSimulationState() }), 15_000);
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 30_000);
    this.healthTimer = setInterval(() => this.recoverHealth(), 1000);
    this.worldTimer.unref();
    this.heartbeatTimer.unref();
    this.healthTimer.unref();
    this.civicUnsubscribe = this.civic.onIncidents(() => {
      this.broadcast({ type: 'civic-incidents', incidents: this.civic.incidents() });
    });
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') return;
      if (request.headers.origin && !isOriginAllowed(
        request.headers.origin,
        request.headers.host,
        request.headers['x-forwarded-host'],
        this.publicOrigin,
      )) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
      }
      const cookies = parseCookies(request.headers.cookie);
      const ticketUserId = this.tickets.consume(url.searchParams.get('ticket'));
      const playerId = ticketUserId ?? this.auth.userForToken(cookies[this.auth.cookieName]);
      if (!playerId) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
      (request as AuthenticatedRequest).taxiLibPlayerId = playerId;
      this.wss.handleUpgrade(request, socket, head, (client) => this.wss.emit('connection', client, request));
    } catch {
      socket.destroy();
    }
  }

  private connect(socket: ClientSocket, request: AuthenticatedRequest) {
    const playerId = request.taxiLibPlayerId ?? this.auth.userForToken(parseCookies(request.headers.cookie)[this.auth.cookieName]);
    if (!playerId) { socket.close(4401, 'Unauthorized'); return; }
    const profile = this.auth.profile(playerId);
    socket.playerId = playerId;
    socket.isAlive = true;
    socket.windowStarted = Date.now();
    socket.messageCount = 0;
    socket.chatTimes = [];
    socket.vehicleIds = new Set(this.players.vehicles(playerId).map((vehicle) => vehicle.id));
    socket.propertyIds = new Set(this.players.properties(playerId).map((property) => property.id));
    this.clients.add(socket);
    this.presence.join(profile);
    this.send(socket, { type: 'welcome', playerId, simulation: getSimulationState() });
    const snapshot = this.presence.snapshot(playerId);
    this.send(socket, { type: 'snapshot', players: snapshot });
    for (const state of snapshot) this.send(socket, { type: 'player-health', playerId: state.playerId, health: this.health.health(state.playerId) });
    this.send(socket, { type: 'player-health', playerId, health: this.health.health(playerId) });
    this.send(socket, { type: 'civic-incidents', incidents: this.civic.incidents() });
    this.send(socket, { type: 'safety', safety: this.civic.safety(playerId), wallet: this.players.wallet(playerId), notice: '' });
    this.broadcast({ type: 'player-joined', profile }, playerId);

    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', (data) => this.message(socket, data.toString()));
    socket.on('close', () => this.disconnect(socket));
    socket.on('error', () => this.disconnect(socket));
  }

  private message(socket: ClientSocket, raw: string) {
    const playerId = socket.playerId;
    if (!playerId) return;
    const now = Date.now();
    if (now - (socket.windowStarted ?? 0) > 5000) {
      socket.windowStarted = now; socket.messageCount = 0;
    }
    socket.messageCount = (socket.messageCount ?? 0) + 1;
    if ((socket.messageCount ?? 0) > 80) { socket.close(4408, 'Rate limit'); return; }
    let parsed;
    try { parsed = clientMessageSchema.safeParse(JSON.parse(raw)); } catch { return this.send(socket, { type: 'error', error: 'Invalid message.' }); }
    if (!parsed.success) return this.send(socket, { type: 'error', error: 'Invalid realtime payload.' });
    const message = parsed.data;

    if (message.type === 'ping') return this.send(socket, { type: 'pong', ...(message.nonce === undefined ? {} : { nonce: message.nonce }), serverTime: now });
    if (message.type === 'state') {
      if (this.health.health(playerId).condition === 'dead') return;
      if (message.vehicleId && !socket.vehicleIds?.has(message.vehicleId)) {
        socket.vehicleIds = new Set(this.players.vehicles(playerId).map((vehicle) => vehicle.id));
      }
      if (message.interiorPropertyId && !socket.propertyIds?.has(message.interiorPropertyId)) {
        socket.propertyIds = new Set(this.players.properties(playerId).map((property) => property.id));
      }
      const previous = this.presence.latest(playerId);
      const state = this.presence.update(playerId, message, socket.vehicleIds ?? new Set(), socket.propertyIds ?? new Set());
      if (!state) return;
      for (const impact of this.health.observe(playerId, previous, state, this.presence.snapshot(playerId))) {
        this.broadcastHealth(impact.victimId, impact.health);
      }
      const violation = this.civic.observeMovement(playerId, state);
      if (violation) this.send(socket, { type: 'safety', ...violation });
      for (const client of this.clients) {
        if (client.playerId && client.playerId !== playerId && this.isNearby(playerId, client.playerId)) {
          this.send(client, { type: 'player-state', state });
        }
      }
      return;
    }
    if (message.type === 'emote') {
      for (const client of this.clients) {
        if (client.playerId && client.playerId !== playerId && this.isNearby(playerId, client.playerId)) {
          this.send(client, { type: 'emote', playerId, emote: message.emote });
        }
      }
      return;
    }

    const chatTimes = socket.chatTimes ?? [];
    socket.chatTimes = chatTimes.filter((time) => now - time < 10_000);
    if (socket.chatTimes.length >= 4 || (chatTimes.at(-1) && now - chatTimes.at(-1)! < 700)) {
      return this.send(socket, { type: 'error', error: 'You are sending messages too quickly.' });
    }
    socket.chatTimes.push(now);
    const position = this.presence.recent(playerId)?.position ?? [0, 0, 0];
    const profile = this.auth.profile(playerId);
    const chat = {
      type: 'chat' as const, id: randomUUID(), playerId, displayName: profile.displayName,
      text: message.text, sentAt: new Date(now).toISOString(),
    };
    this.database.connection.prepare('INSERT INTO chat_messages (id, sender_id, text, x, z, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(chat.id, playerId, chat.text, position[0], position[2], chat.sentAt);
    for (const client of this.clients) {
      if (client.playerId && (client.playerId === playerId || this.isNearby(playerId, client.playerId))) this.send(client, chat);
    }
  }

  private broadcastHealth(playerId: string, health: PlayerHealthState, state?: MovementState) {
    for (const client of this.clients) {
      if (client.playerId && (client.playerId === playerId || this.isNearby(playerId, client.playerId))) {
        this.send(client, { type: 'player-health', playerId, health, ...(state ? { state } : {}) });
      }
    }
  }

  private recoverHealth() {
    for (const recovery of this.health.recoveries()) {
      const state = recovery.respawn ? this.presence.respawn(recovery.playerId) ?? undefined : undefined;
      this.broadcastHealth(recovery.playerId, recovery.health, state);
    }
  }

  private isNearby(first: string, second: string) {
    return this.presence.nearby(first).some((record) => record.profile.id === second);
  }

  private disconnect(socket: ClientSocket) {
    const playerId = socket.playerId;
    if (!playerId || !this.clients.has(socket)) return;
    this.clients.delete(socket);
    this.presence.leave(playerId);
    this.health.leave(playerId);
    this.civic.leave(playerId);
    this.broadcast({ type: 'player-left', playerId });
  }

  private heartbeat() {
    for (const socket of this.clients) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }

  private send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  private broadcast(message: ServerMessage, exceptPlayerId?: string) {
    for (const socket of this.clients) {
      if (socket.playerId !== exceptPlayerId) this.send(socket, message);
    }
  }

  close() {
    clearInterval(this.worldTimer);
    clearInterval(this.heartbeatTimer);
    clearInterval(this.healthTimer);
    this.civicUnsubscribe();
    for (const client of this.clients) client.close(1001, 'Server shutting down');
    this.wss.close();
  }
}
