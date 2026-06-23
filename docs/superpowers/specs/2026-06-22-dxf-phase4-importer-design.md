# DXF Milestone M1 — Phase 4: Full DXF Import → Editable Sketches

**Date:** 2026-06-22 (revised same day after full-DXF gap analysis)
**Branch:** `feat/dxf-support` (off master `8112434a`, not merged)
**Umbrella spec:** `docs/superpowers/specs/2026-06-20-dxf-support-design.md` (§4.4)
**Status:** design approved; sub-phase **4a** ready for `writing-plans`

## Goal

Turn a parsed DXF file into **editable 2D sketch primitives** with **full DXF
support** (customer requirement). This is the read-side counterpart to the Phase 2
strict-AC1015 writer and consumes the Phase 3 sketch-model extension (ellipse +
degree-n spline). Import lands as raw, individually-editable sketch geometry on a
chosen plane, via two undoable commands.

## How this revision differs from the first cut

The first Phase-4 design scoped a *minimal* subset and assumed two capabilities the
current parser does not have. A four-agent investigation (2026-06-22) found those are
**correctness bugs**, not omissions, and they are promoted into the floor:

- **`$INSUNITS` is unreachable today.** The Phase-1 parser **never parses the HEADER
  section** — `result.header` is always `{}` (`packages/shared/src/dxf/parser.ts:84`).
  The "read `$INSUNITS` → mm scale" requirement cannot work until HEADER is parsed; an
  inch/metre DXF would import 25.4×/1000× wrong.
- **OCS / extrusion direction (group codes 210/220/230) is ignored.** A
  CIRCLE/ARC/ELLIPSE/LWPOLYLINE authored on a flipped plane (extrusion `(0,0,-1)`) is
  **mirrored** about Y in real DXF, with arc sweep reversed. Un-handled → silently wrong
  geometry.

## Resolved design anchors (from the 2026-06-22 investigation)

- **Arc/ellipse angle convention** (conf 87): sketch `arc.startAngle/endAngle` are
  **radians, CCW from +X** (proven across kernel `SketchOps.ts`, renderer, solver).
  DXF ARC angles are **degrees** (codes 50/51) → `toSketch` applies `rad = deg·π/180`.
  DXF ELLIPSE params (codes 41/42) are already **radians** → copied directly; omit
  `start/endAngle` when the ellipse is full (0→2π). The Phase-3 ry>rx swap is kernel-side
  only (`SketchOps.ts:231-254`) — `toSketch` emits user-frame angles and is unaffected.
- **`buildSketchPartDocument(name, primitives)`** (conf 92): build
  `[...ORIGIN_FEATURES, { kind:'sketch', id: crypto.randomUUID(), plane:{ source:'workPlane', featureId:'origin.XY' }, primitives, constraints:[] }]`
  with `units:'mm'`, empty `parameters/properties/materials/hardware`. Mirrors
  `buildImportedPartDocument` (`packages/app/src/import/buildImportedPartDocument.ts`).
  `ORIGIN_FEATURES` from `packages/app/src/import/originFeatures.ts` (7 features; XY plane
  = `origin.XY`).
- **Wiring** (conf 72): `pickFile` lives in `packages/app/src/shell/fsaFallback.ts`; the
  Phase-1 DXF *underlay* import (`DrawingTab.tsx:375`, `{ description:'DXF file',
  accept:{ 'image/vnd.dxf':['.dxf'] } }`) is the file-pick template. New-part import
  attaches to FileTab; active-sketch import attaches to the sketch ribbon. **Constraint:**
  `SketcherClient` is held in `App.tsx`'s `sketcherClientRef`, unreachable from
  `SketchTab` — the active-sketch command must be **dispatched through App.tsx** (the
  `AddPrimitiveCommand` call site, `App.tsx:1396`), not from the tab. Labels via en/uk
  i18n (`packages/app/src/i18n/locales/*.json`).

## Scope (full support, re-phased)

Decisions locked during brainstorming (2026-06-22):

- **Raw, unconstrained primitives** — each entity → one primitive, no inferred
  geometric constraints. Constraint inference is out of scope for all of Phase 4.
- **HATCH** → import boundary loops as editable line/arc/polyline curves; drop the fill.
- **TEXT/MTEXT** → import via a **new sketch-annotation model** (built in 4b, the
  ambitious choice); text also round-trips on export (writer already emits TEXT).
- **POINT** → add a **new `point` SketchPrimitive**; plumb through all kind-switches.
- **3DFACE / 3D polylines (non-planar)** → **reject with a counted warning**; no silent
  projection.
- **Both import commands** ship (new-part + active-sketch); they share `toSketch`.
- **Drop entirely:** REGION/BODY/3DSOLID (ACIS), WIPEOUT, IMAGE.

### Sub-phases (each independently shippable, gate-verified, TDD)

