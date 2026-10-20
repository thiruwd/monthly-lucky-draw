import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../src/config/env.js';
import { createSupabasePool } from '../src/config/supabase.js';
import { SupabaseStore } from '../src/repositories/supabase-store.js';
import { DrawService } from '../src/services/draw-service.js';
import { hashPassword } from '../src/utils/password.js';
import { describeSupabaseError } from '../src/utils/supabase-errors.js';

let pool;
try {
  const config = readConfig(); pool = createSupabasePool(config);
  const sql = await readFile(new URL('../database/supabase.sql', import.meta.url), 'utf8');
  const db = await pool.connect();
  try { await db.query('BEGIN'); await db.query(sql); await db.query('COMMIT'); }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
  const store = new SupabaseStore(pool);
  let password = process.env.INITIAL_ADMIN_PASSWORD, username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  if (!password) {
    try {
      const login = await readFile('.local-admin.txt', 'utf8');
      password = login.match(/^Password: (.+)$/m)?.[1]; username = login.match(/^Username: (.+)$/m)?.[1] || username;
    } catch { /* A fresh installation receives a randomly generated password. */ }
  }
  if (!password) {
    password = randomBytes(18).toString('base64url');
    await writeFile('.local-admin.txt', `Username: ${username}\nPassword: ${password}\n`, { flag: 'wx', mode: 0o600 });
  }
  if (password.length < 12 || password.length > 256) throw new Error('INITIAL_ADMIN_PASSWORD must contain 12–256 characters.');
  await store.ensureAdmin({ username, passwordHash: await hashPassword(password) });
  await new DrawService(store, { timezone: config.timezone, liveDraws: true }).publicState();
  console.log('Supabase is ready. Tables and admin were configured automatically; existing records and passwords were preserved.');
} catch (error) { console.error(`Supabase setup failed (${error.code || 'CONFIGURATION'}).`); console.error(describeSupabaseError(error)); process.exitCode = 1; }
finally { if (pool) await pool.end(); }
