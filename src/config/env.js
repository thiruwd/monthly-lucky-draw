import dotenv from 'dotenv';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env.supabase', quiet: true });

function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function readConfig() {
  const timezone = process.env.APP_TIMEZONE || 'Asia/Kolkata';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  const production = process.env.NODE_ENV === 'production';
  const port = integer('PORT', 3000, 1, 65535);
  const origin = new URL(process.env.APP_ORIGIN || `http://127.0.0.1:${port}`);
  if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error('APP_ORIGIN must be an origin such as https://draw.example.com.');
  }
  if (production && origin.protocol !== 'https:') throw new Error('Production requires an HTTPS APP_ORIGIN.');
  return {
    production, port, timezone, origin: origin.origin,
    host: process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    trustProxy: integer('TRUST_PROXY', 0, 0, 1),
    liveDraws: true,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseDatabaseUrl: process.env.SUPABASE_DATABASE_URL || '',
    supabaseSslCa: process.env.SUPABASE_SSL_CA || '',
    sessionHours: integer('SESSION_HOURS', 8, 1, 24),
    db: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: integer('DB_PORT', 3306, 1, 65535),
      database: process.env.DB_NAME || 'lucky_draw',
      user: process.env.DB_USER || 'lucky_draw_app',
      password: process.env.DB_PASSWORD || '',
      connectionLimit: integer('DB_CONNECTION_LIMIT', 10, 2, 100),
      ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {})
    }
  };
}
