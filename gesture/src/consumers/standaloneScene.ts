import * as THREE from 'three';
import type { Consumer, GestureEvent, NDC, Quat } from '../types';

/**
 * Self-contained Three.js scene for the laptop screen. A few boxes that can be
 * highlighted (point) and grabbed/dragged (pinch). This is the default consumer
 * and makes the whole gesture module runnable with no camera and no hologram/.
 *
 * Coordinate model: events carry NDC in [-1, 1]. We raycast from the camera
 * through that NDC point to find / move boxes — exactly what HologramAdapter
 * will do later, so behaviour transfers.
 */
export class StandaloneScene implements Consumer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();

  private readonly boxes: THREE.Mesh[] = [];
  private highlighted: THREE.Mesh | null = null;
  private grabbed: THREE.Mesh | null = null;
  /** Last object the user interacted with — the target for rotate/zoom. */
  private focused: THREE.Mesh | null = null;

  private readonly minScale = 0.3;
  private readonly maxScale = 3;

  /** Plane the grabbed box slides along while dragging (parallel to camera). */
  private readonly dragPlane = new THREE.Plane();
  private readonly dragPoint = new THREE.Vector3();

  private readonly baseColor = new THREE.Color(0x3b82f6);
  private readonly hoverColor = new THREE.Color(0x22d3ee);
  private readonly grabColor = new THREE.Color(0x22c55e);

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );
    this.camera.position.set(0, 0, 6);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    // Three boxes laid out left-to-right.
    const geo = new THREE.BoxGeometry(1.2, 1.2, 1.2);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: this.baseColor.clone(),
        emissive: this.baseColor.clone().multiplyScalar(0.15),
        roughness: 0.4,
        metalness: 0.1,
      });
      const box = new THREE.Mesh(geo, mat);
      box.position.set((i - 1) * 2.2, 0, 0);
      this.boxes.push(box);
      this.scene.add(box);
    }

    window.addEventListener('resize', this.onResize);
    this.animate();
  }

  handle(e: GestureEvent): void {
    switch (e.type) {
      case 'point':
        this.setHighlight(this.pick(e.ndc));
        break;
      case 'point_end':
        this.setHighlight(null);
        break;
      case 'pinch_start': {
        const hit = this.pick(e.ndc);
        if (hit) this.beginDrag(hit, e.ndc);
        break;
      }
      case 'pinch_move':
        if (this.grabbed) this.moveDrag(e.ndc);
        break;
      case 'pinch_end':
        this.endDrag();
        break;
      case 'rotate':
        this.applyRotate(e.q);
        break;
      case 'zoom':
        this.applyZoom(e.delta);
        break;
    }
  }

  // --- interaction helpers -------------------------------------------------

  private pick(ndc: NDC): THREE.Mesh | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hits = this.raycaster.intersectObjects(this.boxes, false);
    return (hits[0]?.object as THREE.Mesh) ?? null;
  }

  private setHighlight(box: THREE.Mesh | null): void {
    if (this.highlighted === box) return;
    if (this.highlighted && this.highlighted !== this.grabbed) {
      this.paint(this.highlighted, this.baseColor);
    }
    this.highlighted = box;
    if (box) this.focused = box;
    if (box && box !== this.grabbed) this.paint(box, this.hoverColor);
  }

  private beginDrag(box: THREE.Mesh, ndc: NDC): void {
    this.grabbed = box;
    this.focused = box;
    this.paint(box, this.grabColor);
    // Drag plane: passes through the box, faces the camera.
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, box.position);
    void ndc;
  }

  private moveDrag(ndc: NDC): void {
    if (!this.grabbed) return;
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      this.grabbed.position.copy(this.dragPoint);
    }
  }

  private endDrag(): void {
    if (!this.grabbed) return;
    const wasHighlighted = this.grabbed === this.highlighted;
    this.paint(this.grabbed, wasHighlighted ? this.hoverColor : this.baseColor);
    this.grabbed = null;
  }

  /** Rotate the focused object (or all boxes if none) by a delta quaternion. */
  private applyRotate(q: Quat): void {
    const dq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const targets = this.focused ? [this.focused] : this.boxes;
    for (const t of targets) {
      t.quaternion.premultiply(dq);
    }
  }

  /** Scale the focused object (or all boxes if none), clamped. */
  private applyZoom(delta: number): void {
    const targets = this.focused ? [this.focused] : this.boxes;
    const factor = 1 + delta;
    for (const t of targets) {
      const s = clamp(t.scale.x * factor, this.minScale, this.maxScale);
      t.scale.setScalar(s);
    }
  }

  private paint(box: THREE.Mesh, color: THREE.Color): void {
    const mat = box.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.emissive.copy(color).multiplyScalar(0.15);
  }

  // --- render loop ---------------------------------------------------------

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    for (const box of this.boxes) {
      // Idle spin only while a box is untouched; manual rotate takes over once focused.
      if (box !== this.grabbed && box !== this.focused) box.rotation.y += 0.004;
    }
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
