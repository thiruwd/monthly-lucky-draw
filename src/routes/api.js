import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireCsrf, SESSION_COOKIE } from '../middleware/security.js';
import { memberRules, idRules, statusRules, loginRules, passwordRules, spinRules, historyRules, onlyBodyKeys, validate } from '../middleware/validation.js';
import { memberController } from '../controllers/member-controller.js';
import { drawController } from '../controllers/draw-controller.js';

export function apiRouter({ auth, members, draw, config, rateLimits = true }) {
  const router = Router();
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.production, path: '/', maxAge: config.sessionHours * 3600000 };
  const limit = (max, windowMs) => rateLimits ? rateLimit({ windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait before trying again.' } }) }) : (req, res, next) => next();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/public/draw', limit(6000, 60000), async (req, res) => res.json(await draw.publicState()));
  router.use(limit(300, 60000));
  router.post('/auth/login', limit(10, 15 * 60000), onlyBodyKeys(['username', 'password']), loginRules, validate, async (req, res) => {
    const result = await auth.login(req.validated.username, req.validated.password);
    if (req.cookies[SESSION_COOKIE] && /^[a-f0-9]{64}$/.test(req.cookies[SESSION_COOKIE])) await auth.logout(req.cookies[SESSION_COOKIE]);
    res.cookie(SESSION_COOKIE, result.token, cookieOptions).json({ admin: result.admin, csrfToken: result.csrfToken, timezone: config.timezone });
  });
  router.use(requireAuth(auth), requireCsrf);
  router.get('/auth/session', (req, res) => res.json({ ...req.auth, timezone: config.timezone }));
  router.post('/auth/password', limit(5, 15 * 60000), onlyBodyKeys(['current_password', 'new_password', 'confirm_password']), passwordRules, validate, async (req, res) => {
    await auth.changePassword(req.auth.admin.id, req.validated.current_password, req.validated.new_password);
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined }).json({ message: 'Password changed. Please sign in with your new password.' });
  });
  router.post('/auth/logout', onlyBodyKeys([]), async (req, res) => {
    await auth.logout(req.cookies[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined }).status(204).end();
  });
  const member = memberController(members);
  router.get('/members', member.list);
  router.post('/members', onlyBodyKeys(['name', 'member_code', 'email', 'is_active']), memberRules, validate, member.create);
  router.put('/members/:id', onlyBodyKeys(['name', 'member_code', 'email', 'is_active']), idRules, memberRules, validate, member.update);
  router.patch('/members/:id/status', onlyBodyKeys(['is_active']), idRules, statusRules, validate, member.status);
  router.delete('/members/:id', onlyBodyKeys([]), idRules, validate, member.remove);
  const luckyDraw = drawController(draw);
  router.get('/lucky-draw/eligible', luckyDraw.eligible);
  router.get('/lucky-draw/status', luckyDraw.status);
  router.get('/lucky-draw/winners', historyRules, validate, luckyDraw.winners);
  router.post('/lucky-draw/spin', limit(20, 60000), onlyBodyKeys([]), spinRules, validate, luckyDraw.spin);
  return router;
}
