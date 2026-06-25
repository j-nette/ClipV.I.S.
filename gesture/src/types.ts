/**
 * Shared gesture types — the contract every consumer (StandaloneScene, future
 * HologramAdapter) agrees on. Kept dependency-free so it can be imported by
 * other folders (e.g. hologram/) without pulling in three.js.
 */

/** Normalized device coordinates, both axes in [-1, 1], y-up (Three.js raycaster convention). */
export interface NDC {
  x: number;
  y: number;
}

/** Quaternion, w-last, matching Three.js `Quaternion` component order. */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Canonical model orientations for `snap_view`. */
export type ViewName = 'front' | 'iso' | 'top' | 'back' | 'right';

/**
 * A single MediaPipe hand landmark. x/y are normalized image coords in [0, 1]
 * (x left→right, y top→bottom); z is relative depth (smaller = closer).
 */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** 21 landmarks for one detected hand, in MediaPipe index order. */
export type HandLandmarks = Landmark[];

/**
 * What a manipulation acts on: a single focused object (two-finger pinch) or
 * the whole assembly of objects as a group (three-finger pinch).
 */
export type ManipulationScope = 'object' | 'assembly';

/**
 * Low-level, high-frequency interaction events. Distinct from voice/'s
 * setSceneState() model-swap channel. Emitted at up to ~30 fps once the camera
 * pipeline lands; in Phase 0 they come from the keyboard fallback.
 */
export type GestureEvent =
  | { type: 'point'; ndc: NDC }
  | { type: 'point_end' }
  | { type: 'pinch_start'; ndc: NDC; scope: ManipulationScope }
  /** `depth` is a per-frame push/pull along the camera's view axis (world units, +away). */
  | { type: 'pinch_move'; ndc: NDC; depth?: number; scope: ManipulationScope }
  | { type: 'pinch_end'; scope: ManipulationScope }
  | { type: 'orb_create'; ndc: NDC }
  /** Rotation grab begins; `ndc` is the rotator hand's position to pick a target part. */
  | { type: 'rotate_start'; ndc: NDC; scope: ManipulationScope }
  /** Incremental 3D rotation as a delta quaternion (object or whole assembly). */
  | { type: 'rotate'; q: Quat; scope: ManipulationScope }
  /** Rotation grab ends; clears the rotation target. */
  | { type: 'rotate_end'; scope: ManipulationScope }
  /** Two-hand scale begins; `ndc` = the hand that pinched first, `ndcMid` = midpoint fallback. */
  | { type: 'scale_start'; ndc: NDC; ndcMid: NDC; scope: ManipulationScope }
  /** Incremental zoom. Signed scalar: >0 = zoom in, <0 = zoom out. */
  | { type: 'zoom'; delta: number; scope: ManipulationScope }
  /** Two-hand scale ends; clears the scale target. */
  | { type: 'scale_end'; scope: ManipulationScope }
  // --- hologram model-interaction events (presenter → hologram pipeline) ---
  /** Exploded-view amount, 0..1 (e.g. two-hand spread). */
  | { type: 'explode'; factor: number }
  /** Cycle the render mode: solid → wireframe → xray. */
  | { type: 'render_mode'; dir: 'next' }
  /** Snap the model to a canonical orientation. */
  | { type: 'snap_view'; name: ViewName }
  /** Toggle the hands-free turntable; optional spin speed (radians/sec). */
  | { type: 'turntable'; on: boolean; speed?: number }
  /** Isolate the part at `ndc`, or clear isolation when null. */
  | { type: 'focus'; ndc: NDC | null };

/**
 * A consumer turns gesture events into visuals. StandaloneScene implements this
 * now; HologramAdapter will implement it in Phase 5. Swapping consumers is a
 * startup choice — the upstream pipeline is identical.
 */
export interface Consumer {
  handle(e: GestureEvent): void;
  dispose?(): void;
}
