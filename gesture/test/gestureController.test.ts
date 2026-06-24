import { describe, it, expect } from 'vitest';
import { GestureController } from '../src/gestureController';
import type { HandObservation } from '../src/gestureDetector';
import type { GestureEvent } from '../src/types';
import { quatFromAxisAngle, quatAngle, IDENTITY_QUAT } from '../src/quat';

/** Build a hand observation; not pinching, not pointing, centered, by default. */
function hand(partial: Partial<HandObservation> = {}): HandObservation {
  return {
    label: 'Right',
    point: false,
    pinch: false,
    pinchRatio: 1,
    indexPalmClearance: 1,
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

  it('twisting the hand while grabbing emits a 3D rotation', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2, orient: IDENTITY_QUAT })]);
    events.length = 0;
    // Rotate the hand 0.2 rad about an arbitrary axis.
    const twisted = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.2);
    controller.update([hand({ pinchRatio: 0.2, orient: twisted })]);
    const rot = events.find((e) => e.type === 'rotate');
    expect(rot).toBeDefined();
    if (rot && rot.type === 'rotate') {
      expect(quatAngle(rot.q)).toBeCloseTo(0.2, 5);
    }
  });

  it('does not emit rotate for sub-deadzone twist', () => {
    const { controller, events } = makeController();
    controller.update([hand({ pinchRatio: 0.2, orient: IDENTITY_QUAT })]);
    events.length = 0;
    const tiny = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.005); // below 0.01 deadzone
    controller.update([hand({ pinchRatio: 0.2, orient: tiny })]);
    expect(events.some((e) => e.type === 'rotate')).toBe(false);
  });

  it('two pinching hands enter scale and zoom in as they move apart', () => {
    const { controller, events } = makeController();
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([left(-0.1), right(0.1)]); // dist 0.2
    controller.update([left(-0.15), right(0.15)]); // dist 0.3 → apart → zoom in
    expect(controller.state).toBe('scale');
    const zoom = events.find((e) => e.type === 'zoom');
    expect(zoom).toBeDefined();
    if (zoom && zoom.type === 'zoom') expect(zoom.delta).toBeGreaterThan(0);
  });

  it('moving hands together zooms out', () => {
    const { controller, events } = makeController();
    const left = (x: number) => hand({ label: 'Left', pinchRatio: 0.2, anchor: { x, y: 0 } });
    const right = (x: number) => hand({ label: 'Right', pinchRatio: 0.2, anchor: { x, y: 0 } });
    controller.update([left(-0.2), right(0.2)]); // dist 0.4
    events.length = 0;
    controller.update([left(-0.1), right(0.1)]); // dist 0.2 → together → zoom out
    const zoom = events.find((e) => e.type === 'zoom');
    if (zoom && zoom.type === 'zoom') expect(zoom.delta).toBeLessThan(0);
  });

  it('grab → scale transition ends the grab before scaling', () => {
    const { controller, events } = makeController();
    controller.update([hand({ label: 'Right', pinchRatio: 0.2 })]); // grab
    events.length = 0;
    controller.update([
      hand({ label: 'Right', pinchRatio: 0.2, anchor: { x: 0.1, y: 0 } }),
      hand({ label: 'Left', pinchRatio: 0.2, anchor: { x: -0.1, y: 0 } }),
    ]);
    expect(types(events)).toContain('pinch_end');
    expect(controller.state).toBe('scale');
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

  it('does NOT grab a fist even with tips together (low palm clearance)', () => {
    const { controller } = makeController(); // palmClearance default 0.6
    // Tips close (low ratio) but fingertip tucked into palm (low clearance).
    controller.update([hand({ pinchRatio: 0.1, indexPalmClearance: 0.3 })]);
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
