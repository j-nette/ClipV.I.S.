import { gestureBus } from './eventBus';
import type { HandObservation } from './gestureDetector';
import { INDEX_PALM_CLEARANCE, PINCH_THRESHOLD } from './gestureDetector';
import type { GestureEvent, NDC, ManipulationScope } from './types';
import { quatMultiply, quatFromAxisAngle } from './quat';

/**
 * Turns per-hand observations into stable manipulation events on the bus.
 *
 * Two-hand split (no wrist twisting):
 *  - **Right hand pinch → translate** the target: follow the pinch anchor
 *    (pinch_start / pinch_move / pinch_end) plus push/pull along camera Z (depth).
 *  - **Left hand pinch → rotate** the target by MOVING the hand: horizontal
 *    travel → yaw, vertical travel → pitch (no roll). Move the left hand left to
 *    spin the object left.
 *  - Either hand's pinch type picks the scope: two-finger = one object,
 *    three-finger = the whole assembly.
 *  - **0 pinching, 1 pointing → point:** highlight (point / point_end).
 *
 * Both hands can act at once (right translates while left rotates). The detector
 * stays pure; all timing/state (pinch hysteresis, smoothing, clamping) lives
 * here. Per-hand state is keyed by handedness label so frame-to-frame hand
 * ordering doesn't corrupt it.
 */
export type Mode = 'idle' | 'point' | 'grab' | 'scale';

const AXIS_X = { x: 1, y: 0, z: 0 };
const AXIS_Y = { x: 0, y: 1, z: 0 };

export interface ControllerOptions {
  /** Pinch enters when ratio drops below this. */
  pinchOn?: number;
  /** Pinch exits when ratio rises above this (must be > pinchOn). */
  pinchOff?: number;
  /** Min index-to-palm clearance to count as a pinch (rejects a fist). */
  palmClearance?: number;
  /** EMA smoothing factor for anchors, 0..1 (higher = more responsive). */
  smoothing?: number;
  /** Min |left-hand move| (NDC) per frame before a rotate is emitted — kills jitter. */
  rotateMoveDeadzone?: number;
  /** Radians of rotation per NDC unit of left-hand travel. */
  rotateGain?: number;
  /**
   * Radians of forward roll (about X) per unit change in the left hand's
   * apparent size: move the hand toward the screen to roll the item forward.
   */
  rotateDepthGain?: number;
  /** Max |rotation angle| (radians) per axis per frame — kills spikes. */
  rotateClamp?: number;
  /** Max |zoom delta| per frame (two-hand scale). */
  zoomClamp?: number;
  /** World units of camera-Z translation per unit change in apparent hand size. */
  depthGain?: number;
  /** Min |smoothed hand-size delta| before depth is emitted — kills jitter. */
  depthDeadzone?: number;
  /** Max |depth delta| (world units) per frame — kills spikes. */
  depthClamp?: number;
  /**
   * Swap which detected hand translates vs. rotates. Default: Right translates,
   * Left rotates. Flip this if the camera feed is mirrored the other way.
   */
  swapHandedness?: boolean;
  /** Where to emit events. Defaults to the shared gestureBus. */
  emit?: (e: GestureEvent) => void;
}

export class GestureController {
  private readonly pinchOn: number;
  private readonly pinchOff: number;
  private readonly palmClearance: number;
  private readonly alpha: number;
  private readonly rotateMoveDeadzone: number;
  private readonly rotateGain: number;
  private readonly rotateDepthGain: number;
  private readonly rotateClamp: number;
  private readonly zoomClamp: number;
  private readonly depthGain: number;
  private readonly depthDeadzone: number;
  private readonly depthClamp: number;
  private readonly swapHandedness: boolean;
  private readonly emit: (e: GestureEvent) => void;

  private mode: Mode = 'idle';
  /** Hysteretic pinch state per hand label. */
  private readonly pinchState = new Map<string, boolean>();
  /** Hysteretic create-pose state per hand label. */
  private readonly createPoseState = new Map<string, boolean>();

