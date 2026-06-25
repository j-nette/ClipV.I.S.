import { describe, it, expect } from 'vitest';
import { GestureController } from '../src/gestureController';
import type { HandObservation } from '../src/gestureDetector';
import type { GestureEvent } from '../src/types';
import { quatAngle, IDENTITY_QUAT } from '../src/quat';

/** Build a hand observation; not pinching, not pointing, centered, by default. */
function hand(partial: Partial<HandObservation> = {}): HandObservation {
  return {
    label: 'Right',
    point: false,
    pinch: false,
    pinchRatio: 1,
    createPose: false,
    createPoseRatio: 1,
    indexPalmClearance: 1,
    threeFinger: false,
    depth: 0.2,
    cursor: { x: 0, y: 0 },
    anchor: { x: 0, y: 0 },
    orient: IDENTITY_QUAT,
    ...partial,
  };
}

function makeController() {
  const events: GestureEvent[] = [];
  // Explicit thresholds keep these tests independent of the production
  // PINCH_THRESHOLD default (enter 0.35 / exit 0.5 / clearance 0.6).
  const controller = new GestureController({
    pinchOn: 0.35,
    pinchOff: 0.5,
    palmClearance: 0.6,
    releaseFrames: 1, // release immediately unless a test opts into the debounce
    holdFrames: 0, // no tracking-dropout grace unless a test opts in
    emit: (e) => events.push(e),
  });
  return { controller, events };
}

const types = (events: GestureEvent[]) => events.map((e) => e.type);

