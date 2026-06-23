import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandLandmarks } from './types';

/**
 * MediaPipe Hands wrapper. Loads the model + wasm from local public/ assets
 * (no CDN at demo time), runs a per-frame detection loop against a <video>, and
 * pushes results to a callback. Phase 1 only *tracks* — gesture detection comes
 * in Phase 2 and consumes the landmarks this emits.
 */
export interface HandTrackerOptions {
  /** Base path to the copied wasm runtime (served from public/). */
  wasmBase?: string;
  /** Path to the hand_landmarker.task model (served from public/). */
  modelPath?: string;
  /** Max hands to track. 1 keeps it fast; 2 enables two-hand zoom/rotate later. */
  numHands?: number;
}

export type HandsListener = (result: HandTrackerFrame) => void;

export interface HandTrackerFrame {
  /** Landmarks per detected hand (empty when no hand is visible). */
  hands: HandLandmarks[];
  /** Source video timestamp in ms. */
  timestampMs: number;
}

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;
  private readonly listeners = new Set<HandsListener>();

  constructor(private readonly opts: HandTrackerOptions = {}) {}

  /** Load wasm + model. Must be awaited before start(). */
  async init(): Promise<void> {
    const {
      wasmBase = '/mediapipe/wasm',
      modelPath = '/models/hand_landmarker.task',
      numHands = 2,
    } = this.opts;

    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands,
    });
  }

  onResults(listener: HandsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Begin the detection loop against a playing video element. */
  start(video: HTMLVideoElement): void {
    if (!this.landmarker) throw new Error('HandTracker.init() must be awaited before start()');
    this.video = video;
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    this.landmarker?.close();
    this.landmarker = null;
    this.listeners.clear();
  }

  private loop = (): void => {
    if (!this.running || !this.video || !this.landmarker) return;
    this.rafId = requestAnimationFrame(this.loop);

    const video = this.video;
    // Only run detection on a fresh frame.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    const timestampMs = performance.now();
    let result: HandLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch {
      return; // transient frame error — skip and try next frame
    }

    const hands: HandLandmarks[] = result.landmarks.map((hand) =>
      hand.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );

    const frame: HandTrackerFrame = { hands, timestampMs };
    for (const listener of this.listeners) listener(frame);
  };
}
