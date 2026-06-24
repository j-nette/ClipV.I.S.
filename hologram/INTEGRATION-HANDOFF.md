# Hologram Integration Handoff — Two-Display Pipeline + New Model Features

> From the hologram-pyramid spike (the standalone four-camera demo) **into** ClipV.I.S.
> Audience: the main-project agent / `hologram/` owners (Baron, Claire).
> Goal: land (1) a **two-display** presenter→hologram pipeline on one machine, (2) the
> **four-camera volumetric** pinwheel, and (3) a set of **new model-interaction features**
> exposed in this project's existing `window.*` + `gestureBus` conventions.

---

## 0. TL;DR

We prototyped the pyramid renderer plus five model-interaction features in a standalone repo
(`hologram-pyramid/src/main.js`). This doc explains how to fold them into ClipV.I.S. **without**
breaking the agent contract or the gesture event bus.

Three things to do, in order:

1. **Split the display into two roles** driven by one shared `ModelState` (single source of truth):
   - **Presenter view** — the existing single-camera scene + webcam gestures. *Owns* the state.
   - **Hologram view** — a four-camera pinwheel that *mirrors* the state. Display-only.
   - Sync the two browser windows on the same machine with a `BroadcastChannel`.
2. **Upgrade the pinwheel** in `voice/scene.js` from "same view ×4" to **four cameras → four render
   targets → four quadrants** (true volumetric — looks correct as you walk around the pyramid).
3. **Add new features as functions in this project's format**: `window.setExplode()`,
   `window.setRenderMode()`, `window.snapToView()`, `window.setTurntable()`, `window.focusPart()`,
   plus matching `GestureEvent`s + keyboard fallbacks in `gesture/`.

Nothing here changes the `POST /agent` contract or `setSceneState()` / `setClippyState()`.

---

## 1. What the spike adds (feature inventory)

| Feature | Demo trigger | What it does | Main-project gap |
|---|---|---|---|
| **Four-camera volumetric pinwheel** | always (pyramid) | renders the model from 4 angles (front/right/back/left) into 4 RTs, composited into 4 rotated quadrants | `voice/scene.js` only does **same view ×4** (one RT stamped 4×) — looks flat from the sides |
| **Exploded view** | `E` | separates assembly parts outward along per-part direction, proportional + min-gap | not implemented |
| **Hands-free turntable** | `Space`/`T`, `↑`/`↓` | toggle continuous auto-spin, adjustable speed, layered on manual orbit | scene.js has a *fixed* always-on spin only |
| **Snap to canonical views** | `←`/`→`, `1`–`4` | animate to front / iso / top / back | not implemented |
| **Render mode** | `R` | cycle solid → wireframe → x-ray (translucent, depth-write off) | not implemented |
| **Part isolation / focus** | hover + click | highlight pointed-at part; "grab" to ghost everything else | not implemented |

Demo source of truth for all of the above: `hologram-pyramid/src/main.js` (single file, heavily
commented). Reference it while implementing; this doc is the *integration* layer, not a re-listing.

---

## 2. The architectural reframe: one state, two renderers

In the spike, OrbitControls drove a `pivot` and four cameras rendered it — **all in one window**.
For ClipV.I.S. we **split** that into two windows that share **one model state**:

```
                        ┌─────────────────────────────┐
   webcam ► gestures ──►│  PRESENTER WINDOW (?role=presenter)
   mouse/keyboard    ──►│  • single perspective camera (existing scene.js camera)
                        │  • handles ALL input
                        │  • writes ModelState  ──┐
                        └─────────────────────────┼───┘
                                                  │ BroadcastChannel("clipvis-holo")
                        ┌─────────────────────────▼───┐
                        │  HOLOGRAM WINDOW (?role=hologram)
   external monitor ◄───│  • four ring cameras → 4 RTs → 4 quadrants
   (acrylic pyramid)    │  • reads ModelState, applies to pivot, renders
                        │  • NO input handling (pure follower)
                        └─────────────────────────────┘
```

### `ModelState` — the single source of truth

Both windows build the **same** scene + model. Only this object crosses between them:

```js
// shared/modelState.js  (new — importable by scene.js in both roles)
export const DEFAULT_STATE = {
  model: "surface_pro_11",   // model id (existing convention, see agent/models.js)
  compareTo: null,           // model id | null
  orientation: { x: 0, y: 0, z: 0, w: 1 }, // quaternion (matches gesture 'rotate' deltas)
  zoom: 5.0,                 // ring radius / camera distance
  explode: 0,                // 0..1
  spin: { on: false, speed: 0.6 }, // turntable (radians/sec)
  renderMode: "solid",       // "solid" | "wireframe" | "xray"
  focusPart: null,           // mesh/part id to isolate, or null
  clippy: "idle",            // existing setClippyState value
};
```

