import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { readConfig } from '../src/config/env.js';

const { db } = readConfig();
if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(db.database)) throw new Error('DB_NAME must be a simple SQL identifier.');
const connection = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, ...(db.ssl ? { ssl: db.ssl } : {}) });
try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database: db.database });
  const sql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map(part => part.trim()).filter(Boolean)) await connection.query(statement);
  console.log(`Schema ready in ${db.database}. Existing data was preserved.`);
} finally { await connection.end(); }
