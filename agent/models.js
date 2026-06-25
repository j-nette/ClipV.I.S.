// Mock "Fabric" metadata store.
// Replace with a real Fabric Lakehouse query (lookup_model_metadata tool) in step 8.
// Schema mirrors the planned Fabric `models` table: name, file, weight, price, owner, blurb.

export const MODELS = {
  xbox_controller: {
    name: "xbox_controller",
    display: "Xbox Wireless Controller",
    file: "xbox_controller.glb",
    weight: "0.6 lbs",
    price: "$59",
    owner: "Xbox Team",
    blurb: "The Xbox Wireless Controller."
  },
  surface_laptop: {
    name: "surface_laptop",
    display: "Surface Laptop",
    file: "surface_laptop.glb",
    weight: "2.84 lbs",
    price: "$999",
    owner: "Surface Team",
    blurb: "The Microsoft Surface Laptop."
  },
  circuit: {
    name: "circuit",
    display: "Circuit Board",
    file: "circuit.glb",
    weight: "n/a",
    price: "n/a",
    owner: "Devices Team",
    blurb: "A circuit board assembly."
  },
  clippy: {
    name: "clippy",
    display: "Clippy",
    file: "clippy.glb",
    weight: "n/a",
    price: "n/a",
    owner: "ClipV.I.S.",
    blurb: "Clippy, your holographic assistant."
  }
};

// Aliases people might say -> canonical model id.
export const ALIASES = {
  "surface laptop 3": "surface_laptop",
  "surface laptop": "surface_laptop",
  "surface pro 11": "surface_laptop",
  "surface pro": "surface_laptop",
  "surface": "surface_laptop",
  "laptop": "surface_laptop",
  "xbox controller": "xbox_controller",
  "xbox": "xbox_controller",
  "controller": "xbox_controller",
  "circuit board": "circuit",
  "circuit": "circuit",
  "motherboard": "circuit",
  "pcb": "circuit",
  "board": "circuit",
  "clippy": "clippy",
  "paperclip": "clippy",
  "clip": "clippy"
};

export function resolveModel(text) {
  const t = text.toLowerCase();
  // longest alias first so "surface pro 11" beats "surface"
  const keys = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (t.includes(k)) return ALIASES[k];
  }
  return null;
}
