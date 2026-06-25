import { describe, it, expect } from 'vitest';
import { OneEuroFilter, HandSmoother } from '../src/smoothing';

describe('OneEuroFilter', () => {
  it('reduces jitter around a steady value', () => {
    const f = new OneEuroFilter(1.0, 0.3, 1.0);
    const raw: number[] = [];
    const out: number[] = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      t += 1 / 60;
      const noisy = 0.5 + (Math.sin(i * 12.9898) * 43758.5453) % 0.02; // pseudo-noise ±0.02
      raw.push(noisy);
      out.push(f.filter(noisy, t));
    }
    const variance = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    };
    // Ignore the warm-up while the filter seeds.
    expect(variance(out.slice(30))).toBeLessThan(variance(raw.slice(30)));
  });

  it('converges toward a new steady value after a step', () => {
    const f = new OneEuroFilter(1.0, 0.3, 1.0);
    let t = 0;
    f.filter(0, (t += 1 / 60)); // seed at 0
    let v = 0;
    for (let i = 0; i < 60; i++) v = f.filter(1, (t += 1 / 60)); // step to 1
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('passes the very first sample through unchanged', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.42, 0)).toBe(0.42);
  });
});

describe('HandSmoother', () => {
  it('keeps per-hand state separate by label', () => {
    const s = new HandSmoother({ minCutoff: 1, beta: 0.3 });
    const lm = (x: number) => Array.from({ length: 21 }, () => ({ x, y: x, z: x }));
    s.smooth('Left', lm(0), 0);
    s.smooth('Right', lm(1), 0);
    // Each hand converges toward its own input, not a shared average.
    let left = s.smooth('Left', lm(0), 1000);
    let right = s.smooth('Right', lm(1), 1000);
    for (let i = 2; i < 40; i++) {
      left = s.smooth('Left', lm(0), i * 1000);
      right = s.smooth('Right', lm(1), i * 1000);
    }
    expect(left[0].x).toBeLessThan(0.1);
    expect(right[0].x).toBeGreaterThan(0.9);
  });
});
