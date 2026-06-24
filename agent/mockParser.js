// Mock intent parser — keyword based. Runs when Foundry is not configured.
// Lets the whole demo work TODAY with zero cloud access.
import { MODELS, resolveModel } from "./models.js";

export function mockParse(userText, currentModel) {
  const t = (userText || "").toLowerCase().trim();

  if (!t) {
    return unknown();
  }

  // manipulate — voice-driven model transforms (mirrors the gesture API)
  const MANIP = [
    { re: /(zoom in|closer|enlarge|bigger|grow|scale up)/, action: "bigger", say: "Zooming in." },
    { re: /(zoom out|further|smaller|shrink|scale down)/, action: "smaller", say: "Zooming out." },
    { re: /(rotate|spin|turn).*(left|counter)/, action: "rotate_left", say: "Rotating left." },
    { re: /(rotate|spin|turn).*(right|clock)/, action: "rotate_right", say: "Rotating right." },
    { re: /(rotate|spin|turn)/, action: "rotate_right", say: "Spinning it around." },
    { re: /move.*(left)/, action: "move_left", say: "Moving left." },
    { re: /move.*(right)/, action: "move_right", say: "Moving right." },
    { re: /move.*(up)/, action: "move_up", say: "Moving up." },
    { re: /move.*(down)/, action: "move_down", say: "Moving down." },
    { re: /(reset|center|recenter|put it back)/, action: "reset", say: "Resetting the view." },
  ];
  for (const m of MANIP) {
    if (m.re.test(t)) {
      return { intent: "manipulate", model: null, compare_to: null, action: m.action, clippy: "presenting", narration: m.say };
    }
  }

  // chat / greetings — gives a little Jarvis-style banter even in mock mode
  const greetings = ["hi", "hey", "hello", "yo", "sup", "thanks", "thank you", "how are you", "who are you", "what can you do"];
  if (greetings.some((g) => t === g || t.startsWith(g + " ") || t.includes("how are you") || t.includes("who are you") || t.includes("what can you"))) {
    let narration = "Hi! Ask me to show you a model — try the Xbox controller.";
    if (t.includes("thank")) narration = "Anytime! That's what I'm here for.";
    else if (t.includes("how are you")) narration = "Sharp as ever and ready to present!";
    else if (t.includes("who are you")) narration = "I'm Clippy — your holographic co-pilot.";
    return { intent: "chat", model: null, compare_to: null, clippy: "idle", narration };
  }

  // compare
  if (t.includes("compare") || t.includes("versus") || t.includes(" vs ")) {
    const target = resolveModel(t);
    const model = currentModel || (target ? null : null);
    const compareTo = target;
    if (!compareTo) return unknown();
    const a = MODELS[currentModel];
    const b = MODELS[compareTo];
    let narration = `Comparing ${b ? b.display : compareTo}.`;
    if (a && b && a.weight !== "n/a" && b.weight !== "n/a") {
      narration = `${a.display} is ${a.weight}, ${b.display} is ${b.weight}.`;
    }
    return {
      intent: "compare",
      model: currentModel || null,
      compare_to: compareTo,
      clippy: "presenting",
      narration
    };
  }

  // lookup_spec
  const specWords = ["weigh", "weight", "cost", "price", "how much", "how big", "size", "spec", "heavy",
    "dimension", "describe", "measure", "length", "width", "height", "how tall", "how wide", "how long", "scale", "mass", "material"];
  if (specWords.some((w) => t.includes(w))) {
    const model = resolveModel(t) || currentModel;
    if (!model || !MODELS[model]) return unknown();
    const m = MODELS[model];
    let narration = `${m.display}: ${m.blurb}`;
    const asksDimensions = /dimension|describe|measure|size|length|width|height|how (big|tall|wide|long)|scale|mass/.test(t);
    if (asksDimensions) {
      const parts = [];
      if (m.dimensions) parts.push(`it measures ${m.dimensions}`);
      if (m.weight && m.weight !== "n/a") parts.push(`weighs ${m.weight}`);
      if (m.material) parts.push(`and is made of ${m.material}`);
      narration = parts.length ? `The ${m.display}: ${parts.join(", ")}.` : narration;
    } else if (t.includes("weigh") || t.includes("weight") || t.includes("heavy")) {
      narration = `It weighs ${m.weight}.`;
    } else if (t.includes("cost") || t.includes("price") || t.includes("much")) {
      narration = `It costs ${m.price}.`;
    }
    return {
      intent: "lookup_spec",
      model,
      compare_to: null,
      clippy: "presenting",
      narration
    };
  }

  // show_model
  const showWords = ["show", "bring up", "pull up", "display", "let's see", "open"];
  const model = resolveModel(t);
  if (model && (showWords.some((w) => t.includes(w)) || true)) {
    const m = MODELS[model];
    return {
      intent: "show_model",
      model,
      compare_to: null,
      clippy: "presenting",
      narration: `Here's the ${m.display}.`
    };
  }

  return unknown();
}

function unknown() {
  return {
    intent: "unknown",
    model: null,
    compare_to: null,
    clippy: "confused",
    narration: "Sorry, I didn't get that."
  };
}