> **Why a quaternion for orientation?** The gesture bus already emits `rotate` as a **delta
> quaternion** (`types.ts`). The presenter accumulates those deltas into `orientation`; both
> displays just `pivot.quaternion.copy(orientation)`. No azimuth/polar bookkeeping, no drift, and
> all four hologram faces stay coherent because they read one quaternion.

### Sync mechanism (same machine, two windows)

Use a **`BroadcastChannel`** — same-origin, cross-window, zero backend changes. The presenter
publishes on every change; the hologram applies whatever it receives.

```js
// shared/holoSync.js  (new)
const channel = new BroadcastChannel("clipvis-holo");

// Presenter side: call after any state mutation.
export function publishState(state) {
  channel.postMessage({ kind: "state", state });
}

// Hologram side: subscribe once at startup.
export function subscribeState(onState) {
  channel.onmessage = (e) => { if (e.data?.kind === "state") onState(e.data.state); };
  channel.postMessage({ kind: "hello" }); // ask presenter to re-broadcast current state
}
```

> Cross-**machine** later? Swap `BroadcastChannel` for a WebSocket through the existing Express
> server (`agent/server.js`) — same `publish/subscribe` shape, so callers don't change. Not needed
> for the one-machine demo.

---

## 3. Splitting the display by `role`

`voice/index.html` already loads `scene.js`. Add a role switch read from the URL:

```js
// top of voice/scene.js
const ROLE = new URLSearchParams(location.search).get("role") || "presenter";
const isHologram = ROLE === "hologram";
```

- **`?role=presenter` (default)** — keep the current single `camera` + `OrbitControls`; keep the
  panel/voice UI; attach gestures; **own** the state; `publishState()` on every change.
- **`?role=hologram`** — hide the UI panel, force black background, build the four-camera pinwheel,
  `subscribeState()` and apply incoming state; render-only.

### Opening the second window on the connected monitor

Baseline (works everywhere): a button in the presenter panel:

```js
document.getElementById("openHologram").onclick = () =>
  window.open("/?role=hologram", "clipvis-holo", "width=1280,height=1280");
// then drag that window to the external display and press F11 (fullscreen).
```

Optional auto-placement (Chromium): the **Window Management API** can put it on the second screen
fullscreen without manual dragging:

```js
const screens = await window.getScreenDetails();          // prompts once for permission
const ext = screens.screens.find(s => !s.isPrimary) ?? screens.currentScreen;
const w = window.open("/?role=hologram", "clipvis-holo",
  `left=${ext.left},top=${ext.top},width=${ext.availWidth},height=${ext.availHeight}`);
// inside the hologram window on load: document.documentElement.requestFullscreen();
```

> The connected monitor lies flat, screen-up, with the acrylic pyramid on top — exactly the
> hardware setup in `hardware/`. The presenter never sees the pyramid layout; they drive a normal
> 3D view on the laptop.

---

## 4. The four-camera pinwheel (replace `renderPinwheel` in `voice/scene.js`)

The current `renderPinwheel()` renders **once** from `holoCam` into one `rt` and stamps 4 identical
copies. Replace it with the spike's approach so each quadrant shows the *correct* angle.

**Port from `hologram-pyramid/src/main.js`:**

- Four cameras on a ring at angles `[0, π/2, π, -π/2]`, all `lookAt(target)`, `aspect = 1`.
- Four `WebGLRenderTarget`s, one per camera.
- An orthographic overlay with four `PlaneGeometry` quads, each `MeshBasicMaterial({ map: rt.texture })`,
  positioned top/bottom/left/right and rotated so each base points outward.
- Per frame (hologram role only): apply `ModelState` to the pivot, render the scene **four times**
  (one per camera/RT), then render the overlay to the screen.

**Keep your existing live-tune knobs** (`holo.size`, `holo.gap`, `holo.dist`, `holo.elev`, persisted
to `localStorage`) — they map directly onto the spike's `quadSize`, `quadOffset`, `ringRadius`,
`ringHeight`. The tuning keys (`[ ] - = , . ; ' 0`) stay on the **hologram** window.

> **Cost note:** four renders/frame ≈ 4× a single view. If the demo laptop struggles, drop
> `RT_SIZE` to 512 and cap `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`. Only the
> hologram window pays this; the presenter view stays single-render and smooth for gesture latency.

---

## 5. New features as `window.*` functions (this project's format)

