import "dotenv/config";
import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { mockParse } from "./mockParser.js";
import { MODELS } from "./models.js";
import { lookupModelMetadata, getAllModels, fabricStatus } from "./fabric.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Folder of pre-rendered voice clips (any voice you want: ElevenLabs website,
// recordings, etc.). A clip named after the slugified narration is played
// instead of calling a TTS service — lets you use voices the free API blocks.
const CLIPS_DIR = path.join(__dirname, "..", "voice", "clips");

function slugify(text) {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function findClip(text) {
  const slug = slugify(text);
  if (!slug) return null;
  for (const ext of [".mp3", ".wav", ".ogg", ".m4a"]) {
    const p = path.join(CLIPS_DIR, slug + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Serve the voice frontend so everything runs from one origin (mic needs https/localhost).
app.use(express.static(path.join(__dirname, "..", "voice")));
// Serve 3D model files (.glb) so the hologram scene can load them.
app.use("/assets", express.static(path.join(__dirname, "..", "models")));

const PORT = process.env.PORT || 3000;
const FOUNDRY_READY = !!(process.env.FOUNDRY_ENDPOINT && process.env.FOUNDRY_API_KEY);
const GITHUB_READY = !!process.env.GITHUB_MODELS_TOKEN;
const TTS_READY = !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);

const LLM = FOUNDRY_READY ? "Foundry" : GITHUB_READY ? "GitHubModels" : "MOCK";
console.log(`[clipvis-agent] LLM: ${LLM} | Data: ${fabricStatus()} | TTS: ${TTS_READY ? "Azure" : "browser fallback"}`);

// --- Demo response cache (step 11): exact-match scripted commands skip the model call ---
const DEMO_CACHE = {
  "clippy, show me the surface laptop": {
    intent: "show_model", model: "surface_laptop", compare_to: null,
    clippy: "presenting", narration: "Here's the Surface Laptop."
  }
};

function fromCache(text) {
  const key = (text || "").toLowerCase().trim().replace(/[.?!]$/, "");
  return DEMO_CACHE[key] || null;
}

function messages(userText, currentModel) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Current model on screen: ${currentModel || "none"}.\nCommand: ${userText}` }
  ];
}

// --- Call Foundry (Azure OpenAI-compatible chat completions) ---
async function callFoundry(userText, currentModel) {
  const url = `${process.env.FOUNDRY_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${process.env.FOUNDRY_DEPLOYMENT}/chat/completions?api-version=2024-08-01-preview`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": process.env.FOUNDRY_API_KEY },
    body: JSON.stringify({ messages: messages(userText, currentModel), temperature: 0, response_format: { type: "json_object" } })
  });
  if (!res.ok) throw new Error(`Foundry ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- Call GitHub Models (OpenAI-compatible, free, just needs a GitHub token) ---
async function callGitHubModels(userText, currentModel) {
  const base = (process.env.GITHUB_MODELS_ENDPOINT || "https://models.github.ai/inference").replace(/\/$/, "");
  const model = process.env.GITHUB_MODELS_MODEL || "openai/gpt-4o";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GITHUB_MODELS_TOKEN}` },
    body: JSON.stringify({ model, messages: messages(userText, currentModel), temperature: 0, response_format: { type: "json_object" } })
  });
  if (!res.ok) throw new Error(`GitHubModels ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

async function callLLM(userText, currentModel) {
  if (FOUNDRY_READY) return { ...(await callFoundry(userText, currentModel)), _source: "foundry" };
  if (GITHUB_READY) return { ...(await callGitHubModels(userText, currentModel)), _source: "github" };
  return { ...mockParse(userText, currentModel), _source: "mock" };
}

// --- Build spec/compare narration from real data (Fabric or mock) ---
async function enrichWithData(result, userText) {
  const t = (userText || "").toLowerCase();
  if (result.intent === "lookup_spec" && result.model) {
    const m = await lookupModelMetadata(result.model);
    if (m) {
      if (t.includes("weigh") || t.includes("weight") || t.includes("heavy")) {
        result.narration = `It weighs ${m.weight}.`;
      } else if (t.includes("cost") || t.includes("price") || t.includes("much")) {
        result.narration = `It costs ${m.price}.`;
      } else {
        result.narration = `${m.display}: ${m.blurb}`;
      }
    }
  } else if (result.intent === "compare" && result.model && result.compare_to) {
    const a = await lookupModelMetadata(result.model);
    const b = await lookupModelMetadata(result.compare_to);
    if (a && b && a.weight !== "n/a" && b.weight !== "n/a") {
      result.narration = `${a.display} is ${a.weight}, ${b.display} is ${b.weight}.`;
    }
  }
  return result;
}

// --- POST /agent : voice text -> intent JSON (steps 5-7) ---
app.post("/agent", async (req, res) => {
  const { user_text, current_model } = req.body || {};
  try {
    const cached = fromCache(user_text);
    if (cached) return res.json({ ...cached, _source: "cache" });

    let result = await callLLM(user_text, current_model);
    result = await enrichWithData(result, user_text);
    return res.json(result);
  } catch (err) {
    console.error("[/agent] error:", err.message);
    // Never crash the demo — fall back to mock, then to unknown.
    try {
      return res.json({ ...mockParse(user_text, current_model), _source: "mock-fallback" });
    } catch {
      return res.json({
        intent: "unknown", model: null, compare_to: null,
        clippy: "confused", narration: "Sorry, I didn't get that.", _source: "error"
      });
    }
  }
});

// --- GET /models : metadata (Fabric or mock) ---
app.get("/models", async (_req, res) => res.json(await getAllModels()));

// --- POST /tts : narration text -> audio. Priority: ElevenLabs > Azure > 204 (browser fallback). ---
app.post("/tts", async (req, res) => {
  const { text } = req.body || {};
  if (!text) return res.status(204).end();

  // 0) Pre-rendered clip (any voice — bypasses TTS APIs entirely)
  const clip = findClip(text);
  if (clip) {
    const type = clip.endsWith(".wav") ? "audio/wav" : clip.endsWith(".ogg") ? "audio/ogg" : "audio/mpeg";
    res.set("Content-Type", type);
    return fs.createReadStream(clip).pipe(res);
  }

  // 1) ElevenLabs (best/custom voices) — set ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID
  if (process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID) {
    try {
      const voiceId = process.env.ELEVENLABS_VOICE_ID;
      const model = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 },
        }),
      });
      if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
      res.set("Content-Type", "audio/mpeg");
      return res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error("[/tts] ElevenLabs error:", err.message);
      // fall through to Azure / browser
    }
  }

  // 2) Azure Speech
  if (TTS_READY) {
    try {
      const region = process.env.AZURE_SPEECH_REGION;
      const voice = process.env.AZURE_SPEECH_VOICE || "en-US-AndrewMultilingualNeural";
      const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'><mstts:express-as style='cheerful' xmlns:mstts='http://www.w3.org/2001/mstts'>${escapeXml(text)}</mstts:express-as></voice></speak>`;
      const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        },
        body: ssml,
      });
      if (!r.ok) throw new Error(`Azure TTS ${r.status}`);
      res.set("Content-Type", "audio/mpeg");
      return res.send(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error("[/tts] Azure error:", err.message);
    }
  }

  // 3) Browser speech-synthesis fallback
  return res.status(204).end();
});

function escapeXml(s = "") {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

app.listen(PORT, () => console.log(`[clipvis-agent] http://localhost:${PORT}`));
