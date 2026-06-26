# ClipVIS — Gesture Reference (finalized)

The complete, current list of every gesture the system recognizes, what it does,
and its keyboard fallback. This is reconciled against the implementation in
`src/gestureDetector.ts`, `src/gestureController.ts`, and `src/keyboardFallback.ts`
— it is the source of truth, superseding the shorter MVP lists in `README.md`
and `PLAN.md`.

## Conventions

- **Handedness:** by default the **Right** hand *translates* and the **Left** hand
  *rotates*. This split avoids wrist-twisting. Set `swapHandedness` to flip it.
- **Scope:** a manipulation acts on either one **object** (two-finger pinch) or the
  **whole assembly** (three-finger pinch).
- **Cursor:** the index fingertip, mapped to NDC (`[-1,1]`, y-up, mirrored for a
  selfie view).
- Every gesture has an always-on keyboard fallback so the demo runs with the
  webcam unplugged.

---

## Manipulation gestures

| Gesture | Hand pose | Action | Event(s) | Keyboard |
|---|---|---|---|---|
| **Point / hover** | Index extended, other fingers curled (right hand) | Highlight the part under the fingertip | `point`, `point_end` | `P` (hold) |
| **Focus / isolate** | Point and *dwell* on one spot (~16 frames, little drift) | Isolate the part under the cursor | `focus` | `K` (toggle) |
| **Grab — object** | Two-finger pinch (thumb + index) | Grab a single object | `pinch_start/move/end` (scope `object`) | `G` (toggle) |
| **Grab — assembly** | Three-finger pinch (thumb + index + middle) | Grab the whole assembly as a group | `pinch_*` (scope `assembly`) | `B` toggles scope |
| **Translate** | Pinch + move the **right** hand; push/pull toward or away from camera for depth | Move the target in X/Y and along camera-Z | `pinch_move` (with `depth`) | Arrow keys |
| **Rotate** | Pinch + move the **left** hand: horizontal = yaw, vertical = pitch | Rotate the target in 3D (no wrist roll needed) | `rotate_start/rotate/rotate_end` | `Q`/`E` yaw · `R`/`F` pitch · `C`/`V` roll |
| **Scale / zoom** | **Both** hands pinch — change the distance between them | Scale the target (spread = bigger) | `scale_start`, `zoom`, `scale_end` | `Z`/`X` or mouse wheel |

---

## Discrete command gestures (hologram presenter)

These drive model-presentation features. They are no-ops in the standalone scene.

| Gesture | Hand pose | Action | Event | Keyboard |
|---|---|---|---|---|
| **Explode / collapse** | Both **fists** held together to "charge" (~7 frames), then **open** the hands and spread apart to explode / bring together to collapse | Scrub the exploded-view amount (0→1, both directions, persists) | `explode` `{ factor }` | `O` (toggle) |
| **Snap view** | **Left** hand held upright, fingers extended; the count picks the view | Snap to a canonical orientation | `snap_view` | `1`/`2`/`3`/`4`, or `[`/`]` to cycle |
| **Render mode** | **Right** hand thumb→middle tap (touch then release) | Cycle render mode: solid → wireframe → x-ray | `render_mode` | `M` |
| **Turntable** | **Right** hand two-finger pose (index + middle together) swiped horizontally; hold still to stop | Fling the auto-spin (speed ∝ swipe) / stop it | `turntable` `{ on, speed }` | `Space` or `T` (toggle) |
| **Create orb** | "Rock sign" pose: index + pinky extended, middle + ring curled, thumb near the curled tips | Spawn a new orb at the cursor | `orb_create` | — |

### Snap-view finger counts

Held with the **left** hand, fingers pointing up:

| Fingers | View |
|---|---|
| 1 | front |
| 2 | iso |
| 3 | right |
| 4 | top |

> Note: `README.md` lists `1 2 3 4 → front / iso / top / back`, but the
> implemented mapping (`SNAP_VIEWS` in both the controller and keyboard fallback)
> is `front / iso / right / top`. This table reflects the code.

---

## Event contract (`GestureEvent`)

Every gesture above emits one of these typed events onto the shared `gestureBus`;
consumers (the standalone scene, the hologram presenter) turn them into visuals:

- `point`, `point_end`
- `pinch_start`, `pinch_move` (optional `depth`), `pinch_end` — with `scope`
- `rotate_start`, `rotate` (delta quaternion), `rotate_end` — with `scope`
- `scale_start`, `zoom` (signed delta), `scale_end` — with `scope`
- `explode` `{ factor }`
- `render_mode` `{ dir: 'next' }`
- `snap_view` `{ name }`
- `turntable` `{ on, speed? }`
- `focus` `{ ndc | null }`
- `orb_create` `{ ndc }`

## Keyboard fallback — full key map

| Key | Action |
|---|---|
| `P` (hold) | Point at the cursor |
| `G` | Grab toggle (pinch_start ↔ pinch_end) |
| `B` | Toggle scope: object ↔ assembly |
| `← → ↑ ↓` | Move the virtual cursor |
| `Q`/`E` · `R`/`F` · `C`/`V` | Rotate yaw · pitch · roll |
| `Z`/`X` or wheel | Zoom in / out |
| `O` | Explode toggle |
| `M` | Cycle render mode |
| `Space` / `T` | Turntable toggle |
| `[` / `]` | Snap to previous / next view |
| `1` `2` `3` `4` | Snap to front / iso / right / top |
| `K` | Focus / isolate toggle at the cursor |
