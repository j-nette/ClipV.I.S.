import { describe, it, expect } from 'vitest';
import { detect, detectHand, toNDC, LM, PINCH_THRESHOLD } from '../src/gestureDetector';
import type { HandLandmarks, Landmark } from '../src/types';

/** Build a 21-point hand, all landmarks defaulting to center, then apply overrides. */
function makeHand(overrides: Record<number, Partial<Landmark>>): HandLandmarks {
  const hand: HandLandmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [idx, p] of Object.entries(overrides)) {
    hand[Number(idx)] = { ...hand[Number(idx)], ...p };
  }
  return hand;
}

/** Open hand: all fingers extended, thumb far from index → neither point nor pinch. */
function openHand(): HandLandmarks {
  return makeHand({
    [LM.WRIST]: { x: 0.5, y: 0.9 },
    [LM.MIDDLE_MCP]: { x: 0.5, y: 0.6 },
    [LM.THUMB_TIP]: { x: 0.35, y: 0.65 },
    [LM.INDEX_MCP]: { x: 0.45, y: 0.6 },
    [LM.INDEX_PIP]: { x: 0.45, y: 0.45 },
    [LM.INDEX_TIP]: { x: 0.45, y: 0.3 },
    [LM.MIDDLE_PIP]: { x: 0.5, y: 0.45 },
    [LM.MIDDLE_TIP]: { x: 0.5, y: 0.3 },
    [LM.RING_PIP]: { x: 0.55, y: 0.45 },
    [LM.RING_TIP]: { x: 0.55, y: 0.3 },
    [LM.PINKY_PIP]: { x: 0.6, y: 0.45 },
    [LM.PINKY_TIP]: { x: 0.6, y: 0.3 },
  });
}

describe('gestureDetector', () => {
  it('returns neutral state for an empty frame', () => {
    expect(detect([])).toEqual({
      point: false,
      pinch: false,
      createPose: false,
      cursor: null,
      pinchRatio: 1,
      createPoseRatio: 1,
    });
  });

  it('returns neutral state for a malformed hand (<21 points)', () => {
    const state = detect([[{ x: 0.5, y: 0.5, z: 0 }]]);
    expect(state.point).toBe(false);
    expect(state.pinch).toBe(false);
  });

  it('detects no gesture for a flat open hand', () => {
    const state = detectHand(openHand());
    expect(state.pinch).toBe(false);
    expect(state.point).toBe(false);
    // Cursor is still reported whenever a hand is visible.
    expect(state.cursor).not.toBeNull();
  });

  it('detects pinch when thumb tip meets index tip', () => {
    const hand = openHand();
    hand[LM.THUMB_TIP] = { x: 0.44, y: 0.31, z: 0 }; // near index tip (0.45, 0.3)
    const state = detectHand(hand);
    expect(state.pinch).toBe(true);
    expect(state.pinchRatio).toBeLessThan(PINCH_THRESHOLD);
    expect(state.cursor).not.toBeNull();
  });

  it('detects a rock-sign create pose when middle and ring fold onto the thumb', () => {
    const hand = openHand();
    hand[LM.THUMB_TIP] = { x: 0.53, y: 0.56, z: 0 };
    hand[LM.MIDDLE_TIP] = { x: 0.52, y: 0.57, z: 0 };
    hand[LM.RING_TIP] = { x: 0.54, y: 0.57, z: 0 };
    hand[LM.PINKY_TIP] = { x: 0.61, y: 0.29, z: 0 };
    const state = detectHand(hand);
    expect(state.createPose).toBe(true);
    expect(state.createPoseRatio).toBeLessThan(PINCH_THRESHOLD);
    expect(state.point).toBe(false);
  });

  it('does NOT pinch for a closed fist (thumb + index tips also close)', () => {
    // All four fingers curled toward their knuckles, thumb resting on index tip.
    const hand = makeHand({
      [LM.WRIST]: { x: 0.5, y: 0.9 },
      [LM.INDEX_MCP]: { x: 0.45, y: 0.6 },
      [LM.MIDDLE_MCP]: { x: 0.5, y: 0.6 },
      [LM.RING_MCP]: { x: 0.55, y: 0.6 },
      [LM.PINKY_MCP]: { x: 0.6, y: 0.6 },
      [LM.INDEX_TIP]: { x: 0.46, y: 0.58 },
      [LM.MIDDLE_TIP]: { x: 0.5, y: 0.58 },
      [LM.RING_TIP]: { x: 0.55, y: 0.58 },
      [LM.PINKY_TIP]: { x: 0.6, y: 0.58 },
      [LM.THUMB_TIP]: { x: 0.46, y: 0.58 },
    });
    const state = detectHand(hand);
    expect(state.pinchRatio).toBeLessThan(PINCH_THRESHOLD); // tips are close…
    expect(state.pinch).toBe(false); // …but it's a fist, so no pinch
  });

  it('detects point when index is extended and other fingers are curled', () => {
    const hand = openHand();
    // Curl middle/ring/pinky (tip below its PIP in image space).
    hand[LM.MIDDLE_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand[LM.RING_TIP] = { x: 0.55, y: 0.5, z: 0 };
    hand[LM.PINKY_TIP] = { x: 0.6, y: 0.5, z: 0 };
    const state = detectHand(hand);
    expect(state.point).toBe(true);
    expect(state.pinch).toBe(false);
    expect(state.cursor).not.toBeNull();
  });

  it('pinch suppresses point even if fingers look like a point', () => {
    const hand = openHand();
    hand[LM.MIDDLE_TIP] = { x: 0.5, y: 0.5, z: 0 };
    hand[LM.RING_TIP] = { x: 0.55, y: 0.5, z: 0 };
    hand[LM.PINKY_TIP] = { x: 0.6, y: 0.5, z: 0 };
    hand[LM.THUMB_TIP] = { x: 0.44, y: 0.31, z: 0 }; // also pinching
    const state = detectHand(hand);
    expect(state.pinch).toBe(true);
    expect(state.point).toBe(false);
  });

  it('maps image-space landmark to mirrored y-up NDC', () => {
    expect(toNDC({ x: 0.5, y: 0.5, z: 0 })).toEqual({ x: 0, y: 0 });
    // x mirrored: left in image (x=0) → right in NDC (+1).
    expect(toNDC({ x: 0, y: 0, z: 0 })).toEqual({ x: 1, y: 1 });
    expect(toNDC({ x: 1, y: 1, z: 0 })).toEqual({ x: -1, y: -1 });
  });
});
