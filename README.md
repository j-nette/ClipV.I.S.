# ClipV.I.S.

> *Clippy but they joined the Avengers.*

**Bring the thing you're talking about into the room.**

An interactive Pepper's Ghost hologram for your meeting table. Clippy saw your struggles with clear and engaging meetings about hardware so Clippy materialized into 3D space thelps you view and organize your presentation media! (Thanks APC for sharing your pain points!)

Say *"Clippy, show me Xbox Controller V2"* and the at-scale part is projected in 3D. Gesture-based commands allow users to interact with information markers, explode assemblies, and toggle between viewing modes. CLippy can also narrate specs from Microsoft Fabric and help answer questions with a a real LLM brain. 

Microsoft Intern Hackathon 2026.

---

## Prerequisities

## Run it

```bash
cd agent
npm install
copy .env.example .env   # optional: add keys for the real LLM/voice
npm start                # http://localhost:3000
```

Open http://localhost:3000 → click **Listen** (use **Edge**), or type a command, or press **1–5**.
Press **H** for hologram pyramid mode. **New here? Read [`HANDOFF.md`](HANDOFF.md) first.**

---

## Repo Map

| Folder | What's in it |
|---|---|
| [`HANDOFF.md`](HANDOFF.md) | **Read first** — current state, how to run, gotchas, next steps. |
| [`docs/`](docs/) | `project-brief.md` — the master spec. |
| [`agent/`](agent/) | Backend: LLM brain (GitHub Models), Fabric, TTS, clip-player (Gebril, Neha) |
| [`voice/`](voice/) | Frontend: 3D hologram scene, voice client, on-device STT (Gebril, Neha) |
| [`clippy/`](clippy/) | Clippy mascot model + animation notes (Jeanette, Baron, Neha) |
| [`hologram/`](hologram/) | Pyramid renderer notes (working renderer currently in `voice/scene.js`) (Baron, Claire) |
| [`gesture/`](gesture/) | Hand-gesture recognition — **stretch goal** (Jeanette, Kevin) |
| [`models/`](models/) | 3D assets (.glb / .gltf) — drop hero models here |
| [`hardware/`](hardware/) | Pyramid build notes, BOM, lighting, demo-room checklist |
| [`demo/`](demo/) | Demo script, backup video, submission package |

## Features
- At-scale hologram projection
- Voice commands
- Gestures
  - Index pinch to select object, move, and rotate
  - "Rock sign" to add information blob
  - Index point to expand information blob
- Acrylic laser-cut pyramid with 3D printed enclosure that can be transformed into a light box

## Future Projections
TBD



## Team

Baron · Claire · Jeanette · Kevin · Neha · Gebril

## Quick Links

- [Project Brief](docs/project-brief.md)
- Hackathon kickoff: Mon 6/22, B7 Bramble/Nettle/Fern
- Submission opens: Mon 6/29
