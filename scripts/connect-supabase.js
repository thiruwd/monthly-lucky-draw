import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../src/config/env.js';
import { createSupabasePool, isPasswordPlaceholder, parseSupabaseConnection } from '../src/config/supabase.js';
import { connectionWithPassword, updateDatabaseUri } from '../src/utils/supabase-setup.js';
import { describeSupabaseError, SupabaseConfigurationError } from '../src/utils/supabase-errors.js';

let hidden = false, prompt, pool;
const cancellation = new AbortController();
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) process.stdout.write(chunk, encoding); callback(); } });
async function askHidden(label) {
  process.stdout.write(label);
  hidden = true;
  try { return await prompt.question('', { signal: cancellation.signal }); }
  finally { hidden = false; process.stdout.write('\n'); }
}

try {
  if (!process.stdin.isTTY) throw new SupabaseConfigurationError('INTERACTIVE_TERMINAL_REQUIRED', 'Run npm run connect:supabase in your own PowerShell or Command Prompt window so you can enter the database connection privately.');
  const config = readConfig();
  console.log('Open your Supabase project, then choose Connect > Session pooler > URI.');
  console.log('Copy the full postgresql:// URI. You can leave [YOUR-PASSWORD] in it.');
  console.log('Both inputs below are hidden. Paste with Ctrl+V or right-click.');
  prompt = readline.createInterface({ input: process.stdin, output, terminal: true });
  prompt.on('SIGINT', () => cancellation.abort());
  let connection;
  while (!connection) {
    const input = (await askHidden('Database URI (hidden; Enter keeps the saved URI): ')).trim();
    try { connection = parseSupabaseConnection({ ...config, supabaseDatabaseUrl: input || config.supabaseDatabaseUrl }, { allowPasswordPrompt: true }); }
    catch (error) {
      if (!(error instanceof SupabaseConfigurationError)) throw error;
      console.error(describeSupabaseError(error));
      console.log('Copy the URI beginning postgresql:// from Connect > Session pooler. Press Ctrl+C to cancel.');
    }
  }
  const currentPassword = decodeURIComponent(connection.password);
  if (!currentPassword || isPasswordPlaceholder(currentPassword)) {
    const password = await askHidden('Supabase database password (hidden; not the draw admin password): ');
    connection = connectionWithPassword(config, connection.toString(), password);
  }
  const connectedConfig = { ...config, supabaseDatabaseUrl: connection.toString() };
  pool = createSupabasePool(connectedConfig);
  console.log('Testing the database connection...');
  await pool.query('SELECT 1');
  await pool.end(); pool = undefined;
  cancellation.signal.throwIfAborted();

  const configFile = new URL('../.env.supabase', import.meta.url);
  let contents = '';
  try { contents = await readFile(configFile, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw new SupabaseConfigurationError('CONFIG_FILE_READ', 'Could not read .env.supabase. Check that this file is accessible, then run the connection command again.'); }
  try { await writeFile(configFile, updateDatabaseUri(contents, connection.toString()), { mode: 0o600 }); }
  catch { throw new SupabaseConfigurationError('CONFIG_FILE_WRITE', 'The database was reached, but .env.supabase could not be saved. Check the file permissions and run the connection command again.'); }
  console.log('Connection verified and saved privately in .env.supabase.');
  prompt.close();

  console.log('Setting up the draw tables and initial admin...');
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./setup-supabase.js', import.meta.url))], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'inherit', windowsHide: true,
      env: { ...process.env, SUPABASE_DATABASE_URL: connection.toString() }
    });
    child.once('error', () => reject(new SupabaseConfigurationError('SETUP_PROCESS', 'The connection was saved, but setup could not start. Run npm run setup:supabase in this project folder.')));
    child.once('exit', code => resolve(code ?? 1));
  });
  if (status !== 0) process.exitCode = 1;
  else console.log('Ready. Run npm start, then open http://127.0.0.1:3000/admin. Your initial login is in .local-admin.txt.');
} catch (error) {
  if (error?.name === 'AbortError') console.error('Connection setup cancelled.');
  else console.error(describeSupabaseError(error));
  process.exitCode = 1;
} finally { hidden = false; prompt?.close(); if (pool) await pool.end(); }
