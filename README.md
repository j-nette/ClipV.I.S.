# ClipV.I.S.

> *Clippy but they joined the Avengers.*

**Bring the thing you're talking about into the room.**

A physical Pepper's Ghost hologram pyramid for your meeting table. Say *"Clippy, show me the Xbox controller"* — a 3D model materializes inside the pyramid, rotating, visible from all sides, while a Clippy mascot narrates with specs from Microsoft Fabric and a real LLM brain. Slideshows show pictures of things. ClipV.I.S. shows the **thing**.

Microsoft Intern Hackathon 2026.

---

## 🏃 Run it (works today, no keys needed for mock mode)

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

## Status (as of `dev/voice-agent`)

✅ real gpt-4o brain · ✅ voice in (Edge + on-device fallback) · ✅ ElevenLabs voice (Charlie) ·
✅ Clippy mascot · ✅ voice-driven 3D model swap · ✅ hologram pyramid mode · ✅ Fabric wired ·
✅ text + hotkey fallbacks. See `HANDOFF.md` for details and next steps.

## Team

Baron · Claire · Jeanette · Kevin · Neha · Gebril

## Quick Links

- [Project Brief](docs/project-brief.md)
- Hackathon kickoff: Mon 6/22, B7 Bramble/Nettle/Fern
- Submission opens: Mon 6/29