describe('GestureController (manipulation)', () => {
  it('one pinching hand enters grab and emits pinch_start then pinch_move', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2, anchor: { x: 0.1, y: 0.1 } })]);
    controller.update([hand({ pinchRatio: 0.2, anchor: { x: 0.2, y: 0.2 } })]);
    expect(controller.state).toBe('grab');
    expect(types(events)).toEqual(['pinch_start', 'pinch_move']);
  });

  it('two-finger grab targets a single object (scope=object)', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2, threeFinger: false })]);
    expect(controller.scopeState).toBe('object');
    const start = events.find((e) => e.type === 'pinch_start');
    if (start && start.type === 'pinch_start') expect(start.scope).toBe('object');
  });

  it('three-finger grab targets the whole assembly (scope=assembly)', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2, threeFinger: true })]);
    expect(controller.state).toBe('grab');
    expect(controller.scopeState).toBe('assembly');
    const start = events.find((e) => e.type === 'pinch_start');
    expect(start).toBeDefined();
    if (start && start.type === 'pinch_start') expect(start.scope).toBe('assembly');
  });

  it('right-hand pinch translates: pinch_start then pinch_move, never rotate', () => {
    const { controller, events } = makeController();
    controller.update([hand({ label: 'Right', pinchRatio: 0.2, anchor: { x: 0.1, y: 0.1 } })]);
    controller.update([hand({ label: 'Right', pinchRatio: 0.2, anchor: { x: 0.2, y: 0.2 } })]);
    expect(types(events)).toEqual(['pinch_start', 'pinch_move']);
    expect(events.some((e) => e.type === 'rotate')).toBe(false);
  });

  it('left-hand pinch rotates by moving, with no translation', () => {
    const { controller, events } = makeController();
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([left(0)]); // session anchors, no emit yet
    controller.update([left(0.2)]); // moves right → yaw
    expect(controller.state).toBe('grab');
    expect(types(events)).not.toContain('pinch_start');
    expect(types(events)).not.toContain('pinch_move');
    const rot = events.find((e) => e.type === 'rotate');
    expect(rot).toBeDefined();
    if (rot && rot.type === 'rotate') expect(quatAngle(rot.q)).toBeGreaterThan(0);
  });

  it('left-hand three-finger pinch rotates the whole assembly', () => {
    const { controller, events } = makeController();
    const left = (x: number) =>
      hand({ label: 'Left', pinchRatio: 0.2, threeFinger: true, anchor: { x, y: 0 } });
    controller.update([left(0)]);
    controller.update([left(0.2)]);
    const rot = events.find((e) => e.type === 'rotate');
    expect(rot).toBeDefined();
    if (rot && rot.type === 'rotate') expect(rot.scope).toBe('assembly');
  });

  it('does not rotate for sub-deadzone left-hand movement', () => {
    const { controller, events } = makeController();
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([left(0)]);
    events.length = 0;
    controller.update([left(0.001)]); // tiny move, below deadzone
    expect(events.some((e) => e.type === 'rotate')).toBe(false);
  });

  it('emits rotate_start with the hand position, then rotate_end on release', () => {
    const { controller, events } = makeController();
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([left(0.3)]); // rotation session starts
    const start = events.find((e) => e.type === 'rotate_start');
    expect(start).toBeDefined();
    if (start && start.type === 'rotate_start') expect(start.ndc.x).toBeCloseTo(0.3);
    controller.update([]); // hand lost → release
    expect(types(events)).toContain('rotate_end');
  });

  it('both hands pinching scale (zoom in as they move apart)', () => {
    const { controller, events } = makeController();
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([right(0.1), left(-0.1)]); // scale starts, dist 0.2
    controller.update([right(0.2), left(-0.2)]); // dist 0.4 → apart → zoom in
    expect(controller.state).toBe('scale');
    const zoom = events.find((e) => e.type === 'zoom');
    expect(zoom).toBeDefined();
    if (zoom && zoom.type === 'zoom') expect(zoom.delta).toBeGreaterThan(0);
    expect(types(events)).not.toContain('rotate');
    expect(types(events)).not.toContain('pinch_move');
  });

  it('moving both hands together zooms out', () => {
    const { controller, events } = makeController();
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([right(0.2), left(-0.2)]); // dist 0.4
    events.length = 0;
    controller.update([right(0.1), left(-0.1)]); // dist 0.2 → together → zoom out
    const zoom = events.find((e) => e.type === 'zoom');
    if (zoom && zoom.type === 'zoom') expect(zoom.delta).toBeLessThan(0);
  });

  it('a second hand joining a grab ends the grab before scaling', () => {
    const { controller, events } = makeController();
    controller.update([hand({ label: 'Right', pinchRatio: 0.2 })]); // right grab
    events.length = 0;
    controller.update([
      hand({ label: 'Right', pinchRatio: 0.2, anchor: { x: 0.1, y: 0 } }),
      hand({ label: 'Left', pinchRatio: 0.2, anchor: { x: -0.1, y: 0 } }),
    ]);
    expect(types(events)).toContain('pinch_end');
    expect(controller.state).toBe('scale');
  });

  it('two-hand scale picks the hand that pinched first, midpoint as fallback', () => {
    const { controller, events } = makeController();
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([right(0.3)]); // right pinches first (grab)
    controller.update([right(0.3), left(-0.1)]); // left joins → scale
    const start = events.find((e) => e.type === 'scale_start');
    expect(start).toBeDefined();
    if (start && start.type === 'scale_start') {
      expect(start.ndc.x).toBeCloseTo(0.3); // first-pinching hand (right)
      expect(start.ndcMid.x).toBeCloseTo(0.1); // midpoint of 0.3 and -0.1
    }
    controller.update([]); // hands lost → release
    expect(types(events)).toContain('scale_end');
  });

  it('two hands pinching the same frame fall back to the midpoint', () => {
    const { controller, events } = makeController();
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([right(0.2), left(-0.4)]); // both start together
    const start = events.find((e) => e.type === 'scale_start');
    expect(start).toBeDefined();
    if (start && start.type === 'scale_start') {
      expect(start.ndc.x).toBeCloseTo(-0.1); // no clear first → midpoint
      expect(start.ndcMid.x).toBeCloseTo(-0.1);
    }
  });

  it('left hand moving toward the camera rolls the item (depth → rotate)', () => {
    const { controller, events } = makeController();
    const left = (depth: number) =>
      hand({ label: 'Left', pinchRatio: 0.2, depth, anchor: { x: 0, y: 0 } });
    controller.update([left(0.2)]); // session anchors
    controller.update([left(0.4)]); // apparent size grows = hand closer → roll
    const rot = events.find((e) => e.type === 'rotate');
    expect(rot).toBeDefined();
    if (rot && rot.type === 'rotate') expect(quatAngle(rot.q)).toBeGreaterThan(0);
  });

  it('applies pinch hysteresis per hand', () => {
    const { controller } = makeController(); // on 0.35 / off 0.5
    controller.update([hand({ pinchRatio: 0.4 })]); // in band → not pinching
    expect(controller.state).toBe('idle');
    controller.update([hand({ pinchRatio: 0.3 })]); // below on → grab
    expect(controller.state).toBe('grab');
    controller.update([hand({ pinchRatio: 0.45 })]); // in band → still grabbing
    expect(controller.state).toBe('grab');
    controller.update([hand({ pinchRatio: 0.6 })]); // above off → release
    expect(controller.state).toBe('idle');
  });

  it('emits point when a single hand points', () => {
    const { controller, events } = makeController();
    controller.update([hand({ point: true, cursor: { x: 0.3, y: 0.4 } })]);
    expect(controller.state).toBe('point');
    expect(types(events)).toEqual(['point']);
  });

  it('emits orb_create once when the create pose starts', () => {
    const { controller, events } = makeController();
    controller.update([hand({ createPoseRatio: 0.2, cursor: { x: 0.3, y: 0.4 } })]);
    controller.update([hand({ createPoseRatio: 0.25, cursor: { x: 0.31, y: 0.41 } })]);
    expect(types(events).filter((type) => type === 'orb_create')).toEqual(['orb_create']);
  });

  it('does NOT grab a fist even with tips together (low palm clearance)', () => {
    const { controller } = makeController(); // palmClearance default 0.6
    // Tips close (low ratio) but fingertip tucked into palm (low clearance).
    controller.update([hand({ pinchRatio: 0.1, indexPalmClearance: 0.3 })]);
    expect(controller.state).toBe('idle');
  });

  it('keeps the grip through a brief release spike (release debounce)', () => {
    const events: GestureEvent[] = [];
    const controller = new GestureController({
      pinchOn: 0.35,
      pinchOff: 0.5,
      palmClearance: 0.6,
      releaseFrames: 3, // require 3 consecutive release frames
      emit: (e) => events.push(e),
    });
    const right = (ratio: number) => hand({ label: 'Right', pinchRatio: ratio });
    controller.update([right(0.2)]); // grab
    expect(controller.state).toBe('grab');
    controller.update([right(0.7)]); // one-frame motion-blur spike → still grabbing
    expect(controller.state).toBe('grab');
    controller.update([right(0.2)]); // re-pinched → grip held throughout
    expect(controller.state).toBe('grab');
    expect(types(events)).not.toContain('pinch_end');
  });

  it('holds the grab through a brief tracking dropout (hand-loss grace)', () => {
    const events: GestureEvent[] = [];
    const controller = new GestureController({
      pinchOn: 0.35,
      pinchOff: 0.5,
      palmClearance: 0.6,
      releaseFrames: 1,
      holdFrames: 3, // hold up to 3 missing frames
      emit: (e) => events.push(e),
    });
    const right = () => hand({ label: 'Right', pinchRatio: 0.2 });
    controller.update([right()]); // grab
    expect(controller.state).toBe('grab');
    controller.update([]); // hand vanished (dropout) → held, not dropped
    controller.update([]); // still held
    expect(controller.state).toBe('grab');
    expect(types(events)).not.toContain('pinch_end');
    controller.update([right()]); // hand back → grab continues uninterrupted
    expect(controller.state).toBe('grab');
    expect(types(events)).not.toContain('pinch_end');
  });

  it('drops the grab after the dropout grace expires', () => {
    const events: GestureEvent[] = [];
    const controller = new GestureController({
      pinchOn: 0.35,
      pinchOff: 0.5,
      palmClearance: 0.6,
      releaseFrames: 1,
      holdFrames: 2,
      emit: (e) => events.push(e),
    });
    const right = () => hand({ label: 'Right', pinchRatio: 0.2 });
    controller.update([right()]); // grab
    controller.update([]); // miss 1 (held)
    controller.update([]); // miss 2 (held)
    controller.update([]); // beyond grace → drop
    expect(types(events)).toContain('pinch_end');
    expect(controller.state).toBe('idle');
  });

  it('releases an active grab if the hand curls into a fist', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.1, indexPalmClearance: 0.9 })]); // grab
    expect(controller.state).toBe('grab');
    events.length = 0;
    controller.update([hand({ pinchRatio: 0.1, indexPalmClearance: 0.3 })]); // fist
    expect(controller.state).toBe('idle');
    expect(types(events)).toEqual(['pinch_end']);
  });

  it('losing all hands ends an active grab', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2 })]);
    events.length = 0;
    controller.update([]); // no hands
    expect(types(events)).toEqual(['pinch_end']);
    expect(controller.state).toBe('idle');
  });
});
