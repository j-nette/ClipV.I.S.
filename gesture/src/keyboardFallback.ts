import { gestureBus } from './eventBus';
import { quatFromAxisAngle } from './quat';
import type { NDC, ManipulationScope } from './types';

/**
 * Phase 0 input source: drives the exact same GestureEvents the camera pipeline
 * will later emit, but from the keyboard. This is the always-on fallback that
 * ships even if computer vision is cut on Wednesday.
 *
 * Controls:
 *   P (hold)      → point at the cursor; release → point_end
 *   G (toggle)    → pinch_start / pinch_end (press to grab, press again to drop)
 *   B (toggle)    → object ↔ assembly scope (mimics the three-finger pinch)
 *   Arrow keys    → move the cursor (nudges pinch_move while grabbed)
 *   Q / E         → rotate yaw (left / right)
 *   R / F         → rotate pitch (up / down)
 *   C / V         → rotate roll (twist)
 *   Z / X         → zoom in / out  (mouse wheel also zooms)
 *
 * The cursor is a virtual pointer in NDC space, since there's no fingertip yet.
 */
export class KeyboardFallback {
  private cursor: NDC = { x: 0, y: 0 };
  private pointing = false;
  private pinching = false;
  private scope: ManipulationScope = 'object';
  private readonly step = 0.06;
  private readonly rotStep = 0.1;
  private readonly zoomStep = 0.08;

  start(): () => void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('wheel', this.onWheel);
    };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key.toLowerCase()) {
      case 'p':
        if (!this.pointing) {
          this.pointing = true;
          gestureBus.emit({ type: 'point', ndc: { ...this.cursor } });
        }
        break;
      case 'g':
        this.togglePinch();
        break;
      case 'b':
        this.scope = this.scope === 'object' ? 'assembly' : 'object';
        break;
      case 'arrowleft':
        this.moveCursor(-this.step, 0);
        break;
      case 'arrowright':
        this.moveCursor(this.step, 0);
        break;
      case 'arrowup':
        this.moveCursor(0, this.step);
        break;
      case 'arrowdown':
        this.moveCursor(0, -this.step);
        break;
      case 'q':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, -this.rotStep), scope: this.scope });
        break;
      case 'e':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, this.rotStep), scope: this.scope });
        break;
      case 'r':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, -this.rotStep), scope: this.scope });
        break;
      case 'f':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 1, y: 0, z: 0 }, this.rotStep), scope: this.scope });
        break;
      case 'c':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, -this.rotStep), scope: this.scope });
        break;
      case 'v':
        gestureBus.emit({ type: 'rotate', q: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, this.rotStep), scope: this.scope });
        break;
      case 'z':
        gestureBus.emit({ type: 'zoom', delta: this.zoomStep, scope: this.scope });
        break;
      case 'x':
        gestureBus.emit({ type: 'zoom', delta: -this.zoomStep, scope: this.scope });
        break;
      default:
        return;
    }
    if (
      ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'p', 'g', 'b', 'q', 'e', 'r', 'f', 'c', 'v', 'z', 'x'].includes(
        e.key.toLowerCase(),
      )
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key.toLowerCase() === 'p' && this.pointing) {
      this.pointing = false;
      gestureBus.emit({ type: 'point_end' });
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Wheel up (negative deltaY) = zoom in.
    const delta = e.deltaY < 0 ? this.zoomStep : -this.zoomStep;
    gestureBus.emit({ type: 'zoom', delta, scope: this.scope });
  };

  private togglePinch(): void {
    if (this.pinching) {
      this.pinching = false;
      gestureBus.emit({ type: 'pinch_end', scope: this.scope });
    } else {
      this.pinching = true;
      gestureBus.emit({ type: 'pinch_start', ndc: { ...this.cursor }, scope: this.scope });
    }
  }

  private moveCursor(dx: number, dy: number): void {
    this.cursor = {
      x: clamp(this.cursor.x + dx, -1, 1),
      y: clamp(this.cursor.y + dy, -1, 1),
    };
    if (this.pinching) {
      gestureBus.emit({ type: 'pinch_move', ndc: { ...this.cursor }, scope: this.scope });
    } else if (this.pointing) {
      gestureBus.emit({ type: 'point', ndc: { ...this.cursor } });
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
