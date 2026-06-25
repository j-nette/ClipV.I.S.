import type { Landmark } from './types';

/**
 * One-Euro filter (Casiez et al. 2012): an adaptive low-pass filter that trades
 * lag for jitter based on speed. At rest it smooths hard (kills shake); as the
 * signal moves fast it loosens (low lag, so quick moves still track). Ideal for
 * noisy MediaPipe landmarks, which the Tasks API does NOT smooth itself.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff = 1.0,
    private readonly beta = 0.3,
    private readonly dCutoff = 1.0,
  ) {}

  /** Smoothing factor for a given cutoff frequency and timestep. */
  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** Filter one sample at time `t` (seconds). */
  filter(x: number, t: number): number {
    if (this.xPrev === null || !Number.isFinite(this.xPrev)) {
      this.xPrev = x;
      this.tPrev = t;
      this.dxPrev = 0;
      return x;
    }
    let dt = t - this.tPrev;
    if (!(dt > 0)) dt = 1 / 60; // guard against equal/again-stale timestamps
    this.tPrev = t;

    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    this.dxPrev = dxHat;

    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

export interface SmoothingOptions {
  /** Lower = smoother at rest (more shake removed), at the cost of a little lag. */
  minCutoff?: number;
  /** Higher = looser (less lag) as the hand moves faster. */
  beta?: number;
  /** Derivative cutoff; rarely needs changing. */
  dCutoff?: number;
}

/**
 * Per-hand landmark smoother. Keeps an independent One-Euro filter per landmark
 * coordinate, keyed by handedness label so left/right hands don't share state.
 */
export class HandSmoother {
  private readonly filters = new Map<string, OneEuroFilter[]>();

  constructor(private readonly opts: SmoothingOptions = {}) {}

  /** Smooth one hand's 21 landmarks at video time `tMs` (milliseconds). */
  smooth(label: string, landmarks: Landmark[], tMs: number): Landmark[] {
    const t = tMs / 1000;
    const need = landmarks.length * 3;
    let arr = this.filters.get(label);
    if (!arr || arr.length !== need) {
      const { minCutoff = 1.0, beta = 0.3, dCutoff = 1.0 } = this.opts;
      arr = Array.from({ length: need }, () => new OneEuroFilter(minCutoff, beta, dCutoff));
      this.filters.set(label, arr);
    }
    return landmarks.map((p, i) => ({
      x: arr![i * 3].filter(p.x, t),
      y: arr![i * 3 + 1].filter(p.y, t),
      z: arr![i * 3 + 2].filter(p.z, t),
    }));
  }

  /** Drop filter state for hands not present this frame (so a re-entry restarts clean). */
  retain(activeLabels: Set<string>): void {
    for (const label of [...this.filters.keys()]) {
      if (!activeLabels.has(label)) this.filters.delete(label);
    }
  }
}
