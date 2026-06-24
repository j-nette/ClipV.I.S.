import { gestureBus } from './eventBus';
import type { HandObservation } from './gestureDetector';
import { INDEX_PALM_CLEARANCE, PINCH_THRESHOLD } from './gestureDetector';
import type { GestureEvent, NDC, Quat, ManipulationScope } from './types';
import { quatMultiply, quatConjugate, quatAngle, quatClampAngle, IDENTITY_QUAT } from './quat';

/**
 * Turns per-hand observations into stable manipulation events on the bus:
 *
 *  - **1 pinching hand → grab:** translate the object to follow the pinch anchor
 *    (pinch_start / pinch_move / pinch_end) AND rotate it by the hand's in-plane
 *    twist (rotate dz = roll delta).
 *  - **2 pinching hands → scale:** the object grows/shrinks as the two pinch
 *    anchors move apart/together (zoom delta from their distance ratio).
 *  - **0 pinching, 1 pointing → point:** highlight (point / point_end).
 *
 * The detector stays pure; all timing/state (pinch hysteresis, smoothing,
 * clamping) lives here. Per-hand pinch state is keyed by handedness label so
 * frame-to-frame hand ordering doesn't corrupt it.
 */
export type Mode = 'idle' | 'point' | 'grab' | 'scale';

export interface ControllerOptions {
  /** Pinch enters when ratio drops below this. */
  pinchOn?: number;
  /** Pinch exits when ratio rises above this (must be > pinchOn). */
  pinchOff?: number;
  /** Min index-to-palm clearance to count as a pinch (rejects a fist). */
  palmClearance?: number;
  /** EMA smoothing factor for the grab anchor, 0..1 (higher = more responsive). */
  smoothing?: number;
  /** Min |roll delta| (radians) before a rotate is emitted — kills jitter. */
  rotateDeadzone?: number;
  /** Max |roll delta| (radians) per frame — kills wrap/teleport spikes. */
  rotateClamp?: number;
  /** Max |zoom delta| per frame. */
  zoomClamp?: number;
  /** Where to emit events. Defaults to the shared gestureBus. */
  emit?: (e: GestureEvent) => void;
}

export class GestureController {
  private readonly pinchOn: number;
  private readonly pinchOff: number;
  private readonly palmClearance: number;
  private readonly alpha: number;
  private readonly rotateDeadzone: number;
  private readonly rotateClamp: number;
  private readonly zoomClamp: number;
  private readonly emit: (e: GestureEvent) => void;

  private mode: Mode = 'idle';
  /** Hysteretic pinch state per hand label. */
  private readonly pinchState = new Map<string, boolean>();

  // grab session
  private activeLabel: string | null = null;
  private prevOrient: Quat = IDENTITY_QUAT;
  private smoothed: NDC | null = null;
  // scale session
  private prevDist = 0;
  // What the current grab/scale session acts on (locked at entry).
  private scope: ManipulationScope = 'object';

  constructor(opts: ControllerOptions = {}) {
    // PINCH_THRESHOLD is the single source of truth: a pinch enters when the
    // ratio drops below it. pinchOff sits a touch above for release hysteresis.
    this.pinchOn = opts.pinchOn ?? PINCH_THRESHOLD;
    this.pinchOff = opts.pinchOff ?? PINCH_THRESHOLD + 0.1;
    this.palmClearance = opts.palmClearance ?? INDEX_PALM_CLEARANCE;
    this.alpha = opts.smoothing ?? 0.5;
    this.rotateDeadzone = opts.rotateDeadzone ?? 0.01;
    this.rotateClamp = opts.rotateClamp ?? 0.3;
    this.zoomClamp = opts.zoomClamp ?? 0.1;
    this.emit = opts.emit ?? ((e) => gestureBus.emit(e));
  }

  /** Current stable mode (for HUD/debug). */
  get state(): Mode {
    return this.mode;
  }

  /** What the active grab/scale session targets (object vs whole assembly). */
  get scopeState(): ManipulationScope {
    return this.scope;
  }

