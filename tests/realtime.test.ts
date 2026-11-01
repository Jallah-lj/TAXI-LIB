import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { Database } from '../src/server/db/database';
import { seedDatabase } from '../src/server/db/seed';
import { AuthService } from '../src/server/services/auth-service';
import { PlayerService } from '../src/server/services/player-service';
import { PresenceService } from '../src/server/services/presence-service';
import { TaxiService } from '../src/server/services/taxi-service';
import { LifestyleService } from '../src/server/services/lifestyle-service';
import { CitizenTaskService } from '../src/server/services/citizen-task-service';
import { CivicService } from '../src/server/services/civic-service';
import { createApp } from '../src/server/app';
import { RealtimeGateway } from '../src/server/realtime/gateway';
import type { AppConfig } from '../src/server/config';
import type { ServerMessage } from '../src/shared/protocol';
import { PLAYER_SPAWN } from '../src/shared/world';
import { RealtimeTicketService } from '../src/server/realtime/ticket-service';

const config: AppConfig = { port: 0, host: '127.0.0.1', databasePath: ':memory:', sessionTtlDays: 7, isProduction: false };

describe('two-client realtime district', () => {
  let database: Database;
  let server: Server;
  let gateway: RealtimeGateway;
  let auth: AuthService;
  let players: PlayerService;
  let lifestyle: LifestyleService;
  let tasks: CitizenTaskService;
  let civic: CivicService;
  let tickets: RealtimeTicketService;
  let port: number;
  const sockets: WebSocket[] = [];

  beforeEach(async () => {
    database = new Database(':memory:');
    seedDatabase(database);
    auth = new AuthService(database);
    players = new PlayerService(database, auth);
    const presence = new PresenceService();
    const taxi = new TaxiService(database, players, presence);
    tickets = new RealtimeTicketService();
    lifestyle = new LifestyleService(database, players, presence);
    tasks = new CitizenTaskService(database, players, presence);
    civic = new CivicService(database, players, presence);
    const app = createApp({ database, auth, players, taxi, lifestyle, tasks, civic, tickets, config });
    server = createServer(app);
    gateway = new RealtimeGateway(server, database, auth, players, presence, civic, tickets);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'object' && address) port = address.port;
  });

  afterEach(async () => {
    sockets.forEach((socket) => socket.close());
    gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    database.close();
  });

  function connect(token: string, received: ServerMessage[]) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: `${auth.cookieName}=${token}` } });
    sockets.push(socket);
    socket.on('message', (data) => received.push(JSON.parse(data.toString()) as ServerMessage));
    return new Promise<WebSocket>((resolve, reject) => { socket.on('open', () => resolve(socket)); socket.on('error', reject); });
  }

  async function waitFor(received: ServerMessage[], type: ServerMessage['type'], predicate: (message: ServerMessage) => boolean = () => true) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const message = received.find((entry) => entry.type === type && predicate(entry));
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }

  it('authenticates sockets, replicates movement and delivers proximity chat', async () => {
    const first = await auth.register('network_one', 'safe-password', 'Network One');
    const second = await auth.register('network_two', 'safe-password', 'Network Two');
    const firstMessages: ServerMessage[] = [];
    const secondMessages: ServerMessage[] = [];
    const firstSocket = await connect(first.token, firstMessages);
    await connect(second.token, secondMessages);
    await waitFor(firstMessages, 'welcome');
    await waitFor(secondMessages, 'snapshot');
    firstSocket.send(JSON.stringify({ type: 'state', position: [12, 0, 42], heading: 0, speed: 0, mode: 'walking', sequence: 1 }));
    const replicated = await waitFor(secondMessages, 'player-state');
    expect(replicated.type).toBe('player-state');
    if (replicated.type === 'player-state') expect(replicated.state.playerId).toBe(first.userId);
    firstSocket.send(JSON.stringify({ type: 'chat', text: 'See you at the taxi stand.' }));
    const delivered = await waitFor(secondMessages, 'chat');
    expect(delivered.type).toBe('chat');
    if (delivered.type === 'chat') expect(delivered.text).toBe('See you at the taxi stand.');
    expect(database.connection.prepare('SELECT COUNT(*) AS count FROM chat_messages').get()).toMatchObject({ count: 1 });
  });

  it('refreshes home ownership after purchase and replicates interior and headlight state', async () => {
    const owner = await auth.register('home_network', 'safe-password', 'Home Network');
    const observer = await auth.register('home_observer', 'safe-password', 'Home Observer');
    const ownerMessages: ServerMessage[] = [];
    const observerMessages: ServerMessage[] = [];
    const ownerSocket = await connect(owner.token, ownerMessages);
    await connect(observer.token, observerMessages);
    await waitFor(ownerMessages, 'welcome');
    await waitFor(observerMessages, 'snapshot');

    // The socket's initial property cache is empty; the first indoor state must refresh it.
    const purchased = lifestyle.purchaseProperty(owner.userId, 'sinkor-studio', randomUUID());
    const propertyId = purchased.properties[0]!.id;
    ownerSocket.send(JSON.stringify({ type: 'state', position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'walking', interiorPropertyId: propertyId, sequence: 1 }));
    const indoor = await waitFor(observerMessages, 'player-state', (message) => message.type === 'player-state' && message.state.sequence === 1);
    expect(indoor).toMatchObject({ type: 'player-state', state: { playerId: owner.userId, interiorPropertyId: propertyId } });

    const vehicleId = players.vehicles(owner.userId)[0]!.id;
    ownerSocket.send(JSON.stringify({ type: 'state', position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, lightsOn: true, sequence: 2 }));
    const headlights = await waitFor(observerMessages, 'player-state', (message) => message.type === 'player-state' && message.state.sequence === 2);
    expect(headlights).toMatchObject({ type: 'player-state', state: { vehicleId, lightsOn: true } });
    if (headlights.type === 'player-state') expect(headlights.state.interiorPropertyId).toBeUndefined();

    ownerSocket.send(JSON.stringify({ type: 'state', position: [PLAYER_SPAWN.x, 0.14, PLAYER_SPAWN.z], heading: 0, speed: 0, mode: 'driving', vehicleId, lightsOn: false, sequence: 3 }));
    const lightsOff = await waitFor(observerMessages, 'player-state', (message) => message.type === 'player-state' && message.state.sequence === 3);
    expect(lightsOff).toMatchObject({ type: 'player-state', state: { vehicleId, lightsOn: false } });
  });

  it('broadcasts civic incident assignment to connected citizens', async () => {
    const first = await auth.register('civic_network_one', 'safe-password', 'Civic Network One');
    const second = await auth.register('civic_network_two', 'safe-password', 'Civic Network Two');
    const firstMessages: ServerMessage[] = [];
    const secondMessages: ServerMessage[] = [];
    await connect(first.token, firstMessages);
    await connect(second.token, secondMessages);
    await waitFor(firstMessages, 'civic-incidents');
    await waitFor(secondMessages, 'civic-incidents');
    const incident = civic.incidents().find((entry) => entry.status === 'open')!;
    tasks.accept(first.userId, incident.templateId, randomUUID(), incident.id);
    civic.publish();
    const assigned = (message: ServerMessage) => message.type === 'civic-incidents'
      && message.incidents.some((entry) => entry.id === incident.id && entry.status === 'assigned');
    await waitFor(firstMessages, 'civic-incidents', assigned);
    await waitFor(secondMessages, 'civic-incidents', assigned);
    expect(civic.incidents().find((entry) => entry.id === incident.id)?.status).toBe('assigned');
  });

  it('issues player health from accepted vehicle movement rather than an impact claim', async () => {
    const driver = await auth.register('health_driver', 'safe-password', 'Health Driver');
    const victim = await auth.register('health_victim', 'safe-password', 'Health Victim');
    const driverMessages: ServerMessage[] = [];
    const victimMessages: ServerMessage[] = [];
    const driverSocket = await connect(driver.token, driverMessages);
    const victimSocket = await connect(victim.token, victimMessages);
    await waitFor(driverMessages, 'welcome');
    await waitFor(victimMessages, 'welcome');
    victimSocket.send(JSON.stringify({ type: 'state', position: [12, 0, 44], heading: 0, speed: 0, mode: 'walking', sequence: 1 }));
    await waitFor(driverMessages, 'player-state', (message) => message.type === 'player-state' && message.state.playerId === victim.userId);
    const vehicleId = players.vehicles(driver.userId)[0]!.id;
    driverSocket.send(JSON.stringify({ type: 'state', position: [12, 0, 42], heading: 0, speed: 0, mode: 'driving', vehicleId, sequence: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 180));
    driverSocket.send(JSON.stringify({ type: 'state', position: [12, 0, 43], heading: 0, speed: 6, mode: 'driving', vehicleId, sequence: 2 }));
    const health = await waitFor(victimMessages, 'player-health', (message) => message.type === 'player-health' && message.playerId === victim.userId && message.health.condition !== 'healthy');
    expect(health).toMatchObject({ type: 'player-health', playerId: victim.userId });
    if (health.type === 'player-health') expect(health.health.impactSpeedKmh).toBeGreaterThan(0);
  });

  it('accepts a single-use realtime ticket without relying on cookies', async () => {
    const account = await auth.register('ticket_driver', 'safe-password', 'Ticket Driver');
    const issued = tickets.issue(account.userId);
    const messages: ServerMessage[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(issued.ticket)}`);
    sockets.push(socket);
    socket.on('message', (data) => messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => { socket.on('open', () => resolve()); socket.on('error', reject); });
    const welcome = await waitFor(messages, 'welcome');
    expect(welcome.type).toBe('welcome');
    if (welcome.type === 'welcome') expect(welcome.playerId).toBe(account.userId);

    const replay = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${encodeURIComponent(issued.ticket)}`);
    sockets.push(replay);
    const error = await new Promise<Error>((resolve) => replay.on('error', resolve));
    expect(error.message).toMatch(/401/);
  });

  it('refuses an unauthenticated socket upgrade', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    sockets.push(socket);
    const error = await new Promise<Error>((resolve) => socket.on('error', resolve));
    expect(error.message).toMatch(/401/);
  });
});
