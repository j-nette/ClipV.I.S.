import type { HandLandmarks, Landmark, NDC, Quat } from './types';
import { quatFromBasis, normalize, cross, sub, type Vec3 } from './quat';

/**
 * Pure gesture detection: landmarks → gesture state. No DOM, no events, no
 * stored state — every call is a pure function of its input. Timing concerns
 * (hysteresis, debounce, smoothing) live in the controller (Phase 3); keeping
 * this layer pure is what makes it unit-testable and the Wed cut cheap.
 */

/** MediaPipe hand landmark indices we rely on. */
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

/** Pinch when thumb–index distance / hand size drops below this. */
export const PINCH_THRESHOLD = 0.22;

/**
 * A pinch also requires the index fingertip to be clear of the palm in 3D
 * (distance to the palm center / hand size above this). A fist tucks the
 * fingertip into the palm, so it's rejected even though thumb + index tips touch.
 * Tuned between observed fist (~0.35) and pinch (~0.6) clearances.
 */
export const INDEX_PALM_CLEARANCE = 0.5;

/**
 * Three-finger pinch: the middle fingertip also joins the thumb (its distance to
 * the thumb / hand size below this), turning a two-finger object pinch into an
 * assembly pinch. A touch looser than PINCH_THRESHOLD since the middle is longer.
 */
export const MIDDLE_PINCH_THRESHOLD = 0.32;

/** A finger counts as curled when its tip-to-MCP distance / hand size is below this. */
export const FIST_CURL_THRESHOLD = 0.5;

export interface GestureState {
  point: boolean;
  pinch: boolean;
  createPose: boolean;
  /** Index-fingertip position in NDC. Present whenever a hand is visible. */
  cursor: NDC | null;
  /** Normalized thumb–index distance — exposed so the controller can apply hysteresis. */
  pinchRatio: number;
  /** Largest normalized thumb contact distance used for the rock-sign create pose. */
  createPoseRatio: number;
  /** Normalized 3D index-tip-to-palm distance — exposed for tuning the fist guard. */
  indexPalmClearance: number;
}

const NEUTRAL: GestureState = {
  point: false,
  pinch: false,
  createPose: false,
  cursor: null,
  pinchRatio: 1,
  createPoseRatio: 1,
  indexPalmClearance: 0,
};

/** Detect gestures for the first hand in a frame (or neutral if none). */
export function detect(hands: HandLandmarks[]): GestureState {
  const hand = hands[0];
  if (!hand || hand.length < 21) return NEUTRAL;
  return detectHand(hand);
}

/** Detect gestures for a single 21-point hand. */
export function detectHand(hand: HandLandmarks): GestureState {
  const handSize = dist(hand[LM.WRIST], hand[LM.MIDDLE_MCP]) || 1e-6;
  const pinchRatio = dist(hand[LM.THUMB_TIP], hand[LM.INDEX_TIP]) / handSize;
  const createPoseRatio = Math.max(
    dist(hand[LM.THUMB_TIP], hand[LM.MIDDLE_TIP]),
    dist(hand[LM.THUMB_TIP], hand[LM.RING_TIP]),
  ) / handSize;
  const fist = isFist(hand, handSize);
  const createPose = isCreatePose(hand, handSize, createPoseRatio, fist);
  // The index fingertip must be clear of the palm in 3D — this rejects a fist
  // (curled into the palm); the rock-sign create pose also isn't a pinch.
  const indexPalmClearance = dist(hand[LM.INDEX_TIP], palmCenter(hand)) / handSize;
  const pinch =
    pinchRatio < PINCH_THRESHOLD && indexPalmClearance > INDEX_PALM_CLEARANCE && !createPose;

  const point = !pinch && !createPose && isPointing(hand);

  // Cursor is available whenever a hand is visible, so the controller can track
  // position through the pinch hysteresis band (not only while a gesture fires).
  const cursor = toNDC(hand[LM.INDEX_TIP]);

  return {
    point,
    pinch,
    createPose,
    cursor,
    pinchRatio,
    createPoseRatio,
    indexPalmClearance,
  };
}

/** Approximate palm center: centroid of the wrist and the four finger knuckles. */
function palmCenter(hand: HandLandmarks): Landmark {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0, y = 0, z = 0;
  for (const i of ids) {
    x += hand[i].x;
    y += hand[i].y;
    z += hand[i].z;
  }
  return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
}

