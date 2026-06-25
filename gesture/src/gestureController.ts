import { gestureBus } from './eventBus';
import type { HandObservation } from './gestureDetector';
import { INDEX_PALM_CLEARANCE, PINCH_THRESHOLD } from './gestureDetector';
import type { GestureEvent, NDC, ManipulationScope, ViewName } from './types';
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

// --- discrete command gestures (explode / focus / snap-view / render / spin) ---
/** Frames both fists must be held close together to "charge" the explosion. */
const EXPLODE_ARM_FRAMES = 10;
/** NDC distance between the two hands that counts as "together" (charged). */
const EXPLODE_NEAR = 0.7;
/** Hand spread (NDC) beyond the charge distance for a full (1.0) explode. */
const EXPLODE_RANGE = 1.4;
/** Frames a point must dwell on one spot to isolate that part. */
const FOCUS_DWELL_FRAMES = 16;
/** Max cursor drift (NDC) allowed while dwelling. */
const FOCUS_MOVE_TOL = 0.1;
/** Frames a finger count must be stable before it snaps the view. */
const SNAP_HOLD_FRAMES = 7;
/** Snap-view targets, indexed by finger count − 1. */
const SNAP_VIEWS: ViewName[] = ['front', 'iso', 'top', 'back'];
/** Thumb→middle ratio below this = contact; above RELEASE = released (a snap/tap). */
const RENDER_TOUCH = 0.35;
const RENDER_RELEASE = 0.55;
/** Frames to wait before another render-mode snap can fire. */
const RENDER_COOLDOWN = 10;
/** Min horizontal hand speed (NDC/frame) of a two-finger swipe to fling the spin. */
const TURN_SWIPE_VX = 0.05;
/** Swipe speed → spin speed (rad/s) and its cap. */
const TURN_SPEED_GAIN = 9;
const TURN_MAX_SPEED = 6;
/** Frames the two-finger pose must be held still to stop the spin. */
const TURN_STOP_FRAMES = 12;

export interface ControllerOptions {
  /** Pinch enters when ratio drops below this. */
  pinchOn?: number;
  /** Pinch exits when ratio rises above this (must be > pinchOn). */
  pinchOff?: number;
  /** Min index-to-palm clearance to count as a pinch (rejects a fist). */
  palmClearance?: number;
  /**
   * Frames the release condition must hold before a pinch actually releases.
   * Bridges brief motion-blur spikes in pinch ratio/clearance during fast moves
   * so the grip doesn't slip. 1 = release immediately.
   */
  releaseFrames?: number;
  /**
   * Frames an active grab is held when its hand vanishes from the frame
   * (a tracking dropout, common during fast motion) before it's dropped. The
   * grab resumes seamlessly if the hand reappears within this window.
   */
  holdFrames?: number;
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
  private readonly releaseFrames: number;
  private readonly holdFrames: number;
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
  /** Consecutive frames the release condition has held, per hand label. */
  private readonly releaseCount = new Map<string, number>();
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
  /** Consecutive frames the gripping hand has been missing (tracking dropout). */
  private transMiss = 0;

  // rotation session (left hand)
  private rotActive = false;
  private rotLabel: string | null = null;
  private rotSmoothed: NDC | null = null;
  private rotScope: ManipulationScope = 'object';
  /** Smoothed left-hand size + last value depth-roll was measured from. */
  private rotSmoothedDepth = 0;
  private rotPrevDepth = 0;
  /** Consecutive frames the rotating hand has been missing (tracking dropout). */
  private rotMiss = 0;

  // point session
  private pointActive = false;

