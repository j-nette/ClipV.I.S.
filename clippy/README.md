# clippy/

The Clippy mascot — 3D model, rigging, animations, behavior.

**Owners:** Jeanette, Baron, Neha

## Responsibilities
- The Clippy 3D model (.glb / .gltf) — paperclip-style or stylized
- Rigged animation clips:
  - `idle` — gentle bob, blinking
  - `wave` — friendly side-to-side tilt for greetings/thanks (transient)
  - `thinking` — slow head tilt while pondering a question
  - `presenting` — gesture at the model in the scene
  - `celebrating` — excited hops + spin + scale pop for "wow" moments (transient)
  - `confused` — quizzical head shake for unknown intents (transient)
- Emotes are phrase-driven: the agent picks a mascot state from *how* you talk, not just
  *what* you ask (e.g. "wow that's amazing" -> `celebrating`, "hi" / "thanks" -> `wave`).
  Transient emotes auto-revert to `idle` after ~1.5–2s so Clippy always feels alive.
- The procedural state machine in `voice/scene.js` drives both the real `clippy.glb` and the
  placeholder paperclip; see `window.setClippyState(action)`.
- Animation state machine driven by `voice/`'s intent response

## Integration points
- Mounted inside `hologram/`'s scene
- State changes triggered by `voice/` via a `setClippyState(action)` callback
- TTS audio source from `voice/` for lip-sync (optional stretch)

## Standalone test
Load Clippy in a Three.js scene, cycle through animations via keyboard.
