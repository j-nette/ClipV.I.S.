# ClipV.I.S. — Hackathon Project Brief

> **Living document.** Captures everything decided so far for the 2026 Microsoft Intern Hackathon. Update as the team makes new calls.

---

## 1. The Project At A Glance

**Name:** ClipV.I.S. (Clippy V.I.S.)
**Tagline:** *"Bring the thing you're talking about into the room."*
**One-liner:** A physical Pepper's Ghost hologram pyramid on your meeting table, controlled by voice (and gesture, stretch), where a Clippy mascot brings up 3D models of products, buildings, designs, etc. with live data overlays — powered by an Azure AI Foundry agent and Microsoft Fabric.

### The 30-second pitch
> *"Hybrid meetings suck because you're talking about things — products, buildings, designs — that nobody can see in 3D. ClipV.I.S. is a hologram in the middle of your table. Ask Clippy for anything, and it appears, rotating, with the data you need overlaid. It's the meeting Tony Stark would have."*

### The "wow" demo moment
You sit at a table with the pyramid. You say: *"Clippy, show me the Surface Pro 11."* Clippy waves; a 3D Surface Pro materializes inside the pyramid, rotating, visible to everyone around the table. *"What's it weigh?"* — Clippy points and speaks the answer with the spec floating next to the model. Switch products with one voice command.

---

## 2. Hackathon Context

