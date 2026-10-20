import { createPool } from '../src/config/database.js';
import { readConfig } from '../src/config/env.js';
import { MysqlStore } from '../src/repositories/mysql-store.js';

const config = readConfig();
if (config.production) throw new Error('Sample participants can only be created outside production.');
const names = ['Aarav Sharma', 'Ananya Patel', 'Arjun Mehta', 'Diya Nair', 'Ishaan Kapoor', 'Kavya Rao', 'Neel Shah', 'Priya Iyer', 'Rohan Gupta', 'Sana Khan', 'Vikram Desai', 'Zoya Ali'];
const pool = createPool(config.db);
const store = new MysqlStore(pool);
try {
  await store.withWriteLock(async db => {
    for (const [index, name] of names.entries()) {
      await db.execute('INSERT IGNORE INTO members (member_code, name, is_active, created_at, updated_at) VALUES (?, ?, TRUE, UTC_TIMESTAMP(), UTC_TIMESTAMP())', [`DEMO-${String(index + 1).padStart(3, '0')}`, name]);
    }
  });
  console.log('12 sample participants are available. Existing DEMO codes were left unchanged.');
} finally { await pool.end(); }
