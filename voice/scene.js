// The hologram 3D stage. Receives setSceneState({model, compare_to}) from the voice agent
// and swaps the displayed 3D model. Uses real .glb files from /assets/<file> when present,
// otherwise a labeled placeholder so the full loop works before art is ready.
//
// This is the integration target the hologram/ team will adopt (4-view pinwheel goes here later).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 1.2, 6);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.6, 0);

// Lighting — bright key + cyan/magenta rim for the holographic look.
scene.add(new THREE.AmbientLight(0x404a6b, 1.2));
const key = new THREE.DirectionalLight(0xffffff, 2);
key.position.set(3, 5, 4);
scene.add(key);
const rimA = new THREE.PointLight(0x4fd1ff, 40, 20); rimA.position.set(-4, 2, -3); scene.add(rimA);
const rimB = new THREE.PointLight(0xff5d8f, 30, 20); rimB.position.set(4, 1, -4); scene.add(rimB);

// Ground glow disc.
const disc = new THREE.Mesh(
  new THREE.CircleGeometry(3, 64),
  new THREE.MeshBasicMaterial({ color: 0x0a1430, transparent: true, opacity: 0.6 })
);
disc.rotation.x = -Math.PI / 2;
scene.add(disc);

const loader = new GLTFLoader();

// ---- Model holder: one group we swap contents of ----
const modelGroup = new THREE.Group();
scene.add(modelGroup);
const compareGroup = new THREE.Group();
scene.add(compareGroup);

// Placeholder geometry per model id (used until a real .glb is dropped in /models).
const PLACEHOLDERS = {
  surface_pro_11: () => labeledMesh(new THREE.BoxGeometry(2.2, 1.5, 0.08), 0x4fd1ff, "Surface Pro 11"),
  surface_pro_10: () => labeledMesh(new THREE.BoxGeometry(2.2, 1.5, 0.08), 0x8a7dff, "Surface Pro 10"),
  xbox_controller: () => labeledMesh(new THREE.TorusGeometry(0.7, 0.35, 16, 48), 0x52ff8f, "Xbox Controller"),
  building_7: () => labeledMesh(new THREE.BoxGeometry(1.4, 2.4, 1.4), 0xffd166, "Building 7"),
};

// Metadata -> filename, fetched once.
let META = {};
fetch("/models").then((r) => r.json()).then((m) => (META = m)).catch(() => {});

function labeledMesh(geometry, color, label) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 })
  );
  group.add(mesh);
  group.add(makeLabel(label));
  return group;
}

function makeLabel(text) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 128;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#9fe7ff";
  ctx.font = "bold 56px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 80);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.position.set(0, 1.6, 0);
  return sprite;
}

function clearGroup(g) {
  while (g.children.length) g.remove(g.children[0]);
}

// Load a model id into a group: try real .glb, fall back to placeholder.
function loadModel(group, id, offsetX = 0) {
  clearGroup(group);
  group.position.x = offsetX;
  if (!id) return;
  const file = META[id]?.file;
  const url = file ? `/assets/${file}` : null;

  const placeFallback = () => {
    const ph = (PLACEHOLDERS[id] || PLACEHOLDERS.surface_pro_11)();
    group.add(ph);
  };

  if (!url) return placeFallback();
  loader.load(
    url,
    (gltf) => {
      const obj = gltf.scene;
      // normalize size
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const scale = 2.2 / Math.max(size.x, size.y, size.z);
      obj.scale.setScalar(scale);
      group.add(obj);
      group.add(makeLabel(META[id]?.display || id));
    },
    undefined,
    () => placeFallback() // .glb missing -> placeholder
  );
}

// ---- Clippy mascot: real /assets/clippy.glb if present, else placeholder paperclip ----
const clippy = new THREE.Group();
clippy.position.set(-2.6, 0.8, 0.5);
scene.add(clippy);

function buildPlaceholderClippy() {
  const clipMat = new THREE.MeshStandardMaterial({ color: 0xffe45e, emissive: 0xffc400, emissiveIntensity: 0.4, metalness: 0.8, roughness: 0.2 });
  const clipTube = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.06, 12, 40), clipMat);
  clippy.add(clipTube);
  const eyeGeo = new THREE.SphereGeometry(0.07, 16, 16);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.12, 0.12, 0.3);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.12, 0.12, 0.3);
  clippy.add(eyeL, eyeR);
  clippy.scale.setScalar(0.9);
}

loader.load(
  "/assets/clippy.glb",
  (gltf) => {
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.6 / Math.max(size.x, size.y, size.z);
    obj.scale.setScalar(scale);
    clippy.add(obj);
  },
  undefined,
  () => buildPlaceholderClippy() // no glb yet -> placeholder
);

let clippyState = "idle";
window.setClippyState = (action) => { clippyState = action || "idle"; };

// ---- The hook the voice agent calls ----
window.setSceneState = ({ model, compare_to } = {}) => {
  loadModel(modelGroup, model, compare_to ? -1.6 : 0);
  loadModel(compareGroup, compare_to, compare_to ? 1.6 : 0);
};

// ---- Pyramid (Pepper's Ghost) pinwheel mode ----
// Toggle with 'H'. Renders the scene 4x around the model so the acrylic pyramid
// reflects them into a single floating image. Single-view is the default (dev/debug).
let pinwheel = false;
const holoCam = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const target = new THREE.Vector3(0, 0, 0);

// Live-tunable params (persisted) so you can dial it in against the physical pyramid.
const DEFAULTS = { size: 0.30, gap: 40, dist: 5.0, elev: 0.25 };
let holo = { ...DEFAULTS };
try { holo = { ...holo, ...JSON.parse(localStorage.getItem("holo2") || "{}") }; } catch (_) {}
const saveHolo = () => localStorage.setItem("holo2", JSON.stringify(holo));

