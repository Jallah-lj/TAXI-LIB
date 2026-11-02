import { resolve } from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  sessionTtlDays: number;
  isProduction: boolean;
  publicOrigin?: string;
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3000);
  const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  if (!Number.isFinite(sessionTtlDays) || sessionTtlDays < 1 || sessionTtlDays > 90) throw new Error('SESSION_TTL_DAYS must be between 1 and 90.');
  return {
    port,
    host: process.env.HOST ?? '0.0.0.0',
    databasePath: resolve(process.env.DATABASE_PATH ?? './data/taxi-lib.sqlite'),
    sessionTtlDays,
    isProduction: process.env.NODE_ENV === 'production',
    publicOrigin: process.env.PUBLIC_ORIGIN
      ?? (process.env.E2B_SANDBOX_ID ? `https://${port}-${process.env.E2B_SANDBOX_ID}.e2b.app` : undefined),
  };
}
