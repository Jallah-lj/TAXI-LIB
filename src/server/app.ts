import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ZodType } from 'zod';
import type { AppConfig } from './config.js';
import type { Database } from './db/database.js';
import { AuthService } from './services/auth-service.js';
import { PlayerService } from './services/player-service.js';
import { TaxiService } from './services/taxi-service.js';
import type { LifestyleService } from './services/lifestyle-service.js';
import type { CitizenTaskService } from './services/citizen-task-service.js';
import type { CivicService } from './services/civic-service.js';
import { DomainError } from './domain-error.js';
import { requireAuth, sessionToken, validateOrigin } from './http.js';
import {
  appearanceSchema, onboardingSchema, acceptJobSchema, loginSchema, registerSchema, purchasePropertySchema, upgradePropertySchema,
  purchaseVehicleSchema, upgradeVehicleSchema, selectVehicleSchema,
  acceptCitizenTaskSchema, advanceCitizenTaskSchema, cancelCitizenTaskSchema, reportCivicIncidentSchema,
} from '../shared/validation.js';
import type { RealtimeTicketService } from './realtime/ticket-service.js';

interface AppServices {
  database: Database;
  auth: AuthService;
  players: PlayerService;
  taxi: TaxiService;
  lifestyle: LifestyleService;
  tasks: CitizenTaskService;
  civic: CivicService;
  tickets: RealtimeTicketService;
  config: AppConfig;
}

function body<T>(schema: ZodType<T>, request: Request): T {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? 'Invalid request.';
    throw new DomainError(400, message, 'validation_error');
  }
  return result.data;
}

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (response.headersSent) return;
  if (error instanceof DomainError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({ error: 'Malformed JSON request.', code: 'invalid_json' });
    return;
  }
  console.error(JSON.stringify({ level: 'error', message: 'request_failed', path: request.path, error: error instanceof Error ? error.message : String(error) }));
  response.status(500).json({ error: 'The server could not complete that request.', code: 'internal_error' });
};

