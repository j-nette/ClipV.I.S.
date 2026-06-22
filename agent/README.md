# agent/

Azure AI Foundry agent + Fabric integration.

Responsibilities:
- Parse voice intent → `{ model_file, animation, narration, overlay_data }`
- Tool: `lookup_model_metadata(name)` → queries Fabric for specs, owner, version
- Tool: `compare_models(a, b)` → diff specs for "compare" command
- Cache responses for the 3 scripted demo commands (latency safety)

Demo voice commands (locked):
1. "Clippy, show me [product]"
2. "What's it [weigh / cost / measure / ...]?"
3. "Compare to [other product]"
