import { createSupabasePool } from '../src/config/supabase.js';
import { readConfig } from '../src/config/env.js';
import { SupabaseStore } from '../src/repositories/supabase-store.js';
import { DrawService } from '../src/services/draw-service.js';

const config = readConfig();
if (config.production) throw new Error('Sample names are disabled in production.');
const pool = createSupabasePool(config), store = new SupabaseStore(pool);
try {
  await store.withWriteLock(async db => {
    for (const [index, name] of ['Aarav Sharma', 'Ananya Patel', 'Arjun Mehta', 'Diya Nair', 'Ishaan Kapoor', 'Kavya Rao', 'Neel Shah', 'Priya Iyer', 'Rohan Gupta', 'Sana Khan', 'Vikram Desai', 'Zoya Ali'].entries()) {
      await db.query('INSERT INTO lucky_draw.members (name,member_code) VALUES ($1,$2) ON CONFLICT DO NOTHING', [name, `DEMO-${index + 1}`]);
    }
    await new DrawService(store, { timezone: config.timezone, liveDraws: true }).refreshDisplay(db);
  });
  console.log('Optional sample participants added to Supabase.');
} finally { await pool.end(); }
