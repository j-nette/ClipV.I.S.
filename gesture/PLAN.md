# Gesture Controls — Implementation Plan

> **Stretch goal.** MediaPipe Hands in the browser → `point` + `pinch` → events consumed by **any** renderer (a built-in laptop-screen scene *or* `hologram/`).
> **Hard cut-off: Wednesday night.** If gestures aren't reliably triggering by EOD Wed, drop this and lean on voice-only. Every gesture has a keyboard fallback (`P` = point, `G` = pinch). The demo must run fully even if this folder never loads.
> **Decoupled by design.** Gesture emits coordinate-based events onto a bus and ships with its own standalone scene. `hologram/` is just *one optional consumer* — development never blocks on it.

---

## 1. Goals & Non-Goals

### MVP gestures
- **Point** — index fingertip → a 3D ray; highlight whatever model it intersects.
- **Pinch** — thumb+index together → grab and drag a model.
- **Rotate** — turn the focused model (yaw + pitch).
- **Zoom** — scale the focused model in / out.

Point + pinch are the core two (per README). Rotate + zoom are manipulation gestures on whatever model is currently focused (highlighted or grabbed). All four ride the same event bus and have keyboard fallbacks, so adding them costs nothing if CV is cut.

### Decoupling goals (new)
- **Standalone-first.** Gesture ships with its own self-contained laptop-screen scene (a Three.js scene with a few draggable/highlightable boxes) so the full pipeline — camera → detect → smooth → event → visual feedback — is testable with **zero** dependency on `hologram/`.
- **One event contract, many consumers.** The same `GestureEvent`s drive the standalone scene today and `hologram/` later. Switching consumers is a config flag, not a rewrite.
- **Works on a plain laptop screen** (mono, single viewport) *and* the pyramid (4-view pinwheel). The only difference is which consumer interprets the NDC coordinates.

### Non-goals (explicitly out of scope)
- More than 2 gestures, two-handed gestures, gesture *classification* ML, multi-user.
- Owning the *demo's* scene state. In the real demo `hologram/` owns the scene; the standalone scene is a dev/test harness (and a viable laptop-only fallback demo).
- Blocking the demo. If this fails to load, nothing else breaks.

---

## 2. Architecture

```
Webcam (getUserMedia)
   ↓  video frame
MediaPipe Hands (WASM, ~30 fps)  ──►  21 hand landmarks (normalized x,y,z)
   ↓
GestureDetector  (pure functions: landmarks → gesture state)
   ↓  point / pinch state + screen coords
GestureController  (debounce, hysteresis, raise events, draw overlay)
   ↓  events
Shared event bus
   ├──►  StandaloneScene  (built-in Three.js boxes on the laptop screen)  ◄─ DEFAULT consumer
   └──►  HologramAdapter  (forwards to hologram/ raycast/drag)          ◄─ optional consumer
   ↑
Keyboard fallback (P / G)  ──►  same event bus
```

### Decoupling: the consumer abstraction
The bus doesn't know who's listening. A **consumer** is anything that subscribes to `GestureEvent`s and turns them into visuals:
- **`StandaloneScene`** — ships in this folder. A minimal Three.js scene (single mono viewport, a few draggable/highlightable boxes) rendered to the laptop screen. This is the default and makes the whole module runnable solo.
- **`HologramAdapter`** — a thin forwarder that hands the same events to `hologram/`. Enabled via `?consumer=hologram` (or config), only when we actually integrate.

Which consumer is active is a startup choice; the camera/detector/controller pipeline is identical either way.

### Key principle
The detector is **pure** (landmarks in, gesture state out — no DOM, no events). The controller handles timing, smoothing, events, and overlay. This keeps the hard logic unit-testable and the cut decision cheap (delete the controller wiring, keep nothing).

---

## 3. Module Layout

