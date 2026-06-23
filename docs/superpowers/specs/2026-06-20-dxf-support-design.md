# Design — M1: Full-fledged DXF support

**Date:** 2026-06-20 · **Branch target:** new feature branch off `master`.
**Roadmap:** `docs/superpowers/plans/2026-06-20-inventor-parity-roadmap.md` (M1).
**Handoff:** `docs/superpowers/plans/2026-06-20-dxf-milestone-handoff.md`.
**Status:** Approved scope + design decisions; ready for writing-plans.

---

## 1. Goal

Bidirectional DXF: import **and** export round-trip, all use-cases co-equal
(CNC/manufacturing, 2D drafting interchange, customer/vendor geometry import).
Imported DXF lands as **editable 2D sketch primitives** (constrain/extrude them),
not a non-editable underlay. Target modern AutoCAD **AC1015 (AutoCAD 2000+)** read
**and** write, with broad entity coverage: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE,
SPLINE, ELLIPSE, TEXT, MTEXT, INSERT/BLOCK, layers (+ ACI / true-color).

Today: export is hand-rolled R12 (AC1009) only with no native ARC (tessellated to
32-seg polylines); the only import is a non-editable underlay via the read-only
`dxf-parser` npm package. "Full-fledged" = upgrade the writer to AC1015, add a true
editable-sketch importer, and unify both directions behind one shared codec.

## 2. Locked decisions

Scope (from handoff §2, not relitigated): bidirectional; all use-cases co-equal;
import → editable sketch primitives; AC1015 read+write with broad entity coverage.

Design decisions (this session):
- **Codec home:** a self-contained, dependency-free codec in `packages/shared/src/dxf/`
  — own tokenizer + parser + writer + entity↔primitive mapper. `shared` keeps its
  zero-runtime-dependency invariant (the codec is pure).
- **Writer upgrade:** in-place to AC1015. The single `createDxfDocument()` writer emits
  native ARC/ELLIPSE/SPLINE/LWPOLYLINE. The 3 existing exporters migrate to native arcs;
  their golden/e2e/perf tests are rewritten to AC1015 output as a deliberate, reviewed
  regression gate.
- **Lossless import → sketch-model extension:** add an `ellipse` `SketchPrimitive`
  variant and widen spline `degree` from `2|3` to `number`, plumbed through shared types,
  the OCCT kernel, and the planegcs sketcher.
- **Import entry points:** both — import into a new part (sketch on XY) **and** import
  into the active sketch on its plane.
- **`dxf-parser` retired:** the new shared parser becomes the single DXF reader; the
  existing underlay import is rerouted onto it; the npm dep is dropped. Existing underlay
  tests are the regression gate.

## 3. Architecture

One new codec package is the single source of truth for both directions:

```
packages/shared/src/dxf/
  tokenizer.ts   raw DXF text → stream of (groupCode:number, value:string) pairs
  parser.ts      pairs → DxfEntity[] AST: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE,
                 SPLINE, ELLIPSE, TEXT, MTEXT, INSERT, BLOCK; HEADER ($INSUNITS,
                 $ACADVER); TABLES (layers + ACI/true-color)
  writer.ts      DxfEntity[] / builder → AC1015 string (native ARC/ELLIPSE/SPLINE/
                 LWPOLYLINE/LINE/CIRCLE/TEXT/DIMENSION/BLOCK), layer table, ACI+true-color
  toSketch.ts    DxfEntity[] → SketchPrimitive[] (units→mm, layers, INSERT flatten,
                 LWPOLYLINE bulge→arc, ellipse/spline mapping)
  fromSketch.ts  SketchPrimitive[] / drawing geometry → DxfEntity[]
  index.ts       public surface
```

Boundaries: `shared/dxf` is pure (text ↔ AST ↔ primitives) and dependency-free.
`packages/app` keeps only file-I/O glue (`pickFile`), the import commands, and the
exporter wiring. The kernel and sketcher consume the (extended) `SketchPrimitive` model
exactly as they do today.

