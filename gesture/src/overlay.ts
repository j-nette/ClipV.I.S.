import type { HandLandmarks, Landmark } from './types';
import type { HandTrackerFrame } from './handTracker';
import { LM } from './gestureDetector';

/** Per-hand gesture tint, parallel to a frame's hands. */
export interface HandTint {
  pinch: boolean;
  point: boolean;
}

/** Fingertips we render as glowing dots: thumb, index, middle. */
const FINGERTIPS = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP];

const COLOR_IDLE = '34, 211, 238'; // cyan
const COLOR_POINT = '56, 189, 248'; // bright blue
const COLOR_PINCH = '34, 197, 94'; // green

/** Dot radius bounds (px, pre-DPR). */
const MIN_RADIUS = 6;
const MAX_RADIUS = 34;
/** Apparent hand size (normalized palm length) → dot radius in px. */
const SIZE_GAIN = 90;
/** Per-finger depth (landmark z) influence — pushing a fingertip forward grows it. */
const DEPTH_GAIN = 4;

/**
 * Transparent canvas overlay that marks the user's hands with glowing dots at
 * the thumb / index / middle fingertips. Each dot scales with how close that
 * hand (and finger) is to the camera, so reaching toward the screen enlarges it.
 * Tinted green on pinch / blue on point / cyan idle. Mirrors X for the selfie view.
 */
export class Overlay {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * devicePixelRatio;
  };

  /** Draw the frame: fingertip dots per hand, tinted by its gesture state. */
  draw(frame: HandTrackerFrame, tints?: HandTint[]): void {
    const { width: w, height: h } = this.canvas;
    this.ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < frame.hands.length; i++) {
      const t = tints?.[i];
      const rgb = t?.pinch ? COLOR_PINCH : t?.point ? COLOR_POINT : COLOR_IDLE;
      this.drawFingertips(frame.hands[i], w, h, rgb);
    }
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawFingertips(hand: HandLandmarks, w: number, h: number, rgb: string): void {
    // Apparent hand size (palm length in normalized coords) → bigger when closer.
    const palm = dist2D(hand[LM.WRIST], hand[LM.MIDDLE_MCP]);
    const basePx = palm * SIZE_GAIN * devicePixelRatio;

    for (const i of FINGERTIPS) {
      const p = hand[i];
      const x = (1 - p.x) * w; // mirror X for selfie view
      const y = p.y * h;
      // Per-finger depth: smaller (more negative) z = closer to camera = larger.
      const depthScale = 1 - p.z * DEPTH_GAIN;
      const r = clamp(
        basePx * depthScale,
        MIN_RADIUS * devicePixelRatio,
        MAX_RADIUS * devicePixelRatio,
      );
      this.glowDot(x, y, r, rgb);
    }
  }

  /** A soft dot of light: glowing halo with a bright white core. */
  private glowDot(x: number, y: number, r: number, rgb: string): void {
    const ctx = this.ctx;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    grad.addColorStop(0.35, `rgba(${rgb}, 0.9)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
  }
}

function dist2D(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