// On-screen readout + key help (only visible in pyramid mode).
const hud = document.createElement("div");
hud.id = "holohud";
hud.style.cssText = "position:fixed;top:12px;right:12px;font:12px/1.6 Segoe UI,sans-serif;color:#7fe9ff;background:rgba(0,0,0,.6);padding:10px 12px;border-radius:10px;display:none;white-space:pre;z-index:10";
document.body.appendChild(hud);
function updateHud() {
  hud.textContent =
    `PYRAMID MODE  (H to exit)\n` +
    `size  [ ]   ${holo.size.toFixed(2)}\n` +
    `gap   - =   ${holo.gap.toFixed(0)}px\n` +
    `zoom  , .   ${holo.dist.toFixed(1)}\n` +
    `tilt  ; '   ${holo.elev.toFixed(2)}\n` +
    `reset 0`;
}

window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") {
    pinwheel = !pinwheel;
    scene.background = new THREE.Color(pinwheel ? 0x000000 : 0x05070d);
    disc.visible = !pinwheel;
    clippy.visible = !pinwheel; // clean product-only hologram in pyramid mode
    hud.style.display = pinwheel ? "block" : "none";
    updateHud();
    return;
  }
  if (!pinwheel) return;
  // ignore while typing
  if (document.activeElement && document.activeElement.id === "typebox") return;
  const step = e.shiftKey ? 4 : 1;
  switch (e.key) {
    case "[": holo.size = Math.max(0.1, holo.size - 0.01 * step); break;
    case "]": holo.size = Math.min(0.49, holo.size + 0.01 * step); break;
    case "-": holo.gap = Math.max(-200, holo.gap - 4 * step); break;
    case "=": holo.gap = Math.min(400, holo.gap + 4 * step); break;
    case ",": holo.dist = Math.max(2, holo.dist - 0.2 * step); break;
    case ".": holo.dist = Math.min(14, holo.dist + 0.2 * step); break;
    case ";": holo.elev = Math.max(-0.4, holo.elev - 0.03 * step); break;
    case "'": holo.elev = Math.min(1.2, holo.elev + 0.03 * step); break;
    case "0": holo = { ...DEFAULTS }; break;
    default: return;
  }
  saveHolo();
  updateHud();
});

// ---- Resize ----
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

function setLabelsVisible(v) {
  for (const g of [modelGroup, compareGroup]) {
    g.traverse((o) => { if (o.isSprite) o.visible = v; });
  }
}

// Render-to-texture overlay for the pinwheel: render the model ONCE, then stamp 4
// guaranteed-identical rotated copies. This is the canonical Pepper's Ghost method.
const RT_SIZE = 1024;
const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { samples: 4 });
const overlayScene = new THREE.Scene();
const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadMat = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true });
const quads = [];
for (let i = 0; i < 4; i++) {
  const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), quadMat);
  overlayScene.add(q);
  quads.push(q);
}

function renderSingle() {
  setLabelsVisible(true);
  renderer.setRenderTarget(null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  controls.update();
  renderer.render(scene, camera);
}

function renderPinwheel() {
  setLabelsVisible(false);
  // 1) Render the model once (front view, slight elevation) into the texture.
  holoCam.aspect = 1;
  holoCam.position.set(
    target.x,
    target.y + holo.dist * Math.sin(holo.elev),
    target.z + holo.dist * Math.cos(holo.elev)
  );
  holoCam.up.set(0, 1, 0);
  holoCam.lookAt(target);
  holoCam.updateProjectionMatrix();
  renderer.setScissorTest(false);
  renderer.setRenderTarget(rt);
  renderer.render(scene, holoCam);
  renderer.setRenderTarget(null);

  // 2) Stamp 4 rotated copies around screen center via an orthographic overlay.
  const W = window.innerWidth, H = window.innerHeight;
  overlayCam.left = -W / 2; overlayCam.right = W / 2;
  overlayCam.top = H / 2; overlayCam.bottom = -H / 2;
  overlayCam.updateProjectionMatrix();
  const s = Math.min(W, H) * holo.size;
  const d = holo.gap + s / 2;   // center-to-copy distance
  const layout = [
    { x: 0,  y:  d, rot: 0 },              // top
    { x: d,  y:  0, rot: -Math.PI / 2 },   // right
    { x: 0,  y: -d, rot: Math.PI },        // bottom
    { x: -d, y:  0, rot: Math.PI / 2 },    // left
  ];
  quads.forEach((q, i) => {
    q.scale.set(s, s, 1);
    q.position.set(layout[i].x, layout[i].y, 0);
    q.rotation.z = layout[i].rot;
  });
  renderer.render(overlayScene, overlayCam);
}

// ---- Animate ----
const clock = new THREE.Clock();
function tick() {
  const t = clock.getElapsedTime();
  modelGroup.rotation.y = t * 0.5;
  compareGroup.rotation.y = t * 0.5;

  // Clippy idle bob + state reactions
  clippy.position.y = 0.8 + Math.sin(t * 2) * 0.06;
  if (clippyState === "presenting") {
    clippy.rotation.z = Math.sin(t * 8) * 0.15;
  } else if (clippyState === "confused") {
    clippy.rotation.y = Math.sin(t * 12) * 0.3;
  } else {
    clippy.rotation.z = Math.sin(t * 1.5) * 0.05;
    clippy.rotation.y = 0;
  }

  if (pinwheel) renderPinwheel();
  else renderSingle();
  requestAnimationFrame(tick);
}
tick();

// Show a default model so the stage isn't empty on load.
window.setSceneState({ model: "surface_pro_11" });