```
gesture/
  README.md
  PLAN.md                  ← this file
  index.html               ← standalone harness: webcam + skeleton + StandaloneScene
  package.json
  src/
    main.ts                ← bootstraps camera + MediaPipe, picks a consumer, wires controller
    camera.ts              ← getUserMedia + <video> + permission/error handling
    handTracker.ts         ← MediaPipe Hands setup, frame loop, emits landmarks
    gestureDetector.ts     ← PURE: landmarks → { point, pinch } state
    gestureController.ts   ← debounce/hysteresis, event emit, keyboard fallback
    overlay.ts             ← transparent canvas skeleton + fingertip cursor
    eventBus.ts            ← shared event bus (importable by hologram/ too)
    types.ts               ← GestureEvent, HandLandmarks, Consumer interface
    consumers/
      standaloneScene.ts   ← self-contained Three.js scene (laptop-screen default)
      hologramAdapter.ts   ← optional: forwards events to hologram/
  test/
    gestureDetector.test.ts
```

The `consumers/` folder is the seam. `hologram/` integration = writing `hologramAdapter.ts`; everything upstream is already proven against `standaloneScene.ts`.

---

## 4. The Shared Event Bus + Consumer Contract

Gesture needs a **low-level**, high-frequency channel for live interaction (pointing/dragging at ~30 fps) — separate from `hologram/`'s `setSceneState(...)` model-swap channel. Define a tiny typed bus plus a `Consumer` interface so any renderer can plug in.

```ts
// types.ts
export type GestureEvent =
  | { type: 'point';        ndc: { x: number; y: number } }   // normalized device coords [-1,1]
  | { type: 'point_end' }
  | { type: 'pinch_start';  ndc: { x: number; y: number } }
  | { type: 'pinch_move';   ndc: { x: number; y: number } }
  | { type: 'pinch_end' }
  | { type: 'rotate';       dx: number; dy: number }          // radians; dx = yaw, dy = pitch
  | { type: 'zoom';         delta: number };                  // signed scalar; >0 = zoom in

// A consumer turns gesture events into visuals. StandaloneScene and HologramAdapter both implement this.
export interface Consumer {
  handle(e: GestureEvent): void;
  dispose?(): void;
}
```

```ts
// eventBus.ts  — trivial typed emitter
type Handler = (e: GestureEvent) => void;
const handlers = new Set<Handler>();
export const gestureBus = {
  emit: (e: GestureEvent) => handlers.forEach(h => h(e)),
  on:   (h: Handler) => (handlers.add(h), () => handlers.delete(h)),
};
```

```ts
// main.ts — pick a consumer at startup; pipeline is identical regardless
const consumer: Consumer =
  new URLSearchParams(location.search).get('consumer') === 'hologram'
    ? new HologramAdapter()
    : new StandaloneScene();        // DEFAULT — laptop screen, no hologram needed
gestureBus.on(e => consumer.handle(e));
```

**`StandaloneScene` (this folder — the default):**
- Mono Three.js scene, a few boxes laid out in front of the camera.
- `point` / `point_end` → raycast from `ndc`, outline the hovered box.
- `pinch_start` → raycast, pick nearest box, begin drag; `pinch_move` → follow `ndc` on the camera plane; `pinch_end` → drop.
- `rotate` → turn the focused box by yaw/pitch deltas; `zoom` → scale it (clamped). "Focused" = the last highlighted or grabbed box; falls back to all boxes if none.
- This is a complete, demoable laptop-only experience and the test bed for tuning.

**`HologramAdapter` (later — optional consumer):**
- Same five events, forwarded into `hologram/`'s raycast/highlight/drag hooks.
- Maps NDC into the chosen pinwheel viewport (proposal: the "front" quadrant). The pinwheel mapping lives here, not upstream.

> **NDC, not pixels.** Emitting normalized device coords keeps both consumers happy: the standalone mono scene and the 4-view pinwheel both raycast directly, independent of canvas size or layout.

---

## 5. Gesture Detection Logic (`gestureDetector.ts`)

MediaPipe Hands landmark indices used:
- `4` = thumb tip, `8` = index tip, `5` = index MCP (knuckle), `0` = wrist,
- `12/16/20` = middle/ring/pinky tips, `9/13/17` = their MCPs.

### Pinch
```
pinchDistance = dist(landmark[4], landmark[8])      // thumb tip ↔ index tip
normalize by hand size = dist(landmark[0], landmark[9])  // wrist ↔ middle MCP
pinch = (pinchDistance / handSize) < THRESHOLD_ON   // ~0.30 enter
release when ratio > THRESHOLD_OFF                  // ~0.45 exit  (hysteresis)
```

