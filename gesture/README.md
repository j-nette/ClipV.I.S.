# gesture/

Hand-gesture recognition via webcam — **STRETCH GOAL**.

**Owners:** Jeanette, Kevin

## Responsibilities
- MediaPipe Hands running in browser (WASM, ~30 fps)
- Detect 2 gestures only (MVP):
  - **Point** — translate fingertip to a 3D ray, highlight what it intersects
  - **Pinch** — grab + drag a model in the pyramid
- Emit gesture events to `hologram/` via a shared event bus
- Visual feedback: optional skeleton overlay on a transparent canvas

## Hard rules
- **Hard cut-off Wednesday night.** If gestures aren't reliably triggering by EOD Wed, drop this from the demo and lean on voice-only.
- **Keyboard fallback for every gesture.** Press `P` for point, `G` for pinch.
- Demo must work fully without this folder ever loading.

## Integration points
- Calls into `hologram/` to highlight / drag models
- Independent of `voice/` and `agent/`

## Standalone test
Open the page, see your hand skeleton rendered live, pinch your fingers and see "PINCH START" in the console.
