# clippy/

The Clippy mascot — 3D model, rigging, animations, behavior.

**Owners:** Jeanette, Baron, Neha

## Responsibilities
- The Clippy 3D model (.glb / .gltf) — paperclip-style or stylized
- Rigged animation clips:
  - `idle` — gentle bob, blinking
  - `listening` — leaning forward, attentive
  - `presenting` — gesture at the model in the scene
  - `speaking` — mouth/eye animation synced with TTS audio
  - `celebrating` — for "wow" moments
  - `confused` — for unknown intents
- Animation state machine driven by `voice/`'s intent response

## Integration points
- Mounted inside `hologram/`'s scene
- State changes triggered by `voice/` via a `setClippyState(action)` callback
- TTS audio source from `voice/` for lip-sync (optional stretch)

## Standalone test
Load Clippy in a Three.js scene, cycle through animations via keyboard.