  /** Feed one frame of per-hand observations; emits transition/move events. */
  update(hands: HandObservation[]): void {
    // Per-hand pinch hysteresis.
    const pinching: HandObservation[] = [];
    const seen = new Set<string>();
    for (const h of hands) {
      seen.add(h.label);
      if (this.applyHysteresis(h)) pinching.push(h);
    }
    // Forget hands that disappeared.
    for (const label of [...this.pinchState.keys()]) {
      if (!seen.has(label)) this.pinchState.delete(label);
    }

    const pointing = hands.find((h) => h.point && !this.pinchState.get(h.label)) ?? null;
    const target: Mode =
      pinching.length >= 2 ? 'scale' : pinching.length === 1 ? 'grab' : pointing ? 'point' : 'idle';

    if (target !== this.mode) {
      this.exit(this.mode);
      this.mode = target;
      this.enter(target, pinching, pointing);
    } else {
      this.within(target, pinching, pointing);
    }
  }

  /** Force back to idle (e.g. camera stopped), emitting any needed end events. */
  reset(): void {
    this.exit(this.mode);
    this.mode = 'idle';
    this.pinchState.clear();
    this.activeLabel = null;
    this.smoothed = null;
  }

  /** Updates and returns the hysteretic pinch state for a hand. */
  private applyHysteresis(h: HandObservation): boolean {
    // The index must stay clear of the palm, or it's a fist (never a pinch).
    const clear = h.indexPalmClearance > this.palmClearance;
    const was = this.pinchState.get(h.label) ?? false;
    let now = was;
    if (was) {
      // Release when the fingers open OR the hand curls into a fist.
      if (h.pinchRatio > this.pinchOff || !clear) now = false;
    } else if (h.pinchRatio < this.pinchOn && clear) {
      now = true;
    }
    this.pinchState.set(h.label, now);
    return now;
  }

  private enter(mode: Mode, pinching: HandObservation[], pointing: HandObservation | null): void {
    if (mode === 'grab') {
      const h = pinching[0];
      this.activeLabel = h.label;
      this.prevOrient = h.orient;
      this.smoothed = { ...h.anchor };
      // Three-finger pinch manipulates the whole assembly; two-finger, one object.
      this.scope = h.threeFinger ? 'assembly' : 'object';
      this.emit({ type: 'pinch_start', ndc: this.smoothed, scope: this.scope });
    } else if (mode === 'scale') {
      // Assembly scale needs both hands three-fingered; otherwise object scale.
      this.scope = pinching[0].threeFinger && pinching[1].threeFinger ? 'assembly' : 'object';
      this.prevDist = anchorDist(pinching[0], pinching[1]);
    } else if (mode === 'point' && pointing) {
      this.emit({ type: 'point', ndc: pointing.cursor });
    }
  }

  private within(mode: Mode, pinching: HandObservation[], pointing: HandObservation | null): void {
    if (mode === 'grab') {
      const h = pinching.find((p) => p.label === this.activeLabel) ?? pinching[0];
      // Translate: smooth the anchor and follow it.
      this.smoothed = this.smoothed
        ? {
            x: this.alpha * h.anchor.x + (1 - this.alpha) * this.smoothed.x,
            y: this.alpha * h.anchor.y + (1 - this.alpha) * this.smoothed.y,
          }
        : { ...h.anchor };
      this.emit({ type: 'pinch_move', ndc: this.smoothed, scope: this.scope });
      // Rotate: 3D hand-orientation delta → rotate on every axis, clamped.
      const delta = quatMultiply(h.orient, quatConjugate(this.prevOrient));
      this.prevOrient = h.orient;
      if (quatAngle(delta) >= this.rotateDeadzone) {
        this.emit({ type: 'rotate', q: quatClampAngle(delta, this.rotateClamp), scope: this.scope });
      }
    } else if (mode === 'scale') {
      const d = anchorDist(pinching[0], pinching[1]);
      if (this.prevDist > 1e-4) {
        const delta = clamp(d / this.prevDist - 1, -this.zoomClamp, this.zoomClamp);
        if (delta !== 0) this.emit({ type: 'zoom', delta, scope: this.scope });
      }
      this.prevDist = d;
    } else if (mode === 'point' && pointing) {
      this.emit({ type: 'point', ndc: pointing.cursor });
    }
  }

  private exit(mode: Mode): void {
    if (mode === 'grab') {
      this.activeLabel = null;
      this.smoothed = null;
      this.emit({ type: 'pinch_end', scope: this.scope });
    } else if (mode === 'point') {
      this.emit({ type: 'point_end' });
    }
  }
}

function anchorDist(a: HandObservation, b: HandObservation): number {
  return Math.hypot(a.anchor.x - b.anchor.x, a.anchor.y - b.anchor.y);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