export function createApp({ database, auth, players, taxi, lifestyle, tasks, civic, tickets, config }: AppServices) {
  civic.bootstrap();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: config.isProduction ? {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'ws:', 'wss:'], workerSrc: ["'self'", 'blob:'],
      },
    } : false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (request, response, next) => {
    if (!['/auth/login', '/auth/register', '/session', '/world', '/realtime/ticket'].includes(request.path)) return next();
    response.on('finish', () => {
      console.log(JSON.stringify({
        level: 'info', message: 'auth_request', method: request.method, path: request.path, status: response.statusCode,
        hasCookie: Boolean(request.headers.cookie), hasBearer: Boolean(request.headers.authorization),
        hasPreviewSession: Boolean(request.headers['x-taxilib-session']),
      }));
    });
    next();
  });
  app.use(validateOrigin(config.publicOrigin));
  app.use('/api', rateLimit({ windowMs: 5 * 60_000, limit: 400, standardHeaders: 'draft-8', legacyHeaders: false }));
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
  const publicOrigin = config.publicOrigin ? new URL(config.publicOrigin) : null;
  const embeddedPreview = publicOrigin?.protocol === 'https:'
    && (publicOrigin.hostname === 'e2b.app' || publicOrigin.hostname.endsWith('.e2b.app'));
  const sessionCookieOptions = (request: Request) => ({
    httpOnly: true,
    sameSite: embeddedPreview ? 'none' as const : 'lax' as const,
    secure: embeddedPreview || (config.isProduction && request.secure),
    partitioned: embeddedPreview,
    path: '/',
  });

  const setSession = (request: Request, response: Response, token: string, expires: Date) => {
    response.cookie(auth.cookieName, token, {
      ...sessionCookieOptions(request), expires,
    });
  };

  app.get('/health', (_request, response) => {
    const check = database.connection.prepare('SELECT 1 AS ok').get() as { ok: number };
    response.json({ status: check.ok === 1 ? 'ok' : 'degraded', service: 'taxi-lib', time: new Date().toISOString() });
  });

  app.post('/api/auth/register', authLimiter, async (request, response) => {
    const input = body(registerSchema, request);
    const session = await auth.register(input.handle, input.password, input.displayName);
    setSession(request, response, session.token, session.expires);
    response.status(201).json({ player: auth.profile(session.userId), ...(embeddedPreview ? { sessionToken: session.token } : {}) });
  });

  app.post('/api/auth/login', authLimiter, async (request, response) => {
    const input = body(loginSchema, request);
    const session = await auth.login(input.handle, input.password);
    setSession(request, response, session.token, session.expires);
    response.json({ player: auth.profile(session.userId), ...(embeddedPreview ? { sessionToken: session.token } : {}) });
  });

  app.post('/api/auth/logout', (request, response) => {
    auth.logout(sessionToken(request, auth));
    response.clearCookie(auth.cookieName, sessionCookieOptions(request));
    response.status(204).end();
  });

  app.get('/api/session', requireAuth(auth), (request, response) => {
    response.json({ player: auth.profile(request.playerId!) });
  });

  app.post('/api/realtime/ticket', requireAuth(auth), (request, response) => {
    response.json(tickets.issue(request.playerId!));
  });

  app.patch('/api/profile/appearance', requireAuth(auth), (request, response) => {
    const appearance = body(appearanceSchema, request);
    response.json({ player: auth.updateAppearance(request.playerId!, appearance) });
  });

  app.put('/api/profile/onboarding', requireAuth(auth), (request, response) => {
    const input = body(onboardingSchema, request);
    response.json({ player: auth.updateOnboarding(request.playerId!, input.status) });
  });

  app.get('/api/world', requireAuth(auth), (request, response) => {
    const userId = request.playerId!;
    response.json(players.bootstrap(userId, taxi.availableJobs(), taxi.activeTrip(userId), tasks.state(userId), civic.state(userId)));
  });

  app.get('/api/tasks', requireAuth(auth), (request, response) => {
    response.json(tasks.state(request.playerId!));
  });

  app.get('/api/civic', requireAuth(auth), (request, response) => {
    response.json(civic.state(request.playerId!));
  });

  app.post('/api/civic/reports', requireAuth(auth), (request, response) => {
    const input = body(reportCivicIncidentSchema, request);
    response.status(201).json(civic.report(request.playerId!, input.siteId, input.requestId));
  });

  app.post('/api/tasks/accept', requireAuth(auth), (request, response) => {
    const input = body(acceptCitizenTaskSchema, request);
    const result = tasks.accept(request.playerId!, input.templateId, input.requestId, input.incidentId);
    civic.publish();
    response.status(201).json(result);
  });

  app.post('/api/tasks/:id/advance', requireAuth(auth), (request, response) => {
    const input = body(advanceCitizenTaskSchema, request);
    const result = tasks.advance(request.playerId!, request.params.id as string, input.stepId, input.position, input.requestId);
    civic.publish();
    response.json(result);
  });

  app.post('/api/tasks/:id/cancel', requireAuth(auth), (request, response) => {
    const input = body(cancelCitizenTaskSchema, request);
    const result = tasks.cancel(request.playerId!, request.params.id as string, input.requestId);
    civic.publish();
    response.json(result);
  });

  app.get('/api/taxi/jobs', requireAuth(auth), (_request, response) => {
    response.json({ jobs: taxi.availableJobs() });
  });

  app.post('/api/taxi/jobs/:id/accept', requireAuth(auth), (request, response) => {
    const input = body(acceptJobSchema, request);
    response.status(201).json({ trip: taxi.accept(request.playerId!, request.params.id as string, input.vehicleId) });
  });

  app.post('/api/taxi/trips/:id/pickup', requireAuth(auth), (request, response) => {
    response.json({ trip: taxi.pickup(request.playerId!, request.params.id as string) });
  });

  app.post('/api/taxi/trips/:id/complete', requireAuth(auth), (request, response) => {
    response.json(taxi.complete(request.playerId!, request.params.id as string));
  });

  app.post('/api/taxi/trips/:id/cancel', requireAuth(auth), (request, response) => {
    response.json({ trip: taxi.cancel(request.playerId!, request.params.id as string) });
  });

  app.post('/api/lifestyle/properties/purchase', requireAuth(auth), (request, response) => {
    const input = body(purchasePropertySchema, request);
    response.status(201).json(lifestyle.purchaseProperty(request.playerId!, input.listingId, input.requestId));
  });

  app.post('/api/lifestyle/properties/upgrade', requireAuth(auth), (request, response) => {
    const input = body(upgradePropertySchema, request);
    response.json(lifestyle.upgradeProperty(request.playerId!, input.propertyId, input.requestId));
  });

  app.post('/api/lifestyle/vehicles/purchase', requireAuth(auth), (request, response) => {
    const input = body(purchaseVehicleSchema, request);
    response.status(201).json(lifestyle.purchaseVehicle(request.playerId!, input.modelId, input.requestId, input.configuration));
  });

  app.post('/api/lifestyle/vehicles/upgrade', requireAuth(auth), (request, response) => {
    const input = body(upgradeVehicleSchema, request);
    response.json(lifestyle.upgradeVehicle(request.playerId!, input.vehicleId, input.kind, input.requestId));
  });

  app.post('/api/lifestyle/vehicles/select', requireAuth(auth), (request, response) => {
    const input = body(selectVehicleSchema, request);
    response.json(lifestyle.selectVehicle(request.playerId!, input.vehicleId, input.requestId));
  });

  app.get('/api/wallet', requireAuth(auth), (request, response) => {
    response.json({ wallet: players.wallet(request.playerId!), ledger: players.ledger(request.playerId!) });
  });

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.', code: 'not_found' }));
  app.use(errorHandler);
  return app;
}
