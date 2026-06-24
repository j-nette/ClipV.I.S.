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
 * Low-level, high-frequency interaction events. Distinct from voice/'s
 * setSceneState() model-swap channel. Emitted at up to ~30 fps once the camera
 * pipeline lands; in Phase 0 they come from the keyboard fallback.
 */
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
  | { type: 'pinch_move'; ndc: NDC; scope: ManipulationScope }
  | { type: 'pinch_end'; scope: ManipulationScope }
  /** Incremental 3D rotation as a delta quaternion (object or whole assembly). */
  | { type: 'rotate'; q: Quat; scope: ManipulationScope }
  /** Incremental zoom. Signed scalar: >0 = zoom in, <0 = zoom out. */
  | { type: 'zoom'; delta: number; scope: ManipulationScope };

/**
 * A consumer turns gesture events into visuals. StandaloneScene implements this
 * now; HologramAdapter will implement it in Phase 5. Swapping consumers is a
 * startup choice — the upstream pipeline is identical.
 */
export interface Consumer {
  handle(e: GestureEvent): void;
  dispose?(): void;
}
