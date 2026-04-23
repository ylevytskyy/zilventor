# Sub-project 2b — Geometric constraints + planegcs solver

**Date:** 2026-04-23
**Status:** Design, awaiting user review → implementation plan
**Predecessor:** Sub-project 2a (interactive sketcher, shipped at commit `995a60f`)
**Successor:** Sub-project 2c (dimensional constraints)

---

## 1. Goal

Add geometric constraints to the 2D sketcher. Lines, arcs, circles, and points can be constrained with eight relationships. Constraints are solved live by `planegcs` (WASM port of FreeCAD's GCS). Dragging a point updates the solution in real time, so constrained sketches deform coherently — matching the muscle memory a user has from Inventor 2012.

## 2. Scope

### In scope (2b)
Eight geometric constraint kinds:
`parallel`, `perpendicular`, `horizontal`, `vertical`, `coincident`, `tangent`, `equal`, `symmetric`.

Live per-drag solve, auto-constraint inference from snaps, auto-inference during v2 → v3 migration of legacy sketches, over-/under-constrained detection and display, constraint badges in the viewport, select-arrow sketch mode, DOF display in the status bar, persistence in file-format v3.

### Out of scope
- Dimensional constraints (length, distance, angle, radius) — **deferred to 2c**.
- Driven dimensions, parametric equations — **2c or later**.
- Rectangle "explode" (breaking a rectangle into editable edges) — **future**.
- 3D constraints — **later sub-projects**.
- Fillet / chamfer / hole on 2D sketches — **Sub-project 3**.

## 3. Foundational decisions (locked during this brainstorming)

| Decision | Choice |
|---|---|
| Constraint types | 8 geometric, dimensions deferred |
| Live drag-solve | Per-frame (Inventor-faithful) |
| Auto-constraints from snaps | Yes (endpoint → coincident, axis hint → H / V) |
| Solver location | Dedicated sketcher worker (new) |
| Worker state model | Stateful (GCS system lives for the duration of sketch mode) |
| Legacy 2a sketches | Best-effort inference on v2 → v3 migration |
| Sketch default tool | Select arrow (Inventor 2012 faithful) |
| Constraint badges | Always visible; status bar shows DOF |

## 4. Architecture

Three threads. One new worker.

```
MAIN THREAD                     SKETCHER WORKER (new)           KERNEL WORKER (existing)
─────────────────────────       ──────────────────────          ────────────────────────
React + Zustand store           planegcs WASM                   OCCT WASM
SketchTool (5, from 2a)         Live GcsSystem (one per sketch) SketchFeature, FeatureTree
SelectTool (new)                Auto-inference rules            (unchanged)
ConstraintTool (new)
SketcherClient (Comlink wrap)
ConstraintBadgeRenderer (new)
Status-bar DOF display (new)

                   Comlink RPC ─────────►                     ◄──── Comlink RPC (as before)
                   per drag frame                             Finish Sketch still re-executes
                                                              the tree on the kernel worker.
```

OCCT never sees constraints. The kernel worker's `executeSketchFeature` keeps reading only `primitives[]`; constraint data is strictly a 2D-layer concern.

## 5. Data model

Extend `packages/shared/src/types.ts`:

```ts
export type PointRef =
  | { primitiveId: string; anchor: 'start' | 'end' | 'center' }
  | { primitiveId: string; anchor: `cp${number}` };   // spline control points

export type SketchConstraint =
  | { id: string; kind: 'coincident';    a: PointRef; b: PointRef }
  | { id: string; kind: 'horizontal';    line: string }
  | { id: string; kind: 'vertical';      line: string }
  | { id: string; kind: 'parallel';      line1: string; line2: string }
  | { id: string; kind: 'perpendicular'; line1: string; line2: string }
  | { id: string; kind: 'tangent';       line: string; arc: string }
  | { id: string; kind: 'equal';         a: string; b: string }       // lines (length) or arcs/circles (radius)
  | { id: string; kind: 'symmetric';     a: PointRef; b: PointRef; axis: string };

export type ConstraintSource = 'user' | 'auto-snap' | 'inferred-migration';

// Extended Feature:
| { kind: 'sketch';
    id: string;
    plane: 'XY' | 'XZ' | 'YZ';
    primitives: SketchPrimitive[];
    constraints: SketchConstraint[];   // NEW — empty array valid
    // Optional provenance on each constraint rather than the feature:
    // (source is a tagged field on each constraint when it matters)
  }
```

Constraints are stored as a flat array on the sketch feature. Each constraint has a stable `id` so selection and deletion are unambiguous. Provenance (`source`) is carried on each `SketchConstraint` via an optional extra field; it is informational, not load-bearing for solve semantics.

**Rectangles** remain a single primitive in the store. When the sketcher worker builds the GCS system, rectangles are internally expanded into 4 edges + 4 corners with implicit constraints (H on top/bottom, V on left/right, coincident corners). These implicit constraints are never added to `feature.constraints` and are never visible as badges; they're part of the rectangle's identity.

**DOF status** is computed after each solve and kept in the Zustand store only (`sketchDof: { count: number; state: 'under' | 'fully' | 'over' } | null`). Not persisted.

## 6. Sketcher worker API

New package `packages/sketcher-worker/`. The worker exposes (over Comlink):

```ts
export interface SketcherWorkerApi {
  // Lifecycle
  loadSketch(args: {
    primitives: SketchPrimitive[];
    constraints: SketchConstraint[];
  }): Promise<{ dof: DofStatus; warnings: SolverWarning[] }>;
  unloadSketch(): Promise<void>;

  // State mutations (mirror Zustand actions)
  addPrimitive(p: SketchPrimitive): Promise<{ dof: DofStatus }>;
  removePrimitive(id: string): Promise<{ dof: DofStatus }>;
  updatePrimitive(id: string, patch: Partial<SketchPrimitive>): Promise<{ dof: DofStatus }>;
  addConstraint(c: SketchConstraint): Promise<AddConstraintResult>;
  removeConstraint(id: string): Promise<{ dof: DofStatus }>;

  // Drag hot path (≤ 60 Hz)
  beginDrag(ref: PointRef): Promise<void>;
  dragTo(x: number, y: number): Promise<DragSolveResult>;
  endDrag(): Promise<{ dof: DofStatus; finalCoords: PrimitiveCoordsDiff[] }>;

  // Inference helpers
  inferFromSnaps(p: SketchPrimitive, snapEvents: SnapEvent[]): Promise<SketchConstraint[]>;
  // Pure, stateless; also exported from @zilventor/shared for migration.
  inferFromGeometry(primitives: SketchPrimitive[]): Promise<SketchConstraint[]>;
}

type DofStatus = { count: number; state: 'under' | 'fully' | 'over' };
type AddConstraintResult =
  | { ok: true;  dof: DofStatus; coords: PrimitiveCoordsDiff[] }
  | { ok: false; reason: 'redundant' | 'conflict'; offendingConstraintIds: string[] };
type DragSolveResult = { coords: PrimitiveCoordsDiff[]; dof: DofStatus; solverMs: number };
type PrimitiveCoordsDiff = { primitiveId: string; patch: Partial<SketchPrimitive> };
```

**Invariants:**
- `loadSketch` must precede every method except `inferFromGeometry` (stateless).
- `beginDrag` / `dragTo` / `endDrag` form a bracket; `dragTo` outside a drag errors.
- All mutations return the new `DofStatus`; no separate `getDof` call.
- `addConstraint` returning `{ ok: false }` leaves state unchanged. No `force: true` option in 2b.

A thin `SketcherClient` on main thread wraps Comlink, maps diffs into Zustand, and subscribes to `useAppStore` so out-of-band store edits keep the worker in sync.

## 7. Auto-constraint inference

Two call sites, one shared rule set. Pure functions exported from `@zilventor/shared` so both the migration code and the worker can use them.

### Live (during drawing)

Each 2a drawing tool extends its `committed` output with the list of `SnapResult`s that produced the primitive's points. The `ActiveToolController` passes them to `SketcherClient.inferFromSnaps()` after `AddPrimitiveCommand` applies.

Rules applied in order, duplicates rejected by structural equality:

1. **Endpoint snap** — if the snap on the primitive's start or end matched an existing primitive's point, add `coincident(newP.thatEnd, existing.thatEnd)`.
2. **H-axis hint** on a line — add `horizontal(lineId)`.
3. **V-axis hint** on a line — add `vertical(lineId)`.
4. **Rectangle** — rectangle-implicit constraints (H/V edges, coincident corners) are inherent to the primitive, not stored in `constraints[]`.

### Migration (v2 → v3), stateless

`inferFromGeometry(primitives: SketchPrimitive[])` walks one sketch with tolerance `ε = 1e-3 mm` (matches 2a's `combineEdgesIntoWires`):

1. For every pair of primitive endpoints with Euclidean distance < ε → `coincident`.
2. For every line with `|y2 − y1| < ε` → `horizontal`.
3. For every line with `|x2 − x1| < ε` → `vertical`.
4. Rectangles contribute their rectangle-implicit constraints (rule 4 above).
5. **No** parallel / perpendicular / tangent / equal / symmetric inference — false-positive risk is too high.

Each inferred constraint is tagged `source: 'inferred-migration'`.

## 8. UI layer

### Sketch tab layout

```
[Finish Sketch] | Select Line(L) Rect(R) Circle(C) Arc(A) Spline(S) | // ⊥ — | ● ⌒ = ⇄ | Numeric rectangle…
  Sketch        |           Draw                                     |       Constrain         |    Fallback
```

- **Select** is the default the moment the user clicks "2D Sketch". Escape from any other tool returns to Select.
- Eight constraint buttons in a new "Constrain" panel. Default shortcuts: `P` parallel, `E` perpendicular, `H` horizontal, `V` vertical, `N` coincident, `T` tangent, `Q` equal, `Y` symmetric.
- Clicking a constraint button arms a `ConstraintTool`. The cursor gets a constraint glyph. Clicks select primitives (1 for H/V, 2 for most, 3 for symmetric). The tool stays armed for repeated applications until Escape.

### New files under `packages/app/src/sketcher/`

- `SketcherClient.ts` — typed Comlink wrapper, owns the worker reference, syncs with Zustand.
- `tools/SelectTool.ts` — click-to-select, drag-start detection, streams drags through `SketcherClient`.
- `tools/ConstraintTool.ts` — one class parameterised by constraint `kind`; handles N-click state machine.
- `render/ConstraintBadgeRenderer.ts` — HTML-overlay badges anchored to primitive midpoints (three.js sprites are a fallback if overlay positioning is fragile in the Viewport).
- `store/sketchDofSlice.ts` *(or fold into existing `useAppStore`)* — DOF status live in Zustand.

### Viewport overlay behavior

- Badges always visible during sketch mode. One badge per constraint, grouped by primitive to avoid overlap. Click a badge → select the constraint (red highlight). `Delete` key removes it.
- During drag: dragged point follows the cursor unsnapped; other primitives update only on worker solve response. Typical round-trip 1–3 ms; visual lag imperceptible.

### Status bar

Extends the existing `"Ready" / "mm"` footer. New segment next to the unit:
- `"24 DOF"` (amber) — under-constrained
- `"Fully constrained"` (green) — zero DOF
- `"Over constrained: 2 redundant"` (red) — conflict or redundancy present

Clicking the segment opens a small popover that lists redundant/conflicting constraint IDs; each entry jumps to that constraint in the viewport (selects + pans).

## 9. Drag-to-solve flow (hot path)

```
pointerDown on primitive endpoint
  SelectTool finds PointRef (nearest endpoint within snap tolerance)
  SketcherClient.beginDrag(ref) → worker latches the GCS parameter bound to ref

pointerMove (≤ 60 Hz)
  SelectTool screenToWorld → (x, y)
  SketcherClient.dragTo(x, y) → worker:
    1. writes (x, y) into the latched parameter
    2. temporarily fixes that parameter for this solve
    3. planegcs.solve()   (1–3 ms)
    4. reads changed params back, builds PrimitiveCoordsDiff[]
    5. returns { coords, dof, solverMs }
  main thread applies coords to Zustand (useAppStore.applyCoordDiff, new action)
  CommittedSketchRenderer + ConstraintBadgeRenderer re-render

pointerUp
  SketcherClient.endDrag() → worker unfixes the parameter, posts final snapshot
  Main thread creates one DragPrimitivesCommand with { before, after } for the undo stack.
```

**Three correctness notes:**

1. **One undo entry per drag.** Per-frame writes would pollute the undo stack. `DragPrimitivesCommand` (new, alongside `AddPrimitiveCommand` / `DeletePrimitiveCommand`) is built only at `endDrag`.
2. **Snap during drag.** SelectTool runs 2a's `resolveSnap` on every move. If the cursor snaps onto another primitive's endpoint, `endDrag` also runs `inferFromSnaps` so a new `coincident` can be added automatically.
3. **Over-constrained mid-drag.** Solver may report `over` when a conflicting constraint already exists. The worker returns the last feasible coords; the status bar flips to red. The drag is not aborted.

**Perf budget.** 60 fps target on 2014 Intel UHD laptop. 50-primitive, 40-constraint sketch. Each `dragTo` round-trip ≤ 8 ms: Comlink RPC ~1-2 ms, solve 1-3 ms, diff apply + re-render the rest. Enforced by `tests/perf/drag-constrained-sketch.spec.ts`.

## 10. Persistence (file-format v3)

`CURRENT_FORMAT_VERSION` bumps 2 → 3. New migration in `packages/shared/src/fileFormat.ts`:

```ts
2: (m) => {
  const doc = m.document as { featureTree?: Feature[] } | undefined;
  if (doc?.featureTree) {
    for (const f of doc.featureTree) {
      if (f.kind === 'sketch' && !Array.isArray((f as any).constraints)) {
        (f as any).constraints = inferFromGeometry(f.primitives);
        for (const c of (f as any).constraints) c.source = 'inferred-migration';
      }
    }
  }
  return { ...m, formatVersion: 3 };
}
```

**Bundled fix:** the 2a carry-forward flaw where v1→v2 mutated nested input in place is corrected here — the migration now clones the document before walking it. ~5 lines, stays within the scope of working in `fileFormat.ts`.

A round-trip integration test in `packages/kernel/src/__tests__/save-roundtrip.integration.spec.ts` saves a constrained sketch, re-opens, and asserts constraint-list + DOF reproduce bit-for-bit.

Kernel file format is otherwise untouched — OCCT reads only `primitives[]`, constraints are invisible to it.

## 11. Error handling

All failures return structured typed results, never throw. Same pattern as 2a's `degenerateSketch`.

| Condition | Origin | UI response |
|---|---|---|
| Redundant constraint added | `addConstraint → { ok:false, reason:'redundant' }` | Toast: "Redundant — already implied." Constraint not added. |
| Conflict (e.g., H on a line already implied vertical) | `addConstraint → { ok:false, reason:'conflict', offendingConstraintIds }` | Toast listing the conflicting ids, clickable; constraint not added. |
| Solve during drag returns `over` | `dragTo → { dof.state: 'over' }` | Status bar turns red, shows count; drag continues with last feasible coords. |
| Worker lifecycle error (crash, WASM init fail) | uncaught | Status bar shows `"Sketcher offline — reload sketch"` link; sketch mode disabled until reload. |

No blocking dialogs on the drag hot path.

## 12. Testing strategy

| Layer | Location | Coverage |
|---|---|---|
| Shared (pure) | `packages/shared/src/__tests__/` | `inferFromGeometry` golden tests; v2→v3 migration golden tests including the nested-mutation regression. |
| Sketcher worker (integration, real planegcs WASM in Node) | `packages/sketcher-worker/src/__tests__/` | Each constraint kind solves correctly; drag reproduces expected coord diffs; redundant/conflict detection; 1000-cycle soak test for memory leaks. |
| App unit | `packages/app/src/sketcher/__tests__/` | `SelectTool` endpoint-pick math; `ConstraintTool` state machines (one suite per kind); badge placement math; SketcherClient sync with a mocked worker. |
| E2E (Playwright) | `tests/e2e/sketcher/` | `draw-line-h-constraint.spec.ts`, `drag-constrained-rect-becomes-square.spec.ts`, `open-legacy-sketch-gets-badges.spec.ts`. |
| Perf | `tests/perf/` | `drag-constrained-sketch.spec.ts` — 50 prims + 40 constraints, 1 s drag, mean solverMs < 5, mean end-to-end frame < 10 ms. |
| Manual | `docs/superpowers/manual-tests/subproject-2b.md` | Golden-path checklist covering each constraint, legacy-open, drag, over-constraint recovery. |

**Acceptance:** `pnpm -r typecheck` clean, all suites green, manual checklist passes.

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `planegcs` WASM bundle size pushes PWA payload over budget | Measure on first bundle; if > 500 KB compressed, lazy-load the worker only on first entry into sketch mode (common Inventor-flow pattern anyway). |
| Comlink RPC per-frame cost on older devices | Worker state model is already stateful; `dragTo` payload is 16 bytes. Fall-back lever: batch moves at 30 Hz (decision deferred to perf test results). |
| Over-inference during v2 → v3 gives user surprising constraints | Inference rules are intentionally narrow (coincident + H/V only). Migration log captures how many were added; manual checklist includes a "open legacy file" step. |
| Solver divergence (no solution found) during drag | Worker returns last feasible coords and `dof.state: 'over'`; never crashes. |

---

## Appendix A — Open questions resolved during brainstorm

1. **Scope of constraints.** Locked to 8 geometric; dimensions deferred to 2c.
2. **Drag-to-solve.** Live per-frame, Inventor-faithful.
3. **Auto-constraints from snaps.** Yes — coincident + H/V.
4. **Solver location.** Dedicated sketcher worker.
5. **Legacy 2a sketches.** Best-effort inference on migration.
6. **Default sketch tool.** Select arrow.
7. **Badge visibility.** Always visible, status-bar DOF.
8. **Worker state model.** Stateful — single GCS system per sketch-mode session.
