import { describe, expect, it, vi } from 'vitest';
import dotenv from 'dotenv';
import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSupabasePool, parseSupabaseConnection } from '../src/config/supabase.js';
import { describeSupabaseError } from '../src/utils/supabase-errors.js';
import { connectionWithPassword, updateDatabaseUri } from '../src/utils/supabase-setup.js';
import { prepareLocalSupabase } from '../src/config/local-supabase-setup.js';

const project = 'test-project';
const config = { supabaseUrl: `https://${project}.supabase.co` };
const template = `postgresql://postgres.${project}:[YOUR-PASSWORD]@aws-0-example.pooler.supabase.com:5432/postgres`;
const valid = template.replace('[YOUR-PASSWORD]', 'private-test-only');
const parse = uri => parseSupabaseConnection({ ...config, supabaseDatabaseUrl: uri });

describe('Supabase connection setup', () => {
  it.each([
    ['', 'SUPABASE_CONNECTION_MISSING'],
    ['invalid-uri-with-private-test-secret', 'SUPABASE_URI_INVALID'],
    [config.supabaseUrl, 'SUPABASE_URI_PROTOCOL'],
    [template, 'SUPABASE_PASSWORD_MISSING'],
    [template.replace('[YOUR-PASSWORD]', 'unencoded#password'), 'SUPABASE_URI_FRAGMENT'],
    [template.replace('[YOUR-PASSWORD]', '%no'), 'SUPABASE_PASSWORD_ENCODING'],
    [valid.replace('postgres.test-project', 'postgres.other-project'), 'SUPABASE_PROJECT_MISMATCH'],
    [valid.slice(0, -'postgres'.length), 'SUPABASE_URI_INCOMPLETE']
  ])('explains invalid configuration without exposing the URI (%s)', (uri, code) => {
    let failure;
    try { parse(uri); } catch (error) { failure = error; }
    expect(failure?.code).toBe(code);
    expect(describeSupabaseError(failure)).not.toContain('private-test');
    if (uri) expect(describeSupabaseError(failure)).not.toContain(uri);
  });

  it('accepts copied session pooler and direct connection URIs', () => {
    expect(parse(valid).hostname).toBe('aws-0-example.pooler.supabase.com');
    expect(parse(`postgresql://postgres:private-test-only@db.${project}.supabase.co:5432/postgres`).hostname).toBe(`db.${project}.supabase.co`);
  });

  it.each(['symbols@#?/: %$&"\\+!', 'spaces and unicode தமிழ்', 'literal%23value'])('encodes a separately entered password exactly once', async password => {
    const connection = connectionWithPassword(config, template, password);
    expect(decodeURIComponent(connection.password)).toBe(password);
    expect(connection.hash).toBe('');
    expect(connection.search).toBe('');
    expect(dotenv.parse(updateDatabaseUri('', connection.toString())).SUPABASE_DATABASE_URL).toBe(connection.toString());
    const pool = createSupabasePool({ ...config, supabaseDatabaseUrl: connection.toString() });
    try { expect(new pg.Client(pool.options).connectionParameters.password).toBe(password); }
    finally { await pool.end(); }
  });

  it('preserves unrelated settings and comments while replacing duplicate URI entries', () => {
    const original = '# Keep this comment\r\nSUPABASE_URL=https://test-project.supabase.co\r\nSUPABASE_DATABASE_URL="old-private-value"\r\nSUPABASE_SSL_CA=C:/certs/root.crt\r\nexport SUPABASE_DATABASE_URL=duplicate\r\nEXTRA_KEY=keep\r\n';
    const saved = updateDatabaseUri(original, valid);
    expect(saved.match(/^SUPABASE_DATABASE_URL=/gm)).toHaveLength(1);
    expect(saved).not.toMatch(/old-private-value|duplicate/);
    expect(saved).toContain('# Keep this comment\r\n');
    expect(dotenv.parse(saved)).toEqual({ SUPABASE_URL: config.supabaseUrl, SUPABASE_DATABASE_URL: valid, SUPABASE_SSL_CA: 'C:/certs/root.crt', EXTRA_KEY: 'keep' });
  });

  it('appends the URI when the configuration file has no entry yet', () => {
    const saved = updateDatabaseUri('# New configuration\nEXTRA_KEY=keep', valid);
    expect(dotenv.parse(saved)).toEqual({ EXTRA_KEY: 'keep', SUPABASE_DATABASE_URL: valid });
    expect(saved.endsWith('\n')).toBe(true);
  });

  it('keeps certificate verification enabled even when the copied URI disables SSL', async () => {
    const pool = createSupabasePool({ ...config, supabaseDatabaseUrl: `${valid}?sslmode=disable&ssl=false` });
    try {
      expect(pool.options.ssl.rejectUnauthorized).toBe(true);
      const bundled = readFileSync(new URL('../certs/supabase-ca-2021.crt', import.meta.url), 'utf8');
      expect(pool.options.ssl.ca).toContain(bundled);
      expect(pool.options.ssl.ca.length).toBeGreaterThan(1);
      const certificate = new X509Certificate(bundled);
      expect(certificate.ca).toBe(true);
      expect(certificate.verify(certificate.publicKey)).toBe(true);
      expect(certificate.fingerprint256).toBe('80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA');
      expect(Date.parse(certificate.validTo)).toBeGreaterThan(Date.now());
      expect(pool.options.connectionString).not.toMatch(/sslmode|ssl=/);
    } finally { await pool.end(); }
  });

  it('honors an explicit certificate path and fails if that file is missing', async () => {
    const path = new URL('../certs/supabase-ca-2021.crt', import.meta.url);
    const pool = createSupabasePool({ ...config, supabaseDatabaseUrl: valid, supabaseSslCa: path });
    try { expect(pool.options.ssl).toEqual({ rejectUnauthorized: true, ca: readFileSync(path, 'utf8') }); }
    finally { await pool.end(); }
    expect(() => createSupabasePool({ ...config, supabaseDatabaseUrl: valid, supabaseSslCa: 'certs/missing-test-certificate.crt' })).toThrow(expect.objectContaining({ code: 'SUPABASE_CERTIFICATE_FILE' }));
  });

  it.each(['28P01', '42P01', '42501', 'ENOTFOUND', 'ETIMEDOUT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNKNOWN'])('hides raw connection errors (%s)', code => {
    const message = describeSupabaseError({ code, message: `driver exposed ${valid}` });
    expect(message).not.toContain(valid);
    expect(message).not.toContain('private-test-only');
    expect(message.length).toBeGreaterThan(30);
  });
});

