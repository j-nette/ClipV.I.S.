# ClipV.I.S. — Handoff / State of the Build

> Snapshot for anyone (teammate or future session) picking this up. Last updated by Gebril's session.
> Branch with all of this: **`dev/voice-agent`** (open a PR into `main`).

---

## What ClipV.I.S. is
A voice-controlled holographic meeting assistant. You say *"Clippy, show me the Xbox controller"* →
a **Clippy mascot** brings up a **3D model** that floats in a physical **Pepper's Ghost pyramid**,
narrating in a charming voice. Brain is a real LLM; data comes from **Microsoft Fabric**.

---

## ✅ What works right now (run it and see)

```bash
cd agent
npm install
copy .env.example .env   # then fill keys (see below) — or run mock with no keys
npm start                # serves the whole app at http://localhost:3000
```

Open **http://localhost:3000**:
- Click **Listen** (works in **Edge**; Chrome's speech is blocked on corp net → auto-falls back to
  on-device Whisper) OR type in the box OR press hotkeys **1–5**.
- Say/type *"show me the Xbox controller"* → model swaps, Clippy reacts, voice narrates.
- Press **H** → **pyramid mode** (4-view pinwheel for the acrylic). Tune with `[ ] - = , . ; ' 0`.

| Layer | Status | Notes |
|---|---|---|
| LLM brain | ✅ real gpt-4o | via **GitHub Models** (Foundry was RBAC-gated for interns) |
| Voice in | ✅ | Edge Web Speech; on-device Whisper (transformers.js) fallback for corp net |
| Voice out | ✅ | ElevenLabs voice **Charlie** (`IKne3meq5aSn9XLyUdCD`), live; clip-player + browser fallback |
| Clippy mascot | ✅ | real rigged `clippy.glb`, idle/presenting/confused animations |
| 3D model swap | ✅ | placeholders now; auto-load real `.glb` when dropped in `models/` |
| Hologram pyramid | ✅ | render-to-texture pinwheel, live-tunable, persisted to localStorage |
| Fabric data | ⚠️ wired, mock on corp | corp net blocks SQL redirect ports 11000–11999; serves identical mock mirror |
| Fallbacks | ✅ | text box + hotkeys 1–5; keyboard-safe for the demo |

---

## 🔑 Configuration (`agent/.env`)
Copy `agent/.env.example` → `agent/.env`. With **no keys it runs in mock mode** (keyword parser +
browser voice). To enable the real stack:

| Var | What | Current |
|---|---|---|
| `GITHUB_MODELS_TOKEN` | GitHub fine-grained token w/ **Models: read** → real LLM | set locally (not committed) |
| `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | ElevenLabs voice (Charlie) | set locally |
| `FABRIC_SQL_SERVER` / `FABRIC_SQL_DATABASE` | Fabric Lakehouse SQL endpoint | set; needs `az login`; blocked on corp |
| `FOUNDRY_*` | Azure Foundry (alt to GitHub Models) | empty (RBAC-gated) |

**Secrets are NOT in git** (`.env` is gitignored). Each dev fills their own. Tokens used during the
session should be rotated.

> ⚠️ Auth note: Fabric live query uses `AzureCliCredential` → run `az login`. It still fails on the
> corp network (port block), so it gracefully falls back to the mock — demo is unaffected.

---

## 🧩 The agent contract (DO NOT change without telling the team)
`POST /agent  { user_text, current_model }  ->`
```json
{
  "intent": "show_model | lookup_spec | compare | chat | unknown",
  "model": "<id|null>",
  "compare_to": "<id|null>",
  "clippy": "presenting | idle | confused",
  "narration": "<short in-character line>"
}
```
This is the interface between `voice/`, `hologram/`, and `clippy/`. Keep it stable.

Endpoints: `POST /agent`, `POST /tts`, `GET /models`, static `/` (frontend) and `/assets` (`.glb`).

---

## 🗂 Repo layout
```
agent/      Node+Express backend: LLM (GitHub Models/Foundry/mock), Fabric, /tts, clip-player
voice/      Frontend: 3D scene (scene.js), voice client (app.js), on-device STT (stt.js), clips/
models/     3D .glb assets + hero-model checklist  (drop real models here, named per models.js)
clippy/     mascot animation notes
hologram/   pyramid renderer notes (the working renderer currently lives in voice/scene.js)
hardware/   physical pyramid build notes
demo/       demo script + backup video + submission
docs/       project-brief.md (master spec)
```

---

## 🔌 Integration hooks for hologram/ + clippy/
`voice/scene.js` currently implements the hologram itself and exposes:
```js
window.setSceneState({ model, compare_to });  // load/swap 3D model(s)
window.setClippyState("presenting"|"idle"|"confused");  // mascot reaction
```
`voice/app.js` calls these after each agent response. When the hologram team formalizes their own
module, adopt this same contract.

---

## ▶️ Next steps (priority order)
1. **Demo script** (`demo/script.md`) — lock the exact 90-sec pitch + the exact spoken commands.
2. **Real hero `.glb` models** → drop in `models/` named `surface_pro_11.glb`, `xbox_controller.glb`,
   `building_7.glb` (see `agent/models.js` for the names). They auto-load, no code change.
3. **Physical pyramid** build + tune pinwheel (`[ ] - = , . ; '` in pyramid mode) on the real tablet.
4. **Merge `dev/voice-agent` → main** (open PR).
5. **Backup demo video** (record a perfect run Thursday night) + submission package.
6. Optional: pre-render the locked demo lines in a fancy ElevenLabs *library* voice on the website
   (free tier blocks library voices via API) and drop the mp3s in `voice/clips/` — see its README.

---

## ⚠️ Gotchas learned the hard way
- **Browser speech (Chrome) is blocked on corp net** → use **Edge**, or the on-device Whisper fallback,
  or hotspot. Text box + hotkeys always work.
- **Fabric SQL is blocked on corp net** (ports 11000–11999) → mock mirror used; identical data.
- **Azure Foundry + Azure Speech are RBAC-gated** for intern accounts → we use GitHub Models +
  ElevenLabs instead.
- **ElevenLabs free tier cannot use Voice Library voices via API** (402) → only built-in *Default*
  voices work live (we use Charlie). Library voices need a paid plan, or pre-render via clip-player.
- **Windows on ARM (Snapdragon X Elite)**: no NVIDIA/CUDA, Python not installed → local RVC/PyTorch
  is not viable on this machine.
- Frontend assets are cache-busted with `?v=N` in `index.html`; bump N when you change JS/CSS.