- **4a — Correct flat import (P0).** Parser HEADER parse (`$INSUNITS`, `$ACADVER`) +
  OCS→WCS transform on all OCS-relative entities + SPLINE fidelity (fit-point fallback,
  knots/weights) + POLYLINE closed-wrap bulge. `toSketch` for LINE, CIRCLE, ARC,
  ELLIPSE, SPLINE, LWPOLYLINE/POLYLINE. Both import commands + `buildSketchPartDocument`
  + entry points. **No manifest bump** (emits only existing v31 shapes). *This is the
  next build.*
- **4b — Blocks, layers, points, text (P1).** Parser TABLES/LAYER parse (color/linetype
  → metadata, layer→`construction?`), INSERT/BLOCK recursive flatten with
  scale/rotation/array (COLUMNS/ROWS), new `point` primitive, new text-annotation model
  for TEXT/MTEXT (+ MTEXT formatting-code stripping). **Manifest bump v31→v32** (new
  `point` primitive + annotation schema). HATCH-boundary import may land here or 4c.
- **4c — Exotic + hardening (P2).** DIMENSION/LEADER/MLEADER → annotations, SOLID/3DFACE
  (planar→boundary, non-planar→reject), RAY/XLINE → construction lines, HATCH boundary
  (if not in 4b), parser perf (index pairs per entity to kill the per-`num()` linear
  scan, `parser.ts:8`), large-file handling. Manifest as needed.

## Architecture

Three layers, each independently testable. Sub-phase 4a builds the spine; 4b/4c extend.

### A. Parser extensions — shared (`packages/shared/src/dxf/`)

The dep-free Phase-1 parser is extended (not replaced). Concrete group-code additions:

- **HEADER section** (4a): branch on `section === 'HEADER'`; capture `$INSUNITS`(9/70),
  `$ACADVER`(9/1), optionally `$EXTMIN/$EXTMAX`. Populate `ParsedDxf.header` (today
  always `{}`).
- **OCS extrusion** (4a): read 210/220/230 on CIRCLE/ARC/ELLIPSE/LWPOLYLINE/POLYLINE/TEXT;
  store on the entity. Z/elevation 30 for LINE/polyline.
- **SPLINE fidelity** (4a): read fit points (11/21) as a fallback when control points are
  absent, knots (40), weights (41), counts (72/73/74); distinguish fit-vs-control.
- **TABLES/LAYER** (4b): branch on `section === 'TABLES'`; per LAYER read name(2),
  color(62), linetype(6), flags(70) → `ParsedDxf.layers`. Per-entity color(62)/trueColor(420).
- **INSERT arrays** (4b): COLUMNS(70), ROWS(71), col/row spacing(44/45); BLOCK base point.
- **New entity reads** (4b/4c): POINT, SOLID/3DFACE, HATCH, DIMENSION, LEADER, RAY/XLINE.

### B. `toSketch` — shared, pure (`packages/shared/src/dxf/toSketch.ts`)

```ts
export function toSketch(parsed: ParsedDxf): {
  primitives: SketchPrimitive[];
  annotations: SketchAnnotation[];   // 4b+; empty in 4a
  dropped: { kind: string; count: number; reason: string }[];
};
```

- **Pure, dependency-free** (shared has zero runtime deps). Plain-data in, plain-data out.
- **Unit scaling** (4a): `$INSUNITS` from `parsed.header` → mm factor on every
  coordinate/radius (4=mm→1, 1=inch→25.4, 6=metre→1000, 0/absent→1=treat as mm).
- **OCS→WCS** (4a): for entities with extrusion ≠ (0,0,1), apply the arbitrary-axis
  algorithm to centers/points and reverse arc sweep before mapping.
- **Mapping table:**

  | DXF entity            | Target                        | Sub-phase | Notes |
  | --------------------- | ----------------------------- | --------- | ----- |
  | LINE                  | `line`                        | 4a | direct (+OCS/Z) |
  | CIRCLE                | `circle`                      | 4a | OCS-aware |
  | ARC                   | `arc`                         | 4a | deg→rad; OCS reverses sweep |
  | ELLIPSE               | `ellipse`                     | 4a | params radians; full→omit start/end |
  | SPLINE                | `spline`                      | 4a | control pts, else fit-pt fallback; degree clamped to poles−1 |
  | LWPOLYLINE / POLYLINE | `line` + `arc` (bulge→arc)    | 4a | closed-wrap segment honors last-vertex bulge |
  | POINT                 | `point` (new)                 | 4b | |
  | INSERT / BLOCK        | flattened primitives          | 4b | recursive transform; arrays expanded |
  | TEXT / MTEXT          | `SketchAnnotation` (new)      | 4b | MTEXT formatting stripped |
  | HATCH                 | boundary loops → `line`/`arc` | 4b/4c | fill dropped |
  | DIMENSION / LEADER    | `SketchAnnotation`            | 4c | |
  | SOLID / 3DFACE        | boundary `line`s / reject     | 4c | non-planar → dropped+tallied |
  | RAY / XLINE           | construction `line`           | 4c | clipped to extents |
  | REGION/3DSOLID, WIPEOUT, IMAGE | — (dropped)          | — | tallied |

