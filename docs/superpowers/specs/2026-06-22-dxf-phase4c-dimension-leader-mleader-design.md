# DXF Phase 4c — DIMENSION / LEADER / MLEADER full-fidelity import

**Date:** 2026-06-22
**Branch:** `feat/dxf-support` (off master `8112434a`; HEAD at design time `28c54128`)
**Status:** design approved (brainstorming), pending plan
**Manifest:** NO bump (emits only existing v32 `SketchPrimitive` shapes + `TextAnnotation`)

## 1. Context

Phase 4a/4b/4c-slices shipped a DXF→editable-sketch importer: parser keeps all blocks
(including anonymous `*`-prefixed ones) with base points, `expandInsert` recursively flattens
INSERTs/blocks into sketch primitives, and TEXT/MTEXT map to the `TextAnnotation` model rendered
as canvas-texture meshes. This slice imports the three annotation/dimensioning entities the parser
currently drops at `default → null`:

- **DIMENSION** (`parser.ts` switch, currently unhandled)
- **LEADER** (legacy `AcDbLeader`)
- **MLEADER** / **MULTILEADER** (`AcDbMLeader`)

Locked product decision (phase4 design `2026-06-22-dxf-phase4-importer-design.md:82–136`):
"DIMENSION/LEADER/MLEADER → annotations", scoped to 4c. This design refines that to **full
fidelity**: import the drawn geometry (lines/arcs/arrowheads) AND the text, by reusing the existing
block-flatten machinery rather than reducing each entity to a bare text label.

Brainstorming decisions (this session):
1. **Richness = full fidelity** (expand the `*D` blocks; arrowheads via a new SOLID branch).
2. **Scope = all three** entities (DIMENSION + LEADER + MLEADER).
3. **Fixtures = spec-grounded, hand-authored** (no real DXF available in repo); MLEADER is
   best-effort with a documented limitation flagged for later human re-verification on a real file.

Group codes below are grounded in the ezdxf documentation + the AutoDesk DXF Reference (not
training-data memory). Per-entity grounding confidence: SOLID 97 · DIMENSION 92 · LEADER 90 ·
MLEADER 78.

## 2. Architecture — reuse over reinvent

```
parser.ts                         toSketch.ts
─────────                         ───────────
+ case 'DIMENSION'  ─┐            DIMENSION → synth identity INSERT of block(2) → expandInsert()
+ case 'SOLID'       ├─ new       │           (fallback: TextAnnotation from 1/42 at 11/21)
+ case 'LEADER'      │  parse     SOLID     → closed construction-line loop (winding 0,1,3,2)
+ case 'MLEADER'    ─┘  branches  LEADER    → construction polyline from vertices
                                  MLEADER   → CONTEXT_DATA: leader polylines + embedded text
```

- **No new `SketchPrimitive` kind.** Geometry maps to existing `line` (and whatever the flattened
  block contains: `line`/`arc`/`circle`). Text maps to existing `TextAnnotation`.
- **No manifest bump.** All emitted shapes already exist in v32.
- **Rendering: zero change.** Flattened primitives + annotations flow through the existing
  `CommittedSketchRenderer.update(primitives, annotations)`.
- **Unrecognized → drop+tally.** A malformed entity (esp. MLEADER) must `drop(...)` (the existing
  skipped-entity tally) and continue — never crash the import.

## 3. Entity types & types.ts changes

Add to the `DxfEntity` union (`packages/shared/src/dxf/types.ts`):

```ts
| { type: 'DIMENSION'; layer: string; block?: string; textOverride: string;
    measurement: number; textMidX: number; textMidY: number }
| { type: 'SOLID'; layer: string; corners: ReadonlyArray<{ x: number; y: number }> }  // 3 or 4
| { type: 'LEADER'; layer: string; vertices: ReadonlyArray<{ x: number; y: number }> }
| { type: 'MLEADER'; layer: string;
    leaderLines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
    text?: { value: string; x: number; y: number; height: number; rotation: number } }
```

(3DFACE, RAY/XLINE, HATCH remain out of scope — separate 4c slices.)

## 4. Per-entity mapping

### 4.1 DIMENSION — `parser.ts` + `toSketch.ts`

**Parse** (grounded codes): `2` block name (optional), `1` text override, `42` actual
measurement, `11`/`21` text midpoint, `70` type flags (parsed but only used to detect the
block-present bit if needed; not required for the mapping). Def-points (`10`/`20`, `13`/`23`,
`14`/`24`) are read only for the fallback path.

**Map** (`toSketch`):
1. If `block` is present AND resolvable in `parsed.blocks`: synthesize an identity INSERT
   `{ type:'INSERT', name: block, x:0, y:0, rotation:0, xscale:1, yscale:1, columns:1, rows:1, ... }`
   and call the existing `expandInsert(synthInsert, parsed, s, depth, drop)`. This yields the full
   rendered dimension — extension/dimension lines (LINE→`line`), arc dims (ARC→`arc`), arrowheads
   (SOLID→construction loop, §4.2), and the measurement text (MTEXT/TEXT→`TextAnnotation`) — all via
   already-tested code paths.
2. **Fallback** (block absent/unresolvable): emit one `TextAnnotation` at `(11,21)·s` with
   `value = textOverride` if non-empty and not `<>`, else the formatted measurement (`42`).
   Formatting: `formatMeasurement(v) = trim trailing zeros of v.toFixed(3)` (no unit suffix, no
   dimstyle precision — MVP). Drop the geometry in this branch (we have none without the block).
