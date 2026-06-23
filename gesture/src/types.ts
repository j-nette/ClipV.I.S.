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
export type GestureEvent =
  | { type: 'point'; ndc: NDC }
  | { type: 'point_end' }
  | { type: 'pinch_start'; ndc: NDC }
  | { type: 'pinch_move'; ndc: NDC }
  | { type: 'pinch_end' }
  /** Incremental rotation of the focused object, in radians. dx = yaw, dy = pitch. */
  | { type: 'rotate'; dx: number; dy: number }
  /** Incremental zoom of the focused object. Signed scalar: >0 = zoom in, <0 = zoom out. */
  | { type: 'zoom'; delta: number };

/**
 * A consumer turns gesture events into visuals. StandaloneScene implements this
 * now; HologramAdapter will implement it in Phase 5. Swapping consumers is a
 * startup choice — the upstream pipeline is identical.
 */
export interface Consumer {
  handle(e: GestureEvent): void;
  dispose?(): void;
}