Mirror the existing `window.setSceneState` / `window.setClippyState` style. Each function **mutates
`ModelState` and republishes** (presenter), and is **idempotent when applied** (hologram). Define
them in `scene.js`:

```js
// --- New scene-control hooks (presenter writes; both apply) ---
window.setExplode    = (factor)      => mutate(s => s.explode = clamp01(factor));        // 0..1
window.setRenderMode = (mode)        => mutate(s => s.renderMode = mode);                // solid|wireframe|xray
window.snapToView    = (name)        => mutate(s => s.orientation = VIEW_QUATS[name]);   // front|iso|top|back
window.setTurntable  = ({ on, speed })=> mutate(s => s.spin = { on, speed: speed ?? s.spin.speed });
window.focusPart     = (partId)      => mutate(s => s.focusPart = partId ?? null);

function mutate(fn) {
  fn(STATE);
  applyState(STATE);          // local renderer reacts immediately
  if (!isHologram) publishState(STATE);  // presenter broadcasts to the hologram window
}
```

`applyState(state)` is the one place that pushes state into the scene (both roles call it):

```js
function applyState(s) {
  pivot.quaternion.copy(s.orientation);
  setRingRadius(s.zoom);
  applyExplode(s.explode);            // ported from the spike
  applyRenderMode(s.renderMode);      // ported (solid/wireframe/xray)
  applyIsolation(s.focusPart);        // ported (ghost non-focused parts)
  // spin is integrated in the tick loop (see §6)
}
```

> **Voice integration is free:** the agent can now call these too. E.g. *"Clippy, explode the
> controller"* → `window.setExplode(1)`; *"show me the back"* → `window.snapToView("back")`. Wire
> them in `voice/app.js` next to the existing `setSceneState` call, or extend the agent JSON with an
> optional `action` field (coordinate with the agent owner before changing the contract).

---

## 6. New `GestureEvent`s + consumer + keyboard fallbacks (`gesture/`)

The gesture app stays decoupled. Extend the **contract** (`gesture/src/types.ts`), add a **consumer**
that forwards to the scene hooks, and keep the **keyboard fallbacks** so the demo runs even if CV is cut.

### 6a. Extend the event union (`types.ts`)

```ts
export type GestureEvent =
  | { type: 'point'; ndc: NDC }
  | { type: 'point_end' }
  | { type: 'pinch_start'; ndc: NDC }
  | { type: 'pinch_move'; ndc: NDC }
  | { type: 'pinch_end' }
  | { type: 'orb_create'; ndc: NDC }
  | { type: 'rotate'; q: Quat }
  | { type: 'zoom'; delta: number }
  // --- new, map onto the §5 hooks ---
  | { type: 'explode'; factor: number }          // two-hand spread → 0..1
  | { type: 'render_mode'; dir: 'next' }         // cycle gesture → solid→wire→xray
  | { type: 'snap_view'; dir: 'next' | 'prev' }  // swipe left/right
  | { type: 'turntable'; on: boolean; speed?: number } // flick = on, fist = off
  | { type: 'focus'; ndc: NDC | null };          // point+dwell to set, open hand to clear
```

### 6b. New consumer — `gesture/src/consumers/hologramAdapter.ts`

This is the long-stubbed `?consumer=hologram` (see `main.ts` `createHologramAdapterStub`). It turns
gesture events into the `window.*` hooks (presenter role drives the model; the hologram window
follows via BroadcastChannel — the consumer never talks to the hologram directly):

```ts
import type { Consumer, GestureEvent } from '../types';

export class HologramAdapter implements Consumer {
  private explodeAccum = 0;
  handle(e: GestureEvent): void {
    switch (e.type) {
      case 'rotate':      window.accumOrientation(e.q); break;       // accumulate delta quat
      case 'zoom':        window.nudgeZoom(e.delta); break;
      case 'explode':     window.setExplode(e.factor); break;
      case 'render_mode': window.cycleRenderMode(); break;
      case 'snap_view':   window.snapToView(window.nextView(e.dir)); break;
      case 'turntable':   window.setTurntable({ on: e.on, speed: e.speed }); break;
      case 'focus':       window.focusPart(e.ndc ? window.pickPart(e.ndc) : null); break;
      // point/pinch/orb_create keep their existing StandaloneScene meaning
    }
  }
}
```

Replace the stub in `main.ts`:

```ts
const consumer: Consumer = which === 'hologram'
  ? new HologramAdapter()          // was createHologramAdapterStub()
  : new StandaloneScene(container);
```

### 6c. Picking is now **easy** (important simplification)

