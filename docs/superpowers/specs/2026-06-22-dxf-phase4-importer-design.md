# DXF Milestone M1 — Phase 4: Importer → Editable Sketches

**Date:** 2026-06-22
**Branch:** `feat/dxf-support` (off master `8112434a`, not merged)
**Umbrella spec:** `docs/superpowers/specs/2026-06-20-dxf-support-design.md` (§4.4)
**Status:** design approved; ready for `writing-plans`

## Goal

Turn a parsed DXF file into **editable 2D sketch primitives**. Two undoable entry
points: import into a brand-new part, and import into the currently-open sketch.
This is the read-side counterpart to the Phase 2 strict-AC1015 writer and consumes
the Phase 3 sketch-model extension (ellipse + degree-n spline) with **no manifest bump**.

## Scope (locked during brainstorming, 2026-06-22)

- **Raw, unconstrained primitives.** Each DXF entity maps to one `SketchPrimitive`
  with no inferred geometric constraints. Faithful, deterministic, individually
  editable. Constraint inference (coincidence at shared endpoints) is explicitly
  out of scope and may be a later slice.
- **Flat geometry + bulge→arc.** Covers LINE, CIRCLE, ARC, ELLIPSE, SPLINE,
  LWPOLYLINE/POLYLINE (with bulge→arc). **INSERT/BLOCK recursive flattening is
  deferred to Phase 5** — most hand-drawn/CNC DXFs have no block references, and
  recursive transform composition carries its own fidelity-test burden.
- **Both commands** ship in Phase 4. They share `toSketch`; the marginal cost of
  the second command is small once the first exists.

Out of scope for Phase 4: INSERT/BLOCK flatten, constraint inference, TEXT/MTEXT
import (text round-trips on *export* only), round-trip fidelity/perf hardening
(Phase 5).

## Architecture

Three units, each independently testable:

### 1. `toSketch` — shared, pure

`packages/shared/src/dxf/toSketch.ts`

```ts
export function toSketch(parsed: ParsedDxf): {
  primitives: SketchPrimitive[];
  dropped: { kind: string; count: number }[];
};
```

- **Pure, dependency-free** (shared package has zero runtime deps). Input is the
  `ParsedDxf` from the Phase 1 parser (`packages/shared/src/dxf/parser.ts`); output
  is plain data.
