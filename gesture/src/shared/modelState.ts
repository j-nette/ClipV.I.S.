/**
 * Single source of truth for the presenter → hologram pipeline.
 *
 * The presenter window (the gesture app) OWNS a `ModelState`; the hologram
 * follower window MIRRORS it. Only this plain object crosses between windows
 * (via `holoSync`'s BroadcastChannel), so it must stay structured-clone safe:
 * no class instances, no functions, no THREE.js objects — just data.
 *
 * Orientation is a quaternion because the gesture bus already emits `rotate`
 * as a delta quaternion (see types.ts). The presenter accumulates those deltas;
 * both windows just copy `orientation` onto their pivot. No azimuth/polar
 * bookkeeping, no drift, all four hologram faces stay coherent.
 */
import type { Quat, ViewName } from '../types';
import { quatFromAxisAngle, quatMultiply, IDENTITY_QUAT } from '../quat';

export type RenderMode = 'solid' | 'wireframe' | 'xray';

export interface ModelState {
  /** Model id (matches agent/models.js convention). */
  model: string;
  /** Optional second model shown side-by-side, or null. */
  compareTo: string | null;
  /** Model orientation as a quaternion (accumulated from gesture `rotate` deltas). */
  orientation: Quat;
  /** Model translation offset in world space (from a three-finger assembly drag). */
  position: { x: number; y: number; z: number };
  /** Per-part local translation offsets, keyed by part id (two-finger part drag). */
  partOffsets: Record<string, { x: number; y: number; z: number }>;
  /** Per-part local rotations, keyed by part id (rotating a single grabbed part). */
  partRotations: Record<string, Quat>;
  /** Per-part uniform scale factors, keyed by part id (two-hand object scale). */
  partScales: Record<string, number>;
  /** Camera distance (presenter) / ring radius (hologram). */
  zoom: number;
  /** Exploded-view amount, 0..1. */
  explode: number;
  /** Hands-free turntable. `speed` is radians/second. */
  spin: { on: boolean; speed: number };
  /** Material mode applied to every part. */
  renderMode: RenderMode;
  /** Part id to isolate (ghost everything else), or null. */
  focusPart: string | null;
  /** Existing Clippy state channel value, carried for completeness. */
  clippy: string;
}

export const DEFAULT_STATE: ModelState = {
  model: 'xbox_controller',
  compareTo: null,
  orientation: { ...IDENTITY_QUAT },
  position: { x: 0, y: 0, z: 0 },
  partOffsets: {},
  partRotations: {},
  partScales: {},
  zoom: 5,
  explode: 0,
  spin: { on: false, speed: 0.6 },
  renderMode: 'solid',
  focusPart: null,
  clippy: 'idle',
};

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 14;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function clampZoom(n: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

/** Canonical view orientations, applied directly to the model pivot. */
export const VIEW_QUATS: Record<ViewName, Quat> = {
  front: { ...IDENTITY_QUAT },
  back: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI),
  right: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2),
  top: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2),
  iso: quatMultiply(
    quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.5),
    quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 4),
  ),
};

export const RENDER_MODES: RenderMode[] = ['solid', 'wireframe', 'xray'];

/** Next render mode in the solid → wireframe → xray cycle. */
export function nextRenderMode(mode: RenderMode): RenderMode {
  const i = RENDER_MODES.indexOf(mode);
  return RENDER_MODES[(i + 1) % RENDER_MODES.length];
}
