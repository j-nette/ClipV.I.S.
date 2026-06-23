# voice/

The frontend: the 3D hologram scene, the voice client, and on-device speech. Served by `agent/`.

**Owners:** Gebril, Neha

## Files
- `index.html` — page shell + import map for Three.js. Assets are cache-busted with `?v=N` (bump on change).
- `app.js` — voice client: Listen button, agent calls, TTS playback, voice picker, hotkeys, text box.
- `scene.js` — **the 3D hologram stage** (Three.js): loads/swaps models, Clippy mascot, and the
  **pyramid pinwheel** render. This is effectively the `hologram/` implementation for now.
- `stt.js` — on-device Whisper (transformers.js) speech-to-text; corp-network-proof fallback.
- `style.css` — UI styling.
- `clips/` — drop-in audio clips for custom voices (see its README).

## How input works (robust, layered)
1. **Listen** button → Web Speech API (works in **Edge**; Chrome blocked on corp net)
2. on `network` error → auto-switches to **on-device Whisper** (`stt.js`), push-to-talk
3. **Text box** — always works, no mic/network needed
4. **Hotkeys 1–5** — fire the scripted demo commands (demo-safe)

## Pyramid mode
Press **H** to toggle the 4-view Pepper's Ghost pinwheel. Live-tune (persisted):
`[ ]` size · `- =` gap · `, .` zoom · `; '` tilt · `0` reset. HUD shows current values.

## Integration hooks (the contract with hologram/ + clippy/)
`scene.js` defines, and `app.js` calls:
```js
window.setSceneState({ model, compare_to });            // load / swap 3D model(s)
window.setClippyState("presenting" | "idle" | "confused"); // mascot reaction
```
Real `.glb` models auto-load from `/assets/<file>` (drop them in `models/`), else a labeled placeholder.

## Standalone test
Open http://localhost:3000, type "show me the xbox controller", confirm the model swaps, Clippy
reacts, and a voice narrates. Press H for pyramid mode.
