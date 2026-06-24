// Copies MediaPipe wasm runtime into public/ and downloads the hand landmarker
// model, so gesture runs fully offline (no CDN dependency at demo time).
// Run via: npm run setup:assets  (also runs automatically on postinstall).
import { cp, mkdir, access, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const wasmSrc = join(root, '..', 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, '..', 'public', 'mediapipe', 'wasm');
const modelDir = join(root, '..', 'public', 'models');
const modelPath = join(modelDir, 'hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    console.warn('[assets] wasm source missing — run npm install first.');
    return;
  }
  await mkdir(wasmDest, { recursive: true });
  await cp(wasmSrc, wasmDest, { recursive: true });
  console.log('[assets] copied wasm runtime → public/mediapipe/wasm');
}

async function downloadModel() {
  if (await exists(modelPath)) {
    const { size } = await stat(modelPath);
    if (size > 0) {
      console.log('[assets] model already present — skipping download');
      return;
    }
  }
  await mkdir(modelDir, { recursive: true });
  console.log('[assets] downloading hand_landmarker.task …');
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(modelPath));
  console.log('[assets] saved → public/models/hand_landmarker.task');
}

await copyWasm();
await downloadModel();
