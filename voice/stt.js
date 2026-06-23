// On-device speech-to-text using Whisper via transformers.js.
// Corp-network-proof: the model runs locally in the browser, no cloud speech service.
// Used as an automatic fallback when the browser's Web Speech API is blocked.
let transcriber = null;
let loading = null;

async function getTranscriber(onStatus) {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = (async () => {
      onStatus?.("loading speech model… (first time, ~30s)");
      const { pipeline, env } = await import(
        "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2"
      );
      env.allowLocalModels = false;
      transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
      return transcriber;
    })();
  }
  return loading;
}

// Record from the mic until stop() is called, then resolve with transcribed text.
export function createLocalRecorder(onStatus) {
  let mediaRecorder = null;
  let chunks = [];
  let stream = null;

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Warm up the model in parallel with recording.
      getTranscriber(onStatus);
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.start();
      onStatus?.("listening…");
    },
    async stop() {
      return new Promise((resolve, reject) => {
        if (!mediaRecorder) return resolve("");
        mediaRecorder.onstop = async () => {
          try {
            stream.getTracks().forEach((t) => t.stop());
            onStatus?.("transcribing…");
            const blob = new Blob(chunks, { type: "audio/webm" });
            const audio = await blobToFloat32(blob);
            const model = await getTranscriber(onStatus);
            const out = await model(audio);
            resolve((out.text || "").trim());
          } catch (err) {
            reject(err);
          }
        };
        mediaRecorder.stop();
      });
    },
  };
}

// Decode recorded audio to 16kHz mono Float32 (what Whisper expects).
async function blobToFloat32(blob) {
  const arrayBuf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuf);
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  // mix down to mono
  const a = decoded.getChannelData(0);
  const b = decoded.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}
