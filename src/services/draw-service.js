import { randomInt } from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { getPeriod, sqlUtc } from '../utils/time.js';

export class DrawService {
  constructor(store, { timezone, now = () => new Date(), chooseIndex = randomInt, liveDraws = false }) {
    Object.assign(this, { store, timezone, now, chooseIndex, liveDraws });
  }

  period() { return getPeriod(this.now(), this.timezone); }

  async eligible() {
    const period = this.period();
    return { period, participants: await this.store.eligible(period) };
  }

  async status() {
    return this.store.withSnapshot(async db => {
      const period = this.period();
      // A single connection and snapshot keep these counters mutually consistent.
      const counts = await this.store.counts(db);
      const participants = await this.store.eligible(period, db);
      const winners = await this.store.winners({ month: period.month, year: period.year }, db);
      return { period, counts: { ...counts, remaining: participants.length, winners: winners.total }, participants, winners };
    });
  }

  winners(query) {
    const period = this.period();
    return this.store.winners(query.scope === 'all' ? query : { ...query, month: query.month || period.month, year: query.year || period.year });
  }

  async refreshDisplay(db, liveOverride) {
    if (!this.store.savePublicDisplay) return null;
    const period = this.period();
    const previous = await this.store.getPublicDisplay(db);
    const samePeriod = previous?.period.month === period.month && previous?.period.year === period.year;
    const live = liveOverride === undefined ? (samePeriod ? previous.live : null) : liveOverride;
    const participants = (await this.store.eligible(period, db)).map(({ id, name }) => ({ id, name }));
    const history = await this.store.winners({ month: period.month, year: period.year, limit: 1 }, db);
    const display = { period, participants, latestWinner: history.items[0] || null, live: live || null };
    await this.store.savePublicDisplay(display, db);
    this.publicCache = null;
    return display;
  }

  async publicState() {
    const now = this.now(), period = getPeriod(now, this.timezone);
    let usingCache = this.publicCache && this.publicCache.until > Date.now();
    let display = usingCache ? this.publicCache.display : await this.store.getPublicDisplay?.();
    if (!display || display.period.month !== period.month || display.period.year !== period.year) {
      display = await this.store.withWriteLock(db => this.refreshDisplay(db));
      usingCache = false;
    }
    if (!display) throw new AppError(503, 'LIVE_VIEW_UNAVAILABLE', 'The live draw is not configured.');
    if (!usingCache) this.publicCache = { display, until: Date.now() + 750 };
    const live = display.live || null;
    const inProgress = Boolean(live && now.getTime() < live.endsAt);
    return { period: display.period, participants: display.participants,
      winner: inProgress ? live.previousWinner : display.latestWinner,
      live, inProgress, serverTime: now.getTime() };
  }

  async spin(adminId, key) {
    try {
      return await this.store.withWriteLock(async db => {
        const existing = await this.store.findDrawRequest(adminId, key, db);
        if (existing) return { ...existing, replayed: true };
        // Calculate after acquiring the lock, including when a request waited across midnight.
        const now = this.now();
        const period = getPeriod(now, this.timezone);
        const display = this.liveDraws ? await this.store.getPublicDisplay(db) : null;
        if (display?.live && now.getTime() < display.live.endsAt) {
          throw new AppError(409, 'DRAW_IN_PROGRESS', 'A draw is already spinning. Wait for the winner before starting another.');
        }
        const participants = await this.store.eligible(period, db);
        if (!participants.length) throw new AppError(409, 'NO_ELIGIBLE_PARTICIPANTS', 'No eligible participants remain this month.');
        const winnerIndex = this.chooseIndex(participants.length);
        const selected = participants[winnerIndex];
        const winner = await this.store.insertWinner({
          member_id: selected.id, name: selected.name,
          draw_month: period.month, draw_year: period.year, won_at: sqlUtc(now)
        }, db);
        const response = {
          winner, period, remainingCount: participants.length - 1,
          wheel: { participants, winnerIndex }, replayed: false
        };
        if (this.liveDraws) {
          const samePeriod = display?.period.month === period.month && display?.period.year === period.year;
          response.live = {
            id: winner.id, period, winner,
            previousWinner: samePeriod ? display.latestWinner : null,
            wheel: { winnerIndex, participants: participants.map(({ id, name }) => ({ id, name })) },
            startsAt: now.getTime() + 1000, durationMs: 5500, endsAt: now.getTime() + 6500
          };
          await this.refreshDisplay(db, response.live);
        }
        await this.store.saveDrawRequest(adminId, key, response, db);
        return response; // withWriteLock only resolves after COMMIT succeeds.
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
        throw new AppError(409, 'DRAW_CONFLICT', 'The draw changed concurrently. Refresh the dashboard before drawing again.');
      }
      throw error;
    }
  }
}
