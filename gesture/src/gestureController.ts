import { gestureBus } from './eventBus';
import type { GestureState } from './gestureDetector';
import type { GestureEvent, NDC } from './types';

/**
 * Turns the per-frame (raw, jittery) detector output into stable, debounced
 * gesture *events* on the bus. This is where "reliably triggering" is won:
 *
 *  - Hysteresis on the pinch ratio (separate enter/exit thresholds) so pinch
 *    doesn't flicker around the boundary.
 *  - Debounce on point (N consecutive frames to enter/exit) to reject blips.
 *  - EMA smoothing on the cursor so the highlight ray doesn't twitch.
 *  - A 3-state machine (idle / point / pinch) where pinch always wins.
 *
 * The detector stays pure; all timing/state lives here.
 */
export type Mode = 'idle' | 'point' | 'pinch';

export interface ControllerOptions {
  /** Pinch enters when ratio drops below this. */
  pinchOn?: number;
  /** Pinch exits when ratio rises above this (must be > pinchOn). */
  pinchOff?: number;
  /** Consecutive frames required to enter/exit the point state. */
  debounceFrames?: number;
  /** EMA smoothing factor for the cursor, 0..1 (higher = more responsive). */
  smoothing?: number;
  /** Where to emit events. Defaults to the shared gestureBus. */
  emit?: (e: GestureEvent) => void;
}

export class GestureController {
  private readonly pinchOn: number;
  private readonly pinchOff: number;
  private readonly debounce: number;
  private readonly alpha: number;
  private readonly emit: (e: GestureEvent) => void;

  private mode: Mode = 'idle';
  private rawPinch = false;
  private pointOn = 0;
  private pointOff = 0;
  private smoothed: NDC | null = null;

  constructor(opts: ControllerOptions = {}) {
    this.pinchOn = opts.pinchOn ?? 0.35;
    this.pinchOff = opts.pinchOff ?? 0.5;
    this.debounce = opts.debounceFrames ?? 3;
    this.alpha = opts.smoothing ?? 0.5;
    this.emit = opts.emit ?? ((e) => gestureBus.emit(e));
  }

  /** Current stable mode (for HUD/debug). */
  get state(): Mode {
    return this.mode;
  }

  /** Feed one detector frame; emits transition/move events as needed. */
  update(state: GestureState): void {
    const target = this.computeTarget(state);
    const active = target !== 'idle';
    const cursor = this.smoothCursor(state.cursor, active);

    if (target !== this.mode) {
      this.exit(this.mode);
      this.mode = target;
      this.enter(target, cursor);
    } else {
      this.moveWithin(this.mode, cursor);
    }
  }

  /** Force back to idle (e.g. camera stopped), emitting any needed end events. */
  reset(): void {
    this.exit(this.mode);
    this.mode = 'idle';
    this.rawPinch = false;
    this.pointOn = 0;
    this.pointOff = 0;
    this.smoothed = null;
  }

  private computeTarget(state: GestureState): Mode {
    const hasHand = state.cursor !== null;
    if (!hasHand) {
      this.rawPinch = false;
      this.pointOn = 0;
      this.pointOff = this.debounce;
      return 'idle';
    }

    // Pinch hysteresis.
    if (this.rawPinch) {
      if (state.pinchRatio > this.pinchOff) this.rawPinch = false;
    } else if (state.pinchRatio < this.pinchOn) {
      this.rawPinch = true;
    }
    if (this.rawPinch) {
      this.pointOn = 0;
      this.pointOff = this.debounce;
      return 'pinch';
    }

    // Point debounce: need `debounce` consecutive on to enter, off to exit.
    if (state.point) {
      this.pointOn = Math.min(this.debounce, this.pointOn + 1);
      this.pointOff = 0;
    } else {
      this.pointOff = Math.min(this.debounce, this.pointOff + 1);
      this.pointOn = 0;
    }
    if (this.mode === 'point') {
      return this.pointOff >= this.debounce ? 'idle' : 'point';
    }
    return this.pointOn >= this.debounce ? 'point' : 'idle';
  }

  private smoothCursor(c: NDC | null, active: boolean): NDC | null {
    if (!c) {
      this.smoothed = null;
      return null;
    }
    if (!active || !this.smoothed) {
      this.smoothed = { x: c.x, y: c.y }; // snap on (re)entry
      return this.smoothed;
    }
    this.smoothed = {
      x: this.alpha * c.x + (1 - this.alpha) * this.smoothed.x,
      y: this.alpha * c.y + (1 - this.alpha) * this.smoothed.y,
    };
    return this.smoothed;
  }

  private enter(mode: Mode, cursor: NDC | null): void {
    if (!cursor) return;
    if (mode === 'pinch') this.emit({ type: 'pinch_start', ndc: cursor });
    else if (mode === 'point') this.emit({ type: 'point', ndc: cursor });
  }

  private moveWithin(mode: Mode, cursor: NDC | null): void {
    if (!cursor) return;
    if (mode === 'pinch') this.emit({ type: 'pinch_move', ndc: cursor });
    else if (mode === 'point') this.emit({ type: 'point', ndc: cursor });
  }

  private exit(mode: Mode): void {
    if (mode === 'pinch') this.emit({ type: 'pinch_end' });
    else if (mode === 'point') this.emit({ type: 'point_end' });
  }
}
