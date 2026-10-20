import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

// Actual embedded PostgreSQL engine, isolated in memory. It has one connection;
// the lease serializes its test clients. Cloud PostgreSQL provides real row locks.
export async function createTestPostgres() {
  const engine = new PGlite();
  await engine.exec(await readFile(new URL('../../database/supabase.sql', import.meta.url), 'utf8'));
  let tail = Promise.resolve();
  async function connect() {
    const previous = tail; let release;
    tail = new Promise(resolve => { release = resolve; }); await previous;
    return { query: (sql, params) => engine.query(sql, params), release };
  }
  return {
    connect,
    async query(sql, params) { const db = await connect(); try { return await db.query(sql, params); } finally { db.release(); } },
    end: () => engine.close()
  };
}
