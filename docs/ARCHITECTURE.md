# ClipV.I.S. — Architecture & Code Map

> Onboarding for a new session (human or AI) doing **code** work. Read this with
> [`../HANDOFF.md`](../HANDOFF.md) (state/run) and [`project-brief.md`](project-brief.md) (the vision).
> Everything below is on `main`. **Pending:** `origin/holo-experiment` (Clippy → always-on corner
> widget + pyramid display tuning for the hardware) is not yet merged — see
> [`../HANDOFF.md`](../HANDOFF.md) → Next steps for the integration plan and conflict rules.

---

## 1. The one-sentence model

**Many inputs → one shared `ModelState` (owned by the presenter) → mirrored to a display-only
hologram window.** Voice, hand gestures, and keyboard all do the same thing: call `window.*` hooks
that mutate `ModelState`; `holoSync` broadcasts it; the follower window renders it. Add a feature by
mutating state, never by drawing in two places.

```
                 ┌──────────────────────── PRESENTER  (gesture/, :5173/) ───────────────────────┐
 voice  ─POST /agent→ voiceClient ─┐                                                             │
 hand   ─MediaPipe→ gestureController ─┐                                                         │
 keyboard ─────────► KeyboardFallback ─┼─► gestureBus ─► HologramPresenter.handle()              │
                                       │                      │  (+ window.* hooks: setModelState,│
                                       └──────────────────────┤   setClippyState, setExplode, …)  │
                                                              ▼                                    │
                                                   ModelState (single source of truth)            │
                                                              │ holoSync (BroadcastChannel)        │
                                                              ▼                                    │
                 ┌──────────────────── HOLOGRAM FOLLOWER (/hologram.html) ──────────────────────┐ │
                 │  pure receiver → ModelScene.applyState() → 4-camera pinwheel → acrylic pyramid│ │
                 └───────────────────────────────────────────────────────────────────────────────┘ │
                                                                                                    │
 agent backend (agent/, :3000):  POST /agent (LLM→JSON) · POST /tts · GET /models · /assets/*.glb   │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Two processes, two windows

| | Where | Run | Role |
|---|---|---|---|
| **Agent backend** | `agent/` | `npm --prefix agent start` → :3000 | LLM brain (GitHub Models→Foundry→mock), `/tts`, `/models`, serves `.glb` at `/assets`, serves legacy `voice/` page. |
| **Gesture frontend** | `gesture/` | `npm --prefix gesture run dev` → :5173 | Vite app. **Presenter** (`/`) owns state + all input. **Hologram** (`/hologram.html`) mirrors it. |

Vite proxies `/agent` + `/tts` → :3000. **Never proxy `/models`** — the presenter serves the local
MediaPipe `hand_landmarker.task` from `gesture/public/models` (see `vite.config.ts`).

---

## 3. Module map (`gesture/src/`)

| File | Responsibility |
|---|---|
| `main.ts` | Bootstraps: picks consumer (presenter default; `?consumer=standalone` for the boxes demo), wires `gestureBus`, keyboard, camera, and **`setupVoiceUI()`** (presenter only). |
| `consumers/hologramPresenter.ts` | **Owns `ModelState`.** `handle(GestureEvent)` + `window.*` hooks → mutate state → publish. The only writer. |
| `shared/modelState.ts` | The `ModelState` type, `DEFAULT_STATE`, clamps, `VIEW_QUATS`, render-mode cycle. Structured-clone-safe (plain data only). |
| `shared/holoSync.ts` | `BroadcastChannel` publish/subscribe + `hello` re-sync handshake. Swap for a WebSocket to go cross-machine. |
| `shared/modelScene.ts` | Builds the THREE scene + multi-part model in a `pivot`; `applyState()` pushes state into the graph (orientation, explode, part offsets/rotations/scales, render mode, focus). Loads real `.glb` heroes (normalize→2.2, recenter, per-mesh parts). **Textured glTF materials self-illuminate** (`emissiveMap`) + anisotropy 16; `MODEL_FIX[id]` corrects per-model orientation. Hosts the **in-world Clippy** (outside the pivot). |
| `shared/clippy.ts` | The mascot: placeholder paperclip or `/assets/clippy.glb`; `setEmote()` + `update()` for idle/wave/thinking/presenting/celebrating/confused. |
| `hologram/main.ts`, `hologram/pinwheel.ts` | The follower window: subscribe to state, render four ring cameras → four render targets → four quadrants. |
| `voice/voiceClient.ts` | POST `/agent`; map the JSON to `window.*` hooks; speak `/tts` (browser fallback). |
| `voice/voiceUI.ts` | The presenter command bar (text + Web Speech + chips). |
| `voice/stt.ts` | On-device Whisper (transformers.js) — corp-net-proof STT fallback. |
| `gestureDetector.ts` / `gestureController.ts` / `handTracker.ts` / `smoothing.ts` / `overlay.ts` | MediaPipe hand pipeline: landmarks → poses → smoothed `GestureEvent`s (Kevin). |
| `keyboardFallback.ts` | Always-on keyboard producer for every `GestureEvent` (demo-safe). |
| `eventBus.ts` / `types.ts` / `quat.ts` | Typed event bus, the `GestureEvent`/`Consumer` contracts, quaternion math. |

---

## 4. The contracts (don't break casually)

**Agent JSON** (`POST /agent {user_text, current_model}` → ; see `agent/systemPrompt.js` + `mockParser.js`):
```jsonc
{ "intent": "show_model|lookup_spec|compare|manipulate|chat|unknown",
  "model": "<id|null>", "compare_to": "<id|null>",
  "action": "<zoom_in|zoom_out|spin_on|spin_off|explode|collapse|view_front|view_back|view_top|view_iso|wireframe|xray|solid|reset|null>",
  "clippy": "idle|presenting|thinking|wave|celebrating|confused",
  "narration": "<one short line>" }