- **bulge→arc** (4a): for a segment `p1→p2` with bulge `b` (`b = tan(Δθ/4)`): included
  angle `Δθ = 4·atan(b)`; chord `c = ‖p2−p1‖`; radius `r = c·(1+b²)/(4|b|)`; center offset
  along the chord perpendicular by the sagitta; emit `arc` with start/end **in radians**.
  `b = 0` → `line`. Bulge sign sets CW/CCW.
- **Fresh ids** for every emitted primitive/annotation.
- **Non-planar / un-importable** entities increment `dropped` with a reason.

### C. Commands — app

#### `ImportDxfIntoNewPartCommand` (4a, undoable)

Mirrors `importStepIntoNewPart`. `apply()`: File → text → `parseDxf` → `toSketch` →
`buildSketchPartDocument(name, primitives)` → `kernel.registerPart` → `store.setActivePart`.
`revert()`: restore prior active part. Surface `dropped` via `setStatus`
("Imported N primitives, skipped M entities"). Entry: FileTab "Import DXF…" → `pickFile('.dxf')`.

#### `ImportDxfIntoActiveSketchCommand` (4a, undoable)

Batch generalization of `AddPrimitiveCommand`'s dual path. `apply()`: `parseDxf` →
`toSketch` → for each primitive `kernel.addPrimitive(partId, sketchId, p)` **and**
`sketcherClient.addPrimitive(p)`. Capture prior part + added ids. `revert()`: remove every
added id from **both** kernel and worker, restore prior part. DXF world-XY drops into the
sketch's local UV frame (origin-aligned, unit-scaled) — no 3D plane transform (primitives
are 2D; the sketch plane is applied kernel-side). **Dispatched from App.tsx** (so it can
reach `sketcherClientRef`), triggered by a sketch-ribbon "Import DXF…" button. All-or-nothing:
if any add throws, revert what was added.

## Data flow

```
.dxf ─► text ─► parseDxf (HEADER+TABLES+ENTITIES+OCS) ─► ParsedDxf
   ─► toSketch (units, OCS→WCS, bulge→arc, reject 3D) ─► { primitives, annotations, dropped }
       ├─(new part)─► buildSketchPartDocument ─► kernel.registerPart ─► setActivePart
       └─(active)──► loop kernel.addPrimitive + sketcherClient.addPrimitive
```

## Error handling

- Parse failure → command throws; caller shows an error; no partial state (active-sketch
  reverts any partial adds).
- Zero mappable entities → succeed with a "0 imported, M skipped" status (don't throw).
- Unknown `$INSUNITS` → factor 1, proceed.
- Non-planar 3D / ACIS / unsupported → tallied in `dropped`, never silently mis-mapped.

## Testing (TDD, red→green per slice)

**4a:**
- shared `parser` tests: HEADER `$INSUNITS` captured; OCS extrusion read; SPLINE
  fit-point fallback + knots/weights; polyline closed-wrap bulge.
- shared `toSketch.test.ts`: per-entity mapping; deg→rad arc; unit scaling (inch→mm);
  OCS (0,0,-1) mirrors a circle/arc correctly; bulge polyline → line+arc; closed wrap;
  dropped-tally.
- app command tests: new-part → sketch holds expected primitive count, undo removes part;
  active-sketch → primitives added **and** mirrored to a stub `SketcherClient`, undo
  removes from both paths.
- **§6 real-browser e2e** (`tests/e2e/drawing/dxf-import.spec.ts`): pick a fixture `.dxf`,
  assert the sketch gains the expected primitives (via `window.__zilventor*` probe / DOM,
  not pixels), both entry points, 0 console errors.

**4b/4c:** layer→construction mapping; INSERT flatten/array expansion; `point` round-trip;
text-annotation render + MTEXT strip; HATCH boundary; perf on a large fixture.

## Manifest / migration

- **4a:** no manifest bump (emits only existing v31 `SketchPrimitive` shapes).
- **4b:** manifest **v31→v32** — new `point` primitive + sketch-annotation model are new
  serialized shapes (settle annotation storage — new `SketchPrimitive` kind vs. a separate
  `annotations` array on the sketch feature — in the 4b plan). Structural no-op migration
  keyed at 31, like Phase 3's v30→v31.

## Plan-time notes (not blockers)

- The active-sketch command needs `sketcherClientRef`; dispatch it from `App.tsx`, passing
  the same context shape `AddPrimitiveCommand` uses (`App.tsx:1396`).
- Confirm `KernelClient` vs `KernelApi` method names (`registerPart`, `addPrimitive`,
  `removePrimitive`) against the actual client when writing the commands.
- File-size guard: STEP import uses `STEP_MAX_BYTES` (`FileTab.tsx:19`); decide whether DXF
  needs a parallel cap in the 4a plan.
