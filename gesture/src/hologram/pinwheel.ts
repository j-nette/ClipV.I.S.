import * as THREE from 'three';

/**
 * True four-camera volumetric pinwheel for the Pepper's Ghost pyramid.
 *
 * Unlike the "same view ×4" stamp, this renders the scene from four ring
 * cameras (front / right / back / left) into four render targets, then
 * composites them into four rotated quadrants — so each face of the pyramid
 * shows the correct angle as you walk around it.
 *
 * Only the hologram window pays the 4× render cost. Tuning knobs (quad size,
 * gap, ring height) are live-adjustable and persisted, mapping onto the
 * physical pyramid. Ring radius comes from the shared state's `zoom`.
 */
const RT_SIZE = 1024;
const TUNE_KEY = 'clipvis-holo-tune';

interface Tuning {
  size: number;
  gap: number;
  height: number;
}

const DEFAULT_TUNING: Tuning = { size: 0.3, gap: 40, height: 1.0 };

// Ring camera angles → quadrant placement (top / right / bottom / left),
// each rotated so its base points outward toward the pyramid face.
const ANGLES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const LAYOUT = [
  { x: 0, y: 1, rot: 0 },
  { x: 1, y: 0, rot: -Math.PI / 2 },
  { x: 0, y: -1, rot: Math.PI },
  { x: -1, y: 0, rot: Math.PI / 2 },
];

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
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    for (let i = 0; i < 4; i++) {
      this.cameras.push(new THREE.PerspectiveCamera(45, 1, 0.1, 100));
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
  render(ringRadius: number): void {
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
    }
    this.renderer.setRenderTarget(null);

    const W = window.innerWidth;
    const H = window.innerHeight;
    this.overlayCam.left = -W / 2;
    this.overlayCam.right = W / 2;
    this.overlayCam.top = H / 2;
    this.overlayCam.bottom = -H / 2;
    this.overlayCam.updateProjectionMatrix();

    const s = Math.min(W, H) * this.tuning.size;
    const d = this.tuning.gap + s / 2;
    this.quads.forEach((q, i) => {
      q.scale.set(s, s, 1);
      q.position.set(LAYOUT[i].x * d, LAYOUT[i].y * d, 0);
      q.rotation.z = LAYOUT[i].rot;
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
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 4 : 1;
    switch (e.key) {
      case '[': this.tuning.size = Math.max(0.1, this.tuning.size - 0.01 * step); break;
      case ']': this.tuning.size = Math.min(0.49, this.tuning.size + 0.01 * step); break;
      case '-': this.tuning.gap = Math.max(-200, this.tuning.gap - 4 * step); break;
      case '=': this.tuning.gap = Math.min(400, this.tuning.gap + 4 * step); break;
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
      `size  [ ]   ${this.tuning.size.toFixed(2)}\n` +
      `gap   - =   ${this.tuning.gap.toFixed(0)}px\n` +
      `tilt  ; '   ${this.tuning.height.toFixed(2)}\n` +
      `reset 0`;
  }
}
