# HANDOFF — Milestone M1: Full-fledged DXF support

**For:** a fresh session starting the DXF milestone.
**Date written:** 2026-06-20 · **Branch at write time:** master (clean).
**Roadmap:** `docs/superpowers/plans/2026-06-20-inventor-parity-roadmap.md` (this is M1).

---

## 0. How to use this handoff
You are picking up M1 of an Inventor-2012 furniture-parity roadmap in a clean context.
Do NOT re-do the audit or ABF research — they are done (summarized below). Your job:
1. Run `superpowers:brainstorming` to convert the locked scope (§2) into a design doc.
2. Run `superpowers:writing-plans` to decompose into red→green→refactor TDD slices.
3. Execute via `superpowers:subagent-driven-development` (Sonnet subagents + self-critique).
4. Gate with `superpowers:verification-before-completion` (§6 real-browser verify).
Follow the user's global CLAUDE.md (TDD per slice, surgical changes, delegate aggressively,
commit+push after each logical change, base branch for diffs = origin/development).

## 1. What the app is
"zilventor" — browser-based parametric furniture/cabinet CAD. OCCT/WASM kernel + React.
pnpm monorepo: `packages/app` (UI + commands + drawing), `packages/shared` (pure logic/types),
`packages/kernel` (OCCT worker), `packages/sketcher-worker` (planegcs 2D solver), `packages/icons`.
Command pattern: everything mutates via `bus.execute(cmd)` (undoable). Goal: parity with
Autodesk Inventor 2012 + Woodwork-for-Inventor for furniture.

## 2. LOCKED scope decisions (from user, do not relitigate)
Full-fledged DXF =
- **Direction:** Import **+** export round-trip (bidirectional).
- **Use-cases:** All co-equal — CNC/manufacturing, 2D drafting interchange, AND import of
  customer/vendor 2D geometry.
- **Import target:** DXF entities become **editable 2D sketch primitives** (constrain/extrude
  them), NOT just a reference underlay.
- **Compatibility:** Modern AutoCAD — **AC1015 / AutoCAD 2000+** read AND write, broad entity
  coverage: LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, SPLINE, ELLIPSE, TEXT, MTEXT,
  INSERT/BLOCK, layers (+ color/ACI). (A real spline import is the main new geometry challenge.)

Note: today export is AutoCAD **R12 (AC1009)** only and there is **no geometry import** (only a
non-editable "DXF underlay"). "Full-fledged" means upgrading the writer to modern DXF and
adding a true editable-sketch importer, behind one shared module.

## 3. Current DXF code surface (verified file anchors)
**Writer (single hand-rolled R12/AC1009 builder):**
- `packages/app/src/drawing/dxfWriter.ts:74` — `createDxfDocument()`. Emits LINE, POLYLINE/
  VERTEX/SEQEND, CIRCLE, TEXT, BLOCK/ENDBLK, DIMENSION. **No ARC entity** (arcs/angular dims
  tessellated to 32-seg polylines). Fixed layer set at `dxfWriter.ts:35`
  (VISIBLE/HIDDEN/SECTION-HATCH/SECTION-LINE/DETAIL/DIMENSIONS/ANNOTATIONS/HOLE-TABLE/TITLE).
  DIMSTYLE STANDARD hard-coded. `hexToAci()` color map.
- Three exporters all import `createDxfDocument` directly (no shared abstraction beyond it):
  - `packages/app/src/drawing/renderDrawingDxf.ts:65` — scaled full-sheet drawing DXF.
    Commands: `ExportDrawingDxfCommand.ts:16`, `ExportAllSheetsDxfCommand.ts:22` (zip).
  - `packages/app/src/drawing/renderDrawingDxf1to1.ts:16` — 1:1 machining DXF (geometry only).
    Commands: `ExportDrawing1to1DxfCommand.ts`, `ExportAllSheets1to1DxfCommand.ts`.
  - `packages/app/src/drawing/renderBoringDxf.ts:53` — boring map (panel outline POLYLINE on
    OUTLINE, bore CIRCLE on dynamic `D{dia}_{depth}` layers). Command: `ExportBoringDxfCommand.ts:18`.

**Parser (already present!):**
- `packages/app/package.json:21` → `dxf-parser@^1.1.2` (read-only). Handles AC1009–AC1015+,
  incl. LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT, SPLINE, ELLIPSE, DIMENSION,
  INSERT/BLOCK. Already used for the DXF **underlay** import; fixture `ImportDxfUnderlayCommand.spec.ts:19`
  uses an AC1015 header → modern parse confirmed. No DXF *write* library — writer is hand-rolled.

**Import target (sketch model):**
- `packages/shared/src/types.ts:30-35` — `SketchPrimitive` union: `line | rectangle | circle |
  arc | spline` (spline degree 2|3 + closed). Sketch feature at `types.ts:52`
  `{ kind:'sketch'; plane: WorkPlaneRef; primitives; constraints }`.
- `packages/app/src/commands/AddSketchCommand.ts:11` (new sketch via `kernel.addFeature`),
  `AddPrimitiveCommand.ts` (adds one primitive, mirrors into `SketcherClient`).
