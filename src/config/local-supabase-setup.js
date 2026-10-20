import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseSupabaseConnection } from './supabase.js';
import { describeSupabaseError, SupabaseConfigurationError } from '../utils/supabase-errors.js';

async function runConnectionCommand() {
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../scripts/connect-supabase.js', import.meta.url))], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: 'inherit', windowsHide: true
    });
    child.once('error', () => reject(new SupabaseConfigurationError('SETUP_PROCESS', 'Database setup could not open. Run npm run connect:supabase in this project folder.')));
    child.once('exit', code => resolve(code ?? 1));
  });
  if (status !== 0) throw new SupabaseConfigurationError('SETUP_INCOMPLETE', 'Database setup did not finish. Run npm start again when you have the Session pooler URI and Supabase database password.');
}

async function readSavedSettings() {
  return dotenv.parse(await readFile(new URL('../../.env.supabase', import.meta.url), 'utf8'));
}

export async function prepareLocalSupabase(config, {
  interactive = Boolean(process.stdin.isTTY), runSetup = runConnectionCommand,
  readSettings = readSavedSettings, log = console.log
} = {}) {
  try { parseSupabaseConnection(config); return config; }
  catch (error) {
    // Hosted and unattended processes must fail immediately instead of prompting.
    if (config.production || !interactive || !(error instanceof SupabaseConfigurationError)) throw error;
    log(describeSupabaseError(error));
    log('Opening one-time Supabase setup. Complete it here and the app will start automatically.');
    await runSetup();
    const saved = await readSettings();
    const connected = { ...config, supabaseDatabaseUrl: saved.SUPABASE_DATABASE_URL || '' };
    parseSupabaseConnection(connected);
    return connected;
  }
}
