/**
 * On-device speech-to-text using Whisper via transformers.js (TS port of
 * voice/stt.js). Corp-network-proof: the model runs locally in the browser, no
 * cloud speech service — this is what lets voice work when the browser's Web
 * Speech API is blocked on the corp network. Used as the automatic fallback in
 * voiceUI when Web Speech errors with `network`/`service-not-allowed`.
 *
 * The transformers.js library + model are loaded from a CDN at runtime (kept
 * out of the Vite build via @vite-ignore), matching the original voice app.
 */

type StatusFn = (msg: string) => void;

/** A pipeline callable: audio Float32 → { text }. Loosely typed (untyped CDN module). */
type Transcriber = (audio: Float32Array) => Promise<{ text?: string }>;

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';
const WHISPER_MODEL = 'Xenova/whisper-tiny.en';

let transcriber: Transcriber | null = null;
let loading: Promise<Transcriber> | null = null;

async function getTranscriber(onStatus?: StatusFn): Promise<Transcriber> {
  if (transcriber) return transcriber;
  if (!loading) {
    loading = (async () => {
      onStatus?.('loading speech model… (first time, ~30s)');
      const mod = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as {
        pipeline: (task: string, model: string) => Promise<Transcriber>;
        env: { allowLocalModels: boolean };
      };
      mod.env.allowLocalModels = false;
      transcriber = await mod.pipeline('automatic-speech-recognition', WHISPER_MODEL);
      return transcriber;
    })();
  }
  return loading;
}

export interface LocalRecorder {
  start(): Promise<void>;
  stop(): Promise<string>;
}

/** Record from the mic until stop() is called, then resolve transcribed text. */
export function createLocalRecorder(onStatus?: StatusFn): LocalRecorder {
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;

  return {
    async start(): Promise<void> {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Warm up the model in parallel with recording.
      void getTranscriber(onStatus);
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.start();
      onStatus?.('listening…');
    },
    async stop(): Promise<string> {
      return new Promise<string>((resolve, reject) => {
        if (!mediaRecorder) return resolve('');
        mediaRecorder.onstop = async () => {
          try {
            stream?.getTracks().forEach((t) => t.stop());
            onStatus?.('transcribing…');
            const blob = new Blob(chunks, { type: 'audio/webm' });
            const audio = await blobToFloat32(blob);
            const model = await getTranscriber(onStatus);
            const out = await model(audio);
            resolve((out.text || '').trim());
          } catch (err) {
            reject(err);
          }
        };
        mediaRecorder.stop();
      });
    },
  };
}

/** Decode recorded audio to 16kHz mono Float32 (what Whisper expects). */
async function blobToFloat32(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuf);
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  // Mix down to mono.
  const a = decoded.getChannelData(0);
  const b = decoded.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}
