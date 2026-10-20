import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../utils/errors.js';

// Opaque, HttpOnly administrator session cookie.
export const SESSION_COOKIE = '__session';

export function sameOrigin(config) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('sec-fetch-site') === 'cross-site' || (req.get('origin') && req.get('origin') !== config.origin)) {
      return next(new AppError(403, 'INVALID_ORIGIN', 'This request must come from the application.'));
    }
    if (!req.is('application/json')) return next(new AppError(415, 'JSON_REQUIRED', 'Send an application/json request.'));
    next();
  };
}

export function requireAuth(auth) {
  return async (req, res, next) => {
    const session = await auth.session(req.cookies[SESSION_COOKIE]);
    if (!session) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    req.auth = session;
    next();
  };
}

export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const actual = Buffer.from(req.get('X-CSRF-Token') || '');
  const expected = Buffer.from(req.auth.csrfToken);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return next(new AppError(403, 'INVALID_CSRF', 'Your session could not be verified. Refresh and try again.'));
  }
  next();
}
