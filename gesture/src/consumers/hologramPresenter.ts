import * as THREE from 'three';
import type { Consumer, GestureEvent } from '../types';
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
import { quatFromAxisAngle, quatMultiply, quatNormalize } from '../quat';

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
      case 'rotate':
        this.snapping = false; // manual rotate takes over from an in-flight snap
        this.mutate((s) => {
          s.orientation = quatNormalize(quatMultiply(e.q, s.orientation));
        });
        break;
      case 'zoom':
        this.mutate((s) => {
          s.zoom = clampZoom(s.zoom * (1 - e.delta));
        });
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
      // pinch_start/move/end intentionally do not translate the centered hero
      // model; the controller already emits rotate/zoom during grab/scale.
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
      const dq = quatFromAxisAngle(UP, this.state.spin.speed * dt);
      this.state.orientation = quatNormalize(quatMultiply(dq, this.state.orientation));
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
  }
}

interface HologramWindow extends Window {
  setExplode(factor: number): void;
  setRenderMode(mode: ModelState['renderMode']): void;
  snapToView(name: keyof typeof VIEW_QUATS): void;
  setTurntable(opts: { on: boolean; speed?: number }): void;
  focusPart(partId: string | null): void;
  setModelState(next: { model: string; compare_to?: string | null }): void;
}
