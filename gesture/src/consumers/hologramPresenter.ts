import * as THREE from 'three';
import type { Consumer, GestureEvent, ManipulationScope } from '../types';
import {
  DEFAULT_STATE,
  VIEW_QUATS,
  clamp01,
  clampZoom,
  nextRenderMode,
  type ModelState,
} from '../shared/modelState';
import { ModelScene } from '../shared/modelScene';
import { createPresenterSync, type PresenterSync } from '../shared/holoSync';
import { quatFromAxisAngle, quatMultiply, IDENTITY_QUAT } from '../quat';

/**
 * Presenter consumer for the laptop screen — the OWNER of `ModelState`.
 *
 * It renders the shared model from a single normal perspective camera (so
 * picking is a textbook raycast), turns gesture events into state mutations,
 * and broadcasts every change so the hologram follower window mirrors it. The
 * follower is a pure receiver; this class is the only writer.
 *
 * It also advances the one time-based motion (turntable spin) and broadcasts
 * the result, so the two windows can never desync on independent clocks.
 *
 * For voice/agent integration it additionally exposes `window.*` hooks
 * (setExplode, setRenderMode, snapToView, setTurntable, focusPart,
 * setModelState) — additive; the POST /agent contract is untouched.
 */
const UP = { x: 0, y: 1, z: 0 };
const CAMERA_DIR = new THREE.Vector3(0, 0.25, 1).normalize();
/** Seconds for a snap-to-view animation. */
const SNAP_DURATION = 0.6;
/** Time constant (s) for a swipe-flung spin to ease back to the base speed. */
const SPIN_DECAY_TAU = 1.2;
/** Per-part scale clamp (two-hand object scale). */
const MIN_PART_SCALE = 0.2;
const MAX_PART_SCALE = 5;
/** Window after a pinch drops in which a re-grip resumes the same part (ms). */
const RESUME_GRIP_MS = 300;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Emotes that auto-revert to idle so Clippy always settles back to alive-idle. */
const TRANSIENT_EMOTES: ReadonlySet<string> = new Set(['wave', 'celebrating', 'confused']);
const CLIPPY_REVERT_MS = 1800;

export class HologramPresenter implements Consumer {
  private readonly state: ModelState = structuredClone(DEFAULT_STATE);
  private readonly modelScene = new ModelScene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly sync: PresenterSync;
  private readonly clock = new THREE.Clock();
  private raf = 0;

  // Snap-to-view animation (slerp current → target over SNAP_DURATION).
  private readonly snapFrom = new THREE.Quaternion();
  private readonly snapTo = new THREE.Quaternion();
  private readonly snapQuat = new THREE.Quaternion();
  private snapT = 0;
  private snapping = false;

  /** Timer that reverts a transient Clippy emote back to idle. */
  private clippyRevertTimer = 0;

