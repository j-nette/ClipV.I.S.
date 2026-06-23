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

// ---- TTS: try server (Azure), fall back to browser speech synthesis ----
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

  // Browser fallback
  if ("speechSynthesis" in window) {
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.onend = resolve;
      speechSynthesis.speak(u);
    });
  }
}

// ---- Speech recognition (Web Speech API) ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizing = false;
let recognition = null;

if (SR) {
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    handleCommand(text);
  };
  recognition.onend = () => {
    recognizing = false;
    els.listen.classList.remove("active");
  };
  recognition.onerror = (e) => {
    recognizing = false;
    els.listen.classList.remove("active");
    console.warn("speech error:", e.error);
    // Surface the reason so it isn't a silent on/off.
    const reasons = {
      "not-allowed": "Mic blocked — allow microphone in the browser address bar 🔒",
      "service-not-allowed": "Mic blocked by browser/OS privacy settings",
      "no-speech": "Didn't hear anything — try again, speak after clicking",
      "audio-capture": "No microphone found",
      "network": "Speech service needs internet (use Chrome/Edge)",
      "aborted": "Listening stopped",
    };
    els.heard.textContent = reasons[e.error] || `speech error: ${e.error}`;
    setStatus("idle");
  };
} else {
  els.listen.textContent = "🎙️ Mic unsupported — use 1/2/3";
}

let micGranted = false;
async function ensureMic() {
  if (micGranted) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop()); // we only needed the permission
    micGranted = true;
    return true;
  } catch (err) {
    els.heard.textContent = "Mic permission denied — click the 🔒 in the address bar → allow microphone";
    return false;
  }
}

els.listen.addEventListener("click", async () => {
  if (!recognition) return;
  if (recognizing) {
    recognition.stop();
    return;
  }
  if (!(await ensureMic())) return;
  try {
    recognizing = true;
    els.listen.classList.add("active");
    setStatus("listening");
    els.heard.textContent = "listening…";
    recognition.start();
  } catch (err) {
    // start() throws if called too soon after a previous session
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
