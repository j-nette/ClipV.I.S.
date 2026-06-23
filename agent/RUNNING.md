# Running the ClipV.I.S. voice + agent stack

The `agent/` backend serves the `voice/` frontend, so it all runs from one command.
**It works today in MOCK mode with zero Azure access** — swap in real keys later.

## Quick start

```bash
cd agent
npm install
cp .env.example .env   # (Windows: copy .env.example .env)
npm start
```

Open http://localhost:3000

- Click **Listen** and say *"Clippy, show me the Surface Pro 11"*
- Or press **1 / 2 / 3** (keyboard fallback for the 3 demo commands)
- The JSON response renders on the page; Clippy narration plays via browser TTS

## What's mock vs real

| Piece | Now (no Azure) | Later (real) |
|---|---|---|
| Intent parsing | `mockParser.js` keyword matcher | Azure AI Foundry (set `FOUNDRY_*` in `.env`) |
| Model metadata | `models.js` in-memory store | Fabric Lakehouse (step 8) |
| TTS voice | browser `speechSynthesis` | Azure Speech (set `AZURE_SPEECH_*`) |

When you fill in `.env`, the server auto-detects and switches from MOCK to LIVE — no code change. Check the startup log line:
`[clipvis-agent] Foundry: MOCK | TTS: browser fallback`

## Endpoints

- `POST /agent` — `{user_text, current_model}` → `{intent, model, compare_to, clippy, narration}`
- `POST /tts` — `{text}` → mp3 audio (or `204` to use browser fallback)
- `GET /models` — model metadata (mock Fabric)

## The agent contract (do not change after Tuesday)

```json
{
  "intent": "show_model | lookup_spec | compare | unknown",
  "model": "<id|null>",
  "compare_to": "<id|null>",
  "clippy": "presenting | idle | confused",
  "narration": "<short sentence>"
}
```

## Integration hooks (for hologram/ + clippy/)

`voice/app.js` calls two globals you can override:

```js
window.setSceneState({ model, compare_to });  // hologram/ implements this
window.setClippyState("presenting");          // clippy/ implements this
```

Until they're implemented, both just `console.log` so the voice vertical runs standalone.
