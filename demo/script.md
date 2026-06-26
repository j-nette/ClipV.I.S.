# ClipV.I.S. — Submission Video Script & Shot List

> **Target length:** 2:30–3:00 (rules allow **2:00–5:00**). One take or lightly edited.
> **Challenge:** Microsoft **Customer Engagement & Support**.
> **The video answers the judges' step-by-step:** what we built, why, for whom, the
> business value, why they'd use it, and the next steps.

**Our customer (the user):** Microsoft **sellers, solution engineers, and customer-success/
support teams** (MCAPS) who pitch and support physical products.
**Their pain:** product conversations happen over flat slides — the room disengages, and remote
attendees see even less.
**Our promise:** *Bring the thing you're talking about into the room.*

All spoken commands below are **really supported today** (see the cheat-sheet at the bottom), so the
run is rehearsable and pre-cacheable.

---

## How to shoot it (read first)

Pepper's-Ghost pyramids are **hard to film** (dark room, faint ghost image, phone glare). Don't bet
the submission on it. Shoot in two layers and cut together:

- **Primary spine — clean screen capture.** Record the **presenter window** (`:5173/`) and the
  **🔺 hologram follower** (`/hologram.html`) on screen. Crisp, guaranteed, readable. This is most of
  the video.
- **B-roll — real-pyramid beauty shot.** 5–10s of the physical pyramid on a table with people leaning
  in. Intercut for the wow; never rely on it for clarity.

**Pre-flight:** both processes running (`agent` on :3000, `gesture` on :5173); pre-cache the exact
narration lines in `voice/clips/` so TTS is instant; rehearse the command order; have the **keyboard
hotkeys ready as the silent fallback** if a voice command flubs (`P/G/B/M/Space/[ ]/1-4/K`, rotate
`Q-E/R-F/C-V`, zoom `Z/X`). Default model is **clippy**.

---

## The script (timecoded)

### 0:00–0:18 — Cold open: the problem (for whom)
**Shot:** a seller mid-pitch over a slide titled "Introducing the new Xbox controller." Two
"customers" across the table — phones out, glazed over. *(B-roll friendly: real people.)*
**VO (or on-screen text):** *"Every day, Microsoft sellers pitch real products… over flat slides.
The room checks out. Remote folks check out harder."*

--- 

Presenter: (some casual yap about the new product) So this is our Xbox controller design... *goes to mouse to move solidworks, projected on TV* This new gen should be pretty familiar except we're introducing kryptonite joysticks for some extra durability. Hey guys... are you even listening? *camera pans from presenter to other meeting attendees*

Attendee 1: Huh? Sorry... it's been a long day of meetings... What are we talking about?
Attendee 2: I'm having a hard time picturing the scale... what does this look like in real life?
Attendee 3: Kryptonite joysticks... how heavy is that?

Presenter: Ah wait guys... I gotchu guys. Clippy, could you bring up the controller on ClipVIS?

---

### 0:18–0:32 — The turn

**Shot:** cut to the presenter — Clippy **waves**, the controller **materializes** floating in the
pyramid / hologram window. Customers lean in.
**On-screen text:** *ClipV.I.S. — a hologram for your customer meeting.*

### 0:32–1:25 — The demo (Make Something + Inspiring)
Drive it with voice; the hologram follower mirrors every change in real time.
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
