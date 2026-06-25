import * as THREE from 'three';
import {
  ORB_STORAGE_KEY,
  createStoredOrb,
  loadStoredOrbs,
  saveStoredOrbs,
  type StoredOrb,
} from '../../../info/data/orbStore';
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
  private static readonly BOX_IDS = ['box-left', 'box-center', 'box-right'] as const;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly raycaster = new THREE.Raycaster();
  private readonly infoLayer: HTMLDivElement;
  private readonly editorEl: HTMLFormElement;
  private readonly titleInput: HTMLInputElement;
  private readonly descriptionInput: HTMLTextAreaElement;

  private readonly boxes: THREE.Mesh[] = [];
  private readonly orbs: OrbView[] = [];
  private highlighted: THREE.Mesh | null = null;
  private grabbed: THREE.Mesh | null = null;
  private hoveredOrb: OrbView | null = null;
  private editingOrb: OrbView | null = null;
  private creatingOrb = false;
  /** Last object the user interacted with — the target for rotate/zoom. */
  private focused: THREE.Mesh | null = null;

  private readonly minScale = 0.3;
  private readonly maxScale = 3;

  /** Plane the grabbed box slides along while dragging (parallel to camera). */
  private readonly dragPlane = new THREE.Plane();
  private readonly dragPoint = new THREE.Vector3();
  /** Offset from the grabbed point to the box center, so it's held where pinched. */
  private readonly grabOffset = new THREE.Vector3();
  /** Scratch vector for the rotation pivot (held point). */
  private readonly pivot = new THREE.Vector3();
  /** Scratch vector for the camera's view direction (depth push/pull axis). */
  private readonly camForward = new THREE.Vector3();
  private readonly orbPoint = new THREE.Vector3();
  private readonly labelPoint = new THREE.Vector3();
  /** Previous anchor world point while dragging the whole assembly (3-finger). */
  private assemblyPrev: THREE.Vector3 | null = null;

  private readonly baseColor = new THREE.Color(0x3b82f6);
  private readonly hoverColor = new THREE.Color(0x22d3ee);
  private readonly grabColor = new THREE.Color(0x22c55e);
  private readonly orbColor = new THREE.Color(0xf59e0b);
  private readonly orbHoverColor = new THREE.Color(0xfef08a);

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.infoLayer = document.createElement('div');
    this.infoLayer.className = 'info-layer';
    container.appendChild(this.infoLayer);

    const editor = this.createEditor();
    this.editorEl = editor.form;
    this.titleInput = editor.titleInput;
    this.descriptionInput = editor.descriptionInput;

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
      box.userData.objectId = StandaloneScene.BOX_IDS[i] ?? `box-${i}`;
      box.position.set((i - 1) * 2.2, 0, 0);
      this.boxes.push(box);
      this.scene.add(box);
    }

    this.reloadOrbsFromStorage();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('storage', this.onStorage);
    this.animate();
  }

  handle(e: GestureEvent): void {
    switch (e.type) {
      case 'point':
        this.setPointTarget(e.ndc);
        break;
      case 'point_end':
        this.setHighlight(null);
        this.setOrbHover(null);
        break;
      case 'orb_create':
        this.createOrbAt(e.ndc);
        break;
      case 'pinch_start': {
        if (e.scope === 'assembly') {
          this.beginAssemblyDrag(e.ndc);
          break;
        }
        // Pinch only manipulates when it actually lands on a box. A miss leaves
        // no target, so the ensuing translate/rotate/zoom do nothing.
        const hit = this.pickBox(e.ndc);
        this.focused = hit;
        if (hit) this.beginDrag(hit, e.ndc);
        break;
      }
      case 'pinch_move':
        if (e.scope === 'assembly') this.moveAssembly(e.ndc, e.depth);
        else if (this.grabbed) this.moveDrag(e.ndc, e.depth);
        break;
      case 'pinch_end':
        if (e.scope === 'assembly') this.endAssemblyDrag();
        else this.endDrag();
        break;
      case 'rotate_start':
        // Object rotation targets the box under the left hand; assembly needs none.
        if (e.scope !== 'assembly') {
          const hit = this.pickBox(e.ndc);
          if (hit) this.focused = hit;
        }
        break;
      case 'rotate':
        if (e.scope === 'assembly') this.rotateAssembly(e.q);
        else this.applyRotate(e.q);
        break;
      case 'rotate_end':
        break;
      case 'scale_start':
        // Object scale targets the box under the pinch midpoint; assembly = all.
        if (e.scope !== 'assembly') {
          const hit = this.pickBox(e.ndc);
          if (hit) this.focused = hit;
        }
        break;
      case 'zoom':
        if (e.scope === 'assembly') this.zoomAssembly(e.delta);
        else this.applyZoom(e.delta);
        break;
      case 'scale_end':
        break;
    }
  }

  // --- interaction helpers -------------------------------------------------

  private pickBoxHit(ndc: NDC): BoxHit | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hits = this.raycaster.intersectObjects(this.boxes, false);
    const hit = hits[0];
    if (!hit) return null;
    return { mesh: hit.object as THREE.Mesh, point: hit.point.clone() };
  }

  private pickBox(ndc: NDC): THREE.Mesh | null {
    return this.pickBoxHit(ndc)?.mesh ?? null;
  }

  private pickOrb(ndc: NDC): OrbView | null {
    if (this.orbs.length === 0) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    const hits = this.raycaster.intersectObjects(
      this.orbs.map((orb) => orb.mesh),
      false,
    );
    const mesh = hits[0]?.object as THREE.Mesh | undefined;
    return this.orbs.find((orb) => orb.mesh === mesh) ?? null;
  }

  private setPointTarget(ndc: NDC): void {
    const orb = this.pickOrb(ndc);
    this.setOrbHover(orb);
    this.setHighlight(orb ? null : this.pickBox(ndc));
  }

  private setHighlight(box: THREE.Mesh | null): void {
    if (this.highlighted === box) return;
    if (this.highlighted && this.highlighted !== this.grabbed) {
      this.paint(this.highlighted, this.baseColor);
    }
    this.highlighted = box;
    if (box && box !== this.grabbed) this.paint(box, this.hoverColor);
  }

  private beginDrag(box: THREE.Mesh, ndc: NDC): void {
    this.grabbed = box;
    this.focused = box;
    this.paint(box, this.grabColor);
    // Drag plane: passes through the box, faces the camera.
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, box.position);
    // Preserve where on the object the pinch landed, so it's held at that point
    // (not snapped to its center) for the rest of the drag.
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      this.grabOffset.copy(box.position).sub(this.dragPoint);
    } else {
      this.grabOffset.set(0, 0, 0);
    }
  }

  private moveDrag(ndc: NDC, depth = 0): void {
    if (!this.grabbed) return;
    // Push/pull along the camera's view axis sinks the whole drag plane to a new
    // depth, so the held point (and X/Y mapping) carry over seamlessly.
    if (depth !== 0) {
      this.dragPlane.translate(this.camera.getWorldDirection(this.camForward).multiplyScalar(depth));
    }
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      this.grabbed.position.copy(this.dragPoint).add(this.grabOffset);
    }
  }

  private endDrag(): void {
    if (!this.grabbed) return;
    const wasHighlighted = this.grabbed === this.highlighted;
    this.paint(this.grabbed, wasHighlighted ? this.hoverColor : this.baseColor);
    this.grabbed = null;
  }

  /** Rotate the focused object by a delta quaternion. No-op if no object is focused. */
  private applyRotate(q: Quat): void {
    if (!this.focused) return;
    const dq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    // While grabbed, rotate about the pinch point (the held world point) rather
    // than the object's center. pivot = position - grabOffset; rotating the
    // offset keeps that point fixed and preserves the grip for dragging.
    if (this.grabbed === this.focused) {
      this.pivot.copy(this.focused.position).sub(this.grabOffset);
      this.grabOffset.applyQuaternion(dq);
      this.focused.position.copy(this.pivot).add(this.grabOffset);
    }
    this.focused.quaternion.premultiply(dq);
  }

  /** Scale the focused object (clamped). No-op if no object is focused. */
  private applyZoom(delta: number): void {
    if (!this.focused) return;
    const s = clamp(this.focused.scale.x * (1 + delta), this.minScale, this.maxScale);
    this.focused.scale.setScalar(s);
  }

  // --- assembly (three-finger) manipulation: all boxes move as a group ------

  /** Centroid of all box positions — the assembly's pivot. */
  private assemblyCenter(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(0, 0, 0);
    for (const b of this.boxes) out.add(b.position);
    return out.divideScalar(this.boxes.length || 1);
  }

  private beginAssemblyDrag(ndc: NDC): void {
    const center = this.assemblyCenter();
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.dragPlane.setFromNormalAndCoplanarPoint(normal, center);
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    this.assemblyPrev = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.dragPlane, this.assemblyPrev)) {
      this.assemblyPrev.copy(center);
    }
  }

  /** Translate every box by the anchor's frame-to-frame world delta. */
  private moveAssembly(ndc: NDC, depth = 0): void {
    if (!this.assemblyPrev) return;
    // Sink the drag plane along the camera axis; the resulting frame delta then
    // carries the depth push/pull into every box alongside the X/Y motion.
    if (depth !== 0) {
      this.dragPlane.translate(this.camera.getWorldDirection(this.camForward).multiplyScalar(depth));
    }
    this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      const dx = this.dragPoint.x - this.assemblyPrev.x;
      const dy = this.dragPoint.y - this.assemblyPrev.y;
      const dz = this.dragPoint.z - this.assemblyPrev.z;
      for (const b of this.boxes) b.position.x += dx, (b.position.y += dy), (b.position.z += dz);
      this.assemblyPrev.copy(this.dragPoint);
    }
  }

  private endAssemblyDrag(): void {
    this.assemblyPrev = null;
  }

  /** Rotate the whole assembly about its centroid by a delta quaternion. */
  private rotateAssembly(q: Quat): void {
    const dq = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    const center = this.assemblyCenter(this.pivot);
    const offset = new THREE.Vector3();
    for (const b of this.boxes) {
      offset.copy(b.position).sub(center).applyQuaternion(dq);
      b.position.copy(center).add(offset);
      b.quaternion.premultiply(dq);
    }
  }

  /** Scale the whole assembly about its centroid (spacing + each box, clamped). */
  private zoomAssembly(delta: number): void {
    const f = 1 + delta;
    const center = this.assemblyCenter(this.pivot);
    const offset = new THREE.Vector3();
    for (const b of this.boxes) {
      offset.copy(b.position).sub(center).multiplyScalar(f);
      b.position.copy(center).add(offset);
      b.scale.setScalar(clamp(b.scale.x * f, this.minScale, this.maxScale));
    }
  }

  private paint(box: THREE.Mesh, color: THREE.Color): void {
    const mat = box.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.emissive.copy(color).multiplyScalar(0.15);
  }

  // --- render loop ---------------------------------------------------------

  private createOrbAt(ndc: NDC): void {
    if (this.editingOrb || this.creatingOrb) return;
    const hit = this.pickBoxHit(ndc);
    if (!hit) return;
    const localPoint = hit.mesh.worldToLocal(hit.point.clone());
    const objectId = this.getObjectId(hit.mesh);
    const orb = this.addOrb(
      createStoredOrb(
        { x: hit.point.x, y: hit.point.y, z: hit.point.z },
        {
          objectId,
          localPosition: { x: localPoint.x, y: localPoint.y, z: localPoint.z },
        },
      ),
    );
    this.openEditor(orb, true);
  }

  private addOrb(data: StoredOrb): OrbView {
    const material = new THREE.MeshStandardMaterial({
      color: this.orbColor.clone(),
      emissive: this.orbColor.clone().multiplyScalar(0.35),
      roughness: 0.25,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 20), material);
    const parent = this.findObjectById(data.objectId);
    if (parent && data.localPosition) {
      mesh.position.set(data.localPosition.x, data.localPosition.y, data.localPosition.z);
      parent.add(mesh);
    } else {
      mesh.position.set(data.position.x, data.position.y, data.position.z);
      this.scene.add(mesh);
    }

    const label = document.createElement('div');
    label.className = 'orb-card';
    const title = document.createElement('div');
    title.className = 'orb-title';
    const body = document.createElement('div');
    body.className = 'orb-body';
    label.append(title, body);
    this.infoLayer.appendChild(label);

    const orb: OrbView = { anchor: parent, data, mesh, label, title, body };
    this.updateOrbLabel(orb);
    this.orbs.push(orb);
    return orb;
  }

  private removeOrb(orb: OrbView): void {
    const index = this.orbs.indexOf(orb);
    if (index >= 0) this.orbs.splice(index, 1);
    if (this.hoveredOrb === orb) this.hoveredOrb = null;
    if (this.editingOrb === orb) this.editingOrb = null;
    orb.mesh.parent?.remove(orb.mesh);
    orb.mesh.geometry.dispose();
    (orb.mesh.material as THREE.MeshStandardMaterial).dispose();
    orb.label.remove();
  }

  private reloadOrbsFromStorage(): void {
    this.clearOrbViews();
    for (const orb of loadStoredOrbs()) {
      this.addOrb(orb);
    }
  }

  private clearOrbViews(): void {
    for (const orb of [...this.orbs]) {
      this.removeOrb(orb);
    }
    this.hoveredOrb = null;
    this.editingOrb = null;
    this.creatingOrb = false;
    this.editorEl.classList.remove('show');
    this.editorEl.reset();
  }

  private persistOrbs(): void {
    saveStoredOrbs(
      this.orbs.map((orb) => {
        const worldPosition = orb.mesh.getWorldPosition(this.orbPoint);
        const anchor = orb.anchor;
        const localPosition = anchor
          ? {
              x: orb.mesh.position.x,
              y: orb.mesh.position.y,
              z: orb.mesh.position.z,
            }
          : undefined;
        return {
          ...orb.data,
          position: {
            x: worldPosition.x,
            y: worldPosition.y,
            z: worldPosition.z,
          },
          objectId: anchor ? this.getObjectId(anchor) : undefined,
          localPosition,
        };
      }),
    );
  }

  private findObjectById(objectId: string | undefined): THREE.Mesh | null {
    if (!objectId) return null;
    return this.boxes.find((box) => this.getObjectId(box) === objectId) ?? null;
  }

  private getObjectId(mesh: THREE.Mesh): string {
    const objectId = mesh.userData.objectId;
    if (typeof objectId !== 'string') throw new Error('scene object is missing a stable object id');
    return objectId;
  }

  private setOrbHover(orb: OrbView | null): void {
    if (this.hoveredOrb === orb) return;
    if (this.hoveredOrb) {
      this.hoveredOrb.label.classList.remove('expanded');
      this.paintOrb(this.hoveredOrb, this.orbColor);
    }
    this.hoveredOrb = orb;
    if (orb) {
      orb.label.classList.add('expanded');
      this.paintOrb(orb, this.orbHoverColor);
    }
  }

  private paintOrb(orb: OrbView, color: THREE.Color): void {
    const mat = orb.mesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.emissive.copy(color).multiplyScalar(0.35);
  }

  private updateOrbLabel(orb: OrbView): void {
    orb.title.textContent = orb.data.title.trim() || 'Untitled Orb';
    orb.body.textContent = orb.data.description.trim() || 'No description yet.';
  }

  private createEditor(): EditorElements {
    const form = document.createElement('form');
    form.className = 'orb-editor';
    form.innerHTML = `
      <h2>Orb details</h2>
      <p>Save a title and description for this point. Hover over the orb later with your index finger to expand it.</p>
      <label for="orb-title">Title</label>
      <input id="orb-title" name="title" maxlength="80" placeholder="Scene marker" />
      <label for="orb-description">Description</label>
      <textarea id="orb-description" name="description" maxlength="400" placeholder="What should this orb remember?"></textarea>
      <div class="orb-editor-actions">
        <button type="submit">Save orb</button>
        <button type="button">Cancel</button>
      </div>
    `;
    const titleInput = form.querySelector('input[name="title"]');
    const descriptionInput = form.querySelector('textarea[name="description"]');
    const cancelButton = form.querySelector('button[type="button"]');
    if (!(titleInput instanceof HTMLInputElement)) throw new Error('orb title input missing');
    if (!(descriptionInput instanceof HTMLTextAreaElement)) {
      throw new Error('orb description input missing');
    }
    if (!(cancelButton instanceof HTMLButtonElement)) throw new Error('orb cancel button missing');
    form.addEventListener('submit', this.onEditorSubmit);
    cancelButton.addEventListener('click', this.onEditorCancel);
    this.infoLayer.appendChild(form);
    return { form, titleInput, descriptionInput };
  }

  private openEditor(orb: OrbView, creating: boolean): void {
    this.editingOrb = orb;
    this.creatingOrb = creating;
    this.titleInput.value = orb.data.title;
    this.descriptionInput.value = orb.data.description;
    this.editorEl.classList.add('show');
    window.requestAnimationFrame(() => this.titleInput.focus());
  }

  private closeEditor(): void {
    this.editingOrb = null;
    this.creatingOrb = false;
    this.editorEl.classList.remove('show');
    this.editorEl.reset();
  }

  private readonly onEditorSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    if (!this.editingOrb) return;
    this.editingOrb.data.title = this.titleInput.value.trim();
    this.editingOrb.data.description = this.descriptionInput.value.trim();
    this.updateOrbLabel(this.editingOrb);
    this.persistOrbs();
    this.closeEditor();
  };

  private readonly onEditorCancel = (): void => {
    if (this.creatingOrb && this.editingOrb) {
      this.removeOrb(this.editingOrb);
      this.persistOrbs();
    }
    this.closeEditor();
  };

  private updateOrbLabels(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    for (const orb of this.orbs) {
      if (this.hoveredOrb !== orb) {
        orb.label.style.display = 'none';
        continue;
      }
      orb.mesh.getWorldPosition(this.labelPoint).project(this.camera);
      const visible = this.labelPoint.z > -1 && this.labelPoint.z < 1;
      if (!visible) {
        orb.label.style.display = 'none';
        continue;
      }
      const x = (this.labelPoint.x * 0.5 + 0.5) * width;
      const y = (-this.labelPoint.y * 0.5 + 0.5) * height;
      orb.label.style.display = 'block';
      orb.label.style.left = `${x}px`;
      orb.label.style.top = `${y}px`;
    }
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    for (const box of this.boxes) {
      // Idle spin only while a box is untouched; manual rotate takes over once focused.
      if (box !== this.grabbed && box !== this.focused) box.rotation.y += 0.004;
    }
    this.updateOrbLabels();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key !== ORB_STORAGE_KEY) return;
    this.reloadOrbsFromStorage();
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('storage', this.onStorage);
    this.editorEl.removeEventListener('submit', this.onEditorSubmit);
    const cancelButton = this.editorEl.querySelector('button[type="button"]');
    if (cancelButton instanceof HTMLButtonElement) {
      cancelButton.removeEventListener('click', this.onEditorCancel);
    }
    this.renderer.dispose();
    this.infoLayer.remove();
    this.container.removeChild(this.renderer.domElement);
  }
}

interface OrbView {
  anchor: THREE.Mesh | null;
  data: StoredOrb;
  mesh: THREE.Mesh;
  label: HTMLDivElement;
  title: HTMLDivElement;
  body: HTMLDivElement;
}

interface BoxHit {
  mesh: THREE.Mesh;
  point: THREE.Vector3;
}

interface EditorElements {
  form: HTMLFormElement;
  titleInput: HTMLInputElement;
  descriptionInput: HTMLTextAreaElement;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
