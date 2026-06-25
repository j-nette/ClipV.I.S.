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

/** A full local transform applied to a single part on top of its rest pose. */
export interface PartTransform {
  position: { x: number; y: number; z: number };
  quaternion: Quat;
  scale: number;
}

export const IDENTITY_PART_TRANSFORM: PartTransform = {
  position: { x: 0, y: 0, z: 0 },
  quaternion: { ...IDENTITY_QUAT },
  scale: 1,
};

export interface ModelState {
  /** Model id (matches agent/models.js convention). */
  model: string;
  /** Optional second model shown side-by-side, or null. */
  compareTo: string | null;
  /** Model orientation as a quaternion (accumulated from gesture `rotate` deltas). */
  orientation: Quat;
  /** Model translation offset in world space (from a three-finger assembly drag). */
  position: { x: number; y: number; z: number };
  /** Per-part local transforms (two-finger part rotate/translate/scale), keyed by part id. */
  partTransforms: Record<string, PartTransform>;
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
  model: 'clippy',
  compareTo: null,
  orientation: { ...IDENTITY_QUAT },
  position: { x: 0, y: 0, z: 0 },
  partTransforms: {},
  zoom: 5,
  explode: 0,
  spin: { on: false, speed: 0.6 },
  renderMode: 'solid',
  focusPart: null,
  clippy: 'idle',
};

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 14;

/** Per-part scale limits (object-scope zoom). */
export const MIN_PART_SCALE = 0.2;
export const MAX_PART_SCALE = 5;

/** Assembly translation bound, so a drag can't lose the model off-screen. */
export const MAX_POSITION = 4;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function clampZoom(n: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

export function clampPartScale(n: number): number {
  return Math.min(MAX_PART_SCALE, Math.max(MIN_PART_SCALE, n));
}

export function clampPosition(n: number): number {
  return Math.min(MAX_POSITION, Math.max(-MAX_POSITION, n));
}

/** Canonical view orientations, applied directly to the model pivot. */
export const VIEW_QUATS: Record<ViewName, Quat> = {
  front: { ...IDENTITY_QUAT },
  back: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI),
  top: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -Math.PI / 2),
  iso: quatMultiply(
    quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -0.5),
    quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 4),
  ),
};

export const RENDER_MODES: RenderMode[] = ['solid', 'wireframe', 'xray'];

/** Next render mode in the solid → wireframe → xray cycle. */
export function nextRenderMode(mode: RenderMode): RenderMode {
  const i = RENDER_MODES.indexOf(mode);
  return RENDER_MODES[(i + 1) % RENDER_MODES.length];
}
