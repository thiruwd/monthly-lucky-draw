import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/env.js', () => ({ readConfig: vi.fn() }));
vi.mock('../src/config/supabase.js', () => ({ createSupabasePool: vi.fn(() => ({})) }));
vi.mock('../src/repositories/supabase-store.js', async () => {
  const { MemoryStore } = await import('./helpers/memory-store.js');
  return { SupabaseStore: MemoryStore };
});
import { readConfig } from '../src/config/env.js';
import { createSupabasePool } from '../src/config/supabase.js';

describe('Vercel application entry', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks();
    readConfig.mockReturnValue({ production: true, origin: 'https://draw.example.com', timezone: 'Asia/Kolkata', sessionHours: 8, trustProxy: 1, liveDraws: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it('exports an app without opening a port and reuses its runtime across requests', async () => {
    const { default: app } = await import('../index.js');
    expect(createSupabasePool).toHaveBeenCalledOnce();
    await request(app).get('/').expect(200).expect(/Watch live/);
    await request(app).get('/admin').expect(200).expect(/Admin/);
    await request(app).get('/api/public/draw').expect(200);
    expect(createSupabasePool).toHaveBeenCalledOnce();
  });

  it('reports missing hosting configuration without crashing the function or revealing secrets', async () => {
    readConfig.mockImplementation(() => { throw new Error('private-test-connection-secret'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: app } = await import('../index.js');
    const response = await request(app).get('/').expect(503);
    expect(response.body.error.code).toBe('HOSTING_SETUP_REQUIRED');
    expect(JSON.stringify(response.body)).not.toContain('private-test-connection-secret');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-test-connection-secret');
  });
});
