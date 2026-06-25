import * as THREE from 'three';
import { Clippy } from './shared/clippy';

/**
 * Presenter-only Clippy: the mascot rendered as a fixed corner widget (like the
 * view cube / axis triad), NOT as an object in the model's world space.
 *
 * Why a widget:
 *  - it shows on the main display only (the hologram follower never builds it),
 *  - it's small and tucked in the bottom-right corner,
 *  - it has its own fixed camera, so it never rotates/scales with the model or
 *    the view — it's a screen-space fixture, not part of camera space.
 *
 * It still reacts to `ModelState.clippy` (idle / wave / thinking / …); the
 * presenter just passes that emote in each frame.
 */
const CLIPPY_PX = 150;
const MARGIN_PX = 16;
/** Lift above the bottom edge so it clears the "Open hologram window" button. */
const BOTTOM_OFFSET_PX = 64;

export class ClippyOverlay {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 20);
  private readonly clippy = new Clippy();
  private readonly clock = new THREE.Clock();
  private readonly size = new THREE.Vector2();
  private elapsed = 0;

  constructor() {
    // Fixed front view, so Clippy faces the user regardless of the model's view.
    this.camera.position.set(0, 0.1, 3.2);
    this.camera.lookAt(0, 0.05, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x4fd1ff, 12, 20);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);

    this.clippy.object.position.set(0, 0, 0);
    this.scene.add(this.clippy.object);
  }

  /** Drive the emote + advance the idle/bob animation. */
  update(emote: string): void {
    this.elapsed += this.clock.getDelta();
    this.clippy.setEmote(emote);
    this.clippy.update(this.elapsed, 0);
  }

  /** Draw Clippy into the bottom-right corner of the renderer's canvas. */
  render(renderer: THREE.WebGLRenderer): void {
    renderer.getSize(this.size);
    const s = CLIPPY_PX;
    const x = this.size.x - s - MARGIN_PX; // right
    const y = BOTTOM_OFFSET_PX; // above the bottom button (viewport y is from bottom)

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setViewport(x, y, s, s);
    renderer.setScissor(x, y, s, s);
    renderer.setScissorTest(true);
    renderer.clearDepth(); // float over the main image, never occluded by it
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Stamp Clippy into the bottom-right corner of a render target (one per
   * hologram view), on top of whatever is already drawn there. Uses the render
   * target's own viewport/scissor so it sits in RT pixels (no canvas pixel-ratio
   * juggling); the caller leaves the model already rendered into `rt`.
   */
  stampInto(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, sizePx: number): void {
    const w = rt.width;
    const h = rt.height;
    const m = Math.round(w * 0.03);
    rt.viewport.set(w - sizePx - m, m, sizePx, sizePx);
    rt.scissor.set(w - sizePx - m, m, sizePx, sizePx);
    rt.scissorTest = true;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt); // re-apply the corner viewport/scissor
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
    rt.viewport.set(0, 0, w, h);
    rt.scissor.set(0, 0, w, h);
    rt.scissorTest = false;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  }
}
