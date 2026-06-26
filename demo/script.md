# Script

### 0:00–0:18 — Cold open: the problem (for whom)
**Shot:** a seller mid-pitch over a slide titled "Introducing the new Xbox controller." Two
"customers" across the table — phones out, glazed over. *(B-roll friendly: real people.)*
**VO (or on-screen text):** *"Every day, Microsoft sellers pitch real products… over flat slides.
The room checks out. Remote folks check out harder."*

--- 

Presenter: (some casual yap about the new product) So this is our Xbox controller design... *goes to mouse to move solidworks, projected on TV* This new gen should be pretty familiar except we're introducing kryptonite joysticks for some extra durability. Hey guys... are you even listening? *camera pans from presenter to other meeting attendees*


Attendee 2 (engineer): I'm having a hard time picturing the scale... what does this look like in real life?
Attendee 3 (external customer?): Kryptonite joysticks... how heavy is that?
Attendee 1 (engagement): Huh? Sorry... it's been a long day of meetings... What are we talking about? *fiddling with duck*

Presenter: Ah wait guys... I gotchu.  Yo (Attendee 1), pass me that duck. *drop duck into hologram box* 

*blinks between hologram duck and real duck*



---

### 0:18–0:32 — The turn

**Shot:** cut to the presenter — Clippy **waves**, the controller **materializes** floating in the
pyramid / hologram window. Customers lean in.
**On-screen text:** *ClipV.I.S. — a hologram for your customer meeting.*

Attendee 2: Wait... The duck is to scale! Woah!

Presenter: Clippy, could you bring up the controller on ClipVIS?

### 0:32–1:25 — The demo (Make Something + Inspiring)

---
Presenter: Ah this is better. Now I can continue the presentation "hands free" (does gestures). Try it out! 

Attendee 1: *spin the thing*? Woah... this is nice.. I get to actually interact with the product - I'm engaged! 

Attendee 2: And I can see the product in real life! (for demo purposes the controller isn't actually at scale cause disclaimer cause our screen isn't big enough)

Attendee 3: Hey clippy... what does this controller weigh? -> clippy answers

Presenter: Clippy also has access to our catalogue of files. Let's look inside the controller - hey clippy, show me the circuit board. 

---


1. **"Spin it."** → it rotates; *"everyone around the table sees it from their angle."* (Pepper's-Ghost
   360° — the thing a slide can't do.)
2. **"What does it weigh?"** → Clippy **points** and narrates the spec; the number floats next to the
   model. *"Real product data from **Microsoft Fabric**."*
3. **Switch products: "Show me the circuit board."** → instant swap. Then **"explode it"** → the board
   separates into its components, and **"x-ray"** → see right through it. *"Show a customer — or a
   support engineer — exactly how it's built and serviced."* (The **Support** half of the challenge —
   and the money shot.)
4. **"Show me the surface laptop."** → instant swap again. *"Any product in the catalog, on command."*
   A quick **"spin it"** to close the loop.
**Throughout, call out the stack:** real **LLM brain** (Azure AI Foundry / GitHub Models), **voice
in/out**, **hand-gesture** control, and the **four-camera pyramid** — all running on a laptop.



### 1:25–1:55 — Why it matters (Business Value, this challenge)
**VO over a clean hologram shot:**
- *"For **sellers and solution engineers**: a flat pitch becomes an interactive product experience —
  more engagement, more memorable meetings, faster deals, real differentiation."*
- *"For **customer success and support**: explode and x-ray views explain how a product works and how
  to service it — fewer misunderstandings, better supportability."*
- *"Built on the **Microsoft stack we sell** — Foundry, Fabric — so it's dogfooding too."*

### 1:55–2:20 — Feasibility + next steps
**VO:**
- *"This works **today**: real LLM, real voice, gestures, and a ~$30 acrylic pyramid plus a tablet."*
- *"Next: **Teams integration** so remote attendees see the holo feed, a **Fabric-backed live product
  catalog**, per-part **CAD hero models**, and cross-machine sync."*

### 2:20–2:35 — Close
**Shot:** the real pyramid, model glowing, people smiling.
**Tagline:** *"Stop showing slides. Start showing the product. **ClipV.I.S. — bring the thing you're
talking about into the room.**"*
**Card:** team names (Baron · Claire · Jeanette · Kevin · Neha · Gebril) + "Microsoft Intern
Hackathon 2026 · Customer Engagement & Support."

---

## Spoken-command cheat sheet (all real, all rehearsable)

| Say | Intent/action | Keyboard fallback |
|---|---|---|
| "show me the xbox controller" | show_model → `xbox_controller` | type in box / quick-chip |
| "spin it" | manipulate → `spin_on` | `Space` / `T` |
| "what does it weigh?" | lookup_spec | — |
| "explode it" / "explode the controller" | manipulate → `explode` | `B` |
| "show me the back" | manipulate → `view_back` | `4` |
| "x-ray" / "wireframe" / "solid mode" | manipulate → render mode | `M` |
| "show me the circuit board" | show_model → `circuit` | quick-chip |
| "show me the surface laptop" | show_model → `surface_laptop` | quick-chip |
| "reset" | manipulate → `reset` | — |

Hero model ids: `xbox_controller`, `circuit`, `surface_laptop` (`agent/models.js`).

---

## Shot checklist (tick before you call it done)
- [ ] Clean screen capture of presenter + hologram follower (the spine).
- [ ] Real-pyramid beauty B-roll (5–10s).
- [ ] All narration lines pre-cached in `voice/clips/` (instant, consistent voice).
- [ ] Every command rehearsed in order; keyboard fallback memorized.
- [ ] Length 2:00–5:00 (aim 2:30–3:00). Audio levels checked. Exported MP4.
- [ ] Says explicitly: **what**, **why**, **for whom**, **business value**, **next steps**.
