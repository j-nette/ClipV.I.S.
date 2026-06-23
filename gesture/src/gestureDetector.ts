import type { HandLandmarks, Landmark, NDC } from './types';

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
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

/** Pinch when thumb–index distance / hand size drops below this. */
export const PINCH_THRESHOLD = 0.4;

export interface GestureState {
  point: boolean;
  pinch: boolean;
  /** Pointer position in NDC (index fingertip), present when point or pinch. */
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
  const pinch = pinchRatio < PINCH_THRESHOLD;

  const point = !pinch && isPointing(hand);

  const cursor = point || pinch ? toNDC(hand[LM.INDEX_TIP]) : null;

  return { point, pinch, cursor, pinchRatio };
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

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
