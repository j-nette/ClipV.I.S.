# voice/

Browser-side voice input + TTS output + agent client.

**Owners:** Gebril, Neha

## Responsibilities
- Web Speech API for voice input (`webkitSpeechRecognition`)
- "Listen" button + visual mic state (idle / listening / thinking / speaking)
- POST recognized text to the agent endpoint in `agent/`
- Receive JSON response: `{ intent, model, compare_to, narration }`
- Play TTS audio (from Azure Speech via `agent/`)
- Call `hologram/`'s `setSceneState()` with the result
- Keyboard fallback: hotkeys `1` `2` `3` fire the same flow as the 3 demo commands

## Integration points
- Calls `agent/` over HTTP
- Calls `hologram/`'s `setSceneState()` to update the scene
- Triggers Clippy animations in `clippy/` based on response intent

## Standalone test
Click "Listen", speak a command, see the JSON response in the console and hear the narration play.
