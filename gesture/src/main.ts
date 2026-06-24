import { gestureBus } from './eventBus';
import { KeyboardFallback } from './keyboardFallback';
import { StandaloneScene } from './consumers/standaloneScene';
import { HologramPresenter } from './consumers/hologramPresenter';
import { startCamera, CameraError } from './camera';
import { HandTracker } from './handTracker';
import { Overlay } from './overlay';
import { detectHands, INDEX_PALM_CLEARANCE, PINCH_THRESHOLD } from './gestureDetector';
import type { HandObservation, GestureState } from './gestureDetector';
import { GestureController } from './gestureController';
import type { Mode } from './gestureController';
import type { Consumer, ManipulationScope } from './types';
import { clearStoredOrbs } from '../../info/data/orbStore';

/**
 * Bootstrap. Phase 0: consumer + keyboard fallback. Phase 1: also start the
 * camera + MediaPipe hand tracker and render the live skeleton overlay. Hand
 * tracking is additive — if the camera fails, the keyboard fallback still runs.
 */
async function main(): Promise<void> {
  if (clearIndicatorsFromQuery()) return;

  const container = document.getElementById('scene');
  const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement | null;
  const statusEl = document.getElementById('status');
  const stateEl = document.getElementById('gesture-state');
  const metricsEl = document.getElementById('metrics');
  if (!container) throw new Error('#scene container not found');

  // `?debug` reveals the skeleton overlay, camera preview, and key help.
  const debug = new URLSearchParams(location.search).has('debug');
  if (debug) document.body.classList.add('debug');

  // Consumer selection. Default is now the HologramPresenter: the main gesture
  // page OWNS the shared ModelState and broadcasts it to the /hologram.html
  // follower window. The original boxes/orbs demo is at ?consumer=standalone.
  const which = new URLSearchParams(location.search).get('consumer');
  const useStandalone = which === 'standalone' || which === 'boxes';
  const consumer: Consumer = useStandalone
    ? new StandaloneScene(container)
    : new HologramPresenter(container);

  if (!useStandalone) setupHologramLauncher();

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
      updateStateBadge(stateEl, controller.state, controller.scopeState);
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
function updateStateBadge(el: HTMLElement | null, mode: Mode, scope: ManipulationScope): void {
  if (!el) return;
  const all = scope === 'assembly' ? ' ALL' : '';
  if (mode === 'grab') {
    el.textContent = `GRAB${all}`;
    el.className = 'pinch';
  } else if (mode === 'scale') {
    el.textContent = `SCALE${all}`;
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
    createPose: false,
    cursor,
    pinchRatio: hands[0]?.pinchRatio ?? 1,
    createPoseRatio: hands[0]?.createPoseRatio ?? 1,
    indexPalmClearance: hands[0]?.indexPalmClearance ?? 0,
  };
}

/** Reveal the "Open hologram window" button (presenter mode) and wire it to
 *  open the follower page. Drag that window to the external monitor + F11. */
function setupHologramLauncher(): void {
  const btn = document.getElementById('open-hologram');
  if (!(btn instanceof HTMLButtonElement)) return;
  btn.style.display = 'block';
  btn.onclick = () => window.open('/hologram.html', 'clipvis-holo', 'width=1280,height=1280');
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

function clearIndicatorsFromQuery(): boolean {
  const params = new URLSearchParams(location.search);
  if (!params.has('clearIndicators')) return false;
  clearStoredOrbs();
  document.body.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;text-align:center;">
      <div>
        <h1 style="margin:0 0 12px;font-size:28px;">Indicators cleared</h1>
        <p style="margin:0 0 18px;color:#94a3b8;">All saved orbs were removed from browser storage for this app origin.</p>
        <a href="/" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#22d3ee;color:#082f49;text-decoration:none;font-weight:700;">Open ClipVIS</a>
      </div>
    </main>
  `;
  return true;
}

void main();