  // translation session (right hand)
  private transActive = false;
  private transLabel: string | null = null;
  private smoothed: NDC | null = null;
  private transScope: ManipulationScope = 'object';
  /** Smoothed apparent hand size, and the last value depth was emitted from. */
  private smoothedDepth = 0;
  private prevDepth = 0;

  // rotation session (left hand)
  private rotActive = false;
  private rotLabel: string | null = null;
  private rotSmoothed: NDC | null = null;
  private rotScope: ManipulationScope = 'object';
  /** Smoothed left-hand size + last value depth-roll was measured from. */
  private rotSmoothedDepth = 0;
  private rotPrevDepth = 0;

  // point session
  private pointActive = false;

  // scale session (both hands pinching)
  private scaleActive = false;
  private scaleScope: ManipulationScope = 'object';
  private prevDist = 0;

  /** Most recent manipulation scope (object vs whole assembly), for the HUD. */
  private scope: ManipulationScope = 'object';

  constructor(opts: ControllerOptions = {}) {
    // PINCH_THRESHOLD is the single source of truth: a pinch enters when the
    // ratio drops below it. pinchOff sits a touch above for release hysteresis.
    this.pinchOn = opts.pinchOn ?? PINCH_THRESHOLD;
    this.pinchOff = opts.pinchOff ?? PINCH_THRESHOLD + 0.1;
    this.palmClearance = opts.palmClearance ?? INDEX_PALM_CLEARANCE;
    this.alpha = opts.smoothing ?? 0.5;
    this.rotateMoveDeadzone = opts.rotateMoveDeadzone ?? 0.004;
    this.rotateGain = opts.rotateGain ?? 2.5;
    this.rotateDepthGain = opts.rotateDepthGain ?? 40;
    this.rotateClamp = opts.rotateClamp ?? 0.3;
    this.zoomClamp = opts.zoomClamp ?? 0.1;
    this.depthGain = opts.depthGain ?? 12;
    this.depthDeadzone = opts.depthDeadzone ?? 0.0015;
    this.depthClamp = opts.depthClamp ?? 0.25;
    this.swapHandedness = opts.swapHandedness ?? false;
    this.emit = opts.emit ?? ((e) => gestureBus.emit(e));
  }

  /** Current stable mode (for HUD/debug). */
  get state(): Mode {
    return this.mode;
  }

  /** What the active manipulation targets (object vs whole assembly). */
  get scopeState(): ManipulationScope {
    return this.scope;
  }

  /** Whether a specific hand (by handedness label) is currently pinching. */
  isPinching(label: string): boolean {
    return this.pinchState.get(label) ?? false;
  }

  /** Feed one frame of per-hand observations; emits transition/move events. */
  update(hands: HandObservation[]): void {
    // Per-hand pinch hysteresis + create-pose detection.
    const pinching: HandObservation[] = [];
    const seen = new Set<string>();
    for (const h of hands) {
      seen.add(h.label);
      const wasCreate = this.createPoseState.get(h.label) ?? false;
      const nowCreate = this.applyCreatePoseHysteresis(h);
      if (nowCreate && !wasCreate) this.emit({ type: 'orb_create', ndc: h.cursor });
      if (this.applyHysteresis(h)) pinching.push(h);
    }
    // Forget hands that disappeared.
    for (const label of [...this.pinchState.keys()]) {
      if (!seen.has(label)) this.pinchState.delete(label);
    }
    for (const label of [...this.createPoseState.keys()]) {
      if (!seen.has(label)) this.createPoseState.delete(label);
    }

    // Split by role: right hand translates, left hand rotates.
    const translator = pinching.find((h) => this.isTranslator(h.label)) ?? null;
    const rotator = pinching.find((h) => !this.isTranslator(h.label)) ?? null;

    // Both hands pinching → scale (distance between them). A single hand keeps
    // translating (right) or rotating (left).
    if (translator && rotator) {
      this.updateTranslation(null); // end any active translate/rotate first
      this.updateRotation(null);
      this.updateScale(translator, rotator);
    } else {
      this.updateScale(null, null); // end any active scale
      this.updateTranslation(translator);
      this.updateRotation(rotator);
    }

    // Pointing only matters when no hand is manipulating.
    const manipulating = this.transActive || this.rotActive || this.scaleActive;
    const pointing = manipulating
      ? null
      : (hands.find((h) => h.point && !this.pinchState.get(h.label)) ?? null);
    this.updatePoint(pointing);

    this.mode = this.scaleActive
      ? 'scale'
      : this.transActive || this.rotActive
        ? 'grab'
        : this.pointActive
          ? 'point'
          : 'idle';
  }

