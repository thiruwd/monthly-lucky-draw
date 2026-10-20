import { readConfig } from './config/env.js';
import { createSupabasePool } from './config/supabase.js';
import { SupabaseStore } from './repositories/supabase-store.js';
import { createApp } from './app.js';
import { describeSupabaseError } from './utils/supabase-errors.js';
import { prepareLocalSupabase } from './config/local-supabase-setup.js';

let config = readConfig();
let server;
let pool;
try {
  config = await prepareLocalSupabase(config);
  pool = createSupabasePool(config);
  const store = new SupabaseStore(pool);
  await store.getPublicDisplay();
  server = createApp({ store, config }).listen(config.port, config.host, () => {
    console.log(`Public draw: ${config.origin}/`);
    console.log(`Administrator: ${config.origin}/admin`);
  });
  server.on('error', error => { console.error(`Server failed: ${error.code}`); process.exitCode = 1; });
} catch (error) {
  console.error(`Supabase startup failed (${error.code || 'CONFIGURATION'}).`);
  console.error(describeSupabaseError(error));
  if (pool) await pool.end();
  process.exitCode = 1;
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const timeout = setTimeout(() => process.exit(1), 10000).unref();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (pool) await pool.end();
  clearTimeout(timeout);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
