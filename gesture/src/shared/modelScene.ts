/**
 * Shared scene content for BOTH windows of the presenter → hologram pipeline.
 *
 * This builds the THREE.Scene, lights, and a `pivot` group holding the model
 * (and an optional compare model) out of separately-addressable PARTS — so
 * exploded view and part isolation actually mean something. It deliberately
 * does NOT own a renderer or a camera: each role drives its own.
 *
 *   - Presenter: one PerspectiveCamera + WebGLRenderer (see hologramPresenter).
 *   - Hologram:  four ring cameras → four render targets → four quadrants
 *                (see hologram/pinwheel).
 *
 * `applyState()` is the single place state is pushed into the scene graph;
 * both roles call it. Zoom is the one field a renderer applies itself (camera
 * distance vs. ring radius), so it is intentionally absent here.
 *
 * Models are multi-part placeholders today. Real per-part `.glb` heroes plug in
 * at `buildInto()` — export assemblies as glTF Binary so parts survive (STL
 * collapses to one mesh and explode/focus degrade to a single "whole" part).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Quat } from '../types';
import type { ModelState } from './modelState';

/** A material we can recolor / wireframe / fade, across placeholder + glTF materials. */
type TunableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  wireframe?: boolean;
};

interface PartSpec {
  id: string;
  geo: () => THREE.BufferGeometry;
  color: number;
  /** Home position, in the model group's local space. */
  pos: [number, number, number];
}

interface PartView {
  /** The object moved on explode (a placeholder mesh, or one glTF mesh). */
  root: THREE.Object3D;
  /** Every material under `root`, cloned so per-part fade/ghost can't bleed. */
  mats: TunableMaterial[];
  baseColors: THREE.Color[];
  /** Local resting position (explode displaces from here). */
  originalPos: THREE.Vector3;
  /** Local resting orientation (per-part rotation composes on top of this). */
  originalQuat: THREE.Quaternion;
  /** Local resting scale (per-part scale multiplies this). */
  originalScale: THREE.Vector3;
  /** Unit outward direction from the model center, in world space at build time. */
  dirWorld: THREE.Vector3;
  /** How far this part already sits from the model center (drives proportional spread). */
  offsetLen: number;
  /** Inverse of the parent's world matrix at build time (world → parent-local). */
  parentInv: THREE.Matrix4;
  partId: string;
}

// Exploded-view tuning (ported from the standalone pyramid spike).
/** Multiplies each part's own offset from center — amplifies natural layering. */
const EXPLODE_SPREAD = 1.0;
/** Minimum uniform outward push so central/coincident parts still clear. */
const EXPLODE_GAP = 0.3;
/** Easing per frame toward the explode target (0..1). */
const EXPLODE_SPEED = 0.1;

/** Colour of the edge outline drawn around a pinch-grabbed part. */
const GRAB_OUTLINE_COLOR = 0x7cffb0;

const _explodeA = new THREE.Vector3();
const _explodeB = new THREE.Vector3();
const _deltaInv = new THREE.Matrix4();
const _deltaA = new THREE.Vector3();
const _deltaB = new THREE.Vector3();
const _partQuat = new THREE.Quaternion();

/** Create a PartView; explode fields are baked later by registerExplode(). */
function newPartView(
  root: THREE.Object3D,
  mats: TunableMaterial[],
  baseColors: THREE.Color[],
  partId: string,
): PartView {
  return {
    root,
    mats,
    baseColors,
    originalPos: root.position.clone(),
    originalQuat: root.quaternion.clone(),
    originalScale: root.scale.clone(),
    dirWorld: new THREE.Vector3(),
    offsetLen: 0,
    parentInv: new THREE.Matrix4(),
    partId,
  };
}

