import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config/env.js';

describe('hosting origin configuration', () => {
  beforeEach(() => {
    for (const key of ['APP_ORIGIN', 'VERCEL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'TRUST_PROXY']) vi.stubEnv(key, undefined);
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('PORT', '3000');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses the production alias rather than a unique deployment URL', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'draw.vercel.app');
    vi.stubEnv('VERCEL_URL', 'draw-unique.vercel.app');
    expect(readConfig()).toMatchObject({ origin: 'https://draw.vercel.app', trustProxy: 1 });
  });
  it('uses the preview deployment URL for previews', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'draw.vercel.app');
    vi.stubEnv('VERCEL_URL', 'draw-preview.vercel.app');
    expect(readConfig().origin).toBe('https://draw-preview.vercel.app');
  });
  it('honors an explicit HTTPS origin for custom domains', () => {
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('VERCEL_URL', 'draw.vercel.app');
    vi.stubEnv('APP_ORIGIN', 'https://draw.example.com');
    expect(readConfig().origin).toBe('https://draw.example.com');
  });
  it('continues to reject unconfigured or HTTP production origins', () => {
    expect(() => readConfig()).toThrow('Production requires an HTTPS APP_ORIGIN.');
    vi.stubEnv('APP_ORIGIN', 'http://draw.example.com');
    expect(() => readConfig()).toThrow('Production requires an HTTPS APP_ORIGIN.');
  });
});
