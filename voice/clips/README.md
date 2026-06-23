# voice/clips/

Pre-rendered voice clips. Drop audio files here to use **any** voice for specific
lines — including ElevenLabs Voice Library voices that the free API blocks, your
own recordings, or RVC output made elsewhere.

## How it works
When Clippy is about to speak a line, the server first looks here for a matching
clip. If found, it plays the clip instead of calling a TTS service. The match is
by the **slugified narration text**.

## Naming
Lowercase the narration, replace non-alphanumerics with `-`. Examples:

| Clippy says | File name |
|---|---|
| "Here's the Xbox controller — sleek and ready for action!" | `here-s-the-xbox-controller-sleek-and-ready-for-action.mp3` |
| "Here's the Surface Pro 11." | `here-s-the-surface-pro-11.mp3` |
| "It weighs 1.97 lbs." | `it-weighs-1-97-lbs.mp3` |

(Server truncates the slug to 60 chars. Supported: `.mp3`, `.wav`, `.ogg`, `.m4a`.)

## Workflow to use a Voice Library voice for free
1. Lock your demo script so you know the exact narrations.
2. On the ElevenLabs **website** Text-to-Speech tool, pick your voice, paste each
   line, generate, and **download** the mp3.
3. Rename each file to the slug of its line (see table) and drop it here.
4. Restart the server. Those lines now play in your chosen voice; everything else
   falls back to the live voice (George) automatically.
