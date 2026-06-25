# ClipV.I.S. — Handoff / State of the Build

> Snapshot for anyone (teammate or future session) picking this up.
> Branch with the consolidated build: **`integrate/voice-clippy-gestures`** (off `main`, which
> already has the gesture app + Kevin's hand-gesture improvements). Open a PR into `main`.

---

## What ClipV.I.S. is
A voice- **and gesture**-controlled holographic meeting assistant. You say *"Clippy, show me the
Xbox controller"* (or pinch/point in the air) → a **Clippy mascot** stands by while a **3D model**
floats in a physical **Pepper's Ghost pyramid**, narrating in a charming voice. Brain is a real
LLM; data comes from **Microsoft Fabric**.

---

## 🏗 Architecture — two windows, one shared state (READ THIS FIRST)

The frontend is now the **TypeScript + Vite app in `gesture/`** (not the old `voice/` page). It runs
as **two browser windows** on the same machine, synced by a `BroadcastChannel`:

| Window | URL | Role |
|---|---|---|
| **Presenter** (the operator drives this) | `http://localhost:5173/` | Single perspective camera. OWNS the shared `ModelState`. Hosts the **voice command bar**, **hand-gesture** input, keyboard. Clippy stands beside the model. |
| **Hologram** (what the audience sees) | `/hologram.html` (🔺 button opens it) | Four-camera pinwheel for the acrylic pyramid. Pure follower — mirrors `ModelState`, no input. Drag to the flat display under the pyramid, F11. |

**One source of truth:** `gesture/src/shared/modelState.ts`. The presenter
(`consumers/hologramPresenter.ts`) is the only writer; `holoSync.ts` broadcasts every change.
Voice, hand gestures, and keyboard **all drive the same `window.*` hooks** → the same state →
both windows stay coherent. Adding an input or a feature = mutate `ModelState`, never touch the
follower directly.

## ✅ What works right now (run it and see)

Two processes — the agent backend (LLM/TTS/models) and the gesture frontend:

```bash
# Terminal 1 — backend on :3000 (LLM brain, /agent, /tts, /assets, /models)
cd agent && npm install && npm start

# Terminal 2 — gesture frontend on :5173 (presenter + hologram follower)
cd gesture && npm install && npm run dev
```

Open **http://localhost:5173/** (the presenter):
- **Voice/text command bar:** type, click a quick-chip, or 🎙️ **Listen** (Web Speech in **Edge**;
  auto-falls back to **on-device Whisper** when corp net blocks cloud speech). Always-on text box.
- *"show me the Xbox controller"* → model swaps, Clippy goes *presenting*, voice narrates.
- *"zoom in" · "spin it" · "explode the controller" · "show me the back" · "wireframe" · "reset"* →
  voice-driven **manipulation** (mirrors the hand gestures).
- *"wow, amazing!"* → Clippy *celebrates*; *"hi"* → *waves* (phrase-driven emotes, auto-revert).
- **Hand gestures** (Kevin): pinch to grab/translate, twist to rotate, two-hand scale, three-finger
  for the whole assembly; explode/focus/snap-view/render-mode/turntable wired to poses. Keyboard
  fallbacks for all (`P/G/B`, `Q-E/R-F/C-V`, `Z/X`, `O/M/T/[ ]/1-4/K`).
- Click **🔺 Open hologram window** → the pyramid follower mirrors everything.

> Legacy: the original single-page voice app is still served at **http://localhost:3000** (`voice/`,
> with `H`=pyramid toggle). Kept as a standalone fallback; the gesture app at :5173 is the main build.

