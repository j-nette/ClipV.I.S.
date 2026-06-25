import { gestureBus } from './eventBus';
import { quatFromAxisAngle } from './quat';
import type { NDC, ViewName, ManipulationScope } from './types';

/**
 * Phase 0 input source: drives the exact same GestureEvents the camera pipeline
 * will later emit, but from the keyboard. This is the always-on fallback that
 * ships even if computer vision is cut on Wednesday.
 *
 * Manipulation (both the standalone scene and the hologram presenter):
 *   P (hold)      → point at the cursor; release → point_end
 *   G (toggle)    → pinch_start / pinch_end (press to grab, press again to drop)
 *   B (toggle)    → object ↔ assembly scope (mimics the three-finger pinch)
 *   Arrow keys    → move the cursor (nudges pinch_move while grabbed)
 *   Q / E         → rotate yaw (left / right)
 *   R / F         → rotate pitch (up / down)
 *   C / V         → rotate roll (twist)
 *   Z / X         → zoom in / out  (mouse wheel also zooms)
 *
 * Hologram model features (consumed by the presenter; no-ops in the standalone
 * scene). NOTE: these intentionally avoid E/R/F/←/→ from the handoff because
 * those already mean rotate/cursor above — see HANDOFF concern notes.
 *   O             → explode toggle (0 ↔ 1)
 *   M             → render mode: solid → wireframe → xray
 *   Space / T     → turntable toggle
 *   [ / ]         → snap to previous / next canonical view
 *   1 / 2 / 3 / 4 → snap to front / iso / top / back
 *   K             → focus toggle (isolate the part at the cursor, then clear)
 *
 * The cursor is a virtual pointer in NDC space, since there's no fingertip yet.
 */
const SNAP_VIEWS: ViewName[] = ['front', 'iso', 'right', 'top'];

export class KeyboardFallback {
  private cursor: NDC = { x: 0, y: 0 };
  private pointing = false;
  private pinching = false;
  private explodeOn = false;
  private turntableOn = false;
  private focusOn = false;
  private viewIndex = 0;
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
      case 'o':
        this.explodeOn = !this.explodeOn;
        gestureBus.emit({ type: 'explode', factor: this.explodeOn ? 1 : 0 });
        break;
      case 'm':
        gestureBus.emit({ type: 'render_mode', dir: 'next' });
        break;
      case ' ':
      case 't':
        this.turntableOn = !this.turntableOn;
        gestureBus.emit({ type: 'turntable', on: this.turntableOn });
        break;
      case '[':
        this.snap(-1);
        break;
      case ']':
        this.snap(1);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        this.viewIndex = Number(e.key) - 1;
        gestureBus.emit({ type: 'snap_view', name: SNAP_VIEWS[this.viewIndex] });
        break;
      case 'k':
        this.focusOn = !this.focusOn;
        gestureBus.emit({ type: 'focus', ndc: this.focusOn ? { ...this.cursor } : null });
        break;
      default:
        return;
    }
    if (
      [
        'arrowleft', 'arrowright', 'arrowup', 'arrowdown',
        'p', 'g', 'b', 'q', 'e', 'r', 'f', 'c', 'v', 'z', 'x',
        'o', 'm', 't', ' ', '[', ']', '1', '2', '3', '4', 'k',
      ].includes(e.key.toLowerCase())
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

  private snap(dir: 1 | -1): void {
    this.viewIndex = (this.viewIndex + dir + SNAP_VIEWS.length) % SNAP_VIEWS.length;
    gestureBus.emit({ type: 'snap_view', name: SNAP_VIEWS[this.viewIndex] });
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
