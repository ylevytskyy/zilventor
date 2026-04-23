# ZilInventor Sub-project 2a — Interactive Sketcher

- **Date:** 2026-04-23
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 2a of ZilInventor's Sub-project 2 (sketcher with constraints). Interactive drawing of 5 primitive types, endpoint + H/V axis snapping, numeric-input-during-draw, closed-loop detection. **No constraint solver** — that arrives in 2b. **No dimensional constraints** — that arrives in 2c.

---

## 1. Overview and scope

### 1.1 Why 2a is a separate spec

The original Shell MVP spec (§1.2) described Sub-project 2 as "2D sketcher with constraints — lines, arcs, circles, splines; parallel/perpendicular/coincident/tangent/dimensional constraints via planegcs." In brainstorming it became clear that "sketcher with constraints" is at least three independently-shippable leaps:

1. Interactive drawing (click-click-click primitives, replacing numeric-input dialogs).
2. Geometric constraints + planegcs solver (parallel, perpendicular, tangent, etc.).
3. Dimensional constraints (typed values that drive geometry).

Each is ~2 weeks of work. 2a is (1). 2b is (2). 2c is (3).

### 1.2 What 2a ships

An interactive 2D sketcher that replaces the Shell MVP's numeric-input rectangle dialog with:

- **Click-click-click drawing** of five primitive types: Line, Rectangle, Circle, Arc, Spline.
- **Endpoint snapping** to existing primitives within pixel tolerance.
- **Horizontal/vertical axis snapping** from the current anchor point within 3°.
- **Numeric input during draw** — Inventor-style: typing a number replaces the next click.
- **Closed-loop detection** so extrusion of a multi-primitive sketch works (or returns a clear error).

All without a constraint solver. Constraints that today are implicit in a rectangle (four right-angle corners) stay implicit. Explicit constraints arrive in 2b.

### 1.3 What 2a does not ship