**Round-trip contract** (the codec's load-bearing test): `write → parse → map`
produces stable geometry — an entity written by `writer.ts`, re-read by `parser.ts`,
and mapped by `toSketch.ts` preserves type and geometry within tolerance.

## 4. Components

### 4.1 Shared DXF codec

- **tokenizer.ts** — splits DXF into `(code, value)` pairs; handles CRLF/LF, trims, and
  type-coerces values lazily (parser decides int/float/string per code).
- **parser.ts** — a sectioned reader (HEADER / TABLES / BLOCKS / ENTITIES). Produces a
  discriminated-union `DxfEntity` AST plus a layer table and header vars. Must match the
  entity coverage `dxf-parser` provided for the underlay (port its fixtures first), then
  extend to SPLINE/ELLIPSE/MTEXT/INSERT.
- **writer.ts** — replaces the R12 builder. Emits `$ACADVER = AC1015`, a real layer
  table, and native `arc()`, `ellipse()`, `spline()`, `lwpolyline()` in addition to the
  existing `line/circle/text/dimension/block`. ACI + true-color (extend `hexToAci()`).
- **toSketch.ts / fromSketch.ts** — pure mappers (see §4.2 for entity↔primitive rules).

### 4.2 Entity ↔ primitive mapping

| DXF entity              | SketchPrimitive                              | Notes |
|-------------------------|----------------------------------------------|-------|
| LINE                    | `line`                                       | direct |
| CIRCLE                  | `circle`                                     | direct |
| ARC                     | `arc`                                         | direct (deg) |
| LWPOLYLINE / POLYLINE   | `line` segments; bulge segs → `arc`          | bulge→arc is a tested fidelity path, not lines-only |
| SPLINE                  | `spline` (degree = DXF degree, any int)      | fit/control points preserved |
| ELLIPSE                 | `ellipse`                                    | DXF center+major-vector+ratio+params ↔ `{cx,cy,rx,ry,rotation,startAngle?,endAngle?}` |
| TEXT / MTEXT            | text annotation (import: note/ignore for sketch geometry; export: native) | sketches are geometry; text round-trips on the writer side |
| INSERT / BLOCK          | flattened: block geometry transformed by INSERT placement | nested INSERT handled recursively |
| layers + ACI/true-color | preserved on export; on import best-effort (construction flag / metadata) | furniture sketches are mm-native |

Units: `$INSUNITS` → mm on import; mm on export.

### 4.3 Sketch-model extension

- **types.ts** — add
  `{ id; kind:'ellipse'; cx; cy; rx; ry; rotation; startAngle?; endAngle?; construction? }`
  (full ellipse when both angles omitted; elliptical arc otherwise). Widen spline
  `degree: 2|3` → `degree: number`.
- **OCCT** (`kernel/src/occt/SketchOps.ts` + `adapter/features/SketchFeature.ts:99`) —
  new `makeEllipseEdge` via `gp_Elips_2` + `BRepBuilderAPI_MakeEdge`; new `'ellipse'`
  case in the per-kind switch. Spline already clamps degree to `nbPoles-1` — unchanged.
- **planegcs** (`sketcher-worker/src/GcsSystem.ts`) — ellipse **decomposes to defining
  points** (center + axis endpoints) sent to the solver, exactly as splines do today
  (the curve geometry is not solved; its points are). No upstream solver change.
- **Exhaustive/branching `kind` switches** that need an `ellipse` branch:
  `SelectTool.ts`, `snap.ts`, `ConstraintTool.ts`, `ProfilePickController.ts` (bbox),
  `CommittedSketchRenderer.ts` (2D render), `inferFromGeometry.ts` (`endpointsOf`),
  and the kernel `SketchFeature.ts` switch.
- **Manifest v30→v31** (`shared/src/fileFormat.ts`): new migration entry keyed `30`
  returning `formatVersion: 31`. Old docs need no mutation (existing splines are valid
  `degree:number`; no ellipses exist yet); the bump pins the new `ellipse` kind.
  Serialization is structural — no serializer code.

### 4.4 Import commands (2 entry points)

- **`ImportDxfIntoNewPartCommand`** — `pickFile` (`.dxf`) → shared parser → `toSketch`
  → new part document with one sketch feature on the XY work plane; `bus.execute`,
  then `store.setActivePart()`. Mirrors `importStepIntoNewPart`. Entry: FileTab.
- **`ImportDxfIntoActiveSketchCommand`** — imports `toSketch` primitives into the
  currently-open sketch on its plane (plane transform applied), each mirrored into
  `SketcherClient` so the solver sees them. Entry: sketch-mode toolbar button.
- Both: undoable, `$INSUNITS`→mm, layer preservation best-effort, INSERT/BLOCK flatten,
  bulge→arc.

### 4.5 Writer upgrade + exporter migration

`createDxfDocument()` upgraded in place to AC1015. The 3 exporters
(`renderDrawingDxf`, `renderDrawingDxf1to1`, `renderBoringDxf`) switch to native arcs
(stop 32-seg tessellation). Their golden + e2e + perf tests are rewritten to the AC1015
output — a deliberate, reviewed regression gate, not silent drift. The underlay reader
(`parseDxfUnderlay`) is rerouted onto the new shared parser and its tests kept green.

**Phase-2 decisions (2026-06-21, from grounding the writer in the actual exporters):**
- **Strictness — STRICT AC1015.** The writer emits real AutoCAD-2000 structure: `$ACADVER=AC1015`
  + `$HANDSEED` in HEADER; a handle allocator giving every entity and table record a unique
  group-`5` hex handle; the required tables incl. `APPID` (ACAD) and `BLOCK_RECORD`
  (`*Model_Space`/`*Paper_Space` + one per block); per-entity `AcDbEntity` + `AcDb<Type>`
  subclass markers (group `100`) and owner refs (group `330`). Rationale: the milestone's
  "read AND write modern AutoCAD" intent — a version-string bump on R12-shaped entities would
  mislabel the format. *Verification caveat:* true AutoCAD-open is human-gated (no AutoCAD/Teigha
  in CI); the automated strictness gate is structural — unique handles, `$HANDSEED` ≥ max handle,
  required subclass markers/owner refs present — plus round-trip through our own parser.
- **Scope — FULL native entity set now.** Phase 2 adds `arc()`, `ellipse()`, `spline()`,
  `lwpolyline()` writer methods even though only `arc()` has a consumer today (the angular-dimension
  picture in `renderDrawingDxf.ts:546`, replacing its 32-seg tessellation). The other three are
  covered by writer-level unit + round-trip tests now; Phase 4 (`fromSketch`) / Phase 5 (round-trip)
  become method calls. *Finding that motivated the questions:* the 3 exporters emit projected
  POLYLINEs (views), CIRCLEs + rect POLYLINEs (boring), and DIMENSIONs — NOT arc/ellipse/spline
  primitives — so the only existing tessellated-arc consumer is the angular dimension.

## 5. Testing strategy

TDD red→green per slice.
- **Codec unit:** one test per entity (parse + write); the **round-trip contract**
  (`write→parse→map→write` stable within tolerance); bulge→arc; INSERT flatten; units.
- **Model:** OCCT bake — an imported ellipse produces real elliptical edge geometry
  (not faceted); planegcs decompose test; v30→v31 migration test; spline degree>3 bake.
- **Commands:** import-into-new-part and import-into-active-sketch (real `bus.execute`,
  assert resulting `SketchPrimitive[]` types/counts, undo restores).
- **Exporters:** rewritten goldens stay green; underlay tests green after reroute.
- **§6 real-browser (Playwright/Chromium):** import a real AC2000 DXF containing arc,
  ellipse, spline, and a polyline-with-bulge → confirm editable sketch primitives appear
  → export → reparse → geometry preserved. Capture screenshots and assert primitive
  type/count back.

## 6. Phase decomposition (for writing-plans)

1. **Shared codec — tokenizer + parser + AST.** Port underlay fixtures, reroute
   `parseDxfUnderlay`, retire `dxf-parser`. Gate: underlay tests green.
2. **Shared codec — AC1015 writer.** Migrate 3 exporters to native arcs; rewrite goldens.
   Gate: all exporter unit/e2e/perf tests green on AC1015 output.
3. **Sketch-model extension.** ellipse + degree-n spline through shared types, OCCT,
   planegcs, the ~7 switches, v30→v31. *(Riskiest — most cross-package; may be lifted
   into its own sub-plan to de-risk.)*
4. **Importer mapping + 2 commands + 2 entry points** (units/layers/blocks/bulge).
5. **Round-trip fidelity, edge cases, perf, §6 verification.**

Sequencing: 1+2 are writer/parser-only (no model change); 3 is the deep change; 4
depends on 1+3; 5 is the gate. One spec; Phase 3 flagged for optional sub-planning.

## 7. Definition of done

- Import a modern (AC2000+) DXF → editable 2D sketch primitives you can constrain/extrude
  (including real ellipses and degree>3 splines).
- Export modern AC1015 DXF with native ARC/CIRCLE/ELLIPSE/SPLINE/LWPOLYLINE/TEXT/layers;
  round-trips through the importer with geometry preserved.
- All existing DXF exporters + underlay import still green (golden tests rewritten to
  AC1015 deliberately); `dxf-parser` removed; new unit + command + e2e tests per slice.
- `pnpm -r typecheck` 0-new, lint clean, real-browser verification captured and read back.

## 8. Risks / gotchas

- **Regression gate:** 3 shipped exporters + underlay depend on current output. Writer
  upgrade + parser reroute must keep them green (goldens rewritten, not silently drifted).
- **Hand-rolled parser coverage:** the new shared parser must match `dxf-parser`'s
  entity coverage before the underlay reroute — port its fixtures first.
- **Spline fidelity:** DXF splines can be high-degree with knots/weights; OCCT fits via
  `GeomAPI_PointsToBSpline` (clamped to poles−1) — map carefully and test, don't drop.
- **Polyline bulge:** arc segments inside LWPOLYLINE are easy to miss → covered by a test.
- **Ellipse + planegcs:** the solver has no ellipse primitive; we decompose to defining
  points (spline pattern). Imported ellipses are not solver-constrainable as ellipses —
  same limitation splines already have; acceptable for imported geometry.
- **Units:** DXF may be unitless/imperial; map `$INSUNITS` → mm.
- Don't break the non-editable underlay path; the new importer supersedes it only for
  the editable-sketch use-case.

## 9. ABF / M2 forward-context

"ABF" = the getabf.net SketchUp plugin (not a file format); it outputs layered DXF +
nesting + labels. That is roadmap **M2**, built on this M1 stack. Keep manufacturing-DXF
in mind while designing the writer (named layers per manufacturing op), but M2 is out of
M1 scope.
