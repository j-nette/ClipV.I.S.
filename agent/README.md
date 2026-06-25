# agent/

Node + Express backend: the LLM brain, Microsoft Fabric data, and TTS. Serves the `voice/` frontend.

**Owners:** Gebril, Neha

## Run
```bash
npm install
copy .env.example .env   # fill keys, or leave empty for mock mode
npm start                # http://localhost:3000
```
See `RUNNING.md` for details. With no keys it runs fully in **mock mode**.

## Endpoints
- `POST /agent` — `{ user_text, current_model }` → intent JSON (see contract below)
- `POST /tts` — `{ text }` → audio. Priority: pre-rendered clip → ElevenLabs → Azure → 204 (browser fallback)
- `GET /models` — model metadata (Fabric if reachable, else mock)
- static `/` (frontend), `/assets` (`.glb` model files)

## LLM backends (priority: Foundry → GitHub Models → mock)
- **GitHub Models** (`GITHUB_MODELS_TOKEN`) — what we actually use; free gpt-4o, works on corp net.
- **Azure Foundry** (`FOUNDRY_*`) — alternative; RBAC-gated for intern subs so currently unused.
- **mock** (`mockParser.js`) — keyword parser so the app runs with zero keys.

## Data
- `fabric.js` — real Lakehouse SQL via `AzureCliCredential` (`az login`), graceful fallback to
  `models.js` mock. Corp net blocks the SQL ports, so the mock mirror is what runs there.

## Voice (`/tts`)
- `voice/clips/<slug>.mp3` plays first if present (any custom voice — see `voice/clips/README.md`)
- else **ElevenLabs** (`ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`, currently Charlie)
- else **Azure Speech** (`AZURE_SPEECH_*`)
- else `204` → browser speech-synthesis fallback in the client

## Agent contract (stable interface — coordinate before changing)
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
Known model ids live in `models.js`: surface_pro_11, surface_pro_10, xbox_controller, building_7.

`action` is set only when `intent` is `manipulate` (else null). It drives the presenter's
`window.*` hooks (zoom/spin/explode/view/render/reset). Values: `zoom_in`, `zoom_out`,
`spin_on`, `spin_off`, `explode`, `collapse`, `view_front`, `view_back`, `view_top`, `view_iso`,
`wireframe`, `xray`, `solid`, `reset`. The field is additive — older consumers that ignore it
keep working.
