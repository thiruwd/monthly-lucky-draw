import { describe, expect, it } from 'vitest';
import { TAU, planSpin, indexAtPointer, easeOutQuint } from '../public/js/wheel-math.js';

describe('server-selected wheel mapping', () => {
  it.each([1, 2, 3, 10, 12, 29, 64, 150])('lands exactly on every server index with %i segments', count => {
    for (let index = 0; index < count; index++) {
      for (const start of [0, 0.125, TAU - 0.01, TAU * 11 + 0.85]) {
        const end = planSpin(start, index, count);
        expect(indexAtPointer(end, count)).toBe(index);
        expect(end - start).toBeGreaterThanOrEqual(6 * TAU - 1e-10);
      }
    }
  });
  it('rejects invalid and empty snapshots', () => {
    expect(() => planSpin(0, 0, 0)).toThrow();
    expect(() => planSpin(0, 5, 5)).toThrow();
    expect(() => planSpin(0, -1, 5)).toThrow();
    expect(indexAtPointer(0, 0)).toBe(-1);
  });
  it('decelerates to a fixed end position', () => {
    expect(easeOutQuint(0)).toBe(0); expect(easeOutQuint(1)).toBe(1);
    expect(easeOutQuint(0.5) - easeOutQuint(0.25)).toBeGreaterThan(easeOutQuint(0.75) - easeOutQuint(0.5));
  });
});