  /** Force back to idle (e.g. camera stopped), emitting any needed end events. */
  reset(): void {
    if (this.transActive) this.emit({ type: 'pinch_end', scope: this.transScope });
    if (this.rotActive) this.emit({ type: 'rotate_end', scope: this.rotScope });
    if (this.scaleActive) this.emit({ type: 'scale_end', scope: this.scaleScope });
    if (this.pointActive) this.emit({ type: 'point_end' });
    this.transActive = false;
    this.transLabel = null;
    this.smoothed = null;
    this.rotActive = false;
    this.rotLabel = null;
    this.rotSmoothed = null;
    this.scaleActive = false;
    this.pointActive = false;
    this.mode = 'idle';
    this.pinchState.clear();
    this.createPoseState.clear();
  }

  /** True when this handedness label drives translation (vs. rotation). */
  private isTranslator(label: string): boolean {
    const rightish = this.swapHandedness ? label === 'Left' : label === 'Right';
    const leftish = this.swapHandedness ? label === 'Right' : label === 'Left';
    if (rightish) return true;
    if (leftish) return false;
    return true; // unknown handedness → default to translation
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

  private applyCreatePoseHysteresis(h: HandObservation): boolean {
    const was = this.createPoseState.get(h.label) ?? false;
    let now = was;
    if (was) {
      if (h.createPoseRatio > this.pinchOff) now = false;
    } else if (h.createPoseRatio < this.pinchOn) {
      now = true;
    }
    this.createPoseState.set(h.label, now);
    return now;
  }

  /** Right-hand translation: follow the pinch anchor + push/pull along depth. */
  private updateTranslation(h: HandObservation | null): void {
    if (!h) {
      if (this.transActive) {
        this.emit({ type: 'pinch_end', scope: this.transScope });
        this.transActive = false;
        this.transLabel = null;
        this.smoothed = null;
      }
      return;
    }
    if (!this.transActive || this.transLabel !== h.label) {
      this.transActive = true;
      this.transLabel = h.label;
      this.smoothed = { ...h.anchor };
      this.smoothedDepth = h.depth;
      this.prevDepth = h.depth;
      this.transScope = h.threeFinger ? 'assembly' : 'object';
      this.scope = this.transScope;
      this.emit({ type: 'pinch_start', ndc: this.smoothed, scope: this.transScope });
      return;
    }
    // Translate: smooth the anchor and follow it.
    const prev = this.smoothed ?? h.anchor;
    this.smoothed = {
      x: this.alpha * h.anchor.x + (1 - this.alpha) * prev.x,
      y: this.alpha * h.anchor.y + (1 - this.alpha) * prev.y,
    };
    // Depth: push/pull along camera Z from the change in apparent hand size.
    // A per-frame VELOCITY — prevDepth advances every frame so a slow bias can
    // never accumulate and fling the object.
    this.smoothedDepth = this.alpha * h.depth + (1 - this.alpha) * this.smoothedDepth;
    const dDepth = this.smoothedDepth - this.prevDepth;
    this.prevDepth = this.smoothedDepth;
    let depth = 0;
    if (Math.abs(dDepth) >= this.depthDeadzone) {
      depth = clamp(dDepth * this.depthGain, -this.depthClamp, this.depthClamp);
    }
    this.emit({ type: 'pinch_move', ndc: this.smoothed, depth, scope: this.transScope });
  }

  /** Left-hand rotation: hand travel → yaw (horizontal) + pitch (vertical). */
  private updateRotation(h: HandObservation | null): void {
    if (!h) {
      if (this.rotActive) {
        this.emit({ type: 'rotate_end', scope: this.rotScope });
        this.rotActive = false;
        this.rotLabel = null;
        this.rotSmoothed = null;
      }
      return;
    }
    if (!this.rotActive || this.rotLabel !== h.label) {
      this.rotActive = true;
      this.rotLabel = h.label;
      this.rotSmoothed = { ...h.anchor };
      this.rotSmoothedDepth = h.depth;
      this.rotPrevDepth = h.depth;
      this.rotScope = h.threeFinger ? 'assembly' : 'object';
      this.scope = this.rotScope;
      // Announce the grab so the consumer can pick the part under this hand.
      this.emit({ type: 'rotate_start', ndc: h.anchor, scope: this.rotScope });
      return; // need a second frame to measure travel
    }
    const prev = this.rotSmoothed ?? h.anchor;
    const sm = {
      x: this.alpha * h.anchor.x + (1 - this.alpha) * prev.x,
      y: this.alpha * h.anchor.y + (1 - this.alpha) * prev.y,
    };
    const dx = sm.x - prev.x;
    const dy = sm.y - prev.y;
    this.rotSmoothed = sm;
    // Depth roll: move the hand toward the screen → roll the item forward (X).
    this.rotSmoothedDepth = this.alpha * h.depth + (1 - this.alpha) * this.rotSmoothedDepth;
    const dDepth = this.rotSmoothedDepth - this.rotPrevDepth;
    this.rotPrevDepth = this.rotSmoothedDepth;

    let yaw = 0;
    let pitch = 0;
    if (Math.hypot(dx, dy) >= this.rotateMoveDeadzone) {
      // Horizontal travel → yaw about world Y; vertical travel → pitch about X.
      yaw = clamp(dx * this.rotateGain, -this.rotateClamp, this.rotateClamp);
      pitch += clamp(-dy * this.rotateGain, -this.rotateClamp, this.rotateClamp);
    }
    if (Math.abs(dDepth) >= this.depthDeadzone) {
      pitch += clamp(dDepth * this.rotateDepthGain, -this.rotateClamp, this.rotateClamp);
    }
    if (yaw === 0 && pitch === 0) return;
    pitch = clamp(pitch, -this.rotateClamp, this.rotateClamp);
    const q = quatMultiply(quatFromAxisAngle(AXIS_Y, yaw), quatFromAxisAngle(AXIS_X, pitch));
    this.emit({ type: 'rotate', q, scope: this.rotScope });
  }

  /** Highlight while a single hand points (and clear it when it stops). */
  private updatePoint(pointing: HandObservation | null): void {
    if (pointing) {
      this.emit({ type: 'point', ndc: pointing.cursor });
      this.pointActive = true;
    } else if (this.pointActive) {
      this.emit({ type: 'point_end' });
      this.pointActive = false;
    }
  }

  /** Two-hand scale: the object grows/shrinks as the pinch anchors move apart. */
  private updateScale(a: HandObservation | null, b: HandObservation | null): void {
    if (!a || !b) {
      if (this.scaleActive) {
        this.emit({ type: 'scale_end', scope: this.scaleScope });
        this.scaleActive = false;
      }
      return;
    }
    const d = Math.hypot(a.anchor.x - b.anchor.x, a.anchor.y - b.anchor.y);
    if (!this.scaleActive) {
      this.scaleActive = true;
      // Assembly scale needs both hands three-fingered; otherwise object scale.
      this.scaleScope = a.threeFinger && b.threeFinger ? 'assembly' : 'object';
      this.scope = this.scaleScope;
      this.prevDist = d;
      // Midpoint between the two pinches picks the target part (object scope).
      const mid = { x: (a.anchor.x + b.anchor.x) / 2, y: (a.anchor.y + b.anchor.y) / 2 };
      this.emit({ type: 'scale_start', ndc: mid, scope: this.scaleScope });
      return;
    }
    if (this.prevDist > 1e-4) {
      const delta = clamp(d / this.prevDist - 1, -this.zoomClamp, this.zoomClamp);
      if (delta !== 0) this.emit({ type: 'zoom', delta, scope: this.scaleScope });
    }
    this.prevDist = d;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
