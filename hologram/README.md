# hologram/

The Three.js + React Three Fiber scene + 4-view pinwheel renderer for the Pepper's Ghost pyramid.

**Owners:** Baron, Claire

## Responsibilities
- Three.js scene composition (camera, lighting, scene graph)
- 4-view pinwheel renderer: render the scene from 4 angles (front/back/left/right) into 4 quadrants on a flat display
- Loading and swapping 3D model files from `models/`
- Animating transitions when models change
- Pure-black background, bright/emissive materials only

## Integration points
- Exposes a callback: `setSceneState({ model, animation, compare_to })` that `voice/` calls when the agent returns a response
- Receives Clippy mascot model from `clippy/`
- Loads asset files from `models/`

## Standalone test
You should be able to render a rotating cube in the pinwheel layout and confirm the pyramid illusion works with no other systems running.

## Implementation status (pyramid follower)

The four-view pinwheel follower is **implemented in the `gesture/` Vite project**
(not here and not in `voice/scene.js`), because the presenter and follower must
share TypeScript modules under one bundler and the same origin for
`BroadcastChannel` sync. See `INTEGRATION-HANDOFF.md` and `../gesture/README.md`.

- **Follower page:** `gesture/hologram.html` → `gesture/src/hologram/` (a true
  four-camera → four-RT → four-quadrant compositor). Pure display, no input.
- **Presenter:** `gesture/src/consumers/hologramPresenter.ts` owns the shared
  `ModelState` and broadcasts it; the follower mirrors it every frame.
- **Sync:** `gesture/src/shared/holoSync.ts` (`BroadcastChannel`, same origin).
- **Scene + models:** `gesture/src/shared/modelScene.ts` builds multi-part models
  and loads real `/assets/<id>.glb` (Vite-proxied to the agent server).
- `voice/scene.js` is **unchanged** — it remains the voice vertical's own
  single-view renderer with its legacy `H` pyramid toggle.

The `setSceneState({ model, compare_to })` contract is preserved; new features
are additive `window.*` hooks (`setExplode`, `setRenderMode`, `snapToView`,
`setTurntable`, `focusPart`, `setModelState`).