```
`action` is non-null only for `intent:"manipulate"`. `action` + the wider `clippy` set are **additive** —
consumers that ignore them keep working.

**Presenter `window.*` hooks** (every input path calls these):
`setModelState({model,compare_to})` · `setClippyState(emote)` · `setExplode(0..1)` ·
`setRenderMode("solid"|"wireframe"|"xray")` · `snapToView("front"|"iso"|"top"|"back")` ·
`setTurntable({on,speed})` · `focusPart(id|null)` · `nudgeZoom(delta)` · `resetView()`.

**`GestureEvent`** (`types.ts`): `point`/`pinch_*`/`rotate`/`zoom` (+ `scope: object|assembly`) and
the model-feature events `explode`/`render_mode`/`snap_view`/`turntable`/`focus`.

---

## 5. Invariants & gotchas (learned the hard way)

- **Presenter is the sole writer of `ModelState`;** the follower never mutates. Mutate via a hook, then
  the follower mirrors it for free. Don't draw the same change in two places.
- **`ModelState` must stay structured-clone-safe** (plain data — no class instances, functions, or
  THREE objects) because it crosses the `BroadcastChannel`.
- **Normalize accumulated rotation quaternions** (`quatNormalize` at every accumulation site +
  `.normalize()` on the pivot) or a long rotation stream shears the model.
- **Don't add `/models` to the Vite proxy** — it shadows the local MediaPipe model and breaks tracking.
- **Clippy lives outside the `pivot`** so model swap / rotate / explode never move the mascot.
- **Transient emotes** (wave/celebrating/confused) auto-revert to idle in `HologramPresenter` so the
  follower mirrors the revert too.
- The legacy `voice/` app (`scene.js`/`app.js`, served at :3000) uses the **older** `setSceneState`/
  `setClippyState` pair — it's a separate fallback, not the gesture app.

---

## 6. Verify (run before claiming done)

```bash
npm --prefix gesture run typecheck   # tsc --noEmit
npm --prefix gesture run test        # vitest — 58 passing
npm --prefix gesture run build       # tsc && vite build (presenter + hologram bundles)
```
Live smoke: start both processes, open :5173, try "show me the xbox controller", "zoom in", "wow!".

---

## 7. How to add things (recipes)

- **A new 3D model:** add it to `agent/models.js` (+ `models.csv`) **and the id list in
  `agent/systemPrompt.js`** (the LLM path rejects unknown ids), drop `models/<id>.glb`, and add a
  multi-part placeholder in `modelScene.ts` `PART_SPECS` (fallback before art lands). Real `.glb`
  auto-normalizes + self-illuminates. If it renders **grey**, it's spec-gloss — convert with
  `npx @gltf-transform/cli metalrough in.glb out.glb`. If it faces the wrong way, add a `MODEL_FIX`
  entry in `modelScene.ts`.
- **A new voice command:** extend `agent/systemPrompt.js` (LLM path) **and** `agent/mockParser.js`
  (mock/fallback). If it manipulates the model, return `intent:"manipulate"` + an `action`, then map
  that action in `voiceClient.ts` `applyAction()` to a `window.*` hook.
- **A new manipulation feature:** add a field to `ModelState` + apply it in `modelScene.applyState()`,
  expose a `window.*` hook in `hologramPresenter.ts`, add a `GestureEvent` (`types.ts`) + a
  `KeyboardFallback` binding, and (optionally) an agent `action`.
- **A new Clippy emote:** add it to `clippy.ts` (`ClippyEmote` + a case in `update()`), allow it in
  `agent` (prompt + `EMOTE_CUES`), and add to `TRANSIENT_EMOTES` in `hologramPresenter.ts` if it
  should auto-revert.
