# gesture/

Hand-gesture recognition via webcam — **STRETCH GOAL** — plus the **presenter →
hologram pipeline** that grew out of the integration (see
`../hologram/INTEGRATION-HANDOFF.md`).

**Owners:** Jeanette, Kevin

## Responsibilities
- MediaPipe Hands running in browser (WASM, ~30 fps)
- Detect 2 gestures only (MVP):
  - **Point** — translate fingertip to a 3D ray, highlight what it intersects
  - **Pinch** — grab + rotate a model (hand twist), two-hand pinch = scale/zoom
- Emit gesture events onto a shared bus consumed by a renderer (`Consumer`)
- Visual feedback: optional skeleton overlay on a transparent canvas (`?debug`)

## Hard rules
- **Keyboard fallback for every gesture.** The demo runs fully with the webcam
  unplugged — everything below is keyboard-driven too.
- Demo must work fully without this folder ever loading.

## Two-window presenter → hologram pipeline (integrated)

The gesture app now hosts **both** roles of the Pepper's-Ghost demo. They share a
single `ModelState` (one source of truth) over a same-origin `BroadcastChannel`;
`voice/scene.js` is left untouched as the voice vertical's own renderer.

- **Presenter** (default page) — single perspective view; OWNS `ModelState`;
  turns gestures/keys into state changes; broadcasts on every change.
- **Hologram follower** (`/hologram.html`) — a true **four-camera** volumetric
  pinwheel (4 cameras → 4 render targets → 4 quadrants); a pure receiver that
  mirrors the presenter. No input handling.

```
gesture/
  index.html               presenter page (default consumer)
  hologram.html            hologram follower page
  src/
    main.ts                bootstrap: camera + MediaPipe, pick consumer, keys
    consumers/
      standaloneScene.ts   boxes/orbs demo  (?consumer=standalone)
      hologramPresenter.ts presenter: owns ModelState, publishes  (default)
    hologram/
      main.ts              follower bootstrap (subscribe + render)
      pinwheel.ts          four-camera → 4 RT → 4 quadrant compositor
    shared/
      modelState.ts        ModelState, DEFAULT_STATE, VIEW_QUATS
      holoSync.ts          BroadcastChannel publish/subscribe (+ hello re-sync)
      modelScene.ts        shared scene + multi-part models + applyState
```

## Run

```bash
npm install           # also fetches MediaPipe assets (postinstall)
npm run dev           # presenter at http://localhost:<port>/
```

- Open the pyramid with the **🔺 Open hologram window** button on the presenter.
  It must be opened that way (relative URL) so both windows share the **same
  origin + port** — `BroadcastChannel` won't connect across ports.
- Run **one** dev server only (extra Vite instances grab new ports and break sync).
- Boxes/orbs demo instead of the presenter: `?consumer=standalone`.
- `?debug` shows the skeleton overlay, camera preview, and key help.

### Real .glb models
Models load from `/assets/<id>.glb`, proxied by Vite (`vite.config.ts`) to the
Express agent server. To see real models:

```bash
cd ../agent && npm install && npm start   # serves /assets on :3000
```

Drop files in `../models/<id>.glb` (e.g. `clippy.glb`, `xbox_controller.glb`).
The default model is **clippy**. Missing file or server down → multi-part
placeholder. To add a brand-new model, also register it in `agent/models.js`
(`MODELS` + `ALIASES`). See `../models/README.md`.

## Controls (keyboard + mouse — always on)

**Manipulation**
| Input | Action |
|---|---|
| `P` (hold) | Point at the cursor (hover-highlights a part); release ends |
| `G` | Grab toggle (no-op in the presenter; used by the standalone scene) |
| `← → ↑ ↓` | Move the virtual cursor |
| `Q`/`E` · `R`/`F` · `C`/`V` | Rotate yaw · pitch · roll |
| `Z`/`X` or wheel | Zoom in / out |

**Hologram features** (presenter; no-ops in standalone)
| Input | Action |
|---|---|
| `B` | Toggle exploded view (eased, proportional spread) |
| `M` | Cycle render mode: solid → wireframe → x-ray |
| `Space` / `T` | Toggle turntable auto-spin |
| `[` / `]` | Snap to previous / next canonical view (animated) |
| `1` `2` `3` `4` | Snap to front / iso / top / back |
| `K` | Toggle focus/isolate the part at the cursor |

> Bindings deliberately differ from the handoff (`E`/`R`/`F`/arrows are rotate/
> cursor here), so explode/render/snap moved to `B`/`M`/`[ ]`.

## Standalone test
Open `?consumer=standalone`, see your hand skeleton (`?debug`), pinch your
fingers and watch "PINCH START" in the console.

