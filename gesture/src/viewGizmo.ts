import * as THREE from 'three';
import type { Quat } from './types';

/**
 * CAD-style orientation widgets for the presenter (main display ONLY): a labelled
 * view cube (top-left) and a separate XYZ axis triad (bottom-left) that rotate
 * with the model so you always know which face is front / top / right — like the
 * gizmos in Maya and SolidWorks. Rendered with an ORTHOGRAPHIC camera so the
 * labels/arrows keep a constant size (no perspective blow-up near the camera).
 *
 * Deliberately NOT used in the hologram follower: the pinwheel renders the scene
 * four times, so a corner gizmo would appear 4× and break the clean,
 * product-only Pepper's-Ghost illusion. It's display-only (non-interactive).
 */
const GIZMO_PX = 120;
const MARGIN_PX = 16;
/** Orthographic half-extents, sized per widget so each fills its own viewport. */
const CUBE_EXTENT = 0.95; // a unit cube's half-diagonal is ≈ 0.87
const AXES_EXTENT = 2.2; // axis labels sit at ≈ 2.05

export class ViewGizmo {
  // Two separate widgets (CAD convention), each in its own LEFT corner so they
  // stay clear of the top-right status label.
  private readonly cubeScene = new THREE.Scene();
  private readonly axesScene = new THREE.Scene();
  // One ortho camera per widget so the cube isn't shrunk to fit the longer axes.
  private readonly cubeCamera = makeOrtho(CUBE_EXTENT);
  private readonly axesCamera = makeOrtho(AXES_EXTENT);
  private readonly cubeRoot = new THREE.Group();
  private readonly axesRoot = new THREE.Group();
  private readonly size = new THREE.Vector2();

  constructor(cameraDir: THREE.Vector3) {
    // View the gizmos from the same direction as the main camera, so their
    // orientation reads identically to the model on screen.
    for (const cam of [this.cubeCamera, this.axesCamera]) {
      cam.position.copy(cameraDir).multiplyScalar(8);
      cam.lookAt(0, 0, 0);
    }

    this.cubeRoot.add(buildCube());
    this.cubeScene.add(this.cubeRoot);

    addAxis(this.axesRoot, new THREE.Vector3(1, 0, 0), 0xff5566, 'X');
    addAxis(this.axesRoot, new THREE.Vector3(0, 1, 0), 0x55dd66, 'Y');
    addAxis(this.axesRoot, new THREE.Vector3(0, 0, 1), 0x4f9dff, 'Z');
    this.axesScene.add(this.axesRoot);
  }

  /** Mirror the model's current orientation onto both widgets. */
  update(q: Quat): void {
    this.cubeRoot.quaternion.set(q.x, q.y, q.z, q.w);
    this.axesRoot.quaternion.copy(this.cubeRoot.quaternion);
  }

  /** Draw the cube (top-left) and the axis triad (bottom-left). */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.getSize(this.size);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.drawAt(renderer, this.cubeScene, this.cubeCamera, MARGIN_PX, this.size.y - GIZMO_PX - MARGIN_PX); // top-left
    this.drawAt(renderer, this.axesScene, this.axesCamera, MARGIN_PX, MARGIN_PX); // bottom-left
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.autoClear = prevAutoClear;
  }

  private drawAt(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    x: number,
    y: number,
  ): void {
    const s = GIZMO_PX;
    renderer.setViewport(x, y, s, s);
    renderer.setScissor(x, y, s, s);
    renderer.setScissorTest(true);
    renderer.clearDepth(); // float over the main image, never occluded by it
    renderer.render(scene, camera);
  }

  dispose(): void {
    for (const scene of [this.cubeScene, this.axesScene]) {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
    }
  }
}

function makeOrtho(extent: number): THREE.OrthographicCamera {
  return new THREE.OrthographicCamera(-extent, extent, extent, -extent, 0.1, 50);
}

function addAxis(root: THREE.Group, dir: THREE.Vector3, color: number, label: string): void {
  root.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0, 0), 1.4, color, 0.34, 0.24));
  const sprite = labelSprite(label, color);
  sprite.position.copy(dir).multiplyScalar(1.8);
  root.add(sprite);
}

/** A 1×1×1 cube with each face named after the view it presents to the camera. */
function buildCube(): THREE.Mesh {
  // BoxGeometry material order: +X, -X, +Y, -Y, +Z, -Z.
  const faces = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK'];
  const mats = faces.map(
    (label) =>
      new THREE.MeshBasicMaterial({ map: faceTexture(label), transparent: true, opacity: 0.92 }),
  );
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mats);
  cube.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(cube.geometry),
      new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.55 }),
    ),
  );
  return cube;
}

function faceTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#0e1626';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#2b3b57';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 122, 122);
    ctx.fillStyle = '#cfe6ff';
    ctx.font = 'bold 21px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function labelSprite(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = 'bold 44px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 32, 34);
  }
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.5, 0.5, 0.5);
  return sprite;
}
