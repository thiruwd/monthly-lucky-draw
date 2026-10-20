import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestPostgres } from './helpers/postgres.js';
import { SupabaseStore } from '../src/repositories/supabase-store.js';
import { MemberService } from '../src/services/member-service.js';
import { DrawService } from '../src/services/draw-service.js';
import { hashPassword } from '../src/utils/password.js';
import { createApp } from '../src/app.js';
import { indexAtPointer, liveRotation } from '../public/js/wheel-math.js';

describe('Supabase schema and PostgreSQL repository', () => {
  let pool, store, members, draw, now, app, adminHash;
  const config = { production: false, origin: 'http://127.0.0.1:3000', timezone: 'Asia/Kolkata', sessionHours: 8, trustProxy: 0, liveDraws: true };
  beforeAll(async () => { pool = await createTestPostgres(); adminHash = await hashPassword('private-test-password-2026'); }, 30000);
  beforeEach(async () => {
    await pool.query('TRUNCATE lucky_draw.requests,lucky_draw.sessions,lucky_draw.winners,lucky_draw.members,lucky_draw.admins,lucky_draw.live_display RESTART IDENTITY CASCADE');
    store = new SupabaseStore(pool); now = new Date('2026-10-20T08:00:00Z');
    draw = new DrawService(store, { timezone: config.timezone, now: () => now, liveDraws: true, chooseIndex: size => size - 1 });
    members = new MemberService(store, db => draw.refreshDisplay(db));
    await store.ensureAdmin({ username: 'admin', passwordHash: adminHash });
    app = createApp({ store, config, now: () => now, rateLimits: false, logger: { error() {} } });
  });
  afterAll(async () => { if (pool) await pool.end(); });
  async function add(name = 'Priya Iyer', active = true) { return members.save(null, { name, member_code: null, email: 'private@example.com', is_active: active }); }
  async function login(password = 'private-test-password-2026') {
    const agent = request.agent(app); const result = await agent.post('/api/auth/login').send({ username: 'admin', password }).expect(200);
    return { agent, csrf: result.body.csrfToken };
  }
  it('creates, edits, deactivates and soft-deletes names in PostgreSQL', async () => {
    const person = await add(); expect(person.created_at).toContain('T');
    expect(await members.list()).toHaveLength(1);
    await members.save(person.id, { name: 'A new name', member_code: 'CODE-1', email: null, is_active: true });
    expect((await members.list())[0].name).toBe('A new name');
    await members.setStatus(person.id, false); expect((await draw.eligible()).participants).toHaveLength(0);
    await members.remove(person.id); expect(await members.list()).toHaveLength(0);
    expect((await pool.query('SELECT deleted_at FROM lucky_draw.members')).rows[0].deleted_at).toBeInstanceOf(Date);
  });
  it('enforces unique codes and monthly winners in the database itself', async () => {
    await members.save(null, { name: 'One', member_code: 'ABC', email: null, is_active: true });
    await expect(members.save(null, { name: 'Two', member_code: 'abc', email: null, is_active: true })).rejects.toMatchObject({ code: '23505' });
    const result = await draw.spin('1', randomUUID());
    await expect(pool.query('INSERT INTO lucky_draw.winners (member_id,name,draw_month,draw_year,won_at) VALUES ($1,$2,10,2026,now())', [result.winner.member_id, 'Again'])).rejects.toMatchObject({ code: '23505' });
  });
  it('returns a safe public page without exposing contacts, admins, or history', async () => {
    await add();
    const response = await request(app).get('/api/public/draw').expect(200);
    expect(response.body.participants).toEqual([{ id: '1', name: 'Priya Iyer' }]);
    expect(JSON.stringify(response.body)).not.toMatch(/private@example|password_hash|csrf_token|member_code/);
    await request(app).get('/api/members').expect(401);
    await request(app).get('/api/lucky-draw/winners').expect(401);
    await request(app).post('/api/lucky-draw/spin').send({}).expect(401);
  });
  it('saves the same live draw snapshot for all viewers and persists request recovery', async () => {
    await add(); await add('Arjun Mehta'); const key = randomUUID();
    const result = await draw.spin('1', key);
    const other = new DrawService(new SupabaseStore(pool), { timezone: config.timezone, now: () => now, liveDraws: true });
    const publicState = await other.publicState();
    expect(publicState.inProgress).toBe(true); expect(publicState.winner).toBeNull();
    expect(publicState.live.id).toBe(result.winner.id);
    expect(publicState.live.wheel.participants[result.wheel.winnerIndex].id).toBe(result.winner.member_id);
    expect((await other.spin('1', key)).replayed).toBe(true);
    now = new Date(now.getTime() + 7000);
    expect((await other.publicState()).winner.name).toBe('Arjun Mehta');
    expect((await other.publicState()).participants).toHaveLength(1);
  });
  it('prevents overlapping live draws and permits the next intentional draw after animation', async () => {
    await add(); await add('Arjun Mehta');
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => draw.spin('1', randomUUID())));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected').every(result => result.reason.code === 'DRAW_IN_PROGRESS')).toBe(true);
    now = new Date(now.getTime() + 7000); await draw.spin('1', randomUUID());
    expect((await draw.winners({})).total).toBe(2);
  });
  it('rolls back the winner and public broadcast together when the retry record fails', async () => {
    await add();
    const before = await store.getPublicDisplay();
    vi.spyOn(store, 'saveDrawRequest').mockRejectedValueOnce(new Error('Failed final write'));
    await expect(draw.spin('1', randomUUID())).rejects.toThrow('Failed final write');
    expect((await draw.winners({})).total).toBe(0);
    expect(await store.getPublicDisplay()).toEqual(before);
  });
  it('resets eligibility at the configured month boundary while retaining history and original names', async () => {
    const person = await add(); await draw.spin('1', randomUUID());
    await members.save(person.id, { name: 'Renamed', member_code: null, email: null, is_active: true });
    now = new Date('2026-10-31T18:30:00Z');
    expect((await draw.publicState()).participants).toEqual([{ id: person.id, name: 'Renamed' }]);
    expect((await draw.publicState()).winner).toBeNull();
    expect((await draw.winners({ scope: 'all' })).items[0].name).toBe('Priya Iyer');
  });
  it('validates a password change, invalidates every old session, and accepts the new login', async () => {
    const first = await login(), second = await login();
    const body = { current_password: 'wrong', new_password: 'my-new-private-password-2026', confirm_password: 'my-new-private-password-2026' };
    await first.agent.post('/api/auth/password').set('X-CSRF-Token', first.csrf).send(body).expect(403);
    await first.agent.post('/api/auth/password').set('X-CSRF-Token', first.csrf).send({ ...body, current_password: 'private-test-password-2026', confirm_password: 'mismatch' }).expect(422);
    await first.agent.post('/api/auth/password').set('X-CSRF-Token', first.csrf).send({ ...body, current_password: 'private-test-password-2026' }).expect(200);
    await first.agent.get('/api/members').expect(401); await second.agent.get('/api/members').expect(401);
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'private-test-password-2026' }).expect(401);
    await login(body.new_password);
  });
  it('does not let an old verified password create a fresh session after a password change', async () => {
    await store.changeAdminPassword('1', adminHash, await hashPassword('a-different-password-2026'));
    await expect(store.createSession({ adminId: '1', expectedPasswordHash: adminHash, tokenHash: 'a'.repeat(64), csrfToken: 'b'.repeat(64), expiresAt: '2099-01-01 00:00:00' })).rejects.toMatchObject({ code: 'CREDENTIALS_CHANGED' });
  });
  it('enables row level security for every application table', async () => {
    const { rows } = await pool.query("SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='lucky_draw' AND c.relkind='r'");
    expect(rows.length).toBeGreaterThanOrEqual(7); expect(rows.every(row => row.relrowsecurity)).toBe(true);
  });
  it('lets viewers joining mid-spin land on the same server-selected segment', async () => {
    await add(); await add('Arjun Mehta'); await add('Diya Nair'); const { live } = await draw.spin('1', randomUUID());
    const atStart = liveRotation(live.startsAt, live.startsAt, live.durationMs, live.wheel.winnerIndex, 3);
    const halfway = liveRotation(live.startsAt + 2750, live.startsAt, live.durationMs, live.wheel.winnerIndex, 3);
    const end = liveRotation(live.endsAt, live.startsAt, live.durationMs, live.wheel.winnerIndex, 3);
    expect(atStart).toBe(0); expect(halfway).toBeGreaterThan(0); expect(halfway).toBeLessThan(end);
    expect(indexAtPointer(end, 3)).toBe(live.wheel.winnerIndex);
  });
});