In the spike, picking required raycasting *through the rotated composite quadrants* (hard). In the
integrated design, **picking happens on the presenter's single normal view**, so it's a textbook
raycast: `raycaster.setFromCamera(ndc, camera)`. `window.pickPart(ndc)` returns the hit part id.
You only need the quadrant-raycast math if you ever want to pick *on the hologram window itself* —
you don't, so skip it.

### 6d. Keyboard fallbacks (match the existing `P`/`G`/`Q-E` pattern)

Keep these wired in `keyboardFallback.ts` so the demo is keyboard-safe (per the gesture PLAN's Wed
cut-off rule). Suggested bindings, consistent with the spike:

| Key | Event | Hook |
|---|---|---|
| `E` | `explode` (toggle 0↔1) | `setExplode` |
| `R` | `render_mode next` | `cycleRenderMode` |
| `Space` / `T` | `turntable` toggle | `setTurntable` |
| `←` / `→` | `snap_view prev/next` | `snapToView` |
| `1`–`4` | direct snap | `snapToView(front|iso|top|back)` |
| `F` (point+commit) | `focus` | `focusPart` |

### 6e. Gesture → feature mapping (for the CV team)

| Gesture | Event | Feature |
|---|---|---|
| Two-hand spread / pinch distance | `explode` (distance → factor) | exploded view |
| One-hand flick | `turntable {on:true, speed∝flick}` | start spin |
| Fist | `turntable {on:false}` | stop spin |
| Swipe left / right | `snap_view prev/next` | canonical views |
| Cycle/swipe (discrete) | `render_mode next` | solid→wire→xray |
| Point + dwell, open hand to release | `focus` | isolate part |

---

## 7. Turntable in the tick loop

The spike layers auto-spin **on top of** manual orientation so dragging still works while spinning.
Integrate into the existing `tick()` (replace the hard-coded `modelGroup.rotation.y = t * 0.5`):

```js
const dt = clock.getDelta();
if (STATE.spin.on && !isHologram /* presenter integrates; hologram receives result */) {
  spinQuat.setFromAxisAngle(UP, STATE.spin.speed * dt);
  STATE.orientation = new THREE.Quaternion().multiplyQuaternions(spinQuat, STATE.orientation);
  publishState(STATE);   // hologram mirrors the spun orientation
}
pivot.quaternion.copy(STATE.orientation);
```

> Decide one owner for time-based motion. Recommended: the **presenter** advances spin and
> broadcasts; the hologram window purely applies received orientation. That guarantees the two
> displays can never desync (no independent clocks).

---

## 8. File-by-file change list

| File | Change |
|---|---|
| `voice/scene.js` | add `ROLE` switch; build four-camera pinwheel for hologram role; replace `renderPinwheel`; add `applyState` + the five `window.*` hooks; integrate turntable in `tick`; `publish/subscribe` wiring |
| `voice/index.html` | add **Open Hologram** button to the panel; bump `?v=` cache-bust |
| `shared/modelState.js` *(new)* | `DEFAULT_STATE`, `clamp01`, `VIEW_QUATS` |
| `shared/holoSync.js` *(new)* | `BroadcastChannel` publish/subscribe |
| `gesture/src/types.ts` | add the new `GestureEvent` variants (§6a) |
| `gesture/src/consumers/hologramAdapter.ts` *(new)* | forward events → `window.*` hooks |
| `gesture/src/main.ts` | use `HologramAdapter` for `?consumer=hologram` |
| `gesture/src/keyboardFallback.ts` | add E/R/Space/T/←/→/1–4/F bindings |
| `voice/app.js` *(optional)* | call new hooks from agent responses (`action` field) |

---

## 9. Decisions & gotchas

- **Don't touch the agent contract.** `POST /agent` and `setSceneState`/`setClippyState` stay as-is.
  New features are additive hooks; only add an `action` field if the agent owner agrees.
- **One clock owner.** Presenter advances time-based motion (spin) and broadcasts; hologram applies.
  Prevents two-window desync.
- **Orientation as quaternion**, accumulated from gesture `rotate` deltas — matches `types.ts`,
  avoids gimbal/azimuth bookkeeping, keeps all four faces coherent.
- **Picking is trivial now** — single presenter camera. Drop the quadrant-raycast complexity.
- **x-ray + explode** is the money shot ("how it's built"). They compose: a focused part keeps the
  current render mode while others ghost (see `refreshMaterials` in the spike).
- **Assemblies need separate meshes** for explode/isolation to mean anything (GLB preserves them;
  STL collapses to one mesh). Real `.glb` hero models from `models/` should be exported per-part —
  relevant to the SolidWorks parts in `hardware/` (`*.SLDPRT`/`*.SLDASM` → export glTF Binary).