const PART_SPECS: Record<string, PartSpec[]> = {
  clippy: [
    { id: 'clip', geo: () => new THREE.TorusGeometry(0.7, 0.12, 16, 48), color: 0xffe45e, pos: [0, 0, 0] },
    { id: 'eye_l', geo: () => new THREE.SphereGeometry(0.14, 20, 20), color: 0xffffff, pos: [-0.22, 0.24, 0.55] },
    { id: 'eye_r', geo: () => new THREE.SphereGeometry(0.14, 20, 20), color: 0xffffff, pos: [0.22, 0.24, 0.55] },
  ],
  surface_pro_11: [
    { id: 'kickstand', geo: () => new THREE.BoxGeometry(2.0, 1.3, 0.04), color: 0x2a3550, pos: [0, 0, -0.06] },
    { id: 'chassis', geo: () => new THREE.BoxGeometry(2.2, 1.5, 0.06), color: 0x4fd1ff, pos: [0, 0, 0] },
    { id: 'screen', geo: () => new THREE.BoxGeometry(2.0, 1.3, 0.02), color: 0x9fe7ff, pos: [0, 0, 0.06] },
  ],
  surface_pro_10: [
    { id: 'kickstand', geo: () => new THREE.BoxGeometry(2.0, 1.3, 0.04), color: 0x2a2a55, pos: [0, 0, -0.06] },
    { id: 'chassis', geo: () => new THREE.BoxGeometry(2.2, 1.5, 0.06), color: 0x8a7dff, pos: [0, 0, 0] },
    { id: 'screen', geo: () => new THREE.BoxGeometry(2.0, 1.3, 0.02), color: 0xc4bcff, pos: [0, 0, 0.06] },
  ],
  xbox_controller: [
    { id: 'body', geo: () => new THREE.TorusGeometry(0.7, 0.32, 16, 48), color: 0x52ff8f, pos: [0, 0, 0] },
    { id: 'stick_l', geo: () => new THREE.SphereGeometry(0.18, 20, 20), color: 0xffffff, pos: [-0.35, 0.18, 0.2] },
    { id: 'stick_r', geo: () => new THREE.SphereGeometry(0.18, 20, 20), color: 0xffffff, pos: [0.35, -0.05, 0.2] },
    { id: 'dpad', geo: () => new THREE.BoxGeometry(0.3, 0.3, 0.15), color: 0x222831, pos: [0, 0.05, 0.25] },
  ],
  building_7: [
    { id: 'floor_1', geo: () => new THREE.BoxGeometry(1.4, 0.8, 1.4), color: 0xffd166, pos: [0, -0.8, 0] },
    { id: 'floor_2', geo: () => new THREE.BoxGeometry(1.3, 0.8, 1.3), color: 0xffdf8e, pos: [0, 0, 0] },
    { id: 'floor_3', geo: () => new THREE.BoxGeometry(1.2, 0.8, 1.2), color: 0xfff0bf, pos: [0, 0.8, 0] },
  ],
};

function defaultPart(): PartSpec[] {
  return [{ id: 'whole', geo: () => new THREE.BoxGeometry(1.6, 1.6, 1.6), color: 0x4fd1ff, pos: [0, 0, 0] }];
}

export class ModelScene {
  readonly scene = new THREE.Scene();
  /** Orientation is applied here; both groups rotate together. */
  readonly pivot = new THREE.Group();

  private readonly modelGroup = new THREE.Group();
  private readonly compareGroup = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private parts: PartView[] = [];
  private hoverId: string | null = null;
  /** Part currently outlined as grabbed, plus the edge lines drawn for it. */
  private grabbedId: string | null = null;
  private readonly grabLines: THREE.LineSegments[] = [];
  /** Smoothed explode displacement actually applied (eases toward state.explode). */
  private explodeAmount = 0;
  /** Bumped on every setModels() so stale async glTF loads are discarded. */
  private loadToken = 0;

  private model = '';
  private compareTo: string | null = null;