/** True when all four fingers are curled toward their knuckles (a closed fist). */
function isFist(hand: HandLandmarks, handSize: number): boolean {
  return (
    isCurled(hand, LM.INDEX_TIP, LM.INDEX_MCP, handSize) &&
    isCurled(hand, LM.MIDDLE_TIP, LM.MIDDLE_MCP, handSize) &&
    isCurled(hand, LM.RING_TIP, LM.RING_MCP, handSize) &&
    isCurled(hand, LM.PINKY_TIP, LM.PINKY_MCP, handSize)
  );
}

function isCurled(hand: HandLandmarks, tip: number, mcp: number, handSize: number): boolean {
  return dist(hand[tip], hand[mcp]) / handSize < FIST_CURL_THRESHOLD;
}

function isExtended(hand: HandLandmarks, tip: number, pip: number): boolean {
  return hand[tip].y < hand[pip].y;
}

function isCreatePose(
  hand: HandLandmarks,
  handSize: number,
  createPoseRatio: number,
  fist: boolean,
): boolean {
  if (fist) return false;
  const indexExtended = isExtended(hand, LM.INDEX_TIP, LM.INDEX_PIP);
  const pinkyExtended = isExtended(hand, LM.PINKY_TIP, LM.PINKY_PIP);
  const middleCurled = isCurled(hand, LM.MIDDLE_TIP, LM.MIDDLE_MCP, handSize);
  const ringCurled = isCurled(hand, LM.RING_TIP, LM.RING_MCP, handSize);
  return indexExtended && pinkyExtended && middleCurled && ringCurled && createPoseRatio < PINCH_THRESHOLD;
}

/** Index extended while middle/ring/pinky are curled. */
function isPointing(hand: HandLandmarks): boolean {
  const indexExtended = isExtended(hand, LM.INDEX_TIP, LM.INDEX_PIP);
  const middleCurled = hand[LM.MIDDLE_TIP].y > hand[LM.MIDDLE_PIP].y;
  const ringCurled = hand[LM.RING_TIP].y > hand[LM.RING_PIP].y;
  const pinkyCurled = hand[LM.PINKY_TIP].y > hand[LM.PINKY_PIP].y;
  return indexExtended && middleCurled && ringCurled && pinkyCurled;
}

/** Image-space landmark ([0,1], y-down) → NDC ([-1,1], y-up), mirrored for selfie view. */
export function toNDC(p: Landmark): NDC {
  return { x: (1 - p.x) * 2 - 1, y: (1 - p.y) * 2 - 1 };
}

/**
 * Per-hand observation used by the manipulation controller. Adds a grab anchor
 * (thumb–index midpoint) and an in-plane roll angle on top of the basic
 * point/pinch state, plus the handedness label so per-hand state is stable.
 */
export interface HandObservation {
  label: string;
  point: boolean;
  pinch: boolean;
  pinchRatio: number;
  createPose: boolean;
  createPoseRatio: number;
  /** Normalized 3D index-tip-to-palm distance — exposed for tuning the fist guard. */
  indexPalmClearance: number;
  /** True when the middle fingertip also joins the pinch (thumb+index+middle). */
  threeFinger: boolean;
  /** All four fingers curled into the palm (a closed fist). */
  fist: boolean;
  /** All four fingers extended (an open palm). */
  openPalm: boolean;
  /** Number of extended fingers (index..pinky), 0–4 — for finger-count commands. */
  fingerCount: number;
  /** Index + middle extended and held together, ring + pinky curled (the swipe pose). */
  indexMiddle: boolean;
  /** Normalized thumb-tip→middle-tip distance — for the render-mode snap/tap. */
  thumbMiddleRatio: number;
  /**
   * Apparent hand size (wrist→middle-knuckle distance in normalized image
   * coords) used as a robust proxy for distance to the camera: it grows as the
   * hand moves closer and shrinks as it pulls away. The controller tracks its
   * frame-to-frame change to drive depth (camera-Z) translation while grabbing.
   * Far more stable than the raw, wrist-relative landmark z.
   */
  depth: number;
  /** Index fingertip in NDC (pointer / highlight position). */
  cursor: NDC;
  /** Thumb–index midpoint in NDC — the grab anchor used while pinching. */
  anchor: NDC;
  /** Full 3D hand orientation (palm frame) as a quaternion. */
  orient: Quat;
}

