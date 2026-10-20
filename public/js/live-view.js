import { Wheel } from './wheel.js';

export const element = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
};
export function periodLabel(period) {
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(period.year, period.month - 1, 15)));
}
export function celebrate() {
  if (typeof confetti === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches) confetti({ particleCount: 100, spread: 85, origin: { y: 0.58 }, colors: ['#d9edb7', '#214f43', '#dfb792', '#bcb5cf'], disableForReducedMotion: true });
}

export class LiveView {
  constructor({ onState = () => {}, onBusy = () => {}, onWinner = () => {}, onConnection = () => {} } = {}) {
    Object.assign(this, { onState, onBusy, onWinner, onConnection });
    this.wheel = new Wheel(document.getElementById('live-wheel'));
    this.offset = 0; this.animating = false; this.connected = false; this.finished = new Set();
  }
  async refresh() {
    if (this.loading) return;
    this.loading = true;
    const before = Date.now();
    try {
      const response = await fetch('/api/public/draw', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || 'The draw could not be loaded.');
      this.offset = data.serverTime - (before + Date.now()) / 2;
      this.connected = true; this.connection('Connected live', false);
      this.accept(data);
    } catch { this.connected = false; this.connection('Reconnecting…', true); }
    finally { this.loading = false; this.onConnection(this.connected); }
  }
  connection(text, offline) {
    const indicator = document.getElementById('connection');
    indicator.textContent = text; indicator.classList.toggle('offline', offline);
    if (offline && !this.animating) document.getElementById('live-status').textContent = 'Connection lost. Reconnecting to the draw…';
  }
  accept(data) {
    this.current = data;
    document.getElementById('live-month').textContent = periodLabel(data.period);
    this.onState(data);
    const live = data.live;
    if (live && Date.now() + this.offset < live.endsAt && !this.finished.has(live.id)) {
      if (this.animating && this.runningId === live.id) return;
      if (this.animating) return;
      const selected = live.wheel.participants[live.wheel.winnerIndex];
      if (!selected || selected.id !== live.winner.member_id) { this.connection('Draw unavailable', true); return; }
      this.animating = true; this.runningId = live.id; this.onBusy(true);
      document.getElementById('live-status').textContent = 'The wheel is spinning. Good luck, everyone!';
      this.showWinner(live.previousWinner);
      this.wheel.animateLive(live, () => Date.now() + this.offset).then(() => {
        this.finished.add(live.id); this.animating = false;
        this.showWinner(live.winner);
        document.getElementById('live-status').textContent = `Congratulations, ${live.winner.name}!`;
        celebrate(); this.onBusy(false); this.onWinner(live.winner);
        // Leave the pointer on the confirmed winner briefly before removing them.
        setTimeout(() => { if (!this.animating) this.renderIdle(this.current); }, 1200);
      });
      return;
    }
    if (!this.animating) { this.onBusy(false); this.renderIdle(data); }
  }
  showWinner(winner) {
    document.getElementById('live-winner').textContent = winner?.name || 'Your next winner awaits';
    document.getElementById('live-winner-note').textContent = winner ? `Winner for ${periodLabel({ month: winner.draw_month, year: winner.draw_year })}` : 'The winner’s name will appear here after the spin.';
  }
  renderIdle(data) {
    if (!data) return;
    this.wheel.setParticipants(data.participants);
    this.showWinner(data.live && this.finished.has(data.live.id) ? data.live.winner : data.winner);
    document.getElementById('live-status').textContent = data.participants.length ? 'Waiting for your host to start the next spin…' : data.winner ? 'This month’s draw is complete. See you next month!' : 'Your host is getting the draw ready.';
    const list = document.getElementById('accessible-names');
    if (list) list.replaceChildren(...data.participants.map(person => element('li', person.name)));
  }
  start() {
    this.refresh();
    this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 1500);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }
}