| Layer | Status | Notes |
|---|---|---|
| LLM brain | ✅ real gpt-4o | via **GitHub Models** (Foundry was RBAC-gated for interns) |
| Voice in | ✅ | Edge Web Speech; on-device Whisper (transformers.js) fallback for corp net |
| Voice out | ✅ | ElevenLabs voice **Charlie** (`IKne3meq5aSn9XLyUdCD`); clip-player + browser fallback |
| Voice → presenter | ✅ | command bar in `gesture/src/voice/` drives `window.setModelState` etc. |
| Voice manipulation | ✅ | `manipulate` intent + `action` field → zoom/spin/explode/view/render/reset |
| Hand gestures | ✅ | MediaPipe Hands, One-Euro smoothing, two-hand control, poses → same hooks (Kevin) |
| Clippy mascot | ✅ | persistent companion in TS; idle/wave/thinking/presenting/celebrating/confused |
| 3D model swap | ✅ | multi-part placeholders; auto-load real `.glb` from `/assets/<id>.glb` |
| Hologram pyramid | ✅ | four-camera pinwheel follower window (`/hologram.html`) |
| Fabric data | ⚠️ wired, mock on corp | corp net blocks SQL redirect ports 11000–11999; identical mock mirror |
| Fallbacks | ✅ | text box + quick-chips + keyboard for every gesture; demo-safe |

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
  "intent": "show_model | lookup_spec | compare | manipulate | chat | unknown",
  "model": "<id|null>",
  "compare_to": "<id|null>",
  "action": "<manipulation action|null>",
  "clippy": "idle | presenting | thinking | wave | celebrating | confused",
  "narration": "<short in-character line>"
}
```
`action` is set only when `intent` is `manipulate` (else null); values: `zoom_in`, `zoom_out`,
`spin_on`, `spin_off`, `explode`, `collapse`, `view_front`, `view_back`, `view_top`, `view_iso`,
`wireframe`, `xray`, `solid`, `reset`. Both `action` and the wider `clippy` emote set are
**additive** — older consumers that ignore them keep working. This is the interface between the
voice client, the presenter, and Clippy. Keep it stable.

Endpoints: `POST /agent`, `POST /tts`, `GET /models`, static `/` (legacy voice page) and `/assets` (`.glb`).

---

## 🗂 Repo layout
```
agent/      Node+Express backend: LLM (GitHub Models/Foundry/mock), Fabric, /tts, clip-player
gesture/    MAIN frontend (TS+Vite): presenter + hologram follower, voice bar, hand gestures, Clippy
  src/voice/        voiceClient + voiceUI + on-device Whisper (stt.ts) — drives the presenter
  src/shared/       modelState (source of truth), holoSync, modelScene, clippy
  src/consumers/    hologramPresenter (owns state), standaloneScene
  src/hologram/     four-camera pinwheel follower (/hologram.html)
voice/      LEGACY single-page app (scene.js/app.js/stt.js) still served at :3000 as a fallback
models/     3D .glb assets + hero-model checklist (auto-load from /assets/<id>.glb)
clippy/     mascot animation notes
hologram/   pyramid renderer notes + INTEGRATION-HANDOFF.md (two-display pipeline)
hardware/   physical pyramid build notes
demo/       demo script + backup video + submission
docs/       project-brief.md (master spec)
```

---

## 🔌 Integration hooks (presenter `window.*`, driven by voice + gesture + keyboard)
`gesture/src/consumers/hologramPresenter.ts` owns `ModelState` and exposes:
```js
window.setModelState({ model, compare_to });   // load/swap 3D model(s)
window.setClippyState("presenting"|"idle"|"wave"|"thinking"|"celebrating"|"confused");
window.setExplode(0..1);  window.setRenderMode("solid"|"wireframe"|"xray");
window.snapToView("front"|"iso"|"top"|"back");  window.setTurntable({ on, speed });
window.focusPart(partId|null);  window.nudgeZoom(delta);  window.resetView();
```
Every input path (voice client, hand gestures, keyboard) calls these; the presenter mutates
`ModelState` and `holoSync` mirrors it to the `/hologram.html` follower. The legacy `voice/scene.js`
exposes the older `setSceneState`/`setClippyState` pair for the :3000 fallback page only.


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
