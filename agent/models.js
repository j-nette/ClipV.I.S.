// Mock "Fabric" metadata store.
// Replace with a real Fabric Lakehouse query (lookup_model_metadata tool) in step 8.
// Schema mirrors the planned Fabric `models` table: name, file, weight, price, owner, blurb.

export const MODELS = {
  surface_pro_11: {
    name: "surface_pro_11",
    display: "Surface Pro 11",
    file: "surface_pro_11.glb",
    weight: "1.97 lbs",
    price: "$999",
    owner: "Surface Team",
    blurb: "The Surface Pro 11 with the Snapdragon X Elite chip."
  },
  surface_pro_10: {
    name: "surface_pro_10",
    display: "Surface Pro 10",
    file: "surface_pro_10.glb",
    weight: "1.94 lbs",
    price: "$1199",
    owner: "Surface Team",
    blurb: "The previous-gen Surface Pro 10 for business."
  },
  xbox_controller: {
    name: "xbox_controller",
    display: "Xbox Wireless Controller",
    file: "xbox_controller.glb",
    weight: "0.6 lbs",
    price: "$59",
    owner: "Xbox Team",
    blurb: "The Xbox Wireless Controller."
  },
  building_7: {
    name: "building_7",
    display: "Building 7",
    file: "building_7.glb",
    weight: "n/a",
    price: "n/a",
    owner: "RE&F",
    blurb: "Microsoft Redmond Building 7."
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
  "surface pro 11": "surface_pro_11",
  "surface 11": "surface_pro_11",
  "surface pro eleven": "surface_pro_11",
  "surface pro 10": "surface_pro_10",
  "surface 10": "surface_pro_10",
  "surface pro ten": "surface_pro_10",
  "surface": "surface_pro_11",
  "xbox controller": "xbox_controller",
  "xbox": "xbox_controller",
  "controller": "xbox_controller",
  "building 7": "building_7",
  "building seven": "building_7",
  "b7": "building_7",
  "building": "building_7",
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
