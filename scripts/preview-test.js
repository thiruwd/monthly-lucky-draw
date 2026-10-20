// Browser QA uses a disposable database and fixed, test-only administrator.
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPool } from '../src/config/database.js';
import { MysqlStore } from '../src/repositories/mysql-store.js';
import { MemberService } from '../src/services/member-service.js';
import { DrawService } from '../src/services/draw-service.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/utils/password.js';

dotenv.config({ path: '.env.test', quiet: true });
if (process.env.MYSQL_TEST_ENABLED !== '1' || !process.env.TEST_DB_USER || process.env.TEST_DB_PASSWORD === undefined) throw new Error('Explicit .env.test credentials are required.');
const database = `lucky_draw_test_${randomBytes(8).toString('hex')}`;
const credentials = { host: process.env.TEST_DB_HOST || '127.0.0.1', port: Number(process.env.TEST_DB_PORT || 3306), user: process.env.TEST_DB_USER, password: process.env.TEST_DB_PASSWORD };
const root = await mysql.createConnection(credentials);
let created = false, pool, server, closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  if (created && /^lucky_draw_test_[a-f0-9]{16}$/.test(database)) await root.query(`DROP DATABASE \`${database}\``);
  await root.end();
}
process.on('SIGINT', close); process.on('SIGTERM', close);
try {
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
  await root.changeUser({ database });
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  for (const statement of schema.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) await root.query(statement);
  pool = createPool({ ...credentials, database, connectionLimit: 10 });
  const store = new MysqlStore(pool); const members = new MemberService(store);
  await pool.execute('INSERT INTO admins (id, username, password_hash) VALUES (1, ?, ?)', ['ui-test', await hashPassword('local-preview-password')]);
  for (const [index, name] of ['Aarav Sharma', 'Ananya Patel', 'Arjun Mehta', 'Diya Nair', 'Ishaan Kapoor', 'Kavya Rao', 'Neel Shah', 'Priya Iyer', 'Rohan Gupta', 'Sana Khan', 'Vikram Desai', 'Zoya Ali'].entries()) {
    await members.save(null, { name, member_code: `MEM-${String(index + 1).padStart(3, '0')}`, email: null, is_active: true });
  }
  const draw = new DrawService(store, { timezone: 'Asia/Kolkata' });
  await draw.spin('1', 'preview-initial-01'); await draw.spin('1', 'preview-initial-02');
  const config = { production: false, timezone: 'Asia/Kolkata', origin: 'http://127.0.0.1:3001', trustProxy: 0, sessionHours: 1 };
  server = createApp({ store, config }).listen(3001, '127.0.0.1', () => console.log('Isolated browser preview: http://127.0.0.1:3001 · ui-test / local-preview-password'));
  server.on('error', async error => { console.error(error.code); await close(); process.exitCode = 1; });
} catch (error) { console.error(`Preview failed: ${error.code || error.message}`); await close(); process.exitCode = 1; }
