/**
 * Hologram follower bootstrap — a PURE follower. No input handling.
 *
 * It builds the same shared `ModelScene` the presenter builds, subscribes to
 * the presenter's `ModelState` over the BroadcastChannel, and renders the
 * four-camera pinwheel. Every frame it applies the latest received state and
 * renders; it never mutates state. Reopening this window re-syncs via the
 * `hello` handshake in `holoSync`.
 *
 * Run it at /hologram.html, drag it to the monitor under the acrylic pyramid,
 * and press F11 for fullscreen.
 */
import { ModelScene } from '../shared/modelScene';
import { createFollowerSync } from '../shared/holoSync';
import { DEFAULT_STATE, type ModelState } from '../shared/modelState';
import { Pinwheel } from './pinwheel';
import { ClippyOverlay } from '../clippyOverlay';

const canvas = document.getElementById('stage');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('#stage canvas not found');
}

const modelScene = new ModelScene();
let state: ModelState = structuredClone(DEFAULT_STATE);
let modelKey = '';

function ensureModels(s: ModelState): void {
  const key = `${s.model}|${s.compareTo ?? ''}`;
  if (key !== modelKey) {
    modelScene.setModels(s.model, s.compareTo);
    modelKey = key;
  }
}

ensureModels(state);
const pinwheel = new Pinwheel(canvas, modelScene.scene);
// Clippy as a fixed corner fixture in each of the four views (own perspective
// camera, like the presenter) — not a world-space model in the scene.
const clippy = new ClippyOverlay();

createFollowerSync((next) => {
  state = next;
});

function tick(): void {
  requestAnimationFrame(tick);
  ensureModels(state);
  modelScene.applyState(state);
  clippy.update(state.clippy);
  pinwheel.render(state.zoom, clippy);
}
tick();

console.info('[hologram] Follower ready — mirroring presenter via BroadcastChannel.');