- `packages/app/src/sketcher/SketcherClient.ts:25` — `addPrimitive(p)` → `@zilventor/sketcher-worker`.
- ⚠️ **No sketch-import command exists** — nothing reads a file → `SketchPrimitive[]` in a sketch
  feature. This is the core new command to build for import.

**Existing import infra patterns to mirror:**
- `packages/app/src/import/` — `InventorImporter.ts`, `importStepIntoNewPart.ts:15`,
  `buildImportedPartDocument.ts`. File pickers via `packages/app/src/shell/fsaFallback.ts:34`
  `pickFile`. DXF underlay picker at `DrawingTab.tsx:375` → `ImportDxfUnderlayCommand`. STEP at
  `FileTab.tsx:144`. All go through `bus.execute` then `store.setActivePart()`/`setState`.

**Existing tests (follow these patterns):**
- Unit: `packages/app/src/drawing/__tests__/`: dxfWriter.spec, dxfWriter.color.spec,
  renderBoringDxf.spec, renderDrawingDxf.spec, renderDrawingDxf1to1.spec, dxfZip.spec,
  parseDxfUnderlay.spec, dxfParserSmoke.spec.
- Command: `packages/app/src/commands/__tests__/`: Export{Drawing,AllSheets}{,1to1}DxfCommand.spec,
  ExportBoringDxfCommand.spec, ImportDxfUnderlayCommand.spec, RemoveDxfUnderlayCommand.spec.
- E2E (Playwright, real Chromium): `tests/e2e/drawing/T-6-22-dxf-export.spec.ts`,
  `T-6-24-dxf-1to1-export.spec.ts`, `T-6-26-dxf-native-dim.spec.ts`, `T-6-29-dxf-underlay-import.spec.ts`,
  `all-sheets-dxf.spec.ts`. Perf: `tests/perf/drawing-dxf*.perf.spec.ts`.

## 4. Suggested decomposition (refine in brainstorming/writing-plans — NOT binding)
1. **Shared DXF module** — extract a single bidirectional DXF abstraction. Natural home:
   `packages/shared/src/dxf/` (importable by app + kernel), or keep in app/drawing if shared has
   no need. Decide in design. Round-trip (write→read→write) test as the contract.
2. **Writer upgrade R12 → AC1015** — real ARC/ELLIPSE/SPLINE/LWPOLYLINE entities (stop
   tessellating arcs), proper layer table, ACI/true-color. Keep all 3 existing exporters green
   (regression gate — their current output is relied on; consider a version flag if needed).
3. **Importer → editable sketch** — `ImportDxfIntoSketchCommand`: parse via dxf-parser, map
   entities → `SketchPrimitive[]` (line/arc/circle/ellipse/lwpolyline→lines+arcs/spline), create
   a sketch feature, mirror into SketcherClient, undoable. Handle units (DXF $INSUNITS → mm),
   layers, blocks/INSERT flattening. File picker entry (FileTab or sketch toolbar).
4. **Round-trip fidelity + edge cases** — splines (degree/knots), polyline bulge→arc, nested
   INSERT, missing/odd headers, large files (perf spec), empty/garbage input.
5. **Verification** — §6 real-browser: import a real AC2000 DXF → see editable sketch geometry;
   export → reopen in the importer (and ideally an external DXF viewer) → geometry preserved.

## 5. Risks / gotchas
- **Regression risk:** 3 shipped exporters + their unit/e2e/perf tests depend on current R12
  output. Upgrading the writer must keep them green — treat as a hard regression gate.
- **Spline fidelity:** OCCT/sketcher splines are degree 2|3; DXF splines can be higher-degree
  with knots/weights — map carefully or approximate, and TEST it (don't silently drop).
- **Polyline bulge** (arc segments inside LWPOLYLINE) is easy to miss → import as lines only is a
  silent fidelity bug. Cover with a test.
- **Units:** DXF may be unitless or imperial; map `$INSUNITS` to mm. Furniture is mm-native.
- `dxf-parser` is read-only and may not cover every entity → confirm coverage with fixtures
  before relying on it; no write library exists (writer stays hand-rolled, now extended).
- Don't break the existing non-editable "DXF underlay" path unless the design intentionally
  supersedes it.

## 6. Definition of done (M1)
- Import a modern (AC2000+) DXF → editable 2D sketch primitives you can constrain/extrude.
- Export modern DXF with real ARC/CIRCLE/ELLIPSE/SPLINE/LWPOLYLINE/TEXT/layers; round-trips
  through the importer with geometry preserved.
- All existing DXF exporters + tests still green; new unit + command + e2e tests added per slice.
- `pnpm -r typecheck` 0-new, lint clean, real-browser verification captured and read back.

## 7. ABF context (so you don't chase it)
"ABF" was investigated: it's the **getabf.net SketchUp plugin**, not a file format. It outputs
**layered DXF** + nesting + labels. So ABF needs no codec; its capabilities are roadmap **M2**
(manufacturing DXF/nesting/labels), built on this M1 DXF stack. Keep manufacturing-DXF use in
mind while designing M1's writer (named layers per manufacturing op), but M2 is out of M1 scope.