  constructor() {
    this.scene.background = new THREE.Color(0x000000);

    this.scene.add(new THREE.AmbientLight(0x404a6b, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const rimA = new THREE.PointLight(0x4fd1ff, 40, 20);
    rimA.position.set(-4, 2, -3);
    this.scene.add(rimA);
    const rimB = new THREE.PointLight(0xff5d8f, 30, 20);
    rimB.position.set(4, 1, -4);
    this.scene.add(rimB);

    this.pivot.add(this.modelGroup);
    this.pivot.add(this.compareGroup);
    this.scene.add(this.pivot);
  }

  /** All pickable part roots (across model + compare groups). */
  get pickables(): THREE.Object3D[] {
    return this.parts.map((p) => p.root);
  }

  /** (Re)build the displayed model(s). Call when `model`/`compareTo` changes. */
  setModels(model: string, compareTo: string | null): void {
    const token = ++this.loadToken;
    this.clearGroup(this.modelGroup);
    this.clearGroup(this.compareGroup);
    this.parts = [];

    this.buildInto(this.modelGroup, model, token);
    this.modelGroup.position.x = compareTo ? -1.6 : 0;

    // The old part meshes (and any grab outline on them) were just disposed.
    this.grabbedId = null;
    this.grabLines.length = 0;

    if (compareTo) {
      this.buildInto(this.compareGroup, compareTo, token);
      this.compareGroup.position.x = 1.6;
      this.compareGroup.visible = true;
    } else {
      this.compareGroup.visible = false;
    }

    this.model = model;
    this.compareTo = compareTo;
  }

  /** Push state into the scene graph. Zoom is applied by the renderer. */
  applyState(s: ModelState): void {
    if (s.model !== this.model || s.compareTo !== this.compareTo) {
      this.setModels(s.model, s.compareTo);
    }
    this.pivot.quaternion.copy(toThree(s.orientation));
    this.pivot.position.set(s.position.x, s.position.y, s.position.z);
    // Ease the actual displacement toward the target so explode animates.
    this.explodeAmount += (s.explode - this.explodeAmount) * EXPLODE_SPEED;
    this.applyExplode(this.explodeAmount);
    this.applyPartOffsets(s.partOffsets);
    this.applyPartRotations(s.partRotations);
    this.applyPartScales(s.partScales);
    this.refreshMaterials(s);
  }

  /** All pickable part ids currently in the model. */
  hasPart(partId: string): boolean {
    return this.parts.some((p) => p.partId === partId);
  }

  /** World-space position of a part's root (for anchoring a drag plane). */
  partWorldPosition(partId: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const p = this.parts.find((pv) => pv.partId === partId);
    if (!p) return null;
    this.pivot.updateMatrixWorld(true);
    return p.root.getWorldPosition(out);
  }

  /** Convert a world-space delta into the parts' local frame (cancels pivot rotation). */
  worldDeltaToLocal(delta: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    this.pivot.updateMatrixWorld(true);
    const q = this.pivot.getWorldQuaternion(new THREE.Quaternion()).invert();
    return out.copy(delta).applyQuaternion(q);
  }

  /**
   * Convert a world-space drag delta into a part's PARENT-local frame, applying
   * the parent's rotation AND scale. Part offsets are stored in `p.root.position`
   * (parent-local), and a loaded glTF sits under a normalization scale
   * (`obj.scale = 2.2/maxDim`) — so a raw world delta added there is multiplied by
   * that scale and flings the part away. Transforming the origin and (origin +
   * delta) through the inverse parent world matrix and subtracting cancels the
   * parent translation while keeping its rotation+scale. Falls back to the
   * whole-pivot rotation when the part (or its parent) is unknown.
   */
  worldDeltaToPartLocal(
    partId: string,
    delta: THREE.Vector3,
    out = new THREE.Vector3(),
  ): THREE.Vector3 {
    const p = this.parts.find((pv) => pv.partId === partId);
    const parent = p?.root.parent;
    if (!parent) return this.worldDeltaToLocal(delta, out);
    this.pivot.updateMatrixWorld(true);
    _deltaInv.copy(parent.matrixWorld).invert();
    _deltaA.set(0, 0, 0).applyMatrix4(_deltaInv);
    _deltaB.copy(delta).applyMatrix4(_deltaInv);
    return out.copy(_deltaB).sub(_deltaA);
  }

  /** Add each part's persistent drag offset on top of its exploded position. */
  private applyPartOffsets(offsets: ModelState['partOffsets']): void {
    for (const p of this.parts) {
      const o = offsets[p.partId];
      if (!o) continue;
      p.root.position.x += o.x;
      p.root.position.y += o.y;
      p.root.position.z += o.z;
    }
  }

  /** Compose each part's persistent rotation on top of its resting orientation. */
  private applyPartRotations(rotations: ModelState['partRotations']): void {
    for (const p of this.parts) {
      p.root.quaternion.copy(p.originalQuat);
      const r = rotations?.[p.partId];
      if (r) p.root.quaternion.premultiply(_partQuat.set(r.x, r.y, r.z, r.w));
    }
  }

  /** Multiply each part's persistent scale factor onto its resting scale. */
  private applyPartScales(scales: ModelState['partScales']): void {
    for (const p of this.parts) {
      const f = scales?.[p.partId] ?? 1;
      p.root.scale.copy(p.originalScale).multiplyScalar(f);
    }
  }

  /** Raycast a part id from NDC using the provided camera. Null on a miss. */
  pickPartId(ndc: { x: number; y: number }, camera: THREE.Camera): string | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = raycaster.intersectObjects(this.pickables, true)[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node) {
      if (typeof node.userData.partId === 'string') return node.userData.partId;
      node = node.parent;
    }
    return null;
  }

  /** Transient hover highlight (presenter `point`); not part of shared state. */
  setHover(partId: string | null): void {
    this.hoverId = partId;
  }

  /**
   * Draw a glowing edge outline around the part being pinch-grabbed (or clear
   * it with null). The outline is a child of each part mesh, so it follows the
   * part's translation / rotation / scale. Transient — not part of shared state.
   */
  setGrabbed(partId: string | null): void {
    if (partId === this.grabbedId) return;
    this.grabbedId = partId;
    for (const line of this.grabLines) {
      line.parent?.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
    this.grabLines.length = 0;
    if (!partId) return;
    const pv = this.parts.find((p) => p.partId === partId);
    if (!pv) return;
    pv.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
      const mat = new THREE.LineBasicMaterial({
        color: GRAB_OUTLINE_COLOR,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      const line = new THREE.LineSegments(edges, mat);
      line.renderOrder = 999; // draw on top so the highlight is always visible
      line.raycast = () => {}; // never intercept picks
      mesh.add(line);
      this.grabLines.push(line);
    });
  }

  private buildInto(group: THREE.Group, id: string, token: number): void {
    const placeholders = this.addPlaceholderParts(group, id);
    this.registerExplode(group, placeholders);

    // Try a real .glb hero model from /assets/<id>.glb (served via the Vite
    // proxy → Express agent server). On success, swap out the placeholder; on
    // any error (missing file, server down) keep the placeholder silently.
    this.loader.load(
      `/assets/${id}.glb`,
      (gltf) => {
        if (token !== this.loadToken) {
          disposeObject(gltf.scene);
          return;
        }
        for (const pv of placeholders) {
          group.remove(pv.root);
          disposeObject(pv.root);
          const idx = this.parts.indexOf(pv);
          if (idx >= 0) this.parts.splice(idx, 1);
        }
        const glbParts = this.addGlbPart(group, gltf.scene);
        this.registerExplode(group, glbParts);
      },
      undefined,
      () => {
        /* keep placeholder */
      },
    );
  }

  private addPlaceholderParts(group: THREE.Group, id: string): PartView[] {
    const specs = PART_SPECS[id] ?? defaultPart();
    const created: PartView[] = [];
    for (const spec of specs) {
      const color = new THREE.Color(spec.color);
      const mat = new THREE.MeshStandardMaterial({
        color: color.clone(),
        emissive: color.clone(),
        emissiveIntensity: 0.3,
        metalness: 0.3,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(spec.geo(), mat);
      mesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
      mesh.userData.partId = spec.id;
      recenterToCentroid(mesh);
      group.add(mesh);
      const pv = newPartView(mesh, [mat], [color], spec.id);
      this.parts.push(pv);
      created.push(pv);
    }
    return created;
  }

  /**
   * Register a loaded glTF: normalized + recentered, with each MESH as its own
   * part (cloned materials) so render modes, isolation, AND per-part explode all
   * work. A single-mesh export is one part and simply won't separate.
   */
  private addGlbPart(group: THREE.Group, obj: THREE.Object3D): PartView[] {
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    obj.scale.setScalar(2.2 / maxDim);
    obj.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
    obj.position.sub(center);

    group.add(obj);
    const created: PartView[] = [];
    let n = 0;
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = list.map((m) => m.clone() as TunableMaterial);
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      const partId = mesh.name || `part-${n++}`;
      mesh.userData.partId = partId;
      recenterToCentroid(mesh);
      const colors = cloned.map((m) => (m.color ? m.color.clone() : new THREE.Color(0xffffff)));
      const pv = newPartView(mesh, cloned, colors, partId);
      this.parts.push(pv);
      created.push(pv);
    });
    return created;
  }

  /**
   * Bake per-part explode data for `parts`: a unit outward direction and the
   * distance from the model center (proportional spread), plus the parent's
   * inverse world matrix so the world-space push can be applied in each part's
   * local frame — keeping the explosion coherent as the model rotates.
   */
  private registerExplode(group: THREE.Group, parts: PartView[]): void {
    if (!parts.length) return;
    this.pivot.updateMatrixWorld(true);
    const modelCenter = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    for (const p of parts) {
      const parent = p.root.parent;
      if (!parent) continue;
      const partCenter = new THREE.Box3().setFromObject(p.root).getCenter(new THREE.Vector3());
      const offset = partCenter.sub(modelCenter);
      const len = offset.length();
      p.offsetLen = len;
      p.dirWorld = len < 1e-6 ? new THREE.Vector3() : offset.multiplyScalar(1 / len);
      p.parentInv = parent.matrixWorld.clone().invert();
      p.originalPos = p.root.position.clone();
    }
  }

  private applyExplode(factor: number): void {
    for (const p of this.parts) {
      // Parts further from center travel proportionally more; the gap term
      // guarantees even central parts pull clear of their neighbors.
      const dist = factor * (p.offsetLen * EXPLODE_SPREAD + EXPLODE_GAP);
      // Convert the world-space push into the part's parent-local frame:
      // transforming the origin and (dir*dist) then subtracting cancels the
      // parent translation while preserving its rotation/scale.
      _explodeA.set(0, 0, 0).applyMatrix4(p.parentInv);
      _explodeB.copy(p.dirWorld).multiplyScalar(dist).applyMatrix4(p.parentInv).sub(_explodeA);
      p.root.position.copy(p.originalPos).add(_explodeB);
    }
  }

  private refreshMaterials(s: ModelState): void {
    for (const p of this.parts) {
      const ghost = s.focusPart != null && p.partId !== s.focusPart;
      const focused = s.focusPart === p.partId;
      const hovered = this.hoverId === p.partId;
      p.mats.forEach((mat, i) => {
        if (mat.color) mat.color.copy(p.baseColors[i]);
        if (mat.emissive) {
          mat.emissive.copy(p.baseColors[i]);
          mat.emissiveIntensity = focused || hovered ? 0.7 : 0.3;
        }

        let wireframe = false;
        let transparent = ghost;
        let opacity = ghost ? 0.1 : 1;
        let depthWrite = !ghost;

        switch (s.renderMode) {
          case 'wireframe':
            wireframe = true;
            opacity = ghost ? 0.08 : 1;
            depthWrite = true;
            break;
          case 'xray':
            transparent = true;
            opacity = ghost ? 0.05 : focused ? 0.6 : 0.32;
            depthWrite = false;
            break;
          case 'solid':
          default:
            break;
        }

        mat.wireframe = wireframe;
        mat.opacity = opacity;
        mat.depthWrite = depthWrite;
        // Toggling `transparent` at runtime needs a program recompile (it's part
        // of the program cache key). Flag needsUpdate ONLY on an actual change,
        // otherwise the material gets stuck blended (faded) after x-ray — and we
        // avoid recompiling every frame.
        if (mat.transparent !== transparent) {
          mat.transparent = transparent;
          mat.needsUpdate = true;
        }
      });
    }
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length) {
      const child = g.children[0];
      g.remove(child);
      disposeObject(child);
    }
  }
}

function toThree(q: Quat): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

const _centroid = new THREE.Vector3();

/**
 * Move a mesh's geometry so its bounding-box centre sits at the mesh's local
 * origin, shifting the mesh position to compensate so it doesn't visually move.
 * three.js scales and rotates a mesh about its local origin; a glTF part's
 * geometry is usually expressed relative to the model's shared origin, so
 * without this a per-part scale/rotation pivots about the model centre (e.g.
 * the eyes drift up while scaling). After recentering, both happen in place.
 */
function recenterToCentroid(mesh: THREE.Mesh): void {
  const geom = mesh.geometry as THREE.BufferGeometry | undefined;
  if (!geom || !geom.isBufferGeometry) return;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) return;
  bb.getCenter(_centroid);
  if (_centroid.lengthSq() < 1e-12) return; // already centred
  geom.translate(-_centroid.x, -_centroid.y, -_centroid.z);
  // Keep the part visually fixed: shift position by the centroid mapped through
  // the mesh's own scale + rotation (geometry → parent-local).
  mesh.position.add(_centroid.clone().multiply(mesh.scale).applyQuaternion(mesh.quaternion));
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}