  // --- discrete command-gesture state ---
  // explode (two fists → open + spread)
  private explodeArm = 0;
  private explodeArmed = false;
  private explodeBase = 0;
  // focus (point-and-dwell)
  private focusDwell = 0;
  private focusAnchor: NDC | null = null;
  private focusFired = false;
  // snap-view (left-hand finger count)
  private snapCount = 0;
  private snapHold = 0;
  private snapFired = 0;
  // render-mode (thumb→middle snap/tap)
  private readonly renderContact = new Map<string, boolean>();
  private renderCooldown = 0;
  // turntable (two-finger swipe)
  private readonly turnPrevX = new Map<string, number>();
  private readonly turnStill = new Map<string, number>();

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
    this.releaseFrames = Math.max(1, opts.releaseFrames ?? 4);
    this.holdFrames = Math.max(0, opts.holdFrames ?? 8);
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
    // Forget hands that disappeared — but keep a held grip's pinch state alive
    // through a brief tracking dropout so the grab can resume seamlessly.
    for (const label of [...this.pinchState.keys()]) {
      if (seen.has(label)) continue;
      if (label === this.transLabel || label === this.rotLabel) continue;
      this.pinchState.delete(label);
      this.releaseCount.delete(label);
    }
    for (const label of [...this.createPoseState.keys()]) {
      if (!seen.has(label)) this.createPoseState.delete(label);
    }

    // Split by role: right hand translates, left hand rotates.
    const translator = pinching.find((h) => this.isTranslator(h.label)) ?? null;
    const rotator = pinching.find((h) => !this.isTranslator(h.label)) ?? null;
    // A grab whose hand vanished from the frame entirely (vs. still visible but
    // not pinching) is a tracking dropout — hold it rather than dropping it.
    const transLost =
      !translator && this.transActive && this.transLabel != null && !seen.has(this.transLabel);
    const rotLost =
      !rotator && this.rotActive && this.rotLabel != null && !seen.has(this.rotLabel);

    // Both hands pinching → scale (distance between them). A single hand keeps
    // translating (right) or rotating (left).
    if (translator && rotator) {
      // Which hand pinched first? Whichever session was already active before
      // the second hand joined (captured before we end those sessions).
      const firstAnchor = this.scaleActive
        ? null
        : this.transActive
          ? { ...translator.anchor }
          : this.rotActive
            ? { ...rotator.anchor }
            : null;
      this.updateTranslation(null); // end any active translate/rotate first
      this.updateRotation(null);
      this.updateScale(translator, rotator, firstAnchor);
    } else {
      this.updateScale(null, null, null); // end any active scale
      this.updateTranslation(translator, transLost);
      this.updateRotation(rotator, rotLost);
    }

    // Pointing / hover is the RIGHT hand's job (the left hand drives rotation and
    // finger-count view snaps), so they never collide.
    const manipulating = this.transActive || this.rotActive || this.scaleActive;
    const pointing = manipulating
      ? null
      : (hands.find(
          (h) => h.point && this.isTranslator(h.label) && !this.pinchState.get(h.label),
        ) ?? null);
    this.updatePoint(pointing);