- No geometric constraints (parallel, perpendicular, coincident, tangent, equal).
- No dimensional constraints (driven distances, radii, angles).
- No drag-to-reshape existing geometry. Edit = delete + redraw.
- No sketching on arbitrary faces of existing solids. XY plane only.
- No sketch "fully constrained" indicator. The concept isn't meaningful without a solver.
- No grid snap. Grid is visual only.
- No construction geometry (reference lines that don't contribute to a profile).

### 1.4 Why this scope

Every feature past the line above either (a) requires the solver (2b), (b) requires per-face sketch-plane transforms (future sub-project), or (c) would be significantly rewritten when 2b arrives. The discipline: ship interaction and primitives now so users draw real custom furniture profiles; ship solver-dependent correctness next.

---

## 2. Requirements and success criteria

### 2.1 Locked decisions from brainstorming

- **Primitive set:** Line + Rectangle + Circle + Arc + Spline. Spline uses control-point polygon, uniform knots, degree 2 or 3 (default 3).
- **Interaction paradigm:** pure click-click-click plus numeric-input-during-draw. No drag primitives.
- **Snap set:** endpoint snap (within pixel tolerance) + horizontal/vertical axis snap from current anchor (within 3°). No midpoint, center, or intersection snap in 2a.
- **Editing model:** create-only. Delete via select + `Del`. Undo/redo works (pre-existing Shell MVP machinery).
- **Sketch plane:** XY only.
- **Numeric input fallback:** `SketchRectangleDialog` (Shell MVP's numeric-only rectangle input) is kept as a fallback — useful for accessibility, scripting, and anyone who prefers keyboard-only — but demoted from the default.

### 2.2 Success criteria

2a is done when all of these are demonstrably true on the target laptop (2014–2016 Intel HD, 4–8 GB RAM, current Chromium):

1. Designer enters sketch mode, draws any mixture of the 5 primitive types using only the mouse, exits sketch mode, primitives persist.
2. During drawing, cursor snaps to endpoints within pixel tolerance and to horizontal/vertical axes from the current anchor within 3°, with visible snap indicators.
3. Typing a number (optionally pressing `Tab` to move between fields) during any primitive draw commits that exact value instead of the next click.
4. Selecting a committed primitive and pressing `Delete` removes it. `Ctrl+Z` restores it. `Ctrl+Y` re-removes it.
5. A sketch whose primitives form exactly one closed loop extrudes to a solid; zero or multiple loops returns a typed `degenerateSketch` error with a user-visible message.
6. Every Shell-MVP workflow (create-box, edit-undo, save-reopen, PWA-offline) passes without regression.
7. Enter-sketch-mode ≤ 200 ms; commit-primitive ≤ 100 ms; closed-loop detection on 20 primitives ≤ 50 ms.

### 2.3 Performance budgets

See §7.

---

## 3. Foundation approaches

### 3.1 Chosen approach — tool classes with explicit state machines

One `SketchTool` subclass per primitive: `LineTool`, `RectTool`, `CircleTool`, `ArcTool`, `SplineTool`. Each subclass owns a state machine (e.g. `LineTool`: IDLE → WAITING_END → COMMITTED) and an in-progress primitive. Viewport hosts the active tool; pointer, keyboard, and numeric-input events flow into the tool's `handleInput(event)`. Tool emits a committed `SketchPrimitive` via the existing command bus when done.

**Why:** adding a future primitive (ellipse, slot) is a new file, not a modification to shared reducer logic. Each tool is independently testable with synthetic events. Matches the Command pattern already used elsewhere in the app.

### 3.2 Rejected approaches

- **Single sketcher reducer.** Becomes a sprawl of nested switch statements as primitive count grows. Testing one tool's behaviour in isolation requires setting up the whole sketcher state.
- **Outsource drawing to Konva/Paper.js.** Creates two renderer worlds (2D lib + three.js) that must stay coordinate-, style-, and event-consistent. Integration pain exceeds the library's drawing benefits.

### 3.3 Supporting stack

| Layer | Choice |
|---|---|
| Sketch mode rendering | Extend existing three.js scene: orthographic camera normal to XY, 2D grid, primitives as `Line2` / `LineSegments` / `Mesh` |
| Tool framework | `SketchTool` base class + 5 concrete subclasses + `ActiveToolController` |
| Snap resolver | Pure function in `packages/app/src/sketcher/snap.ts` |
| Primitive storage | Extended `SketchPrimitive` discriminated union (5 variants, each with `id`) |
| OCCT edge generation | New helpers in `packages/kernel/src/occt/SketchOps.ts` |
| Extrude integration | New closed-loop detector in kernel; returns wire or typed error |
| Numeric input | Floating input overlay at cursor, focus-steal during draw |
| Tests | Vitest for tools and snap, kernel integration for edges and loop detector, Playwright for workflows + perf |

---

## 4. Architecture

### 4.1 Layers added to the main thread

Three new modules, all under a new `packages/app/src/sketcher/` directory:

1. **`SketchModeController`** — owns the mode transition. Camera to orthographic normal to XY, grid visible, ribbon context swap, store flag. ~80 lines.
2. **`ActiveToolController`** — instantiates the right `SketchTool` for the selected primitive; routes pointer, keyboard, numeric-input events; handles `Esc` and tool-level `Enter`. ~60 lines.
3. **Sketch tool hierarchy** — `SketchTool` base class plus 5 subclasses. Each holds a state machine and an in-progress primitive. ~80–120 lines each.

### 4.2 Main-thread rendering changes

The existing three.js `SceneManager` gets extended — not replaced:

- Existing perspective camera + OrbitControls stay for model mode.
- New `OrthoSketchCamera` wraps the camera swap during sketch mode.
- New `SketchOverlay` group holds snap markers, dashed axis hints, draft-primitive preview.
- Committed sketch primitives render as `Line2` / `LineSegments` / `Mesh` objects in a separate `CommittedSketch` group. Rebuilt from `PartDocument.featureTree` whenever the active part changes.

### 4.3 Kernel extensions

- `SketchOps.ts` grows four new edge helpers (`makeLineEdge`, `makeArcEdge`, `makeCircleEdge`, `makeSplineEdge`) plus one combiner (`combineEdgesIntoWires`).
- `executeSketchFeature` (adapter) accepts multi-primitive sketches, builds edges, runs the combiner, returns either a single closed wire or a `degenerateSketch` error.
- OCCT itself is unchanged.

### 4.4 Data flow — "draw a line"

```
User clicks in viewport
  → Viewport pointer handler → ActiveToolController.handlePointer(event)
  → LineTool.handleClick(point)                  # tool FSM
  → snap.resolve(point, ctx)                     # pure
  → LineTool state: IDLE → WAITING_END, stores firstPoint

User moves mouse
  → Viewport move handler → ActiveToolController.handleMove
  → LineTool.handlePointerMove(point)
  → snap.resolve with activeAnchor = firstPoint
  → SketchOverlay updates preview + axis hints    # no allocation, object reuse

User presses Enter (after typing 500)
  → ActiveToolController's numeric capture → LineTool.commitNumeric(500)
  → LineTool computes endpoint, builds primitive, state → COMMITTED
  → bus.execute(new AddPrimitiveCommand({ kernel, store, sketchId, primitive }))
  → AddPrimitiveCommand.apply:
      kernel.addPrimitive(sketchId, primitive)     # NEW RPC
      getPart refresh
      setActivePart(nextPart)
  → CommittedSketchRenderer picks up the new primitive, adds a Line2
  → LineTool resets to IDLE, ready for next click
```

### 4.5 Design rules

1. **Tool controller is the sole owner of "what primitive is being drawn now."** Mode controller owns mode. Tool controller owns tool. Tools own their own state. No cross-concerns.
2. **Snap resolver is pure and synchronous.** No store, no kernel calls. Takes `(cursorPoint, currentSketch, activeAnchor?)`, returns `{ point, snapKind }`.
3. **Drafts never touch OCCT.** Previews are three.js-only during drawing. OCCT sees a primitive only after commit.
4. **Tool validation happens before emitting a command.** Invalid primitives (spline with one point, circle with zero radius) never reach the command bus.

---

## 5. Module structure

Only new / modified files. Shell-MVP files not listed here are untouched.

```
packages/
├── app/
│   └── src/
│       ├── sketcher/                                NEW — entire subsystem
│       │   ├── index.ts
│       │   ├── SketchModeController.ts
│       │   ├── ActiveToolController.ts
│       │   ├── snap.ts
│       │   ├── tools/
│       │   │   ├── SketchTool.ts                    base class
│       │   │   ├── LineTool.ts
│       │   │   ├── RectTool.ts
│       │   │   ├── CircleTool.ts
│       │   │   ├── ArcTool.ts
│       │   │   ├── SplineTool.ts
│       │   │   └── __tests__/
│       │   │       ├── LineTool.spec.ts
│       │   │       ├── RectTool.spec.ts
│       │   │       ├── CircleTool.spec.ts
│       │   │       ├── ArcTool.spec.ts
│       │   │       └── SplineTool.spec.ts
│       │   ├── overlay/
│       │   │   ├── SketchOverlay.ts
│       │   │   ├── SnapMarker.ts
│       │   │   └── AxisHint.ts
│       │   ├── render/
│       │   │   └── CommittedSketchRenderer.ts
│       │   └── __tests__/
│       │       ├── snap.spec.ts
│       │       ├── ActiveToolController.spec.ts
│       │       └── SketchModeController.spec.ts
│       ├── commands/
│       │   ├── AddPrimitiveCommand.ts               NEW
│       │   ├── DeletePrimitiveCommand.ts            NEW
│       │   └── __tests__/commands.spec.ts           extended
│       ├── shell/
│       │   ├── tabs/
│       │   │   └── SketchTab.tsx                    MODIFIED — 5 buttons + sketch-mode wiring
│       │   └── SketchRectangleDialog.tsx            KEPT as fallback
│       ├── store/
│       │   └── useAppStore.ts                       EXTENDED — sketchMode, activeSketchId, activeToolKind
│       ├── viewport/
│       │   ├── SceneManager.ts                      MODIFIED
│       │   └── Viewport.tsx                         MODIFIED
│       └── App.tsx                                  MODIFIED
│
├── kernel/
│   └── src/
│       ├── occt/
│       │   ├── SketchOps.ts                         EXTENDED
│       │   └── __tests__/SketchOps.spec.ts          extended
│       ├── adapter/
│       │   └── features/
│       │       ├── SketchFeature.ts                 MODIFIED
│       │       └── __tests__/SketchFeature.integration.spec.ts   extended
│       ├── api.ts                                   MODIFIED — addPrimitive, removePrimitive RPCs
│       └── __tests__/
│           └── save-roundtrip.integration.spec.ts   extended — multi-primitive round-trip
│
└── shared/
    └── src/
        ├── types.ts                                 EXTENDED — 5-variant SketchPrimitive with id
        └── fileFormat.ts                            EXTENDED — v1 → v2 migration
```

### 5.1 Hook points for future sub-projects

- `SketchPrimitive` union can grow new variants (ellipse, polygon, slot) with no migration needed.
- `SketchTool` base class is the plug point for future tool subclasses.
- `combineEdgesIntoWires` returns both closed wires and open chains — 2b's solver will consume open-chain data to propose constraints.
- Sketch feature's stored representation has no constraint field yet. 2b adds `constraints: Constraint[]` — an additive change.

---

## 6. Data model

### 6.1 Extended `SketchPrimitive`

Shell MVP (v1):

```ts
export type SketchPrimitive =
  | { kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; cx: number; cy: number; r: number };
```

Sub-project 2a (v2):

```ts
export type SketchPrimitive =
  | { id: string; kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { id: string; kind: 'rectangle'; x: number; y: number; w: number; h: number }
  | { id: string; kind: 'circle'; cx: number; cy: number; r: number }
  | { id: string; kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }
  | { id: string; kind: 'spline'; controlPoints: ReadonlyArray<{ x: number; y: number }>; degree: 2 | 3; closed: boolean };
```

**Key changes:**
- Every primitive has a stable `id` (UUID). Required so `DeletePrimitiveCommand` can target a specific primitive and undo/redo can faithfully restore.
- **Arc** is stored as center + radius + start/end angles. ArcTool's 3-click input converts to this canonical form at commit.
- **Spline** is control polygon + degree + closed flag. Uniform knots implied. Non-uniform knots out of scope.

### 6.2 File format version bump: v1 → v2

`CURRENT_FORMAT_VERSION` in `packages/shared/src/fileFormat.ts` bumps from `1` to `2`.

**Migration v1 → v2:** for each sketch feature, synthesize primitive ids deterministically as `${sketchId}-p${index}`. v1 files reopen cleanly; re-saving writes v2 format.

**Migration loop progress guard** (flagged latent in Shell MVP review): this is the moment the dispatcher gets its first real migration, so we fix the progress guard now — a migration that returns a manifest whose `formatVersion` did not increase fails loudly. ~5 lines.

### 6.3 Unchanged shapes

`PartDocument`, `ProjectFile`, `CachedGeometry`, `Parameter`, `Mesh`, `BoundingBox` all unchanged in shape. Execution/caching semantics unchanged.

### 6.4 No new domain types

Store extensions (§4.1) are UI state only, never saved. Tool internal state lives in the tool instance, never saved. Snap state is per-frame, never saved.

---

## 7. Primary workflows

### 7.1 Enter sketch mode

1. User clicks **Sketch tab → 2D Sketch**.
2. `SketchTab` dispatches `startSketch`: `sketchMode = true`, creates a new sketch feature, sets `activeSketchId`.
3. `SketchModeController`: camera to orthographic normal to XY (≤ 200 ms animation), grid visible, ribbon context swap, OrbitControls → 2D pan/zoom.
4. Status bar: **"Sketch in progress — press Esc to exit"**.

### 7.2 Draw a line with axis snap and numeric input

1. User clicks **Line**. `ActiveToolController` swaps to `LineTool`, state `IDLE`.
2. User clicks ≈(10, 10). `snap.resolve` returns unchanged. `LineTool.handleClick(10, 10)` → `WAITING_END`, `firstPoint = (10, 10)`.
3. User moves cursor. `snap.resolve(cursor, activeAnchor=(10,10))`: within 3° of horizontal → `snap = 'horizontal-axis'`. Overlay shows dashed axis line + line preview.
4. User types `500`. Floating input near cursor shows `500`.
5. User presses Enter. `LineTool.commitNumeric(500)` → endpoint 500 mm along snapped direction. State → `COMMITTED`.
6. `AddPrimitiveCommand` emitted via bus. Kernel's `addPrimitive` appends to sketch feature. Store updates. `CommittedSketchRenderer` adds the `Line2`.
7. Tool resets to `IDLE`. Browser pane: **Sketch1 (1 primitive)**.

### 7.3 Draw a spline and finish with Enter

1. User clicks **Spline**. `SplineTool`, `IDLE`.
2. User clicks five points. After click 2, tool renders live Bézier preview through the control points.
3. User presses Enter. `SplineTool.commit()` → primitive with five control points, degree 3, `closed: false`.
4. Same commit path as the line.
5. Alternative: Esc before commit. Tool aborts; points discarded; tool stays active for a fresh spline.

### 7.4 Extrude a multi-primitive sketch (happy path)

1. User has drawn six lines forming an L-shape. Esc (or "Finish Sketch") exits sketch mode. Camera returns to perspective.
2. User clicks **Model → Extrude**, enters 18, OK.
3. `AddExtrusionCommand` → kernel executes tree.
4. `executeSketchFeature` collects six line primitives. Makes six edges. Passes to `combineEdgesIntoWires`.
5. Combiner walks edges, matches endpoints within ε = 1e-3 mm. Finds one closed loop. Returns `{ closedWires: [wire], openChains: [] }`.
6. Adapter returns the closed wire. Extrude runs. Mesh renders.

### 7.5 Extrude fails on open sketch

1. User has three open lines (not connected into a loop). Click Extrude → 18 → OK.
2. Combiner finds 0 closed, 1 open chain.
3. Adapter returns `err({ kind: 'degenerateSketch', message: 'Sketch is not closed — cannot extrude. Check that all endpoints connect.', ... })`.
4. Status bar shows error message. Viewport keeps last valid mesh. Sketch primitives still in place.
5. User re-enters sketch mode, closes the loop, retries. Works.

### 7.6 Undo/redo primitive add and delete

1. User draws a line. `AddPrimitiveCommand` on undo stack.
2. `Ctrl+Z`: command's `revert` → kernel `removePrimitive(sketchId, id)` → store update → renderer unmounts the `Line2`.
3. `Ctrl+Y`: redo → line back.
4. Delete (select + `Del`): `DeletePrimitiveCommand` snapshots the full primitive. Revert re-adds it with the same id.

---

## 8. Closed-loop detection

### 8.1 Algorithm

Inputs: edges produced by the sketch's primitives.

```
combineEdgesIntoWires(primitives, ε = 1e-3 mm):
  inherentlyClosed = []
  openEdges = []

  for each primitive:
    switch primitive.kind:
      'circle':
        edge = makeCircleEdge(...)
        wire = BRepBuilderAPI_MakeWire(edge).Wire()
        inherentlyClosed.push(wire)
      'rectangle':
        4 connected edges → wire (already closed)
        inherentlyClosed.push(wire)
      'spline' with closed = true:
        edge = makeSplineEdge(...)
        wire = BRepBuilderAPI_MakeWire(edge).Wire()
        inherentlyClosed.push(wire)
      default:  # line, arc, open spline
        edge = makeEdge(...)
        openEdges.push({ edge, startPoint, endPoint })

  chains = []
  remaining = [...openEdges]
  while remaining.length > 0:
    chain = [remaining.shift()]
    extended = true
    while extended:
      extended = false
      for each candidate in remaining:
        if endpointsMatch(chain.end, candidate.start, ε):
          append; remaining.delete; extended = true; break
        if endpointsMatch(chain.end, candidate.end, ε):
          append reversed; remaining.delete; extended = true; break
        if endpointsMatch(chain.start, candidate.end, ε):
          prepend; remaining.delete; extended = true; break
        if endpointsMatch(chain.start, candidate.start, ε):
          prepend reversed; remaining.delete; extended = true; break
    chains.push(chain)

  openChains = chains.filter(c => !endpointsMatch(c.start, c.end, ε))
  closedChains = chains.filter(c => endpointsMatch(c.start, c.end, ε))

  closedWires = [
    ...inherentlyClosed,
    ...closedChains.map(c => BRepBuilderAPI_MakeWire(c.edges).Wire())
  ]

  return { closedWires, openChains }
```

### 8.2 Extrude validation

A sketch is extrudable iff `closedWires.length === 1 && openChains.length === 0`.

| Condition | User message |
|---|---|
| 0 closed, ≥ 1 open | "Sketch is not closed — cannot extrude. Check that all endpoints connect." |
| 0 closed, 0 open | "Sketch is empty — cannot extrude. Draw a closed profile first." |
| ≥ 2 closed, 0 open | "Sketch has multiple closed loops — cannot extrude. Merge or delete loops so exactly one remains. (Hole support comes in Sub-project 3.)" |
| ≥ 1 closed, ≥ 1 open | "Sketch has a valid loop plus disconnected line(s). Delete the stray lines or connect them." |

All returned via `Result<T, KernelError>` with `kind: 'degenerateSketch'`.

### 8.3 Tolerance

`ε = 1e-3 mm = 1 µm`:
- Above floating-point noise for double-precision numbers at typical mm magnitudes.
- Below furniture manufacturing precision (0.1 mm).
- Well below pixel-level snap precision, so snapped endpoints coincide within ε reliably.

Named constant in `SketchOps.ts` for easy tuning.

### 8.4 Performance

O(N²) worst-case on N primitives. For N = 20 (generous 2a upper bound) → 400 endpoint comparisons ≤ 50 ms. If future growth pushes N into hundreds, a quad-tree spatial index on endpoints reduces to O(N log N). Not built now.

### 8.5 Not solved

- Self-intersecting chains (figure-8). Passes the detector but OCCT's `MakeFace` rejects. Surfaces as `booleanFailed` `KernelError`, not `degenerateSketch`. Good-enough for 2a.
- Non-planar chains — impossible on the XY-only sketch plane.
- Tangent continuity at joints — matters for surface fairness, not extrude validity.

---

## 9. Performance plan

### 9.1 Budgets (new for 2a)

| Dimension | Budget | Measurement |
|---|---|---|
| Enter sketch mode | ≤ 200 ms | Playwright timing |
| Exit sketch mode (includes downstream extrude re-run) | ≤ 500 ms | Playwright timing |
| Commit a primitive | ≤ 100 ms | Playwright timing |
| Snap resolver per mousemove | ≤ 1 ms | Synthetic benchmark (N = 50) |
| Closed-loop detection on 20 primitives | ≤ 50 ms | Kernel integration test |
| Numeric input keystroke → floating input redraw | ≤ 16 ms | PerformanceObserver longtask |
| Memory per primitive (domain + overlay) | ≤ 5 KB | Heap snapshot delta |

All Shell MVP budgets continue to hold; a 2a CI run that breaches any blocks ship.

### 9.2 Suspend downstream re-execution during sketch mode

**Rule:** while `sketchMode = true`, primitive add/delete updates the kernel sketch but does **not** trigger re-execution of downstream features. On sketch exit, a single full `kernel.execute` runs with the final sketch state.

Without this rule, every primitive click triggers a full extrude + tessellation (~300 ms of hidden work). On a 20-primitive sketch that's 6 seconds of cumulative lag the user never sees the benefit of. Implementation: `App.tsx`'s re-execute effect gates on `!sketchMode`.

### 9.3 Overlay rendering

Overlay objects (snap markers, axis hints, draft preview) are reused across frames — property updates only, no allocation. One `Line2` instance for the draft preview. No scene-graph churn.

### 9.4 Snap resolver cost

O(N) scan over primitives; viewport-bound pre-filter. At N = 50, ~10 µs per mousemove. Well under 1 ms budget. No spatial index for 2a.

### 9.5 Spline tessellation

Pre-commit: sample the in-progress curve at 32 points per frame (cheap). Post-commit: pre-sample once, upload to GPU buffer. Zoom doesn't re-sample. For splines with > 10 control points, increase samples to 64 for visual quality.

### 9.6 Worker boundary

Every primitive add = one Comlink `addPrimitive` call. ~80 bytes of JSON + ~0.5 ms RPC overhead. For 10 primitives in 5 s: 5 ms total overhead, invisible.

### 9.7 New perf tests

- `tests/perf/enter-sketch-mode.spec.ts` — click 2D Sketch → assert grid visible within 600 ms (3× headroom over 200 ms).
- `tests/perf/draw-20-primitives.spec.ts` — programmatically drive 20 primitive adds + exit sketch. Assert ≤ 5 s total and ≤ 500 ms exit-extrude.

---

## 10. Error handling

### 10.1 New failure modes

| Failure | Detection | User-visible | Recovery |
|---|---|---|---|
| Sketch not closed on extrude | Combiner open chains ≥ 1 | Toast: "Sketch is not closed — cannot extrude." | User adds closing primitive |
| Sketch empty on extrude | No primitives | Toast: "Sketch is empty — draw a closed profile first." | User draws |
| Multiple closed loops | Combiner closed wires ≥ 2 | Toast: "Multiple loops — keep exactly one." | User deletes extras |
| Stray lines with valid loop | Combiner closed ≥ 1 AND open ≥ 1 | Toast: "Stray disconnected line(s). Delete or connect." | User cleans up |
| Self-intersecting chain | OCCT MakeFace rejects | Toast: "Sketch profile has a self-intersection." | User fixes |
| Numeric input NaN / non-positive | Tool validates on commit | Input border red, no commit | User types valid value |
| Spline with < 2 control points | SplineTool refuses commit | Enter is a no-op | Self-healing |
| Circle / arc with radius 0 | Tool refuses commit | Toast: "Radius must be positive." | User re-clicks |
| v1 file load | Migration function | Silent migration | First save writes v2 |
| Migration loop infinite | Progress guard | "no migration from formatVersion N" | Developer diagnostic |

### 10.2 Rules the codebase enforces

Shell MVP rules (Result over Comlink, no catch-and-swallow, structured logging, rollback = undo, atomic writes) all continue.

**New:** tool validation happens before emitting a command. An `AddPrimitiveCommand` never receives an invalid primitive.

### 10.3 Deferred to later sub-projects

- Crash-recovery autosave — carry-forward from Shell MVP, still not in scope.
- Self-intersection pre-check — left to OCCT's MakeFace to catch.
- Offline telemetry buffer — carry-forward.

---

## 11. Testing strategy

### 11.1 Unit tests (Vitest)

**Per-tool state-machine tests** — one `.spec.ts` per tool. Synthetic events drive IDLE → intermediate → COMMITTED → IDLE transitions. No DOM. No three.js. Each ≤ 100 lines.

**Snap resolver tests** — pure function tests:
- Empty sketch → unchanged.
- Endpoint within tolerance → snap.
- Horizontal-axis snap within 3° → adjust y.
- Vertical-axis snap within 3° → adjust x.
- Endpoint + axis candidates → endpoint wins.

**Sketch mode + tool controller tests** — mode flip, tool swap, Esc abort.

**Schema / migration tests** — v1 sketch loads with ids synthesized. Migration loop guard rejects non-advancing migrations.

**Command tests** — `AddPrimitiveCommand` / `DeletePrimitiveCommand` apply + revert round-trip. Revert restores exact prior state including primitive ids.

### 11.2 Integration tests (Vitest + real OCCT in Node)

`SketchOps.spec.ts` extensions:
- `makeLineEdge`, `makeArcEdge`, `makeCircleEdge`, `makeSplineEdge` each produce a valid OCCT edge with expected geometric properties.
- `combineEdgesIntoWires`:
  - 4 lines → square → 1 closed wire.
  - 3 lines in L → 1 open chain.
  - 6 lines L-shape → 1 closed wire.
  - Square + 1 stray line → 1 closed + 1 open.
  - Circle + rectangle → 2 closed wires.

`SketchFeature.integration.spec.ts` extensions — line + arc D-shape extrudes; open polyline returns error; two rectangles return multiple-loops error.

### 11.3 E2E (Playwright)

Six new tests under `tests/e2e/sketcher/`:

- `enter-sketch-mode.spec.ts`
- `draw-line.spec.ts`
- `draw-spline.spec.ts`
- `extrude-l-shape.spec.ts`
- `extrude-fails-open-sketch.spec.ts`
- `undo-primitive.spec.ts`

All existing Shell MVP E2Es (`workflow-2`, `workflow-3`, `workflow-4`, `pwa-offline`) continue to pass. No regression tolerated.

### 11.4 Perf (Playwright, perf project)

Two new tests: `enter-sketch-mode.spec.ts`, `draw-20-primitives.spec.ts`. Existing cold-start and build-box continue.

### 11.5 Visual regression

Deferred. One E2E viewport `toHaveScreenshot` with 2 % pixel tolerance as smoke; full visual diffing deferred to a future sub-project.

### 11.6 Manual test checklist

New sibling to `shell-mvp.md`: `docs/superpowers/manual-tests/subproject-2a.md`. Covers drawing each primitive on target hardware, snap exercises, numeric input flow, happy-path and error-path extrudes.

### 11.7 TDD posture and CI

Every non-trivial unit lands as a failing test first. CI runs typecheck + lint + unit + integration + E2E on every PR. Perf gated on main.

---

## 12. What happens next

1. User reviews this spec.
2. Edits resolved inline.
3. `superpowers:writing-plans` skill consumes this spec and produces an implementation plan broken into TDD-friendly tasks.
4. Implementation proceeds against that plan using subagent-driven development.
5. When §2.2 success criteria are all true, 2a closes; next brainstorm is Sub-project 2b (geometric constraints + planegcs solver).

**Reference:** Shell MVP spec at `docs/superpowers/specs/2026-04-21-zilinventor-shell-mvp-design.md`. Shell MVP plan at `docs/superpowers/plans/2026-04-21-zilinventor-shell-mvp-plan.md`.
