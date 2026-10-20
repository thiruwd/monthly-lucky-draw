import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DrawService } from '../src/services/draw-service.js';
import { MemberService } from '../src/services/member-service.js';
import { getPeriod } from '../src/utils/time.js';
import { MemoryStore } from './helpers/memory-store.js';

describe('monthly draw rules', () => {
  let store, draw, now;
  beforeEach(async () => {
    store = new MemoryStore();
    now = new Date('2026-10-15T08:30:00Z');
    draw = new DrawService(store, { timezone: 'Asia/Kolkata', now: () => now, chooseIndex: size => size - 1 });
    for (let i = 1; i <= 12; i++) await store.createMember({ name: `Participant ${i}`, member_code: null, email: null, is_active: true });
  });
  it('selects an eligible winner and returns the exact wheel snapshot and counts', async () => {
    const result = await draw.spin('1', 'draw-1');
    expect(result.winner.member_id).toBe('12');
    expect(result.winner.name).toBe('Participant 12');
    expect(result.wheel.participants[result.wheel.winnerIndex].id).toBe(result.winner.member_id);
    expect(result.remainingCount).toBe(11);
    expect(store.history).toHaveLength(1);
  });
  it('excludes winners in the same month without removing their membership', async () => {
    const result = await draw.spin('1', 'draw-1');
    expect((await draw.eligible()).participants.map(member => member.id)).not.toContain(result.winner.member_id);
    expect(await store.listMembers()).toHaveLength(12);
  });
  it('makes everyone eligible in the next calendar month and retains history', async () => {
    await draw.spin('1', 'draw-1');
    now = new Date('2026-10-31T18:30:00Z'); // November 1 in Kolkata.
    expect((await draw.eligible()).participants).toHaveLength(12);
    expect((await draw.spin('1', 'draw-2')).winner.draw_month).toBe(11);
    expect(store.history).toHaveLength(2);
  });
  it('excludes inactive participants, including when they are the only member', async () => {
    for (const member of store.members) member.is_active = false;
    await expect(draw.spin('1', 'empty')).rejects.toMatchObject({ code: 'NO_ELIGIBLE_PARTICIPANTS' });
    expect(store.history).toHaveLength(0);
  });
  it('permits the final participant to win, then rejects further draws', async () => {
    store.members = store.members.slice(0, 1);
    expect((await draw.spin('1', 'only')).remainingCount).toBe(0);
    await expect(draw.spin('1', 'none')).rejects.toMatchObject({ status: 409 });
  });
  it('serializes simultaneous draws so each eligible person wins once', async () => {
    const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => draw.spin('1', `parallel-${i}`)));
    const successful = results.filter(result => result.status === 'fulfilled');
    expect(successful).toHaveLength(12);
    expect(new Set(successful.map(result => result.value.winner.member_id)).size).toBe(12);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(4);
  });
  it('replays the same interaction once, even if two identical requests arrive together', async () => {
    const results = await Promise.all([draw.spin('1', 'same'), draw.spin('1', 'same')]);
    expect(results[0].winner.id).toBe(results[1].winner.id);
    expect(results[1].replayed).toBe(true);
    expect(store.history).toHaveLength(1);
  });
  it('rolls back the winner when saving the retry record fails', async () => {
    vi.spyOn(store, 'saveDrawRequest').mockRejectedValueOnce(new Error('write failed'));
    await expect(draw.spin('1', 'failed')).rejects.toThrow('write failed');
    expect(store.history).toHaveLength(0);
    expect((await draw.eligible()).participants).toHaveLength(12);
  });
  it('turns a duplicate-key race into a conflict without a false success', async () => {
    vi.spyOn(store, 'insertWinner').mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }));
    await expect(draw.spin('1', 'duplicate')).rejects.toMatchObject({ code: 'DRAW_CONFLICT', status: 409 });
  });
  it('preserves the draw name when a participant is renamed or deleted', async () => {
    const result = await draw.spin('1', 'first');
    const members = new MemberService(store);
    await members.save(result.winner.member_id, { name: 'A different name', member_code: null, email: null, is_active: true });
    await members.remove(result.winner.member_id);
    expect((await draw.winners({ scope: 'all' })).items[0].name).toBe('Participant 12');
    expect(await store.listMembers()).toHaveLength(11);
  });
});

describe('calendar boundaries', () => {
  it.each([
    ['2026-12-31T18:29:59Z', 'Asia/Kolkata', 12, 2026],
    ['2026-12-31T18:30:00Z', 'Asia/Kolkata', 1, 2027],
    ['2026-11-01T03:59:59Z', 'America/New_York', 10, 2026],
    ['2026-11-01T04:00:00Z', 'America/New_York', 11, 2026],
    ['2026-10-31T23:59:59Z', 'UTC', 10, 2026]
  ])('uses the configured timezone at %s', (value, timezone, month, year) => {
    expect(getPeriod(new Date(value), timezone)).toEqual({ month, year, timezone });
  });
});