- **Performance**: only the hologram window does 4×; lower `RT_SIZE`/pixel ratio there if needed.
- **Cache-bust** `?v=N` on `scene.js`/`app.js`/`style.css` when you ship (per HANDOFF.md).

---

## 10. Reference

- **Spike (all features, one commented file):** `hologram-pyramid/src/main.js`
  - four cameras + RTs + compositor; `applyExplode`; `refreshMaterials` (render mode + isolation);
    `snapToView`/`SNAP_VIEWS`; turntable; `pickAt` (quadrant raycast — *not* needed here).
- **This project's hologram renderer to replace:** `voice/scene.js` → `renderPinwheel`.
- **Gesture contract:** `gesture/src/types.ts`, `gesture/src/eventBus.ts`, consumer wiring in
  `gesture/src/main.ts`.
- **Model ids / files:** `agent/models.js` (`/models` endpoint, `/assets/<file>`).

---

### Acceptance (definition of done)
1. `/?role=presenter` on the laptop drives the model with mouse + webcam gestures.
2. `/?role=hologram` on the connected monitor shows the **four-angle** pinwheel mirroring the
   presenter in real time (rotate/zoom/explode/render-mode/snap/focus all reflect across).
3. Closing/reopening the hologram window re-syncs from the presenter (`hello` re-broadcast).
4. Every gesture has a working keyboard fallback; the demo runs with the webcam unplugged.

---

## 11. Implementation status (what was actually built)

Built into the **`gesture/` Vite project** (not `voice/scene.js`, per request) as a
multi-page app, so the presenter and follower share TypeScript and the same origin
for `BroadcastChannel`. `voice/scene.js` is untouched.

### Where roles live (differs from §2–§3)
- **Presenter** = the gesture app itself (`gesture/index.html`), default consumer
  `hologramPresenter.ts`. Single perspective camera; owns `ModelState`; publishes.
- **Hologram follower** = a separate page `gesture/hologram.html` →
  `gesture/src/hologram/{main,pinwheel}.ts`. Pure follower. (No `?role` switch; the
  boxes/orbs demo is at `?consumer=standalone`.)

### Actual file map (supersedes §8)
| Area | File |
|---|---|
| Shared state | `gesture/src/shared/modelState.ts` (`ModelState`, `DEFAULT_STATE`, `VIEW_QUATS`) |
| Sync | `gesture/src/shared/holoSync.ts` (`BroadcastChannel` + `hello`) |
| Shared scene | `gesture/src/shared/modelScene.ts` (multi-part models, glTF load, explode/render/focus) |
| Presenter | `gesture/src/consumers/hologramPresenter.ts` (+ `window.*` hooks, animated snap, spin) |
| Follower | `gesture/hologram.html`, `gesture/src/hologram/main.ts`, `pinwheel.ts` |
| Contract | `gesture/src/types.ts` (new `GestureEvent`s) |
| Keys | `gesture/src/keyboardFallback.ts` |
| Wiring | `gesture/src/main.ts`, `gesture/index.html`, `gesture/vite.config.ts` (multipage + `/assets` proxy) |

### Ported from the spike
- **Four-camera volumetric pinwheel** (4 cams → 4 RTs → 4 quadrants).
- **Eased explode with proportional spread** (`offsetLen*spread + gap`, parent-local,
  per-mesh for glTF). **Animated snap** (slerp + smoothstep, cancels on manual rotate).
- Render mode (solid/wireframe/x-ray), part isolation/focus, turntable.

### Deviations / not done (confirm if you want changes)
- **Key bindings:** explode `B`, render `M`, snap `[ ]`/`1–4`, turntable `Space/T`,
  focus `K` — because `E/R/F/←→` are already rotate/cursor in the gesture scheme.
- **Picking** is a normal raycast on the presenter's single camera (the quadrant
  raycast from the spike is not needed).
- **glTF path** is `/assets/<id>.glb` (Vite-proxied to the agent server), lowercase id.
- **Turntable speed** has no key/gesture yet (spike used `↑/↓`).
- **Agent `action` field** not added; new features are additive `window.*` hooks only.
- The 5 new features (explode/render/snap/turntable/focus) are **keyboard-only** —
  no hand-gesture mapping yet (CV path still emits only point/pinch/rotate/zoom).

### Run
- `cd gesture && npm install && npm run dev` → presenter; click **Open hologram window**.
- Real models: `cd agent && npm install && npm start` (serves `/assets` on :3000);
  drop `models/<id>.glb`. Default model: **clippy**.

