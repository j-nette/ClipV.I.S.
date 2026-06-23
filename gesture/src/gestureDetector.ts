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
export const PINCH_THRESHOLD = 0.4;

/** A finger counts as curled when its tip–MCP distance / hand size is below this. */
export const FIST_CURL_THRESHOLD = 0.5;

export interface GestureState {
  point: boolean;
  pinch: boolean;
  /** Index-fingertip position in NDC. Present whenever a hand is visible. */
  cursor: NDC | null;
  /** Normalized thumb–index distance — exposed so the controller can apply hysteresis. */
  pinchRatio: number;
}

const NEUTRAL: GestureState = { point: false, pinch: false, cursor: null, pinchRatio: 1 };

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
  // A fist also brings thumb + index tips together, so suppress pinch when the
  // whole hand is curled (all four fingers folded toward their knuckles).
  const pinch = pinchRatio < PINCH_THRESHOLD && !isFist(hand, handSize);

  const point = !pinch && isPointing(hand);

  // Cursor is available whenever a hand is visible, so the controller can track
  // position through the pinch hysteresis band (not only while a gesture fires).
  const cursor = toNDC(hand[LM.INDEX_TIP]);

  return { point, pinch, cursor, pinchRatio };
}

/** True when all four fingers are curled toward their knuckles (a closed fist). */
function isFist(hand: HandLandmarks, handSize: number): boolean {
  const curled = (tip: number, mcp: number) =>
    dist(hand[tip], hand[mcp]) / handSize < FIST_CURL_THRESHOLD;
  return (
    curled(LM.INDEX_TIP, LM.INDEX_MCP) &&
    curled(LM.MIDDLE_TIP, LM.MIDDLE_MCP) &&
    curled(LM.RING_TIP, LM.RING_MCP) &&
    curled(LM.PINKY_TIP, LM.PINKY_MCP)
  );
}

/** Index extended while middle/ring/pinky are curled. */
function isPointing(hand: HandLandmarks): boolean {
  const indexExtended = hand[LM.INDEX_TIP].y < hand[LM.INDEX_PIP].y;
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

  return {
    label,
    point: base.point,
    pinch: base.pinch,
    pinchRatio: base.pinchRatio,
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
