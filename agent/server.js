import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { mockParse } from "./mockParser.js";
import { MODELS } from "./models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Serve the voice frontend so everything runs from one origin (mic needs https/localhost).
app.use(express.static(path.join(__dirname, "..", "voice")));

const PORT = process.env.PORT || 3000;
const FOUNDRY_READY = !!(process.env.FOUNDRY_ENDPOINT && process.env.FOUNDRY_API_KEY);
const TTS_READY = !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION);

console.log(`[clipvis-agent] Foundry: ${FOUNDRY_READY ? "LIVE" : "MOCK"} | TTS: ${TTS_READY ? "Azure" : "browser fallback"}`);

// --- Demo response cache (step 11): exact-match scripted commands skip the model call ---
const DEMO_CACHE = {
  "clippy, show me the surface pro 11": {
    intent: "show_model", model: "surface_pro_11", compare_to: null,
    clippy: "presenting", narration: "Here's the Surface Pro 11."
  }
};

function fromCache(text) {
  const key = (text || "").toLowerCase().trim().replace(/[.?!]$/, "");
  return DEMO_CACHE[key] || null;
}

// --- Call Foundry (Azure OpenAI-compatible chat completions) ---
async function callFoundry(userText, currentModel) {
  const url = `${process.env.FOUNDRY_ENDPOINT.replace(/\/$/, "")}/openai/deployments/${process.env.FOUNDRY_DEPLOYMENT}/chat/completions?api-version=2024-08-01-preview`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": process.env.FOUNDRY_API_KEY },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Current model on screen: ${currentModel || "none"}.\nCommand: ${userText}` }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    })
  });
  if (!res.ok) throw new Error(`Foundry ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// --- POST /agent : voice text -> intent JSON (steps 5-7) ---
app.post("/agent", async (req, res) => {
  const { user_text, current_model } = req.body || {};
  try {
    const cached = fromCache(user_text);
    if (cached) return res.json({ ...cached, _source: "cache" });

    if (FOUNDRY_READY) {
      const result = await callFoundry(user_text, current_model);
      return res.json({ ...result, _source: "foundry" });
    }
    return res.json({ ...mockParse(user_text, current_model), _source: "mock" });
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

// --- GET /models : metadata (mock Fabric) ---
app.get("/models", (_req, res) => res.json(MODELS));

// --- POST /tts : narration text -> audio (step 9). Returns 204 if not configured (browser TTS fallback). ---
app.post("/tts", async (req, res) => {
  const { text } = req.body || {};
  if (!TTS_READY) return res.status(204).end();
  try {
    const region = process.env.AZURE_SPEECH_REGION;
    const voice = process.env.AZURE_SPEECH_VOICE || "en-US-AndrewMultilingualNeural";
    const ssml = `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'><mstts:express-as style='cheerful' xmlns:mstts='http://www.w3.org/2001/mstts'>${escapeXml(text)}</mstts:express-as></voice></speak>`;
    const r = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3"
      },
      body: ssml
    });
    if (!r.ok) throw new Error(`TTS ${r.status}`);
    res.set("Content-Type", "audio/mpeg");
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (err) {
    console.error("[/tts] error:", err.message);
    res.status(204).end();
  }
});

function escapeXml(s = "") {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

app.listen(PORT, () => console.log(`[clipvis-agent] http://localhost:${PORT}`));
