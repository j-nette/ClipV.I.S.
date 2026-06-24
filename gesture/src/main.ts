import { gestureBus } from './eventBus';
import { KeyboardFallback } from './keyboardFallback';
import { StandaloneScene } from './consumers/standaloneScene';
import { startCamera, CameraError } from './camera';
import { HandTracker } from './handTracker';
import { Overlay } from './overlay';
import { detectHands, INDEX_PALM_CLEARANCE, PINCH_THRESHOLD } from './gestureDetector';
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
  const metricsEl = document.getElementById('metrics');
  if (!container) throw new Error('#scene container not found');

  // `?debug` reveals the skeleton overlay, camera preview, and key help.
  const debug = new URLSearchParams(location.search).has('debug');
  if (debug) document.body.classList.add('debug');

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

  // Camera + hand tracking (additive; keyboard works regardless).
  await startHandTracking({ overlayCanvas, statusEl, stateEl, metricsEl, debug });

  console.info(
    '[gesture] Ready. Add ?debug for skeleton + camera preview. ' +
      'Keyboard: P=point, G=grab, arrows=move, Q/E/R/F/C/V=rotate, Z/X/wheel=zoom.',
  );
}

interface TrackingDeps {
  overlayCanvas: HTMLCanvasElement | null;
  statusEl: HTMLElement | null;
  stateEl: HTMLElement | null;
  metricsEl: HTMLElement | null;
  debug: boolean;
}

/** Starts the webcam + MediaPipe loop, rendering the live skeleton overlay. */
async function startHandTracking(deps: TrackingDeps): Promise<void> {
  const { overlayCanvas, statusEl, stateEl, metricsEl, debug } = deps;
  const setStatus = (text: string) => {
    if (statusEl) statusEl.textContent = text;
  };

  try {
    setStatus('loading hand model…');
    const tracker = new HandTracker({ numHands: 2 });
    await tracker.init();

    setStatus('requesting camera…');
    const { video } = await startCamera({ width: 640, height: 480 });

    // Skeleton overlay is debug-only (clean for the real demo).
    const overlay = debug && overlayCanvas ? new Overlay(overlayCanvas) : null;

    // Feed per-hand observations through the controller, which applies pinch
    // hysteresis + smoothing and emits manipulation events onto the bus:
    //   1 pinch  → grab (translate + 3D rotate)
    //   2 pinch  → scale
    //   point    → highlight
    const controller = new GestureController();
    tracker.onResults((frame) => {
      const hands = detectHands(frame.hands, frame.labels);
      overlay?.draw(frame, toTint(hands, controller.state));
      controller.update(hands);
      updateStateBadge(stateEl, controller.state);
      if (debug) updateMetrics(metricsEl, hands);
    });

    tracker.start(video);
    setStatus('tracking — show your hand');
  } catch (err) {
    const msg =
      err instanceof CameraError
        ? `Camera unavailable (${err.kind}). Keyboard controls still work.`
        : 'Hand tracking failed to start. Keyboard controls still work.';
    console.warn('[gesture]', msg, err);
    setStatus('keyboard-only');
    showToast(msg, { error: true, durationMs: 6000 });
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
    indexPalmClearance: hands[0]?.indexPalmClearance ?? 0,
  };
}

/** Live tuning readout (debug only): per-hand pinch ratio + palm clearance. */
function updateMetrics(el: HTMLElement | null, hands: HandObservation[]): void {
  if (!el) return;
  if (!hands.length) {
    el.textContent = 'no hand';
    return;
  }
  const lines = hands.map((h) => {
    const clr = h.indexPalmClearance.toFixed(2);
    const ratio = h.pinchRatio.toFixed(2);
    const pass = h.indexPalmClearance > INDEX_PALM_CLEARANCE ? 'OK ' : 'fist';
    return `${h.label.padEnd(5)} ratio ${ratio}  clear ${clr} ${pass}`;
  });
  el.textContent = `pinch<${PINCH_THRESHOLD}  clear>${INDEX_PALM_CLEARANCE}\n${lines.join('\n')}`;
}

/** Placeholder until Phase 5 — keeps the consumer switch type-safe. */
function createHologramAdapterStub(): Consumer {
  console.warn('[gesture] HologramAdapter not implemented yet — falling back to no-op consumer.');
  return { handle: () => {} };
}

let toastTimer = 0;
/** Show a transient message (auto-hides). Used for camera/tracking errors. */
function showToast(message: string, opts: { error?: boolean; durationMs?: number } = {}): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `show${opts.error ? ' error' : ''}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.className = el.className.replace('show', '').trim();
  }, opts.durationMs ?? 4000);
}

void main();