- **Event:** Microsoft Intern Hackathon 2026 (ICHW)
- **Kickoff:** Mon 6/22 11:30am, Building 7 (Bramble/Nettle/Fern)
- **Build window:** 6/22 – 6/26 (Mon–Fri), submission starts 6/29
- **Categories (with last year's competition density):**
  | Challenge | Projects last year | Top-3 odds |
  |---|---|---|
  | Workplace AI Innovation | 40 | 7.5% |
  | Social Good | 20 | 15% |
  | Healthy Future | 14 | 21% |
  | Customer Engagement & Sales | 11 | 27% |
  | Security & Trustworthy Systems | 10 | 30% |
  | **Hardware AI Innovation** | **9** | **33%** |
  | **Leverage AI for Data** | **8** | **38%** |

### Challenge selection — TO LOCK BY TUE 6/23
**Recommended:** **Hardware AI Innovation**
- Bridges software + physical hardware (literally the challenge prompt)
- Low saturation (9 projects)
- No winner last year looked like this — fresh ground
- Fallback: **Leverage AI for Data** (frame data as 3D-asset metadata + specs in Fabric)

---

## 3. Concept Evolution (How We Got Here)

| Step | Decision |
|---|---|
| 1 | Picked low-saturation challenge over crowded "Workplace AI" (~5x better odds) |
| 2 | Decided to use Fabric AND Foundry (data + agent stack hits judge bingo) |
| 3 | Considered "Lineage Detective" (point at a number in Power BI, agent traces source) — strong but pure software |
| 4 | Added "Visual Jarvis" layer — voice + animated UI = memorable demo |
| 5 | Considered hand-gesture control (Iron Man-style) — kept as stretch only |
| 6 | Pivoted to **physical Pepper's Ghost pyramid** as presentation medium — physical artifact = unforgettable demo |
| 7 | Added **Clippy mascot** for personality + MS nostalgia |
| 8 | **PIVOT:** Bar charts/data viz inside hologram = bad (slideshow does this better). **3D models of real objects = great** — that's the value the pyramid uniquely delivers. |

---

## 4. Product Definition

### Primary user
PMs, designers, engineers, and execs in hybrid meetings who need to discuss physical objects, products, buildings, or 3D designs.

### Problem
- Slideshows show flat images — you can't rotate, inspect, or share the object spatially
- Talking about a "new server rack design" or "campus floor plan" is hand-wavy when remote
- Meetings about physical things lose information vs. being in person with the object

### Solution
A small hologram pyramid in the middle of the table. Voice command summons any 3D asset. Mascot narrates with live data from Fabric. Everyone around the table sees it from their angle.

### Hero use cases (pick 2–3 for demo)
1. **Microsoft hardware** (Surface, Xbox, HoloLens) — instant dogfooding
2. **A Microsoft building** (B7 or Redmond campus) — meta + relatable
3. **A "wow" model** (molecule / engine / heart) — shows the format's range

### Scope (MoSCoW)
| Must | Should | Won't |
|---|---|---|
| Pyramid renders rotating 3D model | Multiple models swappable by voice | Real-time photogrammetry scanning |
| Voice → Foundry → mascot reacts | Floating spec labels next to model | Multi-user / multi-pyramid sync |
| Clippy mascot inside pyramid | Mascot speaks via TTS | True AR / HoloLens integration |
| 4-view pinwheel render works | Side-by-side model comparison | Gesture control (stretch only) |
| 3 scripted voice commands work flawlessly | Real Fabric metadata lookup | Production hosting |

---

## 5. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| **Display** | Tablet or small monitor laid flat | iPad works |
| **Pyramid** | Acrylic Pepper's Ghost pyramid | Buy on Amazon (~$20–$40) or laser-cut/tape acrylic |
| **3D scene** | Three.js + React Three Fiber + drei | Pinwheel render = 4 viewports rotated 90° |
| **3D models** | glTF/GLB files from Sketchfab, MS 3D library, or Blender | Bright, low-poly, emissive materials |
| **Mascot** | Clippy-style model (original or stylized) | Mixamo for rigged animations |
| **Voice in** | Web Speech API (fast) or Azure Speech (better) | Web Speech for MVP |
| **Voice out** | Azure Neural TTS | Clippy needs a voice |
| **Brain** | Azure AI Foundry agent | Maps intent → model + narration |
| **Data** | Microsoft Fabric (model metadata, specs, lineage) | Lakehouse with `models` table |
| **Real-time wire** | WebSockets | Agent → UI streaming |
| **Gesture (stretch)** | MediaPipe Hands in browser, 1 webcam | Point + pinch only |

### Why both Fabric + Foundry
- **Foundry**: agent brain, intent parsing, model selection, narration generation
- **Fabric**: stores 3D asset metadata, product specs, ownership/lineage — the "data" angle for the pitch

---

## 6. Architecture

```
Mic input
   ↓
Web Speech API (or Azure Speech-to-Text)
   ↓
Foundry agent — parses intent, picks model, generates narration
   ↓ (tool calls)
Fabric — fetches metadata/specs for the chosen model
   ↓
React app receives: { model_file, animation, narration, overlay_data }
   ↓
Three.js scene loads model, animates Clippy, overlays text
   ↓
4-view pinwheel renderer (4 viewports at 90° rotations)
   ↓
Flat display (tablet/monitor)
   ↓
Acrylic pyramid → "floating" hologram visible 360° around table
   ↓
Azure TTS → small speaker → Clippy "speaks"
```

---

## 7. Build Plan — Slices

Each slice = end-to-end vertical, demo-able on its own. **Never let a later slice break an earlier one.**

| # | Slice | Demo-able outcome |
|---|---|---|
| **0** | Three.js scene with rotating cube, 4-view pinwheel render | Pyramid works visually (test with cube) |
| **1** | Clippy mascot loaded, idles + waves on click. Pinwheel intact. | The magic moment — mascot floats in pyramid |
| **2** | Voice in → text → fake response → mascot animates "presenting" | End-to-end illusion (no real data yet) |
| **3** | Foundry agent + Fabric metadata lookup: voice → real intent → returns model name + narration | Real product brain |
| **4** | 3D model materializes inside pyramid based on agent response (Surface Pro, building, etc.) | **The demo wow** |
| **5** | Mascot speaks via TTS, reacts to data (gestures, points at model) | Personality + polish |
| **6** | Demo script locked, backup video recorded, lighting tuned, tablecloth, fallbacks tested | Stage-ready |
| **Stretch** | Gesture (pinch + point) via MediaPipe | Only if Slice 4 done by Thu |

**Cut line:** Ship through Slice 4 = medal. Ship through Slice 6 with polish = win.

---

## 8. Team & Ownership (from whiteboard)

| Task | Owner(s) | Due |
|---|---|---|
| Make hologram enclosure (pyramid) | Baron, Claire | Tue 6/23 morning |
| Clippy 3D model → image pipeline | Jeanette, Baron, Neha | Wed 6/24 night |
| Images → 4-side pinwheel pipeline | Baron, Claire | Wed 6/24 night |
| Voice detection + Foundry model wiring | Geebrill (you), Neha | Tue 6/23 night |
| Gesture recognition + CV (1 camera) — stretch | Jeanette, Kevin | Tue 6/23 night |
| Video + submission package | TBD | Start Mon 6/29 |
| **NEEDS ADDING:** Demo script | TBD | Draft Wed, lock Thu |
| **NEEDS ADDING:** Backup demo video | TBD | Record Thu night |
| **NEEDS ADDING:** Lock challenge category | Team | Tue 6/23 |
| **NEEDS ADDING:** Pick 3 hero 3D models | Team | Tue 6/23 |

---

## 9. Integration Checkpoints (the most-important addition)

The board has task deadlines but no integration milestones. Add these:

| Date | Integration milestone |
|---|---|
| **Tue 6/23 EOD** | Slice 0 — pyramid renders cube; voice → Foundry returns text; gesture stub logs a pinch |
| **Wed 6/24 EOD** | Slice 1+2 — Clippy in pyramid, voice triggers his animation (no real data yet) |
| **Thu 6/25 EOD** | Slice 3+4 — real Foundry agent loads real 3D model based on voice |
| **Fri 6/26 EOD** | Slice 5+6 — TTS narration, demo script locked, backup video recorded |
| **Sat–Sun 6/27–28** | Buffer, rehearsal, fix any breaks |
| **Mon 6/29** | Submission package (video, writeup, repo link) |

---

## 10. Demo Script (draft — refine Wed)

**Length:** 90 seconds live.

1. **Setup (10s):** Walk to a table with a pyramid on it. "Imagine you're in a hybrid meeting about the new Surface Pro 11."
2. **Voice command 1 (15s):** *"Clippy, show me the Surface Pro 11."*
   - Clippy waves, fades, model materializes rotating in pyramid.
3. **Voice command 2 (20s):** *"What's it weigh?"*
   - Clippy points; spec text floats next to model; Clippy speaks the answer with one-line context from Fabric metadata.
4. **Voice command 3 (20s):** *"Compare to the Surface Pro 10."*
   - Second model appears next to first; highlight color shows what changed.
5. **Wow #2 (15s):** *"Show me Building 7."* — pivot to a campus model, demonstrating range.
6. **Close (10s):** "Three voice commands. Real Fabric data. Zero slideshows. Everyone at the table sees it." Mic drop.

**Lock the 3 voice commands** so the agent only needs to handle them reliably.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pyramid doesn't ship in time | Build from acrylic sheets + tape (10-min YouTube tutorial) — Baron/Claire owns this |
| Lighting in demo room kills illusion | Dark tablecloth + ring light from above only; test in venue Friday |
| Voice fails on stage | Keyboard hotkeys for each demo command as fallback (must be wired Day 1) |
| Foundry latency slow | Pre-cache responses for the 3 scripted commands |
| 3D models heavy / slow to load | Pre-load all hero models at app start, swap visibility only |
| Gesture (stretch) eats time from core | Hard cut-off: if not working Wed night, abandon and lean on voice-only |
| Pieces drift in parallel for 4 days | Daily integration checkpoint at EOD (see section 9) |
| Demo flubs live | Backup video recorded Thursday night, narrate over it if needed |

---

## 12. Decisions Still To Make

- [ ] **Challenge category:** Hardware AI Innovation (recommended) vs. Leverage AI for Data
- [ ] **Mascot design:** real Clippy paperclip, restyled Clippy, or original character
- [ ] **The 3 hero 3D models** for the demo
- [ ] **Sample Fabric dataset/schema:** what metadata table backs the model lookup
- [ ] **Pyramid size + display device:** iPad? 10" monitor? Bigger?
- [ ] **Mascot voice:** male/female, default Azure voice or custom-styled
- [ ] **Final project name:** keep ClipV.I.S. or rename (Holo, Prism, Atlas, Specter, Fae also floated)

---

## 13. Working Principles (agreed)

1. **Multiple slices, not one mega-prompt.** Each slice is end-to-end and demo-able.
2. **Verify after every prompt.** Run it, check output, commit. Never accept code you haven't read.
3. **Polish is icing, not cake.** Slice 1 must demo on its own. Each later slice is optional.
4. **Hard scope cuts win hackathons.** Anything not in the Must column gets cut at the first sign of slip.
5. **Backup paths for everything.** Keyboard fallback for voice. Screen-only fallback if pyramid breaks. Recorded video if live demo dies.

---

## 14. Files In This Session

- `hackathon-prd-template.md` — generic 1-page PRD template
- `slice-workflow.md` — how to break a feature into prompt-sized pieces and iterate
- `project-brief.md` — this file
