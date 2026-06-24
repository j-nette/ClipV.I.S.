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
    } else if (data.intent === "manipulate" && window.clipvisGesture) {
      applyManipulation(data.action);
    }

    await speak(data.narration);
  } catch (err) {
    console.error(err);
    els.output.textContent = JSON.stringify({ error: String(err) }, null, 2);
  } finally {
    setStatus("idle");
  }
}

// Voice-driven model manipulation -> the same API the gesture team uses.
function applyManipulation(action) {
  const g = window.clipvisGesture;
  switch (action) {
    case "bigger": case "zoom_in": g.scaleBy(1.3); break;
    case "smaller": case "zoom_out": g.scaleBy(0.77); break;
    case "rotate_left": g.rotate(0, -0.5, 0); break;
    case "rotate_right": g.rotate(0, 0.5, 0); break;
    case "move_left": g.translate(-0.6, 0, 0); break;
    case "move_right": g.translate(0.6, 0, 0); break;
    case "move_up": g.translate(0, 0.6, 0); break;
    case "move_down": g.translate(0, -0.6, 0); break;
    case "reset": g.reset(); break;
  }
}

// ---- TTS: charming voice for Clippy, with a picker (defaults to British) ----
let preferredVoice = null;
const voiceSelect = document.getElementById("voiceSelect");
const SAVED_VOICE = localStorage.getItem("clippyVoice");

function rankVoice(v) {
  // Higher = more preferred. Favor British neural/natural voices for charm.
  let s = 0;
  if (/en-GB/i.test(v.lang)) s += 100;
  if (/United Kingdom|British|en-GB/i.test(v.name)) s += 50;
  if (/Natural|Online|Neural/i.test(v.name)) s += 40;            // Edge neural voices
  if (/Ryan|Sonia|Libby|Thomas|George|Arthur/i.test(v.name)) s += 30; // nice UK names
  if (/en-/i.test(v.lang)) s += 5;
  return s;
}

function populateVoices() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return;

  // Default pick: saved choice, else best-ranked (British) voice.
  const sorted = [...voices].sort((a, b) => rankVoice(b) - rankVoice(a));
  preferredVoice =
    (SAVED_VOICE && voices.find((v) => v.name === SAVED_VOICE)) || sorted[0];

  if (voiceSelect) {
    voiceSelect.innerHTML = "";
    // List English voices first (British at top), then the rest.
    const english = sorted.filter((v) => /en-/i.test(v.lang));
    const others = sorted.filter((v) => !/en-/i.test(v.lang));
    for (const v of [...english, ...others]) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      if (preferredVoice && v.name === preferredVoice.name) opt.selected = true;
      voiceSelect.appendChild(opt);
    }
  }
}

if ("speechSynthesis" in window) {
  populateVoices();
  speechSynthesis.onvoiceschanged = populateVoices;
}

if (voiceSelect) {
  voiceSelect.addEventListener("change", () => {
    const v = speechSynthesis.getVoices().find((x) => x.name === voiceSelect.value);
    if (v) {
      preferredVoice = v;
      localStorage.setItem("clippyVoice", v.name);
      // Preview the new voice.
      speak("Hello! I'm Clippy, at your service.");
    }
  });
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
      u.rate = 1.0;    // relaxed, charming pace
      u.pitch = 1.05;  // warm
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