describe('local startup with Supabase setup', () => {
  it('opens setup for an HTTPS value and uses the corrected saved URI immediately', async () => {
    const runSetup = vi.fn().mockResolvedValue(undefined);
    const readSettings = vi.fn().mockResolvedValue({ SUPABASE_DATABASE_URL: valid });
    const log = vi.fn();
    const result = await prepareLocalSupabase({ ...config, supabaseDatabaseUrl: config.supabaseUrl }, { interactive: true, runSetup, readSettings, log });
    expect(runSetup).toHaveBeenCalledOnce();
    expect(result.supabaseDatabaseUrl).toBe(valid);
    expect(log.mock.calls.flat().join(' ')).not.toContain('private-test-only');
  });

  it.each([{ production: true, interactive: true }, { production: false, interactive: false }])('fails without prompting for hosted or unattended startup (%j)', async ({ production, interactive }) => {
    const runSetup = vi.fn();
    await expect(prepareLocalSupabase({ ...config, production, supabaseDatabaseUrl: config.supabaseUrl }, { interactive, runSetup })).rejects.toMatchObject({ code: 'SUPABASE_URI_PROTOCOL' });
    expect(runSetup).not.toHaveBeenCalled();
  });

  it('starts normally when the connection is already valid', async () => {
    const runSetup = vi.fn(), readSettings = vi.fn();
    const ready = { ...config, supabaseDatabaseUrl: valid };
    expect(await prepareLocalSupabase(ready, { interactive: true, runSetup, readSettings })).toBe(ready);
    expect(runSetup).not.toHaveBeenCalled();
    expect(readSettings).not.toHaveBeenCalled();
  });

  it('stops startup when setup is cancelled', async () => {
    const readSettings = vi.fn();
    await expect(prepareLocalSupabase(config, { interactive: true, runSetup: async () => { throw new Error('Cancelled'); }, readSettings, log() {} })).rejects.toThrow('Cancelled');
    expect(readSettings).not.toHaveBeenCalled();
  });
});
