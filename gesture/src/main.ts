import { gestureBus } from './eventBus';
import { KeyboardFallback } from './keyboardFallback';
import { StandaloneScene } from './consumers/standaloneScene';
import { startCamera, CameraError } from './camera';
import { HandTracker } from './handTracker';
import { Overlay } from './overlay';
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
  await startHandTracking(overlayCanvas, statusEl);

  console.info(
    '[gesture] Ready. Keyboard: P=point, G=pinch, arrows=move, Q/E/R/F=rotate, Z/X/wheel=zoom.',
  );
}

/** Starts the webcam + MediaPipe loop, rendering the live skeleton overlay. */
async function startHandTracking(
  overlayCanvas: HTMLCanvasElement | null,
  statusEl: HTMLElement | null,
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
    let lastLogged = 0;
    tracker.onResults((frame) => {
      overlay?.draw(frame);
      // Throttled landmark log so the standalone test is observable.
      const now = performance.now();
      if (frame.hands.length && now - lastLogged > 1000) {
        lastLogged = now;
        console.log(`[gesture] tracking ${frame.hands.length} hand(s), 21 landmarks each`);
      }
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

/** Placeholder until Phase 5 — keeps the consumer switch type-safe. */
function createHologramAdapterStub(): Consumer {
  console.warn('[gesture] HologramAdapter not implemented yet — falling back to no-op consumer.');
  return { handle: () => {} };
}

void main();