3. Construction flag: dimension blocks normally sit on a `DIMENSIONS`/`DEFPOINTS` layer →
   the reused `isConstructionLayer`/layer-table path already marks them construction. The synthetic
   INSERT carries the DIMENSION's own `layer` so layer-based construction detection still applies.

### 4.2 SOLID — `parser.ts` + `toSketch.ts`

**Parse**: corners `10`/`20`, `11`/`21`, `12`/`22`, `13`/`23`. **LOAD-BEARING gotcha (ezdxf,
verbatim): the last two vertices are reversed — screen/winding order is 0,1,3,2, NOT 0,1,2,3.**
Read into `corners` already in winding order: `[c10, c11, c13, c12]`. If `c12 == c13` (within eps)
it is a **triangle** → `[c10, c11, c13]` (3 corners). Apply OCS extrusion if present (reuse the
existing `extrusion()` + OCS→WCS mirror path used by CIRCLE/ARC).

**Map**: emit a **closed loop of `construction:true` `line` primitives** connecting the corners in
winding order and back to the first. (No fill — consistent with the HATCH→boundary product
decision.) SOLID also handles standalone 2D SOLID/TRACE fills, not only arrowheads.

### 4.3 LEADER — `parser.ts` + `toSketch.ts`

**Parse**: vertices = all `10`/`20` pairs (count cross-checked against `76`); ignore `71`
(arrowhead flag), `40` (text height), `340` (annotation handle — the pointed-at text is a separate
entity already imported via its own TEXT/MTEXT record, so LEADER emits **no** text).

**Map**: emit construction `line` primitives between consecutive vertices (open polyline). A
degenerate (<2 vertices) LEADER → `drop(...)` + continue.

### 4.4 MLEADER — `parser.ts` + `toSketch.ts` (best-effort, documented limitation)

The geometry+text live inline in a nested `CONTEXT_DATA{ … }` structure, not in a `*D` block.
**Parse defensively, brace-matching by the literal token STRING, never by code number** — because
code `304` is overloaded (it carries both the MTEXT content string and the `LEADER_LINE{` structural
token). The parser tracks nesting depth by scanning for values ending in `{` (`CONTEXT_DATA{`,
`LEADER{`, `LEADER_LINE{`) and the `}` close tokens, and only interprets coordinate codes within the
recognized sub-block.

Extract (safe codes per grounding): leader-line vertices (`10`/`20`/`30` inside each
`LEADER_LINE{ }`) → one construction polyline per `LEADER_LINE`; embedded text — if `290`
(has_mtext_content) is set — the `304` MTEXT string + `12` text location + `41` text height + `42`
rotation → one `TextAnnotation`. Block-content MLEADERs (`296`) and the 47×16 transform matrix are
**out of scope** → `drop(...)` + tally.

Any parse failure (unbalanced braces, missing content) → `drop(...)` + continue; never throw.

**Documented limitation** (carry into code comment + handoff): MLEADER import is validated against
the AutoDesk/ezdxf spec, NOT a real CAD-exported file. Inner leader-line/dogleg codes are
writer-variant and the spec is self-admittedly unreliable; flag for human re-verification once a
real MLEADER DXF is available.

## 5. Fixtures (hand-authored, spec-grounded)

Hand-author minimal valid AC1015 DXF fixtures covering each entity, placed under
`tests/e2e/fixtures/` and/or inline strings in shared unit tests:

- A **DIMENSION** with a `*D1` block (BLOCKS section defining the block as a couple of LINEs + a
  SOLID arrowhead + an MTEXT) → asserts geometry lines + arrowhead loop + one text annotation.
- A **DIMENSION with no block** → asserts the single-`TextAnnotation` fallback (measurement
  formatted).
- A standalone **SOLID** (quad) and a **SOLID** triangle (vtx2==vtx3) → asserts winding 0,1,3,2 and
  triangle collapse.
- A **LEADER** with 3 vertices → asserts 2 construction segments, no annotation.
- An **MLEADER** with one `LEADER_LINE` (2 vertices) + mtext content → asserts 1 polyline + 1
  annotation; plus a malformed MLEADER → asserts drop+tally, no crash.

## 6. Verification

- **TDD per entity** (red→green): each parser branch + each `toSketch` mapping gets a failing
  shared unit test first. No kernel/OCCT bake needed (these are 2D sketch primitives + annotations,
  not solids).
- **§6 e2e** (real Chromium): import a combined fixture via the DEV hook
  `window.__zilventorImportDxfNewPart`; assert via `window.__zilventorStore` the resulting sketch
  has the expected primitive count and `annotations.length`. Viewport renders black in headless →
  assert through the store, not pixels.
- Gate: shared + app tsc 0; `cd packages/shared && npx vitest run`; `cd packages/app && npx vitest run`;
  `pnpm lint` 0 (real packages; stale-worktree noise pre-existing); e2e from repo root
  `npx playwright test --project=chromium tests/e2e/drawing/<file>`.

## 7. Out of scope (this slice)

- 3DFACE, RAY/XLINE, HATCH boundary, LAYER color/linetype→metadata, parser perf — other 4c slices.
- MLEADER block-content (`296`) and the content transform matrix.
- Dimension measurement formatting per dimstyle (precision, units, tolerances) — MVP uses a fixed
  3-decimal trim.
- Re-rendering dimensions as live editable dimension objects — they import as flat construction
  geometry + text, not as parametric dimensions.

## 8. Limitations & follow-ups

- MLEADER best-effort (see §4.4) — re-verify against a real file.
- DIMENSION imports as flattened geometry, not a live dimension; round-trip export will not
  reconstruct an associative DIMENSION (acceptable for M1 — import is the goal).
- SOLID fill is dropped (boundary only), consistent with HATCH.
