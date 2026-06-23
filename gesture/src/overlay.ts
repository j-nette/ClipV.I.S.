import type { HandLandmarks } from './types';
import type { HandTrackerFrame } from './handTracker';

/** MediaPipe hand skeleton edges (pairs of landmark indices). */
const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

/**
 * Transparent canvas overlay that draws the live hand skeleton. Dev/debug aid —
 * default-off for the real demo (`?debug`). Mirrors X to match the selfie view
 * the user sees of their own hand.
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

  draw(frame: HandTrackerFrame): void {
    const { width: w, height: h } = this.canvas;
    this.ctx.clearRect(0, 0, w, h);
    for (const hand of frame.hands) this.drawHand(hand, w, h);
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawHand(hand: HandLandmarks, w: number, h: number): void {
    const px = (i: number) => (1 - hand[i].x) * w; // mirror X for selfie view
    const py = (i: number) => hand[i].y * h;

    // Connections.
    this.ctx.strokeStyle = 'rgba(34, 211, 238, 0.85)';
    this.ctx.lineWidth = 3 * devicePixelRatio;
    this.ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      this.ctx.moveTo(px(a), py(a));
      this.ctx.lineTo(px(b), py(b));
    }
    this.ctx.stroke();

    // Landmarks.
    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    const r = 4 * devicePixelRatio;
    for (let i = 0; i < hand.length; i++) {
      this.ctx.beginPath();
      this.ctx.arc(px(i), py(i), r, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
  }
}
