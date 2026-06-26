# ClipV.I.S.

**Bring the thing you're talking about into the room.**

An interactive Pepper's Ghost hologram for your meeting table. Clippy saw your struggles with clear and engaging meetings about hardware so Clippy materialized into 3D space that helps you view and organize your presentation media! (Thanks APC for sharing your pain points!) :)

Say *"Clippy, show me Xbox Controller V2"* and the at-scale part is projected in 3D. Accessible, gesture and voice commands allow users to interact with the product, toggle between different views, and learn all about the specs by asking our good old AI powered superhero paperclip. 

Microsoft Intern Hackathon 2026 ·  Customer Engagement & Support.

---

## Prerequisites

- **Node.js 18+** (tested on 20/24) and npm.
- A modern Chromium browser; **Edge** for the best cloud speech (corp net falls back to on-device).
- A webcam for hand gestures (optional — keyboard fallbacks cover every gesture).
- No cloud keys required: the app runs fully in **mock mode** out of the box.

## Run it

Two processes — the backend agent (LLM/TTS/data) and the gesture frontend:

```bash
# Terminal 1 — backend on :3000 (POST /agent, /tts, /assets, /models)
cd agent
npm install
copy .env.example .env   # optional: add keys for the real LLM/voice (else mock mode)
npm start

# Terminal 2 — gesture frontend on :5173 (presenter + hologram follower)
cd gesture
npm install              # postinstall fetches the local MediaPipe model
npm run dev
```

Open **http://localhost:5173/** (the **presenter** — the window you drive):
- Type a command, click a quick-chip, or 🎙️ **Listen** (Edge; auto-falls back to on-device Whisper).
- *"show me the Xbox controller"* → it appears, Clippy reacts, voice narrates.
- *"zoom in" · "spin it" · "explode the controller" · "show me the back" · "reset"* → manipulation.
- Use your hand (pinch/point) or the keyboard for direct manipulation.
- Click **🔺 Open hologram window** → the four-camera pyramid view (what the audience sees).

> **New here? Read [`HANDOFF.md`](HANDOFF.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.**
> The original single-page voice app still runs at **http://localhost:3000** (`voice/`) as a fallback.

---

## Features
- At-scale hologram projection
- Voice commands
- Gestures
  - Index pinch to select object, move, and rotate
  - "Rock sign" to add information blob
  - Index point to expand information blob
  - Snap 
- Acrylic laser-cut pyramid with 3D printed enclosure that can be transformed into a light box

## Future Projections
- Create a "black-out" enclosure, allowing clear hologram viewing in any light level
- Enlarge and optimize hologram pyramid for more ergonomic viewing angles and larger displays
- Interactive assemblies (ex. buttons are pressable)
- Integrate active edit capabilities, similar to CAD

## Lessons Learned & Challenges
- Getting our hands on hardware :c
- OpenGL requires a stronger GPU to render the models - running local LLM and voice models also takes a lot of compute
- Displays sometimes has polarization in certain directions, which made reflecting the model in certain directions almost invisible. We opted to rotate our hologram pyramid and ray cast images 45 degrees to combat this effect.

## Repo Map

| Folder | What's in it |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | **Read first** — current state, how to run, gotchas, next steps. |
| [`docs/`](docs/) | `ARCHITECTURE.md` (code map + data flow) · `project-brief.md` (master spec). |
| [`agent/`](agent/) | Backend (Node/Express): LLM brain (GitHub Models), Fabric, TTS, clip-player. |
| [`gesture/`](gesture/) | **Main frontend** (TS+Vite): presenter + hologram follower, voice bar, hand gestures, Clippy. |
| [`voice/`](voice/) | **Legacy** single-page voice app (served at :3000 as a fallback). |
| [`hologram/`](hologram/) | Pyramid renderer notes + `INTEGRATION-HANDOFF.md` (two-display pipeline). |
| [`clippy/`](clippy/) | Clippy mascot notes (impl now lives in `gesture/src/shared/clippy.ts`). |
| [`models/`](models/) | 3D assets (.glb) — auto-loaded from `/assets/<id>.glb`. |
| [`hardware/`](hardware/) | Pyramid CAD + build notes, BOM, lighting, demo-room checklist. |
| [`demo/`](demo/) | Demo script, poster, backup video, submission package. |

## Team

Baron · Claire · Jeanette · Kevin · Neha · Gebril

