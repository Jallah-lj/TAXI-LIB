import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
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
import type { AppConfig } from '../src/server/config';
import { RealtimeTicketService } from '../src/server/realtime/ticket-service';

const config: AppConfig = { port: 0, host: '127.0.0.1', databasePath: ':memory:', sessionTtlDays: 7, isProduction: false };

describe('account and world API', () => {
  let database: Database;
  let app: Express;

  beforeEach(() => {
    database = new Database(':memory:');
    seedDatabase(database);
    const auth = new AuthService(database);
    const players = new PlayerService(database, auth);
    const presence = new PresenceService();
    const taxi = new TaxiService(database, players, presence);
    const lifestyle = new LifestyleService(database, players, presence);
    const tasks = new CitizenTaskService(database, players, presence);
    const civic = new CivicService(database, players, presence);
    app = createApp({ database, auth, players, taxi, lifestyle, tasks, civic, tickets: new RealtimeTicketService(), config });
  });
  afterEach(() => database.close());

  it('registers, restores a session, saves appearance and protects world APIs', async () => {
    const agent = request.agent(app);
    const registered = await agent.post('/api/auth/register').send({ handle: 'api_driver', password: 'safe-password', displayName: 'API Driver' }).expect(201);
    expect(registered.body.player.handle).toBe('api_driver');
    const world = await agent.get('/api/world').expect(200);
    expect(world.headers['cache-control']).toBe('no-store');
    expect(world.body.wallet.balanceLrd).toBe(12500);
    expect(world.body.vehicles).toHaveLength(1);
    expect(world.body.jobs.length).toBeGreaterThan(0);
    expect(world.body.disclaimer).toMatch(/Fictionalized/);
    const appearance = { skin: 4, hair: 1, top: 3, bottom: 2 };
    await agent.patch('/api/profile/appearance').send(appearance).expect(200);
    const restored = await agent.get('/api/session').expect(200);
    expect(restored.body.player.appearance).toEqual(appearance);
    await request(app).get('/api/world').expect(401);
  });

  it('validates credentials and duplicate handles', async () => {
    await request(app).post('/api/auth/register').send({ handle: 'bad handle!', password: 'short', displayName: 'X' }).expect(400);
    await request(app).post('/api/auth/register').send({ handle: 'unique_driver', password: 'safe-password', displayName: 'Unique Driver' }).expect(201);
    await request(app).post('/api/auth/register').send({ handle: 'unique_driver', password: 'safe-password', displayName: 'Other Driver' }).expect(409);
    await request(app).post('/api/auth/login').send({ handle: 'unique_driver', password: 'wrong-password' }).expect(401);
  });

  it('accepts the public preview origin through a TLS-terminating reverse proxy', async () => {
    await request(app)
      .post('/api/auth/register')
      .set('Host', 'internal:3000')
      .set('X-Forwarded-Host', '3000-preview.e2b.app')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://3000-preview.e2b.app')
      .send({ handle: 'proxy_driver', password: 'safe-password', displayName: 'Proxy Driver' })
      .expect(201);
  });

  it('issues a secure partitioned session cookie for the embedded hosted preview', async () => {
    const auth = new AuthService(database);
    const players = new PlayerService(database, auth);
    const previewPresence = new PresenceService();
    const previewApp = createApp({
      database, auth, players, taxi: new TaxiService(database, players, previewPresence),
      lifestyle: new LifestyleService(database, players, previewPresence),
      tasks: new CitizenTaskService(database, players, previewPresence), civic: new CivicService(database, players, previewPresence), tickets: new RealtimeTicketService(),
      config: { ...config, publicOrigin: 'https://3000-preview.e2b.app' },
    });
    const response = await request(previewApp)
      .post('/api/auth/register')
      .set('Origin', 'https://3000-preview.e2b.app')
      .send({ handle: 'cookie_driver', password: 'safe-password', displayName: 'Cookie Driver' })
      .expect(201);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Partitioned');
    const sessionToken = response.body.sessionToken as string;
    expect(sessionToken).toBeTruthy();
    await request(previewApp).get('/api/world').set('Authorization', `Bearer ${sessionToken}`).expect(200);
    await request(previewApp).get('/api/world').set('X-TaxiLib-Session', sessionToken).set('Authorization', 'Bearer replaced-by-proxy').expect(200);
    const ticket = await request(previewApp).post('/api/realtime/ticket').set('X-TaxiLib-Session', sessionToken).expect(200);
    expect(ticket.body.ticket).toBeTruthy();
  });

  it('persists lifestyle purchases through authenticated, idempotent API routes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ handle: 'lifestyle_api', password: 'safe-password', displayName: 'Lifestyle API' }).expect(201);
    const requestId = randomUUID();
    const purchased = await agent.post('/api/lifestyle/properties/purchase').send({ listingId: 'sinkor-studio', requestId }).expect(201);
    expect(purchased.body.duplicate).toBe(false);
    expect(purchased.body.wallet.balanceLrd).toBe(5000);
    expect(purchased.body.properties[0].listingId).toBe('sinkor-studio');
    const replay = await agent.post('/api/lifestyle/properties/purchase').send({ listingId: 'sinkor-studio', requestId }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.wallet.balanceLrd).toBe(5000);
    const world = await agent.get('/api/world').expect(200);
    expect(world.body.garageCapacity).toBe(3);
    expect(world.body.properties).toHaveLength(1);
    await request(app).post('/api/lifestyle/vehicles/purchase').send({ modelId: 'city-hatchback', requestId: randomUUID() }).expect(401);
  });

  it('validates and persists showroom configuration through the authoritative purchase API', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ handle: 'showroom_api', password: 'safe-password', displayName: 'Showroom API' }).expect(201);
    const requestId = randomUUID();
    const configuration = { paintId: 'pearl', finish: 'metallic' };
    const purchased = await agent.post('/api/lifestyle/vehicles/purchase').send({ modelId: 'city-hatchback', requestId, configuration }).expect(201);
    expect(purchased.body.wallet.balanceLrd).toBe(1050);
    const vehicle = purchased.body.vehicles.find((entry: { modelId: string }) => entry.modelId === 'city-hatchback');
    expect(vehicle).toMatchObject({ paintId: 'pearl', finish: 'metallic', color: '#e8e6df' });
    const replay = await agent.post('/api/lifestyle/vehicles/purchase').send({ modelId: 'city-hatchback', requestId, configuration }).expect(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.wallet.balanceLrd).toBe(1050);
    await agent.post('/api/lifestyle/vehicles/purchase').send({ modelId: 'modern-sedan', requestId: randomUUID(), configuration: { paintId: 'pearl', finish: 'toString' } }).expect(400);
    const world = await agent.get('/api/world').expect(200);
    expect(world.body.wallet.balanceLrd).toBe(1050);
    expect(world.body.vehicles.find((entry: { id: string }) => entry.id === vehicle.id)).toMatchObject(configuration);
  });

  it('accepts, replays and cancels citizen tasks while enforcing taxi exclusivity', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ handle: 'task_api', password: 'safe-password', displayName: 'Task API' }).expect(201);
    const initial = await agent.get('/api/world').expect(200);
    const acceptBody = { templateId: 'market-restock', requestId: randomUUID() };
    const accepted = await agent.post('/api/tasks/accept').send(acceptBody).expect(201);
    expect(accepted.body).toMatchObject({ duplicate: false, activeTask: { templateId: 'market-restock', stepIndex: 0, status: 'active' }, wallet: { balanceLrd: 12500 } });
    const replay = await agent.post('/api/tasks/accept').send(acceptBody).expect(201);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.activeTask.id).toBe(accepted.body.activeTask.id);
    await agent.post('/api/tasks/accept').send({ templateId: 'beach-cleanup', requestId: randomUUID() }).expect(409);
    const job = initial.body.jobs[0];
    await agent.post(`/api/taxi/jobs/${job.id}/accept`).send({ vehicleId: initial.body.selectedVehicleId }).expect(409);

    const cancelBody = { requestId: randomUUID() };
    const cancelled = await agent.post(`/api/tasks/${accepted.body.activeTask.id}/cancel`).send(cancelBody).expect(200);
    expect(cancelled.body).toMatchObject({ duplicate: false, activeTask: null, task: { status: 'cancelled' }, wallet: { balanceLrd: 12500 } });
    const cancelReplay = await agent.post(`/api/tasks/${accepted.body.activeTask.id}/cancel`).send(cancelBody).expect(200);
    expect(cancelReplay.body.duplicate).toBe(true);
    const trip = await agent.post(`/api/taxi/jobs/${job.id}/accept`).send({ vehicleId: initial.body.selectedVehicleId }).expect(201);
    expect(trip.body.trip.status).toBe('accepted');
    await agent.post('/api/tasks/accept').send({ templateId: 'clinic-supply-run', requestId: randomUUID() }).expect(409);
  });

  it('rejects cross-origin mutations and exposes a real health check', async () => {
    await request(app).post('/api/auth/login').set('Origin', 'https://attacker.invalid').send({ handle: 'some_driver', password: 'password' }).expect(403);
    const health = await request(app).get('/health').expect(200);
    expect(health.body.status).toBe('ok');
  });
});