- **Unit scaling:** read `$INSUNITS` from `parsed.header`; convert to a mm scale
  factor applied to every coordinate and radius. Unknown/unitless ($INSUNITS 0 or
  absent) → factor 1 (treat as mm, the app's native unit).
- **Entity → primitive mapping:**

  | DXF entity            | SketchPrimitive            | Notes |
  | --------------------- | -------------------------- | ----- |
  | LINE                  | `line`                     | direct |
  | CIRCLE                | `circle`                   | direct |
  | ARC                   | `arc`                      | DXF start/end angles are **degrees**; convert to the sketch-arc angle convention — see Open Item A |
  | ELLIPSE               | `ellipse`                  | `rx = ‖major‖·scale`, `ry = rx·ratio`, `rotation = atan2(majorY, majorX)`, `startAngle = startParam`, `endAngle = endParam` (DXF ellipse params are radians); omit start/end when full (0→2π) |
  | SPLINE                | `spline`                   | `controlPoints` (scaled), `degree` (any int), `closed` |
  | LWPOLYLINE / POLYLINE | sequence of `line` + `arc` | straight segs → `line`; bulged segs → `arc` via bulge→arc; honor `closed` flag for the wrap segment |
  | TEXT / MTEXT          | — (dropped)                | tallied in `dropped` |
  | INSERT                | — (dropped, Phase 5)       | tallied in `dropped` |

- **bulge→arc:** for a polyline segment from `p1` to `p2` with bulge `b`
  (`b = tan(Δθ/4)`): included angle `Δθ = 4·atan(b)`; chord `c = ‖p2−p1‖`;
  radius `r = c·(1+b²) / (4|b|)`; center offset along the chord's perpendicular by
  the sagitta. Emit an `arc` with center, radius, and start/end angles in the sketch
  convention. `b = 0` → straight `line`.
- **Fresh ids:** each emitted primitive gets a new generated id (no DXF handle reuse).

### 2. `ImportDxfIntoNewPartCommand` — app, undoable

`packages/app/src/commands/ImportDxfIntoNewPartCommand.ts`

Mirrors `packages/app/src/import/importStepIntoNewPart.ts`:

- `apply()`: read File `arrayBuffer` → text → `parseDxf` → `toSketch` →
  `buildSketchPartDocument(name, primitives)` (a new helper building a
  `PartDocument` with origin features + one sketch feature on the **XY plane**
  carrying the imported primitives) → `kernel.registerPart(part)` →
  `store.setActivePart(part)`.
- `revert()`: restore the prior active part (capture in `apply`).
- **Entry point:** FileTab "Import DXF…" menu item → `pickFile('.dxf')` → `bus.execute(cmd)`.
- Surface the `dropped` tally via `setStatus` ("Imported N primitives, skipped M
  text/block entities").

### 3. `ImportDxfIntoActiveSketchCommand` — app, undoable

`packages/app/src/commands/ImportDxfIntoActiveSketchCommand.ts`

Generalizes `AddPrimitiveCommand`'s dual-path (kernel + worker) to a **batch**:

- `apply()`: `parseDxf` → `toSketch` → for each primitive:
  `kernel.addPrimitive(part.id, sketchId, p)` **and**, if a `sketcherClient` is
  present, `sketcherClient.addPrimitive(p)` (so the live solver sees it). Capture
  the prior `PartDocument` and the list of added ids. Re-graft constraints / set
  active part as `AddPrimitiveCommand` does.
- `revert()`: remove every added id from **both** kernel (`removePrimitive`) and
  worker (`sketcherClient.removePrimitive`); restore prior part.
- **Coordinate handling:** DXF world-XY drops directly into the sketch's local
  UV frame (origin-aligned, unit-scaled). No 3D plane transform is needed — the
  primitives are 2D in sketch space, and the sketch's plane is applied at kernel
  level when the sketch is consumed. (This intentionally keeps Phase 4 simple; a
  user-positioned insertion point is a later refinement.)
- **Entry point:** sketch-mode toolbar "Import DXF…" → `pickFile('.dxf')` → `bus.execute(cmd)`.

## Data flow

```
.dxf File ─► arrayBuffer/text ─► parseDxf (shared, P1) ─► ParsedDxf
   ─► toSketch (shared, P4) ─► { primitives, dropped }
       ├─(new part)─► buildSketchPartDocument ─► kernel.registerPart ─► setActivePart
       └─(active)──► loop kernel.addPrimitive + sketcherClient.addPrimitive
```

## Error handling

- Parse failure (malformed DXF) → command throws; caller shows an error status,
  no partial state (new-part: nothing registered; active-sketch: command is
  all-or-nothing — if any `addPrimitive` throws, revert what was added).
- Empty result (zero mappable entities) → succeed with a "0 primitives imported,
  M skipped" status rather than throwing.
- Unknown `$INSUNITS` → scale factor 1, proceed.

## Testing

TDD, red→green per slice:

- **shared `toSketch.test.ts`** (pure, fast): per-entity mapping
  (line/circle/arc/ellipse/spline), bulge-polyline → line+arc, unit scaling
  (`$INSUNITS` inch→mm), dropped-tally for TEXT/INSERT, closed-polyline wrap segment.
- **app `ImportDxfIntoNewPartCommand` test:** importing a small fixture creates a
  part whose sketch holds the expected primitive count; undo removes the part /
  restores prior active part.
- **app `ImportDxfIntoActiveSketchCommand` test:** primitives are added to the
  active sketch **and** mirrored to a stub `SketcherClient`; undo removes them from
  both paths.
- **§6 real-browser e2e** (`tests/e2e/drawing/dxf-import.spec.ts`): drive the real
  UI — pick a fixture `.dxf`, assert the sketch gains the expected primitives (via
  `window.__zilventor*` probe / DOM, not pixels) and 0 console errors. Cover both
  entry points.

## Manifest / migration

**No manifest bump.** Phase 4 emits only existing v31 `SketchPrimitive` shapes and
adds new code paths; no serialized-document schema changes.

## Open items to resolve at plan time (not blockers)

- **A — arc angle convention.** Confirm whether the existing `arc` `SketchPrimitive`
  stores `startAngle`/`endAngle` in radians or degrees, and match `toSketch` (and the
  bulge→arc / ellipse-param outputs) to it. The Phase 1 parser keeps DXF ARC angles
  in degrees; reconcile against how the kernel/app already consume `arc`.
- **B — `buildSketchPartDocument` shape.** Confirm the exact `PartDocument` +
  sketch-`Feature` construction (origin features, plane reference for XY) by reading
  an existing sketch-bearing part fixture; reuse the established builders.
- **C — `pickFile` helper + FileTab/sketch-toolbar wiring.** Locate the existing
  file-picker used by STEP import and the menu/toolbar registration points; reuse them.
```
