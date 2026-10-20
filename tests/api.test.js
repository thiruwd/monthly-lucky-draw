import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/utils/password.js';
import { MemoryStore } from './helpers/memory-store.js';

const password = 'test-only-strong-password';
const passwordHash = await hashPassword(password);
export const testConfig = { production: false, origin: 'http://127.0.0.1:3000', timezone: 'Asia/Kolkata', sessionHours: 8, trustProxy: 0 };
describe('authenticated REST API', () => {
  let app, agent, csrf, store;
  beforeEach(async () => {
    store = new MemoryStore(); store.admins.push({ id: '1', username: 'admin', password_hash: passwordHash });
    app = createApp({ store, config: testConfig, rateLimits: false, now: () => new Date('2026-10-20T08:00:00Z'), logger: { error() {} } });
    agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    csrf = login.body.csrfToken;
  });
  const data = { name: '  Priya Iyer  ', member_code: 'MEM-001', email: 'priya@example.com', is_active: true };
  it('adds, sanitizes, and lists members', async () => {
    const created = await agent.post('/api/members').set('X-CSRF-Token', csrf).send(data).expect(201);
    expect(created.body.member.name).toBe('Priya Iyer');
    expect(created.body.member.id).toEqual(expect.any(String));
    const list = await agent.get('/api/members').expect(200);
    expect(list.body.members).toHaveLength(1);
    expect(list.headers['cache-control']).toBe('no-store');
  });
  it('edits, deactivates, and deletes participants', async () => {
    const created = await agent.post('/api/members').set('X-CSRF-Token', csrf).send(data);
    const id = created.body.member.id;
    await agent.put(`/api/members/${id}`).set('X-CSRF-Token', csrf).send({ ...data, name: 'New name' }).expect(200);
    await agent.patch(`/api/members/${id}/status`).set('X-CSRF-Token', csrf).send({ is_active: false }).expect(200);
    expect((await agent.get('/api/lucky-draw/eligible')).body.participants).toHaveLength(0);
    await agent.delete(`/api/members/${id}`).set('X-CSRF-Token', csrf).send({}).expect(204);
    expect((await agent.get('/api/members')).body.members).toHaveLength(0);
  });
  it('requires authentication and CSRF protection', async () => {
    await request(app).get('/api/members').expect(401);
    await request(app).post('/api/lucky-draw/spin').send({}).expect(401);
    await agent.post('/api/members').send(data).expect(403);
    await agent.post('/api/members').set('X-CSRF-Token', 'wrong').send(data).expect(403);
    await agent.post('/api/members').set('Origin', 'https://other.example').set('X-CSRF-Token', csrf).send(data).expect(403);
  });
  it('uses secure session attributes, revokes logout, and never sends a database credential', async () => {
    const session = await agent.get('/api/auth/session').expect(200);
    expect(session.body).toEqual({ admin: { id: '1', username: 'admin' }, csrfToken: csrf, timezone: 'Asia/Kolkata' });
    await agent.post('/api/auth/logout').set('X-CSRF-Token', csrf).send({}).expect(204);
    await agent.get('/api/members').expect(401);
    const login = await request(app).post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Strict');
    expect(login.body.token).toBeUndefined();
  });
  it('rejects invalid fields, types, duplicate codes and malformed IDs', async () => {
    for (const invalid of [{ ...data, name: ' ' }, { ...data, email: 'wrong' }, { ...data, is_active: 'false' }, { ...data, member_code: 'bad code' }, { ...data, name: 'a'.repeat(151) }, { ...data, admin: true }]) {
      await agent.post('/api/members').set('X-CSRF-Token', csrf).send(invalid).expect(422);
    }
    await agent.post('/api/members').set('X-CSRF-Token', csrf).send(data).expect(201);
    await agent.post('/api/members').set('X-CSRF-Token', csrf).send(data).expect(409);
    await agent.delete('/api/members/18446744073709551616').set('X-CSRF-Token', csrf).send({}).expect(422);
    await agent.delete('/api/members/9223372036854775808').set('X-CSRF-Token', csrf).send({}).expect(422);
    await agent.delete('/api/members/999').set('X-CSRF-Token', csrf).send({}).expect(404);
  });
  it('allows missing optional values and multiple members without codes', async () => {
    await agent.post('/api/members').set('X-CSRF-Token', csrf).send({ name: 'Person one' }).expect(201);
    await agent.post('/api/members').set('X-CSRF-Token', csrf).send({ name: 'Person two', member_code: null, email: '' }).expect(201);
    expect((await agent.get('/api/lucky-draw/status')).body.counts).toEqual({ total: 2, active: 2, remaining: 2, winners: 0 });
  });
  it('forbids client-selected winners and requires an interaction key', async () => {
    await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).send({ member_id: '1' }).expect(422);
    await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', csrf).send({}).expect(422);
  });
  it('records a server-selected winner once and supports safe request recovery', async () => {
    await agent.post('/api/members').set('X-CSRF-Token', csrf).send(data).expect(201);
    const key = randomUUID();
    const result = await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', csrf).set('Idempotency-Key', key).send({}).expect(200);
    expect(result.body.winner.name).toBe('Priya Iyer');
    const retry = await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', csrf).set('Idempotency-Key', key).send({}).expect(200);
    expect(retry.body.winner).toEqual(result.body.winner);
    expect(retry.body.replayed).toBe(true);
    const empty = await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', csrf).set('Idempotency-Key', randomUUID()).send({}).expect(409);
    expect(empty.body.error.code).toBe('NO_ELIGIBLE_PARTICIPANTS');
    expect((await agent.get('/api/lucky-draw/winners')).body.total).toBe(1);
  });
  it('validates history filters and pagination', async () => {
    await agent.get('/api/lucky-draw/winners?month=13&year=2026').expect(422);
    await agent.get('/api/lucky-draw/winners?month=10').expect(422);
    await agent.get('/api/lucky-draw/winners?scope=all&month=10&year=2026').expect(422);
    await agent.get('/api/lucky-draw/winners?scope=all&limit=101').expect(422);
    await agent.get('/api/lucky-draw/winners?month=10&year=2026&limit=20&offset=0').expect(200);
  });
  it('rejects invalid login and expired sessions', async () => {
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' }).expect(401);
    for (const session of store.sessions.values()) session.expires_at = '2000-01-01 00:00:00';
    await agent.get('/api/members').expect(401);
  });
  it('provides security headers and serves local dependencies', async () => {
    const page = await request(app).get('/').expect(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect(page.headers['x-powered-by']).toBeUndefined();
    await request(app).get('/vendor/bootstrap/css/bootstrap.min.css').expect(200);
    await request(app).get('/.env').expect(404);
  });
  it('sets Secure session cookies and HSTS in production', async () => {
    const production = createApp({ store, config: { ...testConfig, production: true, origin: 'https://draw.example.com' }, rateLimits: false });
    const login = await request(production).post('/api/auth/login').set('Origin', 'https://draw.example.com').send({ username: 'admin', password }).expect(200);
    expect(login.headers['set-cookie'][0]).toContain('Secure');
    expect(login.headers['strict-transport-security']).toContain('max-age=');
  });
  it('limits repeated login attempts before another password check', async () => {
    const limited = createApp({ store, config: testConfig });
    for (let i = 0; i < 10; i++) await request(limited).post('/api/auth/login').send({ username: 'missing', password: 'wrong' }).expect(401);
    const blocked = await request(limited).post('/api/auth/login').send({ username: 'missing', password: 'wrong' }).expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
