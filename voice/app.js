// ClipV.I.S. voice client.
// Flow: speech (or hotkey) -> POST /agent -> render JSON -> TTS -> notify hologram + clippy.

const els = {
  listen: document.getElementById("listen"),
  status: document.getElementById("status"),
  heard: document.getElementById("heard"),
  output: document.getElementById("output"),
  narration: document.getElementById("narration"),
};

// Last model shown on screen — context for "what does it weigh" / "compare".
let currentModel = null;

// ---- Integration hooks for the rest of the team (step 10) ----
// hologram/ overrides window.setSceneState; clippy/ overrides window.setClippyState.
// Until then these just log so the voice vertical works standalone.
window.setSceneState = window.setSceneState || ((s) => console.log("[hologram] setSceneState", s));
window.setClippyState = window.setClippyState || ((a) => console.log("[clippy] setClippyState", a));

function setStatus(s) {
  els.status.textContent = s;
  els.status.className = "status " + s;
}

async function handleCommand(userText) {
  els.heard.textContent = userText;
  setStatus("thinking");
  try {
    const res = await fetch("/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_text: userText, current_model: currentModel }),
    });
    const data = await res.json();
    els.output.textContent = JSON.stringify(data, null, 2);
    if (els.narration) els.narration.textContent = data.narration || "";

    if (data.model) currentModel = data.model;

    // Notify the rest of the app.
    window.setClippyState(data.clippy || "idle");
    if (data.intent === "show_model" || data.intent === "compare") {
      window.setSceneState({ model: data.model, compare_to: data.compare_to });
    }

    await speak(data.narration);
  } catch (err) {
    console.error(err);
    els.output.textContent = JSON.stringify({ error: String(err) }, null, 2);
  } finally {
    setStatus("idle");
  }
}

// ---- TTS: tuned browser voice for Clippy (Azure neural used only if /tts configured) ----
let preferredVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;
  // Prefer a pleasant en-US voice for Clippy's cheerful tone.
  const wanted = ["Microsoft Aria", "Google US English", "Samantha", "Microsoft Zira", "Microsoft Jenny"];
  preferredVoice =
    wanted.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) ||
    voices.find((v) => v.lang === "en-US") ||
    voices[0];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

async function speak(text) {
  if (!text) return;
  setStatus("speaking");
  try {
    const res = await fetch("/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (res.status === 200) {
      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      await audio.play();
      await new Promise((r) => (audio.onended = r));
      return;
    }
  } catch (_) { /* fall through to browser TTS */ }

  if ("speechSynthesis" in window) {
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (preferredVoice) u.voice = preferredVoice;
      u.rate = 1.05;   // a touch peppy
      u.pitch = 1.15;  // a touch higher = friendlier Clippy
      u.onend = resolve;
      speechSynthesis.speak(u);
    });
  }
}

// ---- Speech recognition: Web Speech API, with on-device Whisper fallback for corp networks ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false;
let recognition = null;
let mode = SR ? "web" : "local";   // auto-switch to "local" if web speech is blocked
let localRecorder = null;
let localActive = false;

if (SR) {
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => handleCommand(e.results[0][0].transcript);
  recognition.onend = () => {
    recognizing = false;
    els.listen.classList.remove("active");
  };
  recognition.onerror = (e) => {
    recognizing = false;
    els.listen.classList.remove("active");
    console.warn("speech error:", e.error);
    if (e.error === "network" || e.error === "service-not-allowed") {
      // Browser speech cloud is blocked (corp network). Switch to on-device Whisper
      // and start recording immediately so the user doesn't need an extra click.
      mode = "local";
      els.listen.textContent = "🎙️ Listen (on-device)";
      els.heard.textContent = "Cloud speech blocked — using on-device. Recording…";
      toggleLocalListening();
      return;
    }
    const reasons = {
      "not-allowed": "Mic blocked — allow microphone via the 🔒 in the address bar, then reload",
      "no-speech": "Didn't hear anything — click, then speak",
      "audio-capture": "No microphone found",
      "aborted": "Listening stopped",
    };
    els.heard.textContent = reasons[e.error] || `speech error: ${e.error}`;
    setStatus("idle");
  };
}

let micGranted = false;
async function ensureMic() {
  if (micGranted) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    micGranted = true;
    return true;
  } catch (err) {
    els.heard.textContent = "Mic permission denied — click the 🔒 in the address bar → allow microphone";
    return false;
  }
}

async function toggleLocalListening() {
  if (!localActive) {
    if (!(await ensureMic())) return;
    const { createLocalRecorder } = await import("./stt.js");
    localRecorder = createLocalRecorder((s) => { els.heard.textContent = s; });
    try {
      await localRecorder.start();
      localActive = true;
      els.listen.classList.add("active");
      setStatus("listening");
    } catch (err) {
      console.warn("local start failed:", err.message);
      els.heard.textContent = "Couldn't start microphone.";
    }
  } else {
    localActive = false;
    els.listen.classList.remove("active");
    setStatus("thinking");
    try {
      const text = await localRecorder.stop();
      if (text) handleCommand(text);
      else { els.heard.textContent = "Didn't catch that — try again."; setStatus("idle"); }
    } catch (err) {
      console.warn("transcribe failed:", err.message);
      els.heard.textContent = "Transcription failed — try the text box.";
      setStatus("idle");
    }
  }
}

els.listen.addEventListener("click", async () => {
  if (mode === "local") return toggleLocalListening();
  if (!recognition) return;
  if (recognizing) { recognition.stop(); return; }
  if (!(await ensureMic())) return;
  try {
    recognizing = true;
    els.listen.classList.add("active");
    setStatus("listening");
    els.heard.textContent = "listening…";
    recognition.start();
  } catch (err) {
    recognizing = false;
    els.listen.classList.remove("active");
    setStatus("idle");
    console.warn("start failed:", err.message);
  }
});

// ---- Keyboard fallback (step 11) ----
const HOTKEYS = {
  "1": "Clippy, show me the Surface Pro 11",
  "2": "What does it weigh?",
  "3": "Compare to the Surface Pro 10",
  "4": "Clippy, show me the Xbox controller",
  "5": "Clippy, bring up Building 7",
};
window.addEventListener("keydown", (e) => {
  // ignore hotkeys while typing in the text box
  if (document.activeElement === document.getElementById("typebox")) return;
  if (HOTKEYS[e.key]) handleCommand(HOTKEYS[e.key]);
});

// ---- Text input (always works, no mic/network needed) ----
const typeform = document.getElementById("typeform");
const typebox = document.getElementById("typebox");
if (typeform) {
  typeform.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = typebox.value.trim();
    if (text) {
      handleCommand(text);
      typebox.value = "";
    }
  });
}
