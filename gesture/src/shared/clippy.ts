/**
 * Persistent Clippy mascot (Track B).
 *
 * A self-contained THREE object you add to a scene once; it stays present while
 * product models swap around it. The emote state machine is ported from the
 * original procedural animation in `voice/scene.js` and extended to the full set
 * the clippy/ README + agent describe: idle, wave, thinking, presenting,
 * celebrating, confused.
 *
 * Placement is the caller's job: position `clippy.object`. Animation happens on
 * an inner group so the bob/sway/hops never fight the caller's placement. Drive
 * it with `setEmote()` (state changes) + `update(elapsed, dt)` every frame.
 *
 * Transient emotes (wave/celebrating/confused) are NOT auto-reverted here — the
 * state owner (HologramPresenter) reverts `ModelState.clippy` to 'idle' so the
 * hologram follower mirrors the same revert. This class just renders whatever
 * emote it is told, indefinitely.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ClippyEmote =
  | 'idle'
  | 'wave'
  | 'thinking'
  | 'presenting'
  | 'celebrating'
  | 'confused';

const EMOTES: ReadonlySet<string> = new Set<ClippyEmote>([
  'idle',
  'wave',
  'thinking',
  'presenting',
  'celebrating',
  'confused',
]);

/** Normalize unknown/legacy values to a real emote so animation never stalls. */
function asEmote(value: string): ClippyEmote {
  return (EMOTES.has(value) ? value : 'idle') as ClippyEmote;
}

export class Clippy {
  /** Placement handle — the caller positions this in the scene. */
  readonly object = new THREE.Group();
  /** Animated locally (bob / sway / hops / spin) so placement stays intact. */
  private readonly anim = new THREE.Group();

  private emote: ClippyEmote = 'idle';
  /** Elapsed time at which the current emote started (for clean per-state phase). */
  private stateStart = 0;
  private lastElapsed = 0;
  private loadToken = 0;

  constructor() {
    this.object.add(this.anim);
    this.buildPlaceholder();
    this.tryLoadGlb();
  }

  /** Switch emote. Unknown values fall back to idle. */
  setEmote(value: string): void {
    const next = asEmote(value);
    if (next === this.emote) return;
    this.emote = next;
    this.stateStart = this.lastElapsed;
  }

  /** Advance the animation. `elapsed` is total seconds; `dt` is the frame delta. */
  update(elapsed: number, _dt: number): void {
    this.lastElapsed = elapsed;
    const local = elapsed - this.stateStart;
    const a = this.anim;

    // Reset to a neutral pose each frame so no emote leaks into the next.
    a.rotation.set(0, 0, 0);
    a.position.set(0, 0, 0);
    a.scale.setScalar(1);

    switch (this.emote) {
      case 'presenting':
        a.position.y = Math.sin(elapsed * 2) * 0.05;
        a.rotation.x = -0.12; // slight lean toward the model
        a.rotation.z = Math.sin(elapsed * 8) * 0.15;
        break;

      case 'confused':
        a.position.y = Math.sin(elapsed * 2) * 0.04;
        a.rotation.y = Math.sin(elapsed * 12) * 0.3; // quizzical head shake
        break;

      case 'wave':
        a.position.y = Math.sin(elapsed * 3) * 0.05;
        a.rotation.z = Math.sin(local * 7) * 0.4; // big friendly side-to-side tilt
        break;

      case 'thinking':
        a.position.y = Math.sin(elapsed * 2) * 0.04;
        a.rotation.z = 0.22 + Math.sin(elapsed * 2) * 0.05; // held pensive tilt
        a.rotation.y = Math.sin(elapsed * 1.2) * 0.12;
        break;

      case 'celebrating': {
        a.position.y = Math.abs(Math.sin(local * 7)) * 0.35; // excited hops
        a.rotation.y = local * 7; // spin
        a.scale.setScalar(1 + 0.12 * Math.abs(Math.sin(local * 9))); // scale pop
        break;
      }

      case 'idle':
      default:
        a.position.y = Math.sin(elapsed * 2) * 0.06; // gentle bob
        a.rotation.z = Math.sin(elapsed * 1.5) * 0.05; // subtle sway
        break;
    }
  }

  /** Placeholder paperclip + googly eyes (until a real clippy.glb is dropped in). */
  private buildPlaceholder(): void {
    const clipMat = new THREE.MeshStandardMaterial({
      color: 0xffe45e,
      emissive: 0xffc400,
      emissiveIntensity: 0.4,
      metalness: 0.8,
      roughness: 0.2,
    });
    const body = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 14, 48), clipMat);

    const eyeGeo = new THREE.SphereGeometry(0.1, 18, 18);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.17, 0.17, 0.42);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeR.position.set(0.17, 0.17, 0.42);

    this.anim.add(body, eyeL, eyeR);
  }

  /** Swap in a real /assets/clippy.glb when present; keep the placeholder otherwise. */
  private tryLoadGlb(): void {
    const token = ++this.loadToken;
    new GLTFLoader().load(
      '/assets/clippy.glb',
      (gltf) => {
        if (token !== this.loadToken) return;
        // Clear the placeholder.
        while (this.anim.children.length) {
          const child = this.anim.children[0];
          this.anim.remove(child);
          disposeObject(child);
        }
        const obj = gltf.scene;
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        obj.scale.setScalar(1.3 / maxDim);
        obj.updateMatrixWorld(true);
        const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
        obj.position.sub(center);
        this.anim.add(obj);
      },
      undefined,
      () => {
        /* no glb yet — keep the placeholder */
      },
    );
  }
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