/** Build observations for every hand in a frame, keyed by handedness label. */
export function detectHands(hands: HandLandmarks[], labels: string[] = []): HandObservation[] {
  const out: HandObservation[] = [];
  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i];
    if (!hand || hand.length < 21) continue;
    out.push(observeHand(hand, labels[i] ?? `hand${i}`));
  }
  return out;
}

/** Observe a single 21-point hand. */
export function observeHand(hand: HandLandmarks, label: string): HandObservation {
  const base = detectHand(hand);
  const thumb = toNDC(hand[LM.THUMB_TIP]);
  const index = toNDC(hand[LM.INDEX_TIP]);
  const anchor = { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };

  // Three-finger pinch: middle tip also close to the thumb (only meaningful
  // while the basic thumb+index pinch holds).
  const handSize = dist(hand[LM.WRIST], hand[LM.MIDDLE_MCP]) || 1e-6;
  const thumbMiddle = dist(hand[LM.THUMB_TIP], hand[LM.MIDDLE_TIP]) / handSize;
  const threeFinger = base.pinch && thumbMiddle < MIDDLE_PINCH_THRESHOLD;

  // Pose primitives for the discrete command gestures (explode, snap-view,
  // render-mode, turntable). Finger extension uses the same tip-vs-PIP test as
  // the point/create poses, so it's only meaningful with the hand held upright.
  const idx = isExtended(hand, LM.INDEX_TIP, LM.INDEX_PIP);
  const mid = isExtended(hand, LM.MIDDLE_TIP, LM.MIDDLE_PIP);
  const rng = isExtended(hand, LM.RING_TIP, LM.RING_PIP);
  const pky = isExtended(hand, LM.PINKY_TIP, LM.PINKY_PIP);
  const fingerCount = (idx ? 1 : 0) + (mid ? 1 : 0) + (rng ? 1 : 0) + (pky ? 1 : 0);
  const fist = isFist(hand, handSize);
  const openPalm = idx && mid && rng && pky;
  const indexMiddle =
    idx && mid && !rng && !pky &&
    dist(hand[LM.INDEX_TIP], hand[LM.MIDDLE_TIP]) / handSize < 0.6;

  return {
    label,
    point: base.point,
    pinch: base.pinch,
    pinchRatio: base.pinchRatio,
    createPose: base.createPose,
    createPoseRatio: base.createPoseRatio,
    indexPalmClearance: base.indexPalmClearance,
    threeFinger,
    fist,
    openPalm,
    fingerCount,
    indexMiddle,
    thumbMiddleRatio: thumbMiddle,
    depth: handSize,
    cursor: base.cursor ?? index,
    anchor,
    orient: handOrientation(hand),
  };
}

/**
 * Build the hand's 3D orientation from three palm landmarks (wrist, index-MCP,
 * pinky-MCP). Coordinates are taken in view space (mirrored X, up +Y) so the
 * object turns the way the user expects. Returns a quaternion; the controller
 * tracks the frame-to-frame delta to rotate the object on every axis.
 */
function handOrientation(hand: HandLandmarks): Quat {
  // View space: mirror X (selfie), flip Y to up, keep Z.
  const v = (p: Landmark): Vec3 => ({ x: -p.x, y: -p.y, z: p.z });
  const wrist = v(hand[LM.WRIST]);
  const indexMcp = v(hand[LM.INDEX_MCP]);
  const pinkyMcp = v(hand[LM.PINKY_MCP]);

  const along = sub(indexMcp, wrist); // wrist → index, "forward" along the hand
  const across = sub(pinkyMcp, wrist); // wrist → pinky, spans the palm
  let zAxis = normalize(cross(along, across)); // palm normal
  let xAxis = normalize(along);
  if (length3(zAxis) < 0.5 || length3(xAxis) < 0.5) return { x: 0, y: 0, z: 0, w: 1 };
  const yAxis = normalize(cross(zAxis, xAxis));
  xAxis = cross(yAxis, zAxis); // re-orthogonalize
  return quatFromBasis(xAxis, yAxis, zAxis);
}

function length3(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