  // Pinch-drag translation on a camera-facing plane.
  private readonly raycaster = new THREE.Raycaster();
  private readonly dragPlane = new THREE.Plane();
  private readonly dragPoint = new THREE.Vector3();
  private readonly grabOffset = new THREE.Vector3(); // assembly: model pos − hit
  private readonly dragStartHit = new THREE.Vector3(); // part: hit point at grab
  private readonly dragStartOffset = new THREE.Vector3(); // part: offset at grab
  private readonly scratchForward = new THREE.Vector3(); // depth push/pull axis
  private dragMode: 'none' | 'assembly' | 'part' = 'none';
  private dragPartId: string | null = null;
  /** Last part dragged + when its grip dropped, for a sticky re-grip after a slip. */
  private lastPartId: string | null = null;
  private lastPartEndMs = 0;
  /** Part the left hand is rotating (picked at rotate_start), independent of the drag. */
  private rotatePartId: string | null = null;
  /** Part being scaled by a two-hand object pinch (picked at scale_start). */
  private scalePartId: string | null = null;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );

    this.modelScene.setModels(this.state.model, this.state.compareTo);
    this.modelScene.applyState(this.state);

    this.sync = createPresenterSync(() => this.state);
    this.exposeWindowHooks();

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.publish();
    this.animate();
  }

  handle(e: GestureEvent): void {
    switch (e.type) {
      case 'rotate_start':
        // Object rotation needs a target: pick the part under the left hand.
        this.rotatePartId =
          e.scope === 'assembly' ? null : this.modelScene.pickPartId(e.ndc, this.camera);
        break;
      case 'rotate':
        this.snapping = false; // manual rotate takes over from an in-flight snap
        // Assembly grab spins the whole model; an object grab rotates only the
        // part the left hand grabbed. A grab on empty space does nothing.
        if (e.scope === 'assembly') {
          this.mutate((s) => {
            s.orientation = quatMultiply(e.q, s.orientation);
          });
        } else {
          // Prefer the left-hand rotation target; fall back to the held part
          // (keyboard rotate, or a right-hand grab). No target → do nothing.
          const id = this.rotatePartId ?? (this.dragMode === 'part' ? this.dragPartId : null);
          if (id) {
            this.mutate((s) => {
              const cur = s.partRotations[id] ?? IDENTITY_QUAT;
              s.partRotations = { ...s.partRotations, [id]: quatMultiply(e.q, cur) };
            });
          }
        }
        break;
      case 'rotate_end':
        this.rotatePartId = null;
        break;
      case 'scale_start': {
        // Object scale targets the part the first-pinching hand is on; if that
        // ray misses, fall back to the midpoint between the two hands.
        this.scalePartId =
          e.scope === 'assembly'
            ? null
            : (this.modelScene.pickPartId(e.ndc, this.camera) ??
              this.modelScene.pickPartId(e.ndcMid, this.camera));
        break;
      }
      case 'zoom':
        if (e.scope === 'assembly') {
          // Assembly scale grows/shrinks the whole model (camera distance).
          this.mutate((s) => {
            s.zoom = clampZoom(s.zoom * (1 - e.delta));
          });
        } else if (this.scalePartId) {
          // Object scale resizes just the selected part.
          const id = this.scalePartId;
          this.mutate((s) => {
            const cur = s.partScales[id] ?? 1;
            const next = clamp(cur * (1 + e.delta), MIN_PART_SCALE, MAX_PART_SCALE);
            s.partScales = { ...s.partScales, [id]: next };
          });
        }
        break;
      case 'scale_end':
        this.scalePartId = null;
        break;
      case 'point':
        this.modelScene.setHover(this.modelScene.pickPartId(e.ndc, this.camera));
        break;
      case 'point_end':
        this.modelScene.setHover(null);
        break;
      case 'explode':
        this.mutate((s) => {
          s.explode = clamp01(e.factor);
        });
        break;
      case 'render_mode':
        this.mutate((s) => {
          s.renderMode = nextRenderMode(s.renderMode);
        });
        break;
      case 'snap_view':
        this.startSnap(e.name);
        break;
      case 'turntable':
        this.mutate((s) => {
          s.spin = { on: e.on, speed: e.speed ?? s.spin.speed };
        });
        break;
      case 'focus':
        this.mutate((s) => {
          s.focusPart = e.ndc ? this.modelScene.pickPartId(e.ndc, this.camera) : null;
        });
        break;
      // Two-finger pinch grabs only the part it lands on; three-finger pinch
      // (scope=assembly) moves the whole model. The controller also emits
      // rotate during the same grab.
      case 'pinch_start':
        this.beginDrag(e.ndc, e.scope);
        break;
      case 'pinch_move':
        this.moveDrag(e.ndc, e.depth);
        break;
      case 'pinch_end':
        // Remember the part briefly so a re-grip right after a slip resumes it
        // (see beginDrag) instead of snapping to a part behind.
        if (this.dragMode === 'part' && this.dragPartId) {
          this.lastPartId = this.dragPartId;
          this.lastPartEndMs = performance.now();
        }
        this.dragMode = 'none';
        this.dragPartId = null;
        break;
      default:
        break;
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.sync.dispose();
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** Apply a mutation locally and broadcast it to the follower. */
  private mutate(fn: (s: ModelState) => void): void {
    fn(this.state);
    this.modelScene.applyState(this.state);
    this.publish();
  }

  private publish(): void {
    this.sync.publish(this.state);
  }

  /** Start a pinch-drag. Assembly scope moves everything; object scope grabs
   *  only the part under the pinch (no-op if the pinch misses the model). */
  private beginDrag(ndc: { x: number; y: number }, scope: ManipulationScope): void {
    if (scope === 'assembly') {
      this.beginAssemblyDrag(ndc);
      return;
    }
    const partId = this.modelScene.pickPartId(ndc, this.camera);
    if (!partId) {
      this.dragMode = 'none'; // pinch landed off the model — don't grab
      return;
    }
    // Sticky re-grip: if the pinch dropped for a moment (fast move) and is
    // re-acquired right away, resume the same part even if the new pinch landed
    // on a different (e.g. occluded) part — prevents the grip slipping behind.
    const resume =
      this.lastPartId &&
      performance.now() - this.lastPartEndMs < RESUME_GRIP_MS &&
      this.modelScene.hasPart(this.lastPartId)
        ? this.lastPartId
        : null;
    this.beginPartDrag(ndc, resume ?? partId);
  }

  private cameraNormal(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out).negate();
  }

  /** Drag the whole model (three-finger): translate state.position. */
  private beginAssemblyDrag(ndc: { x: number; y: number }): void {
    const pos = this.modelScene.pivot.position;
    this.dragPlane.setFromNormalAndCoplanarPoint(this.cameraNormal(), pos);
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      this.grabOffset.copy(pos).sub(this.dragPoint); // hold where pinched
    } else {
      this.grabOffset.set(0, 0, 0);
    }
    this.dragMode = 'assembly';
  }

  /** Drag a single part (two-finger): translate that part's offset. */
  private beginPartDrag(ndc: { x: number; y: number }, partId: string): void {
    const worldPos = this.modelScene.partWorldPosition(partId);
    if (!worldPos) {
      this.dragMode = 'none';
      return;
    }
    this.dragPlane.setFromNormalAndCoplanarPoint(this.cameraNormal(), worldPos);
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    this.raycaster.ray.intersectPlane(this.dragPlane, this.dragStartHit);
    const cur = this.state.partOffsets[partId];
    this.dragStartOffset.set(cur?.x ?? 0, cur?.y ?? 0, cur?.z ?? 0);
    this.dragPartId = partId;
    this.dragMode = 'part';
  }

  /** Translate the active drag target to follow the pinch on the drag plane. */
  private moveDrag(ndc: { x: number; y: number }, depth = 0): void {
    if (this.dragMode === 'none') return;
    // Push/pull along the camera's view axis sinks the drag plane to a new
    // depth; the held point and X/Y mapping then carry over for both scopes.
    if (depth !== 0) {
      this.dragPlane.translate(this.camera.getWorldDirection(this.scratchForward).multiplyScalar(depth));
    }
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) return;

    if (this.dragMode === 'assembly') {
      const x = this.dragPoint.x + this.grabOffset.x;
      const y = this.dragPoint.y + this.grabOffset.y;
      const z = this.dragPoint.z + this.grabOffset.z;
      this.mutate((s) => {
        s.position = { x, y, z };
      });
    } else if (this.dragMode === 'part' && this.dragPartId) {
      // World delta → the part's parent-local frame (cancels pivot rotation AND
      // the glTF normalization scale), added to the offset.
      const worldDelta = this.dragPoint.clone().sub(this.dragStartHit);
      const local = this.modelScene.worldDeltaToPartLocal(this.dragPartId, worldDelta);
      const id = this.dragPartId;
      const x = this.dragStartOffset.x + local.x;
      const y = this.dragStartOffset.y + local.y;
      const z = this.dragStartOffset.z + local.z;
      this.mutate((s) => {
        s.partOffsets = { ...s.partOffsets, [id]: { x, y, z } };
      });
    }
  }

  /** Begin an eased snap to a canonical view; stops the turntable first. */
  private startSnap(name: keyof typeof VIEW_QUATS): void {
    const o = this.state.orientation;
    this.snapFrom.set(o.x, o.y, o.z, o.w);
    const t = VIEW_QUATS[name];
    this.snapTo.set(t.x, t.y, t.z, t.w);
    this.snapT = 0;
    this.snapping = true;
    this.state.spin.on = false;
  }

  private readonly animate = (): void => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();

    // Snap-to-view: ease the orientation toward the chosen canonical pose and
    // broadcast each frame so the follower mirrors the same animation.
    if (this.snapping) {
      this.snapT = Math.min(1, this.snapT + dt / SNAP_DURATION);
      const k = this.snapT * this.snapT * (3 - 2 * this.snapT); // smoothstep
      this.snapQuat.copy(this.snapFrom).slerp(this.snapTo, k);
      this.state.orientation = {
        x: this.snapQuat.x,
        y: this.snapQuat.y,
        z: this.snapQuat.z,
        w: this.snapQuat.w,
      };
      this.publish();
      if (this.snapT >= 1) this.snapping = false;
    }

    // The presenter is the single owner of time-based motion: advance the spin
    // and broadcast so the follower purely applies the received orientation.
    if (this.state.spin.on) {
      // Momentum: a swipe-boosted spin eases back toward the base speed so a
      // fast fling gradually settles into a steady turntable.
      const base = DEFAULT_STATE.spin.speed;
      this.state.spin.speed += (base - this.state.spin.speed) * (1 - Math.exp(-dt / SPIN_DECAY_TAU));
      const dq = quatFromAxisAngle(UP, this.state.spin.speed * dt);
      this.state.orientation = quatMultiply(dq, this.state.orientation);
      this.publish();
    }

    this.modelScene.applyState(this.state);
    this.camera.position.copy(this.target).addScaledVector(CAMERA_DIR, this.state.zoom);
    this.camera.lookAt(this.target);
    this.renderer.render(this.modelScene.scene, this.camera);
  };

  private readonly onResize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /** Additive hooks so the voice agent can drive the same features. */
  private exposeWindowHooks(): void {
    const w = window as unknown as HologramWindow;
    w.setExplode = (factor: number) => this.mutate((s) => (s.explode = clamp01(factor)));
    w.setRenderMode = (mode) => this.mutate((s) => (s.renderMode = mode));
    w.snapToView = (name) => this.startSnap(name);
    w.setTurntable = (opts) =>
      this.mutate((s) => (s.spin = { on: opts.on, speed: opts.speed ?? s.spin.speed }));
    w.focusPart = (partId) => this.mutate((s) => (s.focusPart = partId ?? null));
    w.setModelState = (next: { model: string; compare_to?: string | null }) =>
      this.mutate((s) => {
        s.model = next.model;
        s.compareTo = next.compare_to ?? null;
      });
    w.setClippyState = (action: string) => this.setClippy(action);
  }

  /** Set Clippy's emote; transient emotes auto-revert to idle so it settles.
   *  Routed through ModelState so the hologram follower mirrors it (and its
   *  revert) over holoSync. */
  private setClippy(action: string): void {
    const emote = action || 'idle';
    window.clearTimeout(this.clippyRevertTimer);
    this.mutate((s) => {
      s.clippy = emote;
    });
    if (TRANSIENT_EMOTES.has(emote)) {
      this.clippyRevertTimer = window.setTimeout(() => {
        this.mutate((s) => {
          s.clippy = 'idle';
        });
      }, CLIPPY_REVERT_MS);
    }
  }
}

interface HologramWindow extends Window {
  setExplode(factor: number): void;
  setRenderMode(mode: ModelState['renderMode']): void;
  snapToView(name: keyof typeof VIEW_QUATS): void;
  setTurntable(opts: { on: boolean; speed?: number }): void;
  focusPart(partId: string | null): void;
  setModelState(next: { model: string; compare_to?: string | null }): void;
  setClippyState(action: string): void;
}
