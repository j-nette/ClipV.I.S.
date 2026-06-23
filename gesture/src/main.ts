import { gestureBus } from './eventBus';
import { KeyboardFallback } from './keyboardFallback';
import { StandaloneScene } from './consumers/standaloneScene';
import { startCamera, CameraError } from './camera';
import { HandTracker } from './handTracker';
import { Overlay } from './overlay';
import { detectHands } from './gestureDetector';
import type { HandObservation, GestureState } from './gestureDetector';
import { GestureController } from './gestureController';
import type { Mode } from './gestureController';
import type { Consumer } from './types';

/**
 * Bootstrap. Phase 0: consumer + keyboard fallback. Phase 1: also start the
 * camera + MediaPipe hand tracker and render the live skeleton overlay. Hand
 * tracking is additive — if the camera fails, the keyboard fallback still runs.
 */
async function main(): Promise<void> {
  const container = document.getElementById('scene');
  const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement | null;
  const statusEl = document.getElementById('status');
  const stateEl = document.getElementById('gesture-state');
  if (!container) throw new Error('#scene container not found');

  // Consumer selection. Default is the laptop-screen StandaloneScene.
  // `?consumer=hologram` will select HologramAdapter once Phase 5 exists.
  const which = new URLSearchParams(location.search).get('consumer');
  const consumer: Consumer = which === 'hologram'
    ? createHologramAdapterStub()
    : new StandaloneScene(container);

  gestureBus.on((e) => consumer.handle(e));

  // Dev visibility: mirror the README standalone test ("PINCH START" in console).
  gestureBus.on((e) => {
    if (e.type === 'pinch_start') console.log('PINCH START', e.ndc);
    if (e.type === 'pinch_end') console.log('PINCH END');
    if (e.type === 'point') console.log('POINT', e.ndc);
  });

  // Always-on keyboard producer.
  new KeyboardFallback().start();

  // Phase 1: camera + hand tracking (additive; keyboard works regardless).
  await startHandTracking(overlayCanvas, statusEl, stateEl);

  console.info(
    '[gesture] Ready. Keyboard: P=point, G=pinch, arrows=move, Q/E/R/F=rotate, Z/X/wheel=zoom.',
  );
}

/** Starts the webcam + MediaPipe loop, rendering the live skeleton overlay. */
async function startHandTracking(
  overlayCanvas: HTMLCanvasElement | null,
  statusEl: HTMLElement | null,
  stateEl: HTMLElement | null,
): Promise<void> {
  const setStatus = (text: string) => {
    if (statusEl) statusEl.textContent = text;
  };

  try {
    setStatus('loading hand model…');
    const tracker = new HandTracker({ numHands: 2 });
    await tracker.init();

    setStatus('requesting camera…');
    const { video } = await startCamera({ width: 640, height: 480 });

    const overlay = overlayCanvas ? new Overlay(overlayCanvas) : null;

    // Feed per-hand observations through the controller, which applies pinch
    // hysteresis + smoothing and emits manipulation events onto the bus:
    //   1 pinch  → grab (translate + roll-rotate)
    //   2 pinch  → scale
    //   point    → highlight
    const controller = new GestureController();
    tracker.onResults((frame) => {
      const hands = detectHands(frame.hands, frame.labels);
      overlay?.draw(frame, toTint(hands, controller.state));
      controller.update(hands);
      updateStateBadge(stateEl, controller.state);
    });

    tracker.start(video);
    setStatus('tracking — show your hand');
  } catch (err) {
    const msg =
      err instanceof CameraError
        ? `camera unavailable (${err.kind}) — keyboard fallback active`
        : 'hand tracking failed to start — keyboard fallback active';
    console.warn('[gesture]', msg, err);
    setStatus(msg);
  }
}

/** Reflect the controller's stable gesture mode on the centered HUD badge. */
function updateStateBadge(el: HTMLElement | null, mode: Mode): void {
  if (!el) return;
  if (mode === 'grab') {
    el.textContent = 'GRAB';
    el.className = 'pinch';
  } else if (mode === 'scale') {
    el.textContent = 'SCALE';
    el.className = 'pinch';
  } else if (mode === 'point') {
    el.textContent = 'POINT';
    el.className = 'point';
  } else {
    el.textContent = 'IDLE';
    el.className = '';
  }
}

/** Build an overlay tint state from the hands + controller mode. */
function toTint(hands: HandObservation[], mode: Mode): GestureState {
  const active = mode === 'grab' || mode === 'scale';
  const cursor = hands[0]?.anchor ?? hands[0]?.cursor ?? null;
  return {
    point: mode === 'point',
    pinch: active,
    cursor,
    pinchRatio: hands[0]?.pinchRatio ?? 1,
  };
}

/** Placeholder until Phase 5 — keeps the consumer switch type-safe. */
function createHologramAdapterStub(): Consumer {
  console.warn('[gesture] HologramAdapter not implemented yet — falling back to no-op consumer.');
  return { handle: () => {} };
}

void main();