### Point
```
indexExtended  = tip[8].y < pip[6].y  (in image space, finger pointing up/out)
othersCurled   = middle/ring/pinky tips are below their PIPs (folded)
point = indexExtended && othersCurled && !pinch
pointer position = landmark[8] (index tip), mapped image-space → NDC
```

### Mapping to NDC
```
ndc.x =  (1 - landmark.x) * 2 - 1   // mirror X (selfie view), then [0,1]→[-1,1]
ndc.y =  (1 - landmark.y) * 2 - 1   // flip Y (image y-down → NDC y-up)
```

### Rotate (manipulation gesture)
Two viable CV mappings — decide during Phase 2 against the StandaloneScene:
- **One-hand (simpler):** while pinching, horizontal hand travel → yaw, vertical → pitch. Re-uses the pinch grab; a mode toggle (e.g. open palm vs. pinch) disambiguates drag vs. rotate.
- **Two-hand (more natural):** both hands pinch; the angle of the line between the two pinch points → rotation, like turning a wheel.
Emit `rotate` with per-frame `dx`/`dy` deltas (radians), already smoothed.

### Zoom (manipulation gesture)
- **Two-hand pinch-spread (recommended):** distance between two pinch points; growing = zoom in, shrinking = zoom out (trackpad-style). Emit `zoom` with `delta` proportional to the per-frame distance change.
- **One-hand fallback:** pinch + push/pull along camera Z (landmark depth) → zoom.

> Rotate/zoom CV is an extension beyond the README's point+pinch core. The keyboard/wheel fallbacks below make them demoable **today**, regardless of whether the two-hand detection lands by the Wed cut-off.

Detector returns:
```ts
interface GestureState {
  pinch: boolean;
  point: boolean;
  cursor: { x: number; y: number } | null;  // NDC, present when point or pinch
  pinchRatio: number;                        // for debugging the overlay
}
```

---

## 6. Smoothing & Stability (`gestureController.ts`)

Raw per-frame detection is jittery — this is where "reliably triggering" is won or lost.

1. **Hysteresis** on enter/exit thresholds (above) so pinch doesn't flicker.
2. **Debounce frames** — require gesture true for N consecutive frames (e.g. 3) before emitting `*_start`; require false for N frames before `*_end`.
3. **One-Euro / EMA smoothing** on the cursor coords (start with simple EMA `α≈0.5`) to stop the highlight ray from twitching.
4. **State machine** — only legal transitions: `idle → pointing`, `idle → pinching`, and back. Never both at once; pinch wins over point.
5. **Throttle move events** to the render cadence; coalesce so we don't flood the bus.

---

## 7. Overlay (`overlay.ts`)

- Transparent `<canvas>` layered over the (optionally hidden) webcam preview.
- Draw the 21-point skeleton using MediaPipe's `drawConnectors` / `drawLandmarks` (or hand-rolled lines).
- Draw a cursor dot at the index fingertip; tint **green on pinch**, **cyan on point**.
- **Demo toggle:** overlay is dev/debug aid. Default off for the real demo (the magic is in the pyramid, not the webcam feed). Keep a `?debug` flag.

---

## 8. Keyboard Fallback (always wired, ships even if CV is cut)

`gestureController` listens for keydown independent of MediaPipe:
- `P` → emit `point` at scene center (or last cursor), `keyup` → `point_end`.
- `G` → toggle `pinch_start` / `pinch_end` (press to grab, press again to drop), with arrow keys nudging `pinch_move`.
- `Q` / `E` → `rotate` yaw; `R` / `F` → `rotate` pitch.
- `Z` / `X` (or mouse wheel) → `zoom` in / out.

This is implemented **first** (Phase 0) so the event contract is provable against the **StandaloneScene** with no camera and no `hologram/`.

---

## 9. Build Phases (standalone-first, time-boxed to the Wed cut-off)

Every phase is verifiable on a plain laptop screen. `hologram/` integration is a single late, optional phase.

