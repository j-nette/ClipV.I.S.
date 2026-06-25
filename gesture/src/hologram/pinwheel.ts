import * as THREE from 'three';
import type { ClippyOverlay } from '../clippyOverlay';

/**
 * True four-camera volumetric pinwheel for the Pepper's Ghost pyramid.
 *
 * Unlike the "same view ×4" stamp, this renders the scene from four ring
 * cameras (front / right / back / left) into four render targets, then
 * composites them into four rotated quadrants — so each face of the pyramid
 * shows the correct angle as you walk around it.
 *
 * Only the hologram window pays the 4× render cost. The four views are
 * composited into a 3×3 cross on a centred SQUARE display — each view is exactly
 * one third of the side (top / bottom / left / right cells). Ring radius comes
 * from the shared state's `zoom`; `;`/`'` tilt the ring cameras.
 */
const RT_SIZE = 1024;
const TUNE_KEY = 'clipvis-holo-tune';
/** Clippy's corner size inside each view's render target. */
const CLIPPY_RT_PX = Math.round(RT_SIZE * 0.34);

interface Tuning {
  /** Ring-camera elevation (look-down tilt onto the model). */
  height: number;
}

const DEFAULT_TUNING: Tuning = { height: 1.0 };

// Ring camera angles → quadrant placement (top / right / bottom / left),
// each rotated so its base points outward toward the pyramid face.
const ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const LAYOUT = [
  { x: 0, y: 1, rot: 0 },
  { x: 1, y: 0, rot: -Math.PI / 2 },
  { x: 0, y: -1, rot: Math.PI },
  { x: -1, y: 0, rot: Math.PI / 2 },
];

/** Rotate the whole composite (the cross) by this angle; shrinks to fit if needed. */
const DISPLAY_ROTATION_DEG = 45;
const DISPLAY_ROTATION_RAD = (DISPLAY_ROTATION_DEG * Math.PI) / 180;

/** Largest |x| or |y| any quad corner reaches once the cross is rotated by `theta`. */
function compositeExtent(cell: number, theta: number): number {
  const rot = (x: number, y: number, c: number, s: number) => ({ x: x * c - y * s, y: x * s + y * c });
  const tc = Math.cos(theta);
  const ts = Math.sin(theta);
  const h = cell / 2;
  let max = 0;
  for (const L of LAYOUT) {
    const center = rot(L.x * cell, L.y * cell, tc, ts);
    const bc = Math.cos(L.rot + theta);
    const bs = Math.sin(L.rot + theta);
    for (const sx of [-h, h]) {
      for (const sy of [-h, h]) {
        const corner = rot(sx, sy, bc, bs);
        max = Math.max(max, Math.abs(center.x + corner.x), Math.abs(center.y + corner.y));
      }
    }
  }
  return max;
}

export class Pinwheel {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly cameras: THREE.PerspectiveCamera[] = [];
  private readonly rts: THREE.WebGLRenderTarget[] = [];
  private readonly overlayScene = new THREE.Scene();
  private readonly overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quads: THREE.Mesh[] = [];
  private readonly target = new THREE.Vector3(0, 0, 0);
  private tuning: Tuning = { ...DEFAULT_TUNING };
  private readonly hud: HTMLElement;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: THREE.Scene,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    for (let i = 0; i < 4; i++) {
      this.cameras.push(new THREE.PerspectiveCamera(45, 1, 0.3, 50));
      const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { samples: 4 });
      this.rts.push(rt);
      const quad = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true }),
      );
      this.overlayScene.add(quad);
      this.quads.push(quad);
    }

    this.loadTuning();
    this.hud = this.createHud();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  /** Render one frame: four ring cameras → four RTs → four quadrants. */
  render(ringRadius: number, clippy?: ClippyOverlay): void {
    const r = ringRadius;
    const h = this.tuning.height;

    for (let i = 0; i < 4; i++) {
      const a = ANGLES[i];
      const cam = this.cameras[i];
      cam.position.set(
        this.target.x + Math.sin(a) * r,
        this.target.y + h,
        this.target.z + Math.cos(a) * r,
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(this.target);
      cam.aspect = 1;
      cam.updateProjectionMatrix();
      this.renderer.setRenderTarget(this.rts[i]);
      this.renderer.render(this.scene, cam);
      // Clippy fixture in the bottom-right of every view (like the presenter).
      clippy?.stampInto(this.renderer, this.rts[i], CLIPPY_RT_PX);
    }
    this.renderer.setRenderTarget(null);

    // Square display split into a 3×3 grid; the four views fill the cross
    // (top / bottom / left / right cells), each exactly one third of the side.
    const side = Math.min(window.innerWidth, window.innerHeight);
    this.overlayCam.left = -side / 2;
    this.overlayCam.right = side / 2;
    this.overlayCam.top = side / 2;
    this.overlayCam.bottom = -side / 2;
    this.overlayCam.updateProjectionMatrix();

    const s = side / 3; // one grid cell
    // Rotate the whole composite by DISPLAY_ROTATION, shrinking it to fit if the
    // rotated cross would spill past the square edges.
    const theta = DISPLAY_ROTATION_RAD;
    const fit = Math.min(1, side / 2 / compositeExtent(s, theta));
    const cell = s * fit;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    this.quads.forEach((q, i) => {
      const px = LAYOUT[i].x * cell;
      const py = LAYOUT[i].y * cell;
      q.scale.set(cell, cell, 1);
      q.position.set(px * cos - py * sin, px * sin + py * cos, 0);
      q.rotation.z = LAYOUT[i].rot + theta;
    });
    this.renderer.render(this.overlayScene, this.overlayCam);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.rts.forEach((rt) => rt.dispose());
    this.renderer.dispose();
    this.hud.remove();
  }

  private readonly onResize = (): void => {
    // Render into a centred SQUARE (the largest that fits), letter-boxed black.
    const side = Math.min(window.innerWidth, window.innerHeight);
    this.renderer.setSize(side, side, true);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 4 : 1;
    switch (e.key) {
      case ';': this.tuning.height = Math.max(-1, this.tuning.height - 0.05 * step); break;
      case "'": this.tuning.height = Math.min(3, this.tuning.height + 0.05 * step); break;
      case '0': this.tuning = { ...DEFAULT_TUNING }; break;
      default: return;
    }
    this.saveTuning();
    this.updateHud();
  };

  private loadTuning(): void {
    try {
      this.tuning = { ...this.tuning, ...JSON.parse(localStorage.getItem(TUNE_KEY) || '{}') };
    } catch {
      /* keep defaults */
    }
  }

  private saveTuning(): void {
    localStorage.setItem(TUNE_KEY, JSON.stringify(this.tuning));
  }

  private createHud(): HTMLElement {
    const hud = document.createElement('div');
    hud.style.cssText =
      'position:fixed;top:12px;right:12px;font:12px/1.6 Segoe UI,sans-serif;color:#7fe9ff;' +
      'background:rgba(0,0,0,.6);padding:10px 12px;border-radius:10px;white-space:pre;z-index:10;';
    document.body.appendChild(hud);
    this.updateHudOn(hud);
    return hud;
  }

  private updateHud(): void {
    this.updateHudOn(this.hud);
  }

  private updateHudOn(hud: HTMLElement): void {
    hud.textContent =
      `PYRAMID (follower)\n` +
      `layout  3×3 cross (1/3 each)\n` +
      `tilt  ; '   ${this.tuning.height.toFixed(2)}\n` +
      `reset 0`;
  }
}
