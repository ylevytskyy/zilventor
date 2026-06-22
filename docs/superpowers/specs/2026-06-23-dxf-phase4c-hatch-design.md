# DXF HATCH import — design spec (Phase 4c slice)

Date: 2026-06-23
Branch: `feat/dxf-support` (off master `8112434a`, NOT merged)
Status: approved (brainstorming), ready for writing-plans

## Goal

Import DXF `HATCH` boundary paths into the editable sketch model as **closed construction geometry**. Fill, pattern, gradient, associativity, and seed points are dropped — only the boundary loops become sketch primitives. This follows the exact precedent already set by `SOLID` and `3DFACE`, whose boundaries are imported via the shared `closedLoop()` helper as construction-only geometry with fill dropped (`expandSolid`'s comment already references "consistent with HATCH spec").

Scope locked during brainstorming:
- **Full edge-type coverage** — polyline boundaries (with bulge) AND edge lists of all 4 edge types: line, circular-arc, elliptic-arc, spline.
- **HATCH-in-blocks** — dispatch HATCH in the `toSketch` main loop AND inside `expandInsert`'s block body (same as SOLID / 3DFACE).

Constants applied by precedent (NOT re-decided):
- `construction: true` always (boundary is reference geometry, like SOLID / 3DFACE).
- OCS/extrusion transform (`ocsXY`) + unit-scale (`s`) applied to all coordinates.
- Arc angles converted DEGREES → radians for the sketch primitive.
- Fill / pattern name / gradient / seed points / associativity dropped.
- NO manifest bump (additive entity) — stays **v32**.
- Changes confined to `packages/shared/src/dxf/` + one e2e. No kernel / OCCT / planegcs / worker change.

## Files

- Parser: `packages/shared/src/dxf/parser.ts` (dispatch switch on entity type; helpers `num`/`nums`/`str`/`extrusion`).
- Types: `packages/shared/src/dxf/types.ts` (`DxfEntity` discriminated union; `SketchPrimitive` union).
- toSketch: `packages/shared/src/dxf/toSketch.ts` (`closedLoop`, `expandSolid`, `expandFace`, `expandPolyline`, `expandInsert`, `mapEntity`, `primExtent`, `clipToBox`, `ocsXY`, `ocsBasis`, `ocsReflected`, `insertMatrix`, `transformPrimitive`).
- Tests: `packages/shared/src/dxf/parser.spec.ts`, `packages/shared/src/dxf/toSketch.spec.ts`.
- e2e: `tests/e2e/drawing/` (assert via `window.__zilventorStore` — headless viewport is black).

## 1. Parser — `parseHatch(pairs)` → `DxfHatch`

### Why a new parsing approach
The existing `num(pairs, code)` / `nums(pairs, code)` helpers treat an entity's group-code pairs as an **unordered bag** — correct when each code appears once. HATCH **repeats** codes 10/20/40/50/51/72/73 across many loops and many edges, with structure encoded by *order* and *count*. The bag helpers cannot express nested repeated structure. So `parseHatch` performs a **cursor-based sequential walk** over the entity's `pairs` array (small local cursor helpers). This is a new-but-necessary parsing style within `parser.ts`.

### DXF HATCH boundary group-code sequence (AC1015+)
```
0   HATCH
8   layer
210/220/230  extrusion (OCS normal)
2   pattern name           (dropped)
70  solid fill flag        (dropped)
71  associativity flag     (dropped)
91  number of boundary paths (N loops)   <-- boundary section starts here
  per loop:
    92  path type flag (bit 1 set => POLYLINE path; else EDGE list)
    -- POLYLINE path (92 & 2):
       72  has-bulge flag
       73  is-closed flag
       93  vertex count
       10/20 vertex x/y, 42 bulge   (repeated per vertex)
    -- EDGE list (else):
       93  edge count
       per edge:
         72  edge type: 1=line, 2=circular arc, 3=elliptic arc, 4=spline
         -- line (72=1):    10/20 start, 11/21 end
         -- arc (72=2):     10/20 center, 40 radius, 50 start(DEG), 51 end(DEG), 73 ccw
         -- ellipse (72=3): 10/20 center, 11/21 major-axis endpoint RELATIVE to center,
                            40 ratio(minor/major), 50 start(DEG), 51 end(DEG), 73 ccw
         -- spline (72=4):  94 degree, 73 rational, 74 periodic,
                            95 knot count, 96 control-point count,
                            40 (knots, repeated), 10/20 + optional 42 (control pts + weights)
    97  source-object count, then that many 330 handles  (skip)
... pattern data / seed points / gradient ...  (skip — boundary section is complete after the loops)
```

### Parsed types (add to `types.ts`)
```ts
type HatchEdge =
  | { kind: 'line';    x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc';     cx: number; cy: number; r: number;
                       startAngle: number; endAngle: number; ccw: boolean }   // DEGREES
  | { kind: 'ellipse'; cx: number; cy: number; majorX: number; majorY: number;
                       ratio: number; startAngle: number; endAngle: number; ccw: boolean } // DEGREES
  | { kind: 'spline';  degree: number; closed: boolean;
                       controlPoints: { x: number; y: number }[]; knots: number[];
                       weights?: number[] };

type HatchLoop =
  | { kind: 'polyline'; closed: boolean; vertices: { x: number; y: number; bulge: number }[] }
  | { kind: 'edges';    edges: HatchEdge[] };

interface DxfHatch {
  type: 'HATCH';
  layer: string;
  extrusion?: DxfExtrusion;
  loops: HatchLoop[];
}
```

### GOTCHA (document in code)
HATCH arc **and** ellipse edge angles (codes 50/51) are in **DEGREES**. This differs from the standalone `ELLIPSE` entity, whose start/end param angles (codes 41/42) are in **RADIANS**. Do not assume the ellipse-edge angles are radians.

### Defensiveness
Unrecognised edge type, missing counts, or a malformed loop → **skip that edge/loop, never throw**. Same posture as the 3DFACE non-planar / degenerate gates (drop, optionally tally).

## 2. toSketch — `expandHatch(e, s)` → construction `SketchPrimitive[]`

Dispatched in **both** the `toSketch` main loop and inside `expandInsert`'s block body (matching SOLID / 3DFACE). All emitted primitives are `construction: true`.

Per loop:
- **polyline loop** → reuse the existing `expandPolyline` segment logic (straight segments + bulge→arc via `segment()`, honour `closed`, OCS reflection negates bulge), forced `construction: true`.
- **edges loop** → per edge:
  - `line` → `line` primitive; both endpoints through `ocsXY(extrusion, x, y)` then `× s`.
  - `arc` → `arc` primitive; center through `ocsXY` + `× s`, `r × s`, deg→rad, and OCS-reflection start/end swap (same handling as the standalone ARC path in `mapEntity`).
  - `ellipse` → `ellipse` primitive; reuse the standalone-ELLIPSE conversion math (major-axis endpoint + ratio → `rx`, `ry`, `rotation`), converting the edge's param angles deg→rad.
  - `spline` → `spline` primitive; control points through `ocsXY` + `× s`, carry `degree` and `closed`.

`elevation` / z is dropped (flat 2D import, consistent with every other entity).

### Targeted refactor (no behavior change)
Extract the standalone-ELLIPSE major-endpoint → (`rx`, `ry`, `rotation`) computation from `mapEntity` into a small shared helper, called by BOTH the standalone ELLIPSE path and the new HATCH ellipse-edge path. The existing standalone-ELLIPSE tests must stay green (this is the regression guard for the refactor). No unrelated refactoring.

## 3. Testing & verification

TDD slices (each red→green; the plan should produce ~8–9 tasks):
1. `parseHatch` — polyline boundary loop (with bulge).
2. `parseHatch` — edge loops: line + circular-arc edges.
3. `parseHatch` — edge loops: elliptic-arc + spline edges.
4. Extract ellipse major-endpoint→(rx,ry,rotation) helper; standalone ELLIPSE tests stay green (refactor, no behavior change).
5. `expandHatch` — polyline loops → construction primitives.
6. `expandHatch` — edge loops line/arc → construction.
7. `expandHatch` — ellipse/spline edges → construction (reuse helper).
8. Dispatch HATCH in `expandInsert` (block-nested) + `toSketch` main-loop wiring.
9. e2e: import a real DXF containing a HATCH → assert construction primitives present, 0 console errors.

Verification posture (matches prior 4c slices):
- Per-pkg from inside the package: `cd packages/shared && npx vitest run`; tsc `npx tsc --noEmit -p tsconfig.json`.
- e2e from root: `npx playwright test --project=chromium tests/e2e/drawing/<file>` — headless viewport is BLACK, so assert via `window.__zilventorStore`, not pixels.
- Gate to pass: shared tsc 0 · app tsc 0 · shared vitest all green (currently 1227 + new) · lint clean (dxf) · §6 e2e green real Chromium · manifest untouched v32.
- Test style: `expect().toBeCloseTo(x, 9)` for floats; discriminated-union type guards (`if (p.kind === 'arc')`).

## Out of scope (documented)
Fill / pattern / gradient rendering; hatch associativity; seed points; `MPOLYGON`. Code-70 / edge-visibility flags ignored. RAY/XLINE-inside-blocks remains out of scope from the prior slice. Known-flaky app-suite `frameToModel` teardown tests are pre-existing, not ours.

## After this slice
Remaining Phase 4c: LAYER color/linetype → metadata (needs a model decision; no consumer today) · parser perf for large files (index group-code pairs per entity). Then Phase 5 (round-trip fidelity / perf / real-browser §6; real-AutoCAD-open of an exported dxf is HUMAN-GATED) → **M1 merge decision** for the whole `feat/dxf-support` branch (Phases 1+2+3+4a+4b+4c).