| Phase | Outcome | Depends on |
|---|---|---|
| **0 — Contract + StandaloneScene + fallback** (DONE) | `eventBus.ts` + `types.ts` + `Consumer`; `StandaloneScene` renders boxes; keyboard `P`/`G` highlight & drag a box. **No camera, no hologram.** | nothing |
| **1 — Camera + tracking** (DONE) | `getUserMedia` → MediaPipe `HandLandmarker` → live skeleton renders in `index.html`. Assets bundled locally. Standalone test passes. | MediaPipe WASM assets |
| **2 — Detection** (DONE) | `gestureDetector` returns correct `point`/`pinch` from live landmarks; console logs `PINCH START` / `POINT`. Unit tests on synthetic landmark fixtures (7 passing). | Phase 1 |
| **3 — Smoothing + emit** (DONE) | `GestureController` debounces, smooths (EMA), applies pinch hysteresis, and emits events; **pinch-drag a real box in StandaloneScene with your hand.** 13 tests passing. | Phase 0 + 2 |
| **4 — Polish** (only if time) | Overlay tint states, cursor smoothing tuned, `?debug` flag, error toasts. | Phase 3 |
| **5 — Hologram adapter** (optional, only if hologram ready) | Write `hologramAdapter.ts`; `?consumer=hologram` drives the pyramid with the *same* events. | Phase 3 + hologram raycast hook |

**Cut decision gate (Wed night):** if the camera path isn't *reliable* (pinch grabs the right object ≥9/10 tries, no false fires while talking with hands), ship the **keyboard-only StandaloneScene** — still a working laptop demo. If `hologram/` slips, Phase 5 is simply skipped. The main demo is unaffected either way.

---

## 10. Tech / Dependencies

- `@mediapipe/hands` + `@mediapipe/drawing_utils` + `@mediapipe/camera_utils` (or the newer `@mediapipe/tasks-vision` `HandLandmarker`). **Decision: use `tasks-vision` HandLandmarker** — current, GPU-delegated, simpler lifecycle. Pin the `.wasm`/`.task` model assets locally (don't depend on a CDN during the demo).
- `three` — for the StandaloneScene (small mono scene). Matches `hologram/`'s renderer so the adapter is a thin forward, not a port.
- Vite + TypeScript (match `hologram/` toolchain so the bus module can be shared and both can run in one dev server when integrated).
- No backend. 100% client-side. **Runs fully standalone** — `npm run dev` in this folder is a complete experience with nothing else checked out.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Camera permission denied / no webcam in demo room | Keyboard fallback is primary-safe; test on the actual demo machine Tue. |
| MediaPipe WASM slow / <15 fps on demo laptop | Lower model complexity to `lite`, cap input resolution to 480p, drop to single hand. |
| False pinch while gesturing during speech | High debounce + hysteresis; overlay off so user isn't tempted to wave at camera. |
| CDN asset fetch fails offline | Bundle model assets locally. |
| Lighting in demo room confuses tracking | Test under demo lighting Tue; raise contrast / add a small fill light. |
| Eats into voice work (shared critical path) | Hard Wed cut-off; Phase 0 keyboard path is cheap insurance. |
| `hologram/` slips or its API churns | **Decoupled** — we build against StandaloneScene; hologram is an optional Phase 5 adapter, never a blocker. |

---

## 12. Standalone Test (from README)

> Open `index.html`, see your hand skeleton rendered live, pinch your fingers → see **"PINCH START"** in the console.

Extended acceptance for this folder (no `hologram/` required):
1. The console test above passes.
2. **Keyboard** `P`/`G` highlight and drag a box in the StandaloneScene with the camera unplugged.
3. **Hand** pinch grabs and drags a box in the StandaloneScene on a plain laptop screen.

If all three pass, gesture is demo-ready as a laptop-only experience — hologram integration is pure upside.

---

## 13. Open Questions

None block development — the standalone path is fully unblocked. These only matter for the optional Phase 5 hologram adapter:
1. Does `hologram/` expose a raycast/highlight/drag hook, or do we add `onGesture(e)` together? (Blocks **Phase 5 only**.)
2. Pinwheel has 4 viewports — which one do we map the cursor into? (Proposal: the "front" quadrant only; lives in `hologramAdapter.ts`.)
3. Shared Vite app or sibling module importing the bus? (Proposal: shared app, lazy-load gesture so a crash can't take down the scene.)
