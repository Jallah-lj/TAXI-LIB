import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { Database } from './db/database.js';
import { seedDatabase } from './db/seed.js';
import { AuthService } from './services/auth-service.js';
import { PlayerService } from './services/player-service.js';
import { PresenceService } from './services/presence-service.js';
import { TaxiService } from './services/taxi-service.js';
import { LifestyleService } from './services/lifestyle-service.js';
import { CitizenTaskService } from './services/citizen-task-service.js';
import { CivicService } from './services/civic-service.js';
import { createApp } from './app.js';
import { RealtimeGateway } from './realtime/gateway.js';
import { RealtimeTicketService } from './realtime/ticket-service.js';

const config = loadConfig();
const database = new Database(config.databasePath);
seedDatabase(database);
const auth = new AuthService(database, config.sessionTtlDays);
const players = new PlayerService(database, auth);
const presence = new PresenceService();
const taxi = new TaxiService(database, players, presence);
const lifestyle = new LifestyleService(database, players, presence);
const tasks = new CitizenTaskService(database, players, presence);
tasks.bootstrap();
const civic = new CivicService(database, players, presence);
const tickets = new RealtimeTicketService();
const app = createApp({ database, auth, players, taxi, lifestyle, tasks, civic, tickets, config });
const server = createServer(app);
const realtime = new RealtimeGateway(server, database, auth, players, presence, civic, tickets, config.publicOrigin);

if (config.isProduction) {
  const clientRoot = resolve(process.cwd(), 'dist/client');
  if (!existsSync(clientRoot)) throw new Error('Production client is missing. Run npm run build first.');
  app.use(express.static(clientRoot, { maxAge: '1h', etag: true }));
  app.use((request, response, next) => {
    if (request.method !== 'GET' || request.path.startsWith('/api') || request.path === '/ws') return next();
    response.sendFile(resolve(clientRoot, 'index.html'));
  });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server }, allowedHosts: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: 'info', message: 'taxi_lib_listening', host: config.host, port: config.port, mode: config.isProduction ? 'production' : 'development' }));
});

const shutdown = () => {
  realtime.close();
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
