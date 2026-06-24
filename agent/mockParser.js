// Mock intent parser — keyword based. Runs when Foundry is not configured.
// Lets the whole demo work TODAY with zero cloud access.
import { MODELS, resolveModel } from "./models.js";

// Phrase-driven emotes — let Clippy react to *how* you talk, not just what you ask.
// These high-confidence emotional cues override the intent's default mascot state.
const EMOTE_CUES = [
  { re: /\b(wow+|amazing|awesome|incredible|epic|nailed it|let'?s go|love it|so cool|that'?s cool|fire|sick|beautiful|gorgeous)\b/, emote: "celebrating" },
  { re: /\b(hi|hey+|hello|yo|howdy|sup|good morning|good afternoon|good evening|thanks|thank you|cheers|bye|goodbye|see (you|ya))\b/, emote: "wave" },
];
// Returns a cued emote if the text clearly signals a mood, else the intent's fallback.
function emoteFor(text, fallback) {
  for (const c of EMOTE_CUES) if (c.re.test(text)) return c.emote;
  return fallback;
}

export function mockParse(userText, currentModel) {
  const t = (userText || "").toLowerCase().trim();

  if (!t) {
    return unknown();
  }

  // chat / greetings — gives a little Jarvis-style banter even in mock mode
  const greetings = ["hi", "hey", "hello", "yo", "sup", "thanks", "thank you", "how are you", "who are you", "what can you do"];
  if (greetings.some((g) => t === g || t.startsWith(g + " ") || t.includes("how are you") || t.includes("who are you") || t.includes("what can you"))) {
    let narration = "Hi! Ask me to show you a model — try the Xbox controller.";
    if (t.includes("thank")) narration = "Anytime! That's what I'm here for.";
    else if (t.includes("how are you")) narration = "Sharp as ever and ready to present!";
    else if (t.includes("who are you")) narration = "I'm Clippy — your holographic co-pilot.";
    return { intent: "chat", model: null, compare_to: null, clippy: emoteFor(t, "wave"), narration };
  }

  // compare
  if (t.includes("compare") || t.includes("versus") || t.includes(" vs ")) {
    const target = resolveModel(t);
    const model = currentModel || (target ? null : null);
    const compareTo = target;
    if (!compareTo) return unknown(t);
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
      clippy: emoteFor(t, "presenting"),
      narration
    };
  }

  // lookup_spec
  const specWords = ["weigh", "weight", "cost", "price", "how much", "how big", "size", "spec", "heavy"];
  if (specWords.some((w) => t.includes(w))) {
    const model = resolveModel(t) || currentModel;
    if (!model || !MODELS[model]) return unknown(t);
    const m = MODELS[model];
    let narration = `${m.display}: ${m.blurb}`;
    if (t.includes("weigh") || t.includes("weight") || t.includes("heavy")) {
      narration = `It weighs ${m.weight}.`;
    } else if (t.includes("cost") || t.includes("price") || t.includes("much")) {
      narration = `It costs ${m.price}.`;
    }
    return {
      intent: "lookup_spec",
      model,
      compare_to: null,
      clippy: emoteFor(t, "presenting"),
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
      clippy: emoteFor(t, "presenting"),
      narration: `Here's the ${m.display}.`
    };
  }

  return unknown(t);
}

function unknown(text = "") {
  return {
    intent: "unknown",
    model: null,
    compare_to: null,
    clippy: emoteFor(text, "confused"),
    narration: "Sorry, I didn't get that."
  };
}
