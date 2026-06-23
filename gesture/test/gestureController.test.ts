import { describe, it, expect } from 'vitest';
import { GestureController } from '../src/gestureController';
import type { GestureState } from '../src/gestureDetector';
import type { GestureEvent } from '../src/types';

/** Build a detector-style state; cursor present by default (hand visible). */
function st(partial: Partial<GestureState> = {}): GestureState {
  return { point: false, pinch: false, cursor: { x: 0, y: 0 }, pinchRatio: 1, ...partial };
}

function makeController() {
  const events: GestureEvent[] = [];
  const controller = new GestureController({ emit: (e) => events.push(e) });
  return { controller, events };
}

const types = (events: GestureEvent[]) => events.map((e) => e.type);

describe('GestureController', () => {
  it('debounces point: requires N consecutive frames to enter', () => {
    const { controller, events } = makeController(); // debounce = 3
    controller.update(st({ point: true }));
    controller.update(st({ point: true }));
    expect(events).toHaveLength(0); // not yet confirmed
    controller.update(st({ point: true }));
    expect(types(events)).toEqual(['point']);
    expect(controller.state).toBe('point');
  });

  it('emits point_end after N frames without point', () => {
    const { controller, events } = makeController();
    for (let i = 0; i < 3; i++) controller.update(st({ point: true }));
    events.length = 0;
    // Within the debounce-off window it stays in point mode (continuous moves)…
    controller.update(st({ point: false }));
    controller.update(st({ point: false }));
    expect(controller.state).toBe('point');
    expect(types(events)).toEqual(['point', 'point']);
    // …then the Nth off-frame confirms release.
    controller.update(st({ point: false }));
    expect(types(events)).toEqual(['point', 'point', 'point_end']);
    expect(controller.state).toBe('idle');
  });

  it('applies hysteresis to pinch (enter < pinchOn, exit > pinchOff)', () => {
    const { controller, events } = makeController(); // on 0.35 / off 0.5
    controller.update(st({ pinchRatio: 0.4 })); // in the band → no pinch
    expect(controller.state).toBe('idle');
    controller.update(st({ pinchRatio: 0.3 })); // below on → pinch
    expect(controller.state).toBe('pinch');
    controller.update(st({ pinchRatio: 0.45 })); // back in band → still pinch
    expect(controller.state).toBe('pinch');
    controller.update(st({ pinchRatio: 0.6 })); // above off → release
    expect(controller.state).toBe('idle');
    expect(types(events)).toEqual(['pinch_start', 'pinch_move', 'pinch_end']);
  });

  it('pinch wins over point', () => {
    const { controller } = makeController();
    controller.update(st({ point: true, pinchRatio: 0.2 }));
    expect(controller.state).toBe('pinch');
  });

  it('losing the hand ends an active pinch', () => {
    const { controller, events } = makeController();
    controller.update(st({ pinchRatio: 0.2 }));
    events.length = 0;
    controller.update(st({ cursor: null })); // hand gone
    expect(types(events)).toEqual(['pinch_end']);
    expect(controller.state).toBe('idle');
  });

  it('emits pinch_move while held', () => {
    const { controller, events } = makeController();
    controller.update(st({ pinchRatio: 0.2, cursor: { x: 0.1, y: 0.1 } }));
    controller.update(st({ pinchRatio: 0.2, cursor: { x: 0.2, y: 0.2 } }));
    controller.update(st({ pinchRatio: 0.2, cursor: { x: 0.3, y: 0.3 } }));
    expect(types(events)).toEqual(['pinch_start', 'pinch_move', 'pinch_move']);
  });
});
