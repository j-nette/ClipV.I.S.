# gesture/

Hand-gesture recognition via webcam — **demo command 3**.

**Owners:** Jeanette, Kevin

## Gestures to support (locked demo command 3)
- **Translation** — move the model in space
- **Rotation** — spin the model
- **Enlargement / shrinking** — scale up / down
- **Perspective** — change the camera field-of-view

## How to plug in (IMPORTANT — don't build a separate app)
Build your MediaPipe hand-tracking into the **existing scene** (`voice/scene.js`) and drive it
through the ready-made API it exposes on `window.clipvisGesture`:

```js
window.clipvisGesture.translate(dx, dy, dz);  // move (world units) — e.g. pinch-drag
window.clipvisGesture.rotate(rx, ry, rz);     // spin (radians) — e.g. two-finger twist
window.clipvisGesture.scaleBy(factor);        // factor>1 grows, <1 shrinks — pinch-zoom
window.clipvisGesture.setScale(s);            // absolute scale
window.clipvisGesture.setPerspective(fov);    // camera FOV 20–90 — two-hand spread
window.clipvisGesture.reset();                // release control -> auto-spin resumes
window.clipvisGesture.isManual();             // bool: is gesture currently driving?
```

When you call any transform, the model's auto-spin pauses automatically so your gestures don't
fight the animation. Call `reset()` when the hand leaves the frame.

Your job: MediaPipe Hands (WASM, ~30 fps) → map hand landmarks to these calls. You do **not** touch
the model loading or rendering — just feed transforms in.

## Hard rules
- **Hard cut-off Wednesday night.** If gestures aren't reliable by EOD Wed, drop from the demo;
  voice + the rest already stand alone.
- **Keyboard fallback for each gesture** for demo safety.
- The demo must work fully even if this folder never loads — gesture is additive.

## Standalone test
Open http://localhost:3000, then from the browser console call e.g.
`window.clipvisGesture.rotate(0, 0.5, 0)` and `window.clipvisGesture.scaleBy(1.5)` — confirm the
model rotates / grows. Once that works, wire the same calls to your detected hand gestures.
