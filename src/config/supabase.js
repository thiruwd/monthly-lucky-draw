import pg from 'pg';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { SupabaseConfigurationError } from '../utils/supabase-errors.js';

export function parseSupabaseConnection(config, { allowPasswordPrompt = false } = {}) {
  const value = config.supabaseDatabaseUrl?.trim();
  if (!value) throw new SupabaseConfigurationError('SUPABASE_CONNECTION_MISSING', 'SUPABASE_DATABASE_URL is empty in .env.supabase. Run npm run connect:supabase and paste Supabase → Connect → Session pooler → URI. The https:// project URL alone cannot connect the database.');
  if (value.includes('#')) throw new SupabaseConfigurationError('SUPABASE_URI_FRAGMENT', 'The database URI contains an unescaped # character. Run npm run connect:supabase; entering the password separately there encodes special characters automatically.');
  let connection;
  try { connection = new URL(value); }
  catch { throw new SupabaseConfigurationError('SUPABASE_URI_INVALID', 'The connection string is not a valid PostgreSQL URI. Run npm run connect:supabase and paste the full URI from Supabase → Connect → Session pooler.'); }
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) throw new SupabaseConfigurationError('SUPABASE_URI_PROTOCOL', 'SUPABASE_DATABASE_URL must start with postgresql:// or postgres://. Copy the database URI from Connect → Session pooler, rather than the https:// project URL.');
  if (!connection.username || !connection.hostname || !connection.pathname || connection.pathname === '/') throw new SupabaseConfigurationError('SUPABASE_URI_INCOMPLETE', 'The database URI is incomplete. Copy the full Session pooler URI, including its username, host, port and /postgres database.');
  let password, username;
  try { password = decodeURIComponent(connection.password); username = decodeURIComponent(connection.username); }
  catch { throw new SupabaseConfigurationError('SUPABASE_PASSWORD_ENCODING', 'The database password has invalid URL encoding. Use npm run connect:supabase to enter it separately.'); }
  if (!allowPasswordPrompt && (!password || isPasswordPlaceholder(password))) throw new SupabaseConfigurationError('SUPABASE_PASSWORD_MISSING', 'The database password is missing or still says [YOUR-PASSWORD]. Run npm run connect:supabase and enter your Supabase database password when prompted.');
  if (config.supabaseUrl) {
    let project;
    try { project = new URL(config.supabaseUrl).hostname.split('.')[0]; }
    catch { throw new SupabaseConfigurationError('SUPABASE_PROJECT_INVALID', 'SUPABASE_URL is invalid. Set it to your https://PROJECT.supabase.co project URL.'); }
    const direct = connection.hostname === `db.${project}.supabase.co`;
    const pooled = connection.hostname.endsWith('.pooler.supabase.com') && username.endsWith(`.${project}`);
    if (!direct && !pooled) throw new SupabaseConfigurationError('SUPABASE_PROJECT_MISMATCH', 'The database URI belongs to a different host or project. Copy it from the same Supabase project as SUPABASE_URL.');
  }
  return connection;
}

export function isPasswordPlaceholder(password) {
  return /^\[?(?:YOUR[-_ ]?(?:DATABASE[-_ ]?)?PASSWORD|PASSWORD)\]?$/i.test(password) || /^PASTE[_ ]/i.test(password);
}

export function createSupabasePool(config) {
  const connection = parseSupabaseConnection(config);
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) connection.searchParams.delete(name);
  let ca;
  try {
    ca = config.supabaseSslCa ? readFileSync(config.supabaseSslCa, 'utf8')
      : [...rootCertificates, readFileSync(new URL('../../certs/supabase-ca-2021.crt', import.meta.url), 'utf8')];
  } catch { throw new SupabaseConfigurationError('SUPABASE_CERTIFICATE_FILE', 'The database root certificate could not be read. Check SUPABASE_SSL_CA, or restore certs/supabase-ca-2021.crt from this project.'); }
  const ssl = { rejectUnauthorized: true, ca };
  const pool = new pg.Pool({ connectionString: connection.toString(), ssl, max: 5,
    connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000, application_name: 'monthly-lucky-draw' });
  pool.on('error', error => console.error({ event: 'supabase_pool_error', code: error.code || 'CONNECTION' }));
  return pool;
}
