import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { HandLandmarks } from './types';
import { HandSmoother, type SmoothingOptions } from './smoothing';

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
  /** Min confidence to first detect a hand (0..1). */
  minDetectionConfidence?: number;
  /** Min confidence the hand is still present (0..1). Lower = fewer dropouts. */
  minPresenceConfidence?: number;
  /** Min confidence to keep tracking frame-to-frame (0..1). Lower = fewer dropouts. */
  minTrackingConfidence?: number;
  /** One-Euro landmark smoothing (kills jitter without much lag). */
  smoothing?: SmoothingOptions;
}

export type HandsListener = (result: HandTrackerFrame) => void;

export interface HandTrackerFrame {
  /** Landmarks per detected hand (empty when no hand is visible). */
  hands: HandLandmarks[];
  /** Handedness label per hand ('Left' | 'Right'), parallel to `hands`. */
  labels: string[];
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
  private readonly smoother: HandSmoother;

  constructor(private readonly opts: HandTrackerOptions = {}) {
    this.smoother = new HandSmoother(opts.smoothing);
  }

  /** Load wasm + model. Must be awaited before start(). */
  async init(): Promise<void> {
    const {
      wasmBase = '/mediapipe/wasm',
      modelPath = '/models/hand_landmarker.task',
      numHands = 2,
      minDetectionConfidence = 0.5,
      minPresenceConfidence = 0.4,
      minTrackingConfidence = 0.4,
    } = this.opts;

    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands,
      minHandDetectionConfidence: minDetectionConfidence,
      minHandPresenceConfidence: minPresenceConfidence,
      minTrackingConfidence,
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

    const labels: string[] = result.handedness.map(
      (h, i) => h[0]?.categoryName ?? `hand${i}`,
    );

    // Smooth the raw landmarks per hand (One-Euro) — the Tasks API does no
    // temporal filtering, so without this the points (and the pinch distance
    // derived from them) jitter, which both looks shaky and flickers the pinch.
    const smoothed: HandLandmarks[] = result.landmarks.map((hand, i) =>
      this.smoother.smooth(labels[i] ?? `hand${i}`, hand.map((p) => ({ x: p.x, y: p.y, z: p.z })), timestampMs),
    );
    this.smoother.retain(new Set(labels));

    const frame: HandTrackerFrame = { hands: smoothed, labels, timestampMs };
    for (const listener of this.listeners) listener(frame);
  };
}
