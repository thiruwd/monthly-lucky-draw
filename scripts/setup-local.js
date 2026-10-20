// Optional first-run helper for a fresh, local developer database only.
import mysql from 'mysql2/promise';
import { access, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/utils/password.js';

if (process.env.NODE_ENV === 'production') throw new Error('Local setup is disabled in production.');
for (const file of ['.env', '.env.test', '.local-admin.txt']) {
  try { await access(file); throw new Error(`${file} already exists. Use the manual setup in README.md; no credentials were changed.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const connection = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.LOCAL_MYSQL_PORT || 3306),
  user: process.env.LOCAL_MYSQL_USER || 'root', password: process.env.LOCAL_MYSQL_PASSWORD || '' });
try {
  const [[database]] = await connection.query("SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'lucky_draw'");
  const [[users]] = await connection.query("SELECT COUNT(*) AS n FROM mysql.user WHERE User IN ('lucky_draw_app', 'lucky_draw_test')");
  if (Number(database.n) || Number(users.n)) throw new Error('The database or application accounts already exist. Use manual setup; existing data was not changed.');
  const appPassword = randomBytes(24).toString('hex');
  const testPassword = randomBytes(24).toString('hex');
  const adminPassword = randomBytes(18).toString('base64url');
  await connection.query('CREATE DATABASE lucky_draw CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await connection.changeUser({ database: 'lucky_draw' });
  const sql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) await connection.query(statement);
  await connection.query("CREATE USER 'lucky_draw_app'@'localhost' IDENTIFIED BY ?", [appPassword]);
  await connection.query("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON lucky_draw.* TO 'lucky_draw_app'@'localhost'");
  await connection.query("CREATE USER 'lucky_draw_test'@'localhost' IDENTIFIED BY ?", [testPassword]);
  await connection.query("GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES ON `lucky\\_draw\\_test\\_%`.* TO 'lucky_draw_test'@'localhost'");
  await connection.query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', ['admin', await hashPassword(adminPassword)]);
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile('.env', example.replace('DB_PASSWORD=\n', `DB_PASSWORD=${appPassword}\n`).replace('DB_PORT=3306', `DB_PORT=${Number(process.env.LOCAL_MYSQL_PORT || 3306)}`), { flag: 'wx', mode: 0o600 });
  await writeFile('.env.test', `MYSQL_TEST_ENABLED=1\nTEST_DB_HOST=127.0.0.1\nTEST_DB_PORT=${Number(process.env.LOCAL_MYSQL_PORT || 3306)}\nTEST_DB_USER=lucky_draw_test\nTEST_DB_PASSWORD=${testPassword}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile('.local-admin.txt', `LOCAL DEVELOPMENT ADMINISTRATOR\nURL: http://127.0.0.1:3000\nUsername: admin\nPassword: ${adminPassword}\n\nKeep this file private. It is ignored by Git. Create your own account with npm run admin:create.\n`, { flag: 'wx', mode: 0o600 });
  console.log('Local database, separate app/test users, and administrator created.');
  console.log('The generated login is in .local-admin.txt. Database secrets are in .env and .env.test.');
} catch (error) {
  console.error(error.code ? `Local setup failed (${error.code}). Check MySQL and use manual setup if needed; no existing objects were removed.` : error.message);
  process.exitCode = 1;
} finally { await connection.end(); }
