import type { NextFunction, Request, Response } from 'express';
import type { AuthService } from './services/auth-service.js';
import { DomainError } from './domain-error.js';

export function sessionToken(request: Request, auth: AuthService): string | undefined {
  const previewToken = request.headers['x-taxilib-session'];
  if (typeof previewToken === 'string' && previewToken.length > 0 && previewToken.length <= 128) return previewToken;
  const cookieToken = request.cookies?.[auth.cookieName] as string | undefined;
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return cookieToken;
}

export function requireAuth(auth: AuthService) {
  return (request: Request, _response: Response, next: NextFunction) => {
    const userId = auth.userForToken(sessionToken(request, auth));
    if (!userId) return next(new DomainError(401, 'Sign in to continue.', 'unauthorized'));
    request.playerId = userId;
    next();
  };
}

export function isOriginAllowed(
  origin: string,
  host: string | undefined,
  forwardedHost: string | string[] | undefined,
  publicOrigin?: string,
): boolean {
  try {
    const originHost = new URL(origin).host;
    const allowedHosts = new Set<string>();
    if (host) allowedHosts.add(host);
    const forwarded = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost?.split(',')[0]?.trim();
    if (forwarded) allowedHosts.add(forwarded);
    if (publicOrigin) allowedHosts.add(new URL(publicOrigin).host);
    // Compare hosts rather than schemes: TLS commonly terminates at the preview/load-balancer proxy.
    return allowedHosts.has(originHost);
  } catch {
    return false;
  }
}

export function validateOrigin(publicOrigin?: string) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const origin = request.headers.origin;
    if (!origin) return next();
    if (!isOriginAllowed(origin, request.headers.host, request.headers['x-forwarded-host'], publicOrigin)) {
      return next(new DomainError(403, 'Request origin is not allowed.', 'origin_rejected'));
    }
    next();
  };
}
