import { TAU, planSpin, normalizeAngle, easeOutQuint, liveProgress, liveRotation } from './wheel-math.js';

const colors = ['#204e42', '#dfb792', '#d8e7bc', '#f0e8d2', '#94b7a2', '#bcb5cf', '#cbd79d', '#e2b49e'];

export class Wheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.participants = [];
    this.rotation = 0;
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
  }

  setParticipants(participants) { this.participants = participants; this.rotation = 0; this.draw(); }

  draw() {
    const size = this.canvas.getBoundingClientRect().width;
    if (!size) return;
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(size * ratio)) {
      this.canvas.width = this.canvas.height = Math.round(size * ratio);
    }
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const radius = size / 2;
    const count = this.participants.length;
    if (!count) {
      ctx.fillStyle = '#eff2e8';
      ctx.beginPath(); ctx.arc(radius, radius, radius, 0, TAU); ctx.fill();
      for (let index = 0; index < 12; index++) {
        ctx.save(); ctx.translate(radius, radius); ctx.rotate(index * TAU / 12);
        ctx.strokeStyle = '#e0e7d8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -radius); ctx.stroke(); ctx.restore();
      }
      return;
    }
    const arc = TAU / count;
    this.participants.forEach((participant, index) => {
      const start = -Math.PI / 2 + index * arc + this.rotation;
      ctx.beginPath(); ctx.moveTo(radius, radius); ctx.arc(radius, radius, radius, start, start + arc); ctx.closePath();
      // Avoid adjacent equal colors at the wrap-around seam.
      const colorIndex = index === count - 1 && index > 0 && index % colors.length === 0 ? 4 : index % colors.length;
      ctx.fillStyle = colors[colorIndex]; ctx.fill(); ctx.strokeStyle = '#ffffff88'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.save(); ctx.translate(radius, radius); ctx.rotate(start + arc / 2);
      const fontSize = Math.min(12, Math.max(3, radius * arc * 0.35));
      ctx.fillStyle = colorIndex === 0 ? '#ffffff' : '#344c3c';
      ctx.font = `600 ${fontSize}px "Segoe UI", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
      let label = participant.name;
      const maxWidth = radius * 0.66;
      const chars = Array.from(label);
      while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxWidth) chars.pop();
      if (chars.length < Array.from(label).length) label = `${chars.join('')}…`;
      ctx.fillText(label, radius - 17, 0, maxWidth);
      ctx.restore();
    });
  }

  async spin(winnerIndex, count) {
    const start = this.rotation;
    const end = planSpin(start, winnerIndex, count);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 5500;
    await new Promise(resolve => {
      const began = performance.now();
      const frame = timestamp => {
        const progress = Math.min(1, (timestamp - began) / duration);
        this.rotation = start + (end - start) * easeOutQuint(progress);
        this.draw();
        if (progress < 1) requestAnimationFrame(frame);
        else { this.rotation = normalizeAngle(end); this.draw(); resolve(); }
      };
      requestAnimationFrame(frame);
    });
  }

  async animateLive(live, getServerTime) {
    const count = live.wheel.participants.length;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setParticipants(live.wheel.participants);
    await new Promise(resolve => {
      const frame = () => {
        const now = getServerTime();
        this.rotation = reducedMotion && now < live.endsAt ? 0 : liveRotation(now, live.startsAt, live.durationMs, live.wheel.winnerIndex, count);
        this.draw();
        if (liveProgress(now, live.startsAt, live.durationMs) < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }
}
