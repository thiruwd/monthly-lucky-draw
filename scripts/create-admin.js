import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createSupabasePool } from '../src/config/supabase.js';
import { readConfig } from '../src/config/env.js';
import { hashPassword } from '../src/utils/password.js';

let hidden = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) process.stdout.write(chunk, encoding); callback(); } });
const prompt = readline.createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
let pool;
try {
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal to create an administrator.');
  const username = (await prompt.question('Admin username: ')).trim();
  process.stdout.write('Admin password (12–256 characters; hidden): ');
  hidden = true;
  const password = await prompt.question('');
  hidden = false;
  process.stdout.write('\n');
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new Error('Use 3–80 letters, numbers, dots, underscores or hyphens for the username.');
  if (password.length < 12 || password.length > 256) throw new Error('The password must contain 12–256 characters.');
  pool = createSupabasePool(readConfig());
  await pool.query('INSERT INTO lucky_draw.admins (username, password_hash) VALUES ($1, $2)', [username, await hashPassword(password)]);
  console.log(`Administrator ${username} created. Sign in using this account.`);
} catch (error) {
  console.error(error.code === '23505' ? 'That username already exists; no account was changed.' : (error.code ? `Admin creation failed (${error.code}). Check the database configuration.` : error.message));
  process.exitCode = 1;
} finally { hidden = false; prompt.close(); if (pool) await pool.end(); }