    // Discrete command gestures (explode, snap-view, render-mode, turntable).
    this.updateCommands(hands);

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
    this.transMiss = 0;
    this.rotActive = false;
    this.rotLabel = null;
    this.rotSmoothed = null;
    this.rotMiss = 0;
    this.scaleActive = false;
    this.pointActive = false;
    this.explodeArm = 0;
    this.explodeArmed = false;
    this.focusDwell = 0;
    this.focusAnchor = null;
    this.focusFired = false;
    this.snapCount = 0;
    this.snapHold = 0;
    this.snapFired = 0;
    this.renderContact.clear();
    this.renderCooldown = 0;
    this.turnPrevX.clear();
    this.turnStill.clear();
    this.mode = 'idle';
    this.pinchState.clear();
    this.releaseCount.clear();
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
      // Release when the fingers open OR the hand curls into a fist — but only
      // after the condition persists, so a one-frame motion-blur spike (common
      // when moving fast) doesn't drop the grip.
      const releasing = h.pinchRatio > this.pinchOff || !clear;
      if (releasing) {
        const c = (this.releaseCount.get(h.label) ?? 0) + 1;
        this.releaseCount.set(h.label, c);
        if (c >= this.releaseFrames) now = false;
      } else {
        this.releaseCount.set(h.label, 0);
      }
    } else if (h.pinchRatio < this.pinchOn && clear) {
      now = true;
      this.releaseCount.set(h.label, 0);
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
  private updateTranslation(h: HandObservation | null, lost = false): void {
    if (!h) {
      if (this.transActive) {
        // Hold the grab through a brief tracking dropout, then drop it.
        if (lost && this.transMiss < this.holdFrames) {
          this.transMiss++;
          return;
        }
        this.emit({ type: 'pinch_end', scope: this.transScope });
        this.transActive = false;
        if (this.transLabel) {
          this.pinchState.delete(this.transLabel);
          this.releaseCount.delete(this.transLabel);
        }
        this.transLabel = null;
        this.smoothed = null;
        this.transMiss = 0;
      }
      return;
    }
    this.transMiss = 0;
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
  private updateRotation(h: HandObservation | null, lost = false): void {
    if (!h) {
      if (this.rotActive) {
        // Hold the rotation grip through a brief tracking dropout, then drop it.
        if (lost && this.rotMiss < this.holdFrames) {
          this.rotMiss++;
          return;
        }
        this.emit({ type: 'rotate_end', scope: this.rotScope });
        this.rotActive = false;
        if (this.rotLabel) {
          this.pinchState.delete(this.rotLabel);
          this.releaseCount.delete(this.rotLabel);
        }
        this.rotLabel = null;
        this.rotSmoothed = null;
        this.rotMiss = 0;
      }
      return;
    }
    this.rotMiss = 0;
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

  /** Highlight while a single hand points; dwelling on a spot isolates that part. */
  private updatePoint(pointing: HandObservation | null): void {
    if (pointing) {
      this.emit({ type: 'point', ndc: pointing.cursor });
      this.pointActive = true;
      // Point-and-dwell → focus/isolate the part under the cursor (fires once).
      if (
        this.focusAnchor &&
        Math.hypot(pointing.cursor.x - this.focusAnchor.x, pointing.cursor.y - this.focusAnchor.y) <
          FOCUS_MOVE_TOL
      ) {
        this.focusDwell++;
      } else {
        this.focusAnchor = { ...pointing.cursor };
        this.focusDwell = 0;
        this.focusFired = false;
      }
      if (this.focusDwell >= FOCUS_DWELL_FRAMES && !this.focusFired) {
        this.focusFired = true;
        this.emit({ type: 'focus', ndc: { ...pointing.cursor } });
      }
    } else if (this.pointActive) {
      this.emit({ type: 'point_end' });
      this.pointActive = false;
      this.focusDwell = 0;
      this.focusAnchor = null;
      this.focusFired = false;
    }
  }

  /** Discrete command gestures, driven by non-pinching hand poses. */
  private updateCommands(hands: HandObservation[]): void {
    this.updateExplode(hands);
    this.updateSnapView(hands);
    this.updateRenderMode(hands);
    this.updateTurntable(hands);
  }

  /** Two fists held together ("charge"), then opened and pulled apart, explode. */
  private updateExplode(hands: HandObservation[]): void {
    const a = hands[0];
    const b = hands[1];
    const ready =
      hands.length >= 2 && !this.isPinching(a.label) && !this.isPinching(b.label);
    if (!ready) {
      this.explodeArm = 0;
      this.explodeArmed = false;
      return;
    }
    const d = Math.hypot(a.cursor.x - b.cursor.x, a.cursor.y - b.cursor.y);
    const bothFist = a.fist && b.fist;
    const bothOpen = a.openPalm && b.openPalm;
    if (!this.explodeArmed) {
      // Charge: both fists held close together.
      if (bothFist && d < EXPLODE_NEAR) {
        this.explodeArm++;
        if (this.explodeArm >= EXPLODE_ARM_FRAMES) {
          this.explodeArmed = true;
          this.explodeBase = d;
        }
      } else {
        this.explodeArm = 0;
      }
      return;
    }
    // Armed: opening + spreading drives the explode factor (and back collapses it).
    if (bothOpen) {
      const factor = clamp((d - this.explodeBase) / EXPLODE_RANGE, 0, 1);
      this.emit({ type: 'explode', factor });
    } else if (!bothFist) {
      // Hands relaxed out of both poses — disarm (keeps the last explode amount).
      this.explodeArmed = false;
      this.explodeArm = 0;
    }
  }

  /** Left-hand finger count (1–4) snaps to front / iso / top / back. */
  private updateSnapView(hands: HandObservation[]): void {
    // A two-hand explode (both open palms / both fists) isn't a view-snap count.
    const twoHandPose =
      hands.length >= 2 &&
      ((hands[0].openPalm && hands[1].openPalm) || (hands[0].fist && hands[1].fist));
    if (this.explodeArmed || twoHandPose) {
      this.snapHold = 0;
      this.snapCount = 0;
      return;
    }
    const left = hands.find((h) => !this.isTranslator(h.label)) ?? null;
    if (!left || this.isPinching(left.label) || left.fingerCount < 1 || left.fingerCount > 4) {
      this.snapHold = 0;
      this.snapCount = 0;
      if (!left || left.fingerCount === 0) this.snapFired = 0; // allow re-firing later
      return;
    }
    const c = left.fingerCount;
    if (c === this.snapCount) {
      this.snapHold++;
    } else {
      this.snapCount = c;
      this.snapHold = 1;
    }
    if (this.snapHold === SNAP_HOLD_FRAMES && c !== this.snapFired) {
      this.snapFired = c;
      this.emit({ type: 'snap_view', name: SNAP_VIEWS[c - 1] });
    }
  }

  /** Thumb→middle contact then release (a snap/tap) cycles the render mode. */
  private updateRenderMode(hands: HandObservation[]): void {
    if (this.renderCooldown > 0) this.renderCooldown--;
    for (const h of hands) {
      // Ignore while pinching, or in poses that also touch thumb+middle (three-
      // finger pinch, rock-sign create) or hide the fingers (fist).
      if (this.isPinching(h.label) || h.pinch || h.createPose || h.fist) {
        this.renderContact.set(h.label, false);
        continue;
      }
      const was = this.renderContact.get(h.label) ?? false;
      if (was && h.thumbMiddleRatio > RENDER_RELEASE) {
        this.renderContact.set(h.label, false);
        if (this.renderCooldown === 0) {
          this.emit({ type: 'render_mode', dir: 'next' });
          this.renderCooldown = RENDER_COOLDOWN;
        }
      } else if (h.thumbMiddleRatio < RENDER_TOUCH) {
        this.renderContact.set(h.label, true);
      }
    }
    for (const label of [...this.renderContact.keys()]) {
      if (!hands.some((h) => h.label === label)) this.renderContact.delete(label);
    }
  }

  /** Two-finger swipe flings the spin (speed ∝ swipe); holding it still stops it. */
  private updateTurntable(hands: HandObservation[]): void {
    for (const h of hands) {
      if (this.isPinching(h.label) || !h.indexMiddle) {
        this.turnPrevX.delete(h.label);
        this.turnStill.delete(h.label);
        continue;
      }
      const prev = this.turnPrevX.get(h.label);
      this.turnPrevX.set(h.label, h.cursor.x);
      if (prev === undefined) continue;
      const vx = h.cursor.x - prev;
      if (Math.abs(vx) >= TURN_SWIPE_VX) {
        const speed = clamp(vx * TURN_SPEED_GAIN, -TURN_MAX_SPEED, TURN_MAX_SPEED);
        this.emit({ type: 'turntable', on: true, speed });
        this.turnStill.set(h.label, 0);
      } else {
        const s = (this.turnStill.get(h.label) ?? 0) + 1;
        this.turnStill.set(h.label, s);
        if (s === TURN_STOP_FRAMES) this.emit({ type: 'turntable', on: false });
      }
    }
    for (const label of [...this.turnPrevX.keys()]) {
      if (!hands.some((h) => h.label === label)) {
        this.turnPrevX.delete(label);
        this.turnStill.delete(label);
      }
    }
  }

  /** Two-hand scale: the object grows/shrinks as the pinch anchors move apart. */
  private updateScale(
    a: HandObservation | null,
    b: HandObservation | null,
    firstAnchor: NDC | null,
  ): void {
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
      // Pick by the hand that pinched first; fall back to the midpoint.
      const mid = { x: (a.anchor.x + b.anchor.x) / 2, y: (a.anchor.y + b.anchor.y) / 2 };
      this.emit({ type: 'scale_start', ndc: firstAnchor ?? mid, ndcMid: mid, scope: this.scaleScope });
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
