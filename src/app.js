import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiRouter } from './routes/api.js';
import { sameOrigin } from './middleware/security.js';
import { errorHandler } from './middleware/errors.js';
import { AuthService } from './services/auth-service.js';
import { MemberService } from './services/member-service.js';
import { DrawService } from './services/draw-service.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createApp({ store, config, now, chooseIndex, rateLimits = true, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({
    strictTransportSecurity: config.production ? undefined : false,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.production ? [] : null
    } }
  }));
  app.use(express.json({ limit: '16kb' }), cookieParser());
  const draw = new DrawService(store, { timezone: config.timezone, now, chooseIndex, liveDraws: Boolean(config.liveDraws) });
  app.use('/api', sameOrigin(config), apiRouter({ auth: new AuthService(store, config),
    members: new MemberService(store, config.liveDraws ? db => draw.refreshDisplay(db) : undefined), draw, config, rateLimits }));
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } }));
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/', (req, res) => res.sendFile(path.join(root, 'public', 'live.html')));
  app.get('/index.html', (req, res) => res.redirect('/'));
  app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(root, 'public', 'admin.html')));
  for (const [name, directory] of [['bootstrap', 'bootstrap/dist'], ['sweetalert2', 'sweetalert2/dist'], ['confetti', 'canvas-confetti/dist']]) {
    app.use(`/vendor/${name}`, express.static(path.join(root, 'node_modules', directory), { index: false, maxAge: '1d', dotfiles: 'deny' }));
  }
  app.use(express.static(path.join(root, 'public'), { etag: true, maxAge: 0, dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).type('text').send('Page not found.'));
  app.use(errorHandler(logger));
  return app;
}
