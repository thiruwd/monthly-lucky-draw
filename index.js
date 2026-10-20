import express from 'express';
import { readConfig } from './src/config/env.js';
import { createSupabasePool } from './src/config/supabase.js';
import { SupabaseStore } from './src/repositories/supabase-store.js';
import { createApp } from './src/app.js';
import { describeSupabaseError } from './src/utils/supabase-errors.js';

// Vercel imports this app; local development continues to use src/server.js.
const app = express();
try {
  const config = readConfig();
  const pool = createSupabasePool(config);
  app.use(createApp({ store: new SupabaseStore(pool), config }));
} catch (error) {
  console.error({ event: 'hosting_startup_failed', code: error.code || 'CONFIGURATION', message: describeSupabaseError(error) });
  app.use((req, res) => res.status(503).json({ error: { code: 'HOSTING_SETUP_REQUIRED', message: 'Hosting setup is incomplete. Check the deployment environment variables.' } }));
}

export default app;
