import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createPool } from '../src/config/database.js';
import { MysqlStore } from '../src/repositories/mysql-store.js';
import { DrawService } from '../src/services/draw-service.js';
import { MemberService } from '../src/services/member-service.js';
import { hashPassword } from '../src/utils/password.js';
import { createApp } from '../src/app.js';

// No .env import and no fallback to application credentials. Only a newly generated
// lucky_draw_test_<random> database may ever be created, cleared, or dropped.
dotenv.config({ path: '.env.test', quiet: true });
const enabled = process.env.MYSQL_TEST_ENABLED === '1';
const database = `lucky_draw_test_${randomBytes(8).toString('hex')}`;
const assertTestDatabase = () => {
  if (process.env.NODE_ENV !== 'test' || !/^lucky_draw_test_[a-f0-9]{16}$/.test(database)) throw new Error('Refusing unsafe test database access.');
};
describe.skipIf(!enabled)('real MySQL / InnoDB integration', () => {
  let root, pool, store, draw, members, current;
  let created = false;
  const now = () => current;
  const credentials = { host: process.env.TEST_DB_HOST || '127.0.0.1', port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER, password: process.env.TEST_DB_PASSWORD };
  const config = { production: false, origin: 'http://127.0.0.1:3000', timezone: 'Asia/Kolkata', sessionHours: 8, trustProxy: 0 };
  let adminHash;
  beforeAll(async () => {
    assertTestDatabase();
    if (!credentials.user || credentials.password === undefined) throw new Error('Explicit TEST_DB_USER and TEST_DB_PASSWORD are required. See .env.test.example.');
    root = await mysql.createConnection(credentials);
    await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await root.changeUser({ database });
    const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
    for (const statement of schema.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) await root.query(statement);
    pool = createPool({ ...credentials, database, connectionLimit: 20 });
    store = new MysqlStore(pool); members = new MemberService(store);
    draw = new DrawService(store, { timezone: config.timezone, now });
    adminHash = await hashPassword('mysql-test-only-password');
  }, 30000);
  beforeEach(async () => {
    assertTestDatabase();
    for (const table of ['draw_requests', 'admin_sessions', 'lucky_draw_winners', 'members', 'admins']) await pool.execute(`DELETE FROM \`${table}\``);
    await pool.execute('INSERT INTO admins (id, username, password_hash) VALUES (1, ?, ?)', ['test-admin', adminHash]);
    current = new Date('2026-10-20T08:00:00Z');
    for (let i = 0; i < 12; i++) await members.save(null, { name: `Test person ${i}`, member_code: `TEST-${i}`, email: null, is_active: i !== 11 });
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (root) {
      if (created) { assertTestDatabase(); await root.query(`DROP DATABASE \`${database}\``); }
      await root.end();
    }
  });
  it('adds and lists members with real mysql2 parameters', async () => {
    expect(await members.list()).toHaveLength(12);
    await expect(members.save(null, { name: 'Duplicate code', member_code: 'TEST-0', email: null, is_active: true })).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });
  it('records a valid active winner, excludes them, and returns consistent status', async () => {
    const eligible = await draw.eligible();
    expect(eligible.participants).toHaveLength(11);
    const result = await draw.spin('1', randomUUID());
    expect(eligible.participants.map(person => person.id)).toContain(result.winner.member_id);
    expect(result.wheel.participants[result.wheel.winnerIndex].id).toBe(result.winner.member_id);
    expect(result.remainingCount).toBe(10);
    expect((await draw.eligible()).participants.map(person => person.id)).not.toContain(result.winner.member_id);
    expect((await draw.status()).counts).toEqual({ total: 12, active: 11, remaining: 10, winners: 1 });
  });
  it('restores eligibility across the timezone month boundary without deleting history', async () => {
    await draw.spin('1', randomUUID());
    current = new Date('2026-10-31T18:30:00Z');
    expect((await draw.eligible()).participants).toHaveLength(11);
    expect((await draw.winners({ scope: 'all' })).total).toBe(1);
    expect((await draw.winners({})).total).toBe(0);
  });
  it('serializes competing processes through the shared database lock', async () => {
    // Separate pools represent two app instances, each with its own connections.
    const secondPool = createPool({ ...credentials, database, connectionLimit: 10 });
    try {
      const secondDraw = new DrawService(new MysqlStore(secondPool), { timezone: config.timezone, now });
      const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => (i % 2 ? draw : secondDraw).spin('1', randomUUID())));
      const wins = results.filter(result => result.status === 'fulfilled').map(result => result.value);
      expect(wins).toHaveLength(11);
      expect(new Set(wins.map(result => result.winner.member_id)).size).toBe(11);
      for (const result of results.filter(result => result.status === 'rejected')) expect(result.reason.code).toBe('NO_ELIGIBLE_PARTICIPANTS');
      expect((await draw.winners({})).total).toBe(11);
    } finally { await secondPool.end(); }
  });
  it('replays an identical request exactly once under concurrency', async () => {
    const key = randomUUID();
    const results = await Promise.all([draw.spin('1', key), draw.spin('1', key), draw.spin('1', key)]);
    expect(new Set(results.map(result => result.winner.id)).size).toBe(1);
    expect((await draw.winners({})).total).toBe(1);
    expect(results.filter(result => result.replayed)).toHaveLength(2);
  });
  it('the unique constraint independently rejects a second win in the same month', async () => {
    const { winner } = await draw.spin('1', randomUUID());
    await expect(pool.execute('INSERT INTO lucky_draw_winners (member_id, member_name, draw_month, draw_year, won_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())',
      [winner.member_id, winner.name, winner.draw_month, winner.draw_year])).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    expect((await draw.winners({})).total).toBe(1);
  });
  it('rolls back a real INSERT when a later write fails', async () => {
    const spy = vi.spyOn(store, 'saveDrawRequest').mockImplementationOnce(async (adminId, key, response, db) => {
      await db.execute('INSERT INTO table_that_does_not_exist (id) VALUES (1)');
    });
    try { await expect(draw.spin('1', randomUUID())).rejects.toMatchObject({ code: 'ER_NO_SUCH_TABLE' }); }
    finally { spy.mockRestore(); }
    expect((await draw.winners({})).total).toBe(0);
    expect((await draw.eligible()).participants).toHaveLength(11);
  });
  it('keeps history after edits/deletion, reserves codes, and never revives a winner on reactivation', async () => {
    const { winner } = await draw.spin('1', randomUUID());
    await members.setStatus(winner.member_id, false); await members.setStatus(winner.member_id, true);
    expect((await draw.eligible()).participants.map(person => person.id)).not.toContain(winner.member_id);
    await members.save(winner.member_id, { name: 'Renamed', member_code: null, email: null, is_active: true });
    await members.remove(winner.member_id);
    expect((await draw.winners({ scope: 'all' })).items[0].name).toBe(winner.name);
    expect(await members.list()).toHaveLength(11);
    const [[row]] = await pool.execute('SELECT deleted_at FROM members WHERE id = ?', [winner.member_id]);
    expect(row.deleted_at).toBeTruthy();
  });
  it('runs authentication, CSRF, member CRUD and a draw through HTTP against MySQL', async () => {
    const app = createApp({ store, config, now, rateLimits: false }); const agent = request.agent(app);
    const { body } = await agent.post('/api/auth/login').send({ username: 'test-admin', password: 'mysql-test-only-password' }).expect(200);
    await agent.post('/api/members').set('X-CSRF-Token', body.csrfToken).send({ name: 'HTTP participant' }).expect(201);
    expect((await agent.get('/api/members').expect(200)).body.members).toHaveLength(13);
    await agent.post('/api/lucky-draw/spin').set('X-CSRF-Token', body.csrfToken).set('Idempotency-Key', randomUUID()).send({}).expect(200);
    await agent.get('/api/lucky-draw/status').expect(200);
    await agent.post('/api/auth/logout').set('X-CSRF-Token', body.csrfToken).send({}).expect(204);
    await agent.get('/api/members').expect(401);
  });
});
