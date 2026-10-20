import { describe, expect, it, vi } from 'vitest';
import { MysqlStore } from '../src/repositories/mysql-store.js';

function fixture() {
  const connection = { query: vi.fn().mockResolvedValue([[]]), execute: vi.fn().mockResolvedValue([[{ id: 1 }]]),
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
  const store = new MysqlStore({ getConnection: vi.fn().mockResolvedValue(connection) });
  return { store, connection };
}
describe('MySQL transaction lifecycle', () => {
  it('acquires the shared database lock before work and resolves only after commit', async () => {
    const { store, connection } = fixture();
    await expect(store.withWriteLock(async db => {
      expect(db).toBe(connection);
      expect(connection.execute).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'));
      expect(connection.commit).not.toHaveBeenCalled(); return 42;
    })).resolves.toBe(42);
    expect(connection.commit).toHaveBeenCalledOnce(); expect(connection.rollback).not.toHaveBeenCalled(); expect(connection.release).toHaveBeenCalledOnce();
  });
  it('rolls back work errors and releases the connection', async () => {
    const { store, connection } = fixture();
    await expect(store.withWriteLock(async () => { throw new Error('failed insert'); })).rejects.toThrow('failed insert');
    expect(connection.rollback).toHaveBeenCalledOnce(); expect(connection.commit).not.toHaveBeenCalled(); expect(connection.release).toHaveBeenCalledOnce();
  });
  it('never confirms a draw on commit failure', async () => {
    const { store, connection } = fixture();
    connection.commit.mockRejectedValueOnce(new Error('connection lost'));
    await expect(store.withWriteLock(async () => ({ winner: '42' }))).rejects.toThrow('connection lost');
    expect(connection.rollback).toHaveBeenCalledOnce(); expect(connection.release).toHaveBeenCalledOnce();
  });
  it('refuses to draw if the shared lock row is missing', async () => {
    const { store, connection } = fixture(); const work = vi.fn();
    connection.execute.mockResolvedValueOnce([[]]);
    await expect(store.withWriteLock(work)).rejects.toThrow('Missing draw lock');
    expect(work).not.toHaveBeenCalled(); expect(connection.rollback).toHaveBeenCalledOnce();
  });
});
