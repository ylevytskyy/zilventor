# DXF Phase 4c slice — 3DFACE + RAY/XLINE import (design)

**Date:** 2026-06-23
**Branch:** `feat/dxf-support` (off master `8112434a`, NOT merged)
**Milestone:** M1 full bidirectional DXF — Phase 4c (remaining import entities)
**Predecessor slice:** DIMENSION/LEADER/MLEADER/SOLID import (HEAD `1c33d502`, shipped+pushed)
**Manifest:** stays **v32** (emits only the existing `line` SketchPrimitive — NO bump)

## 1. Goal

Import three DXF entities the parser currently drops at `readEntity`'s `default → null`
arm (and that `toSketch`'s `mapEntity` default arm would otherwise tally as
"unsupported"):

- **3DFACE** — a planar quad/triangle face → a closed loop of construction lines.
- **RAY** — a semi-infinite line → a finite construction line clamped to the imported
  geometry's bounding box.
- **XLINE** — an infinite line → a finite construction line clamped to the bounding box.

All three map to the existing `line` `SketchPrimitive` with `construction: true`. This is
pure 2D import — the same class as the already-shipped SOLID and LEADER work:

- **NO** new `SketchPrimitive` kind.
- **NO** manifest bump (stays v32).
- **NO** kernel / OCCT / planegcs / sketcher-worker change.

## 2. Background & locked decisions

- The Phase-4 umbrella spec (`docs/superpowers/specs/2026-06-22-dxf-phase4-importer-design.md`)
  locks: **SOLID/3DFACE planar → boundary loops; non-planar → reject + tally.** This slice
  honors that for 3DFACE.
- The product decision for RAY/XLINE is **→ construction lines**. The sketch model has **no**
  infinite-line concept (every line is a finite `{x1,y1,x2,y2}` segment), so they must be
  turned into finite construction lines. User-approved representation: **bbox-clamp** (clamp
  the line to span the bounding box of all other imported geometry; fixed-length fallback when
  there is none).
- RAY/XLINE are inherently reference/construction geometry → `construction: true` **always**,
  regardless of layer. 3DFACE boundary loops are `construction: true` **always**, matching the
  shipped SOLID behavior (`expandSolid` hardcodes `construction: true`). No layer-construction
  threading needed for any of the three.

## 3. Code anchors (verified against the real code on `feat/dxf-support`)

All under `packages/shared/src/dxf/`.

**parser.ts**
- Helpers (lines ~8–29): `num(pairs, code, fallback=0)`, `nums(pairs, code)`,
  `str(pairs, code, fallback='')`, `extrusion(pairs)` (codes 210/220/230, returns `undefined`
  when absent).
- `readEntity()` switch on `raw.type` (lines ~138–254); unknown types fall through
  `default → return null` (lines ~252–253).
- LINE parse (lines ~139–142): codes 10/20 = start, 11/21 = end.
- SOLID/TRACE parse (lines ~218–230): corners from codes 10–13 / 20–23, triangle when
  `p2 ≈ p3`, winding reorder to `[p0,p1,p3,p2]`, optional `extrusion`.
- Entities currently carrying `extrusion?`: CIRCLE, ARC, LWPOLYLINE, POLYLINE, ELLIPSE, POINT,
  SOLID, TRACE.

**toSketch.ts**
- `expandSolid(e, s)` (lines ~505–516): `e.corners.map(c => ocsXY(e.extrusion, c.x, c.y))`,
  then emits a closed loop of `construction:true` lines scaled by `s`.
- `expandLeader(e, s, drop)` (lines ~490–503): `<2` vertices → `drop`; else open construction
  polyline.
- `mapEntity(e, s, drop, construction)` (lines ~538–591): single-`SketchPrimitive`-or-null
  dispatch; LINE → `{kind:'line', x1,y1,x2,y2, ...cons}`; `default → drop(type, 'unsupported
  in Phase 4a'); return null`. (Multi-primitive entities — INSERT/POLYLINE/SOLID/LEADER —
  are dispatched in the **main toSketch loop**, not through `mapEntity`.)
- `expandInsert` block-body loop (lines ~342–354): per-block-entity dispatch with explicit
  branches for INSERT, LWPOLYLINE/POLYLINE, **SOLID** (`expandSolid(be, 1)`), else `mapEntity`.
- Unit scale `s = unitFactor(parsed.header)` (line ~384); applied to every coordinate/radius.
- Drop tally: `droppedMap` (line ~387) + `drop(kind, reason)` (lines ~388–392).
- **No** bounding-box or infinite-line concept exists anywhere — confirmed.
- `ocsXY(extrusion, x, y)` (lines ~34–38) handles `undefined` extrusion as identity.

**3DFACE / RAY / XLINE DXF facts (grounded):**
- 3DFACE: corners codes 10–13 / 20–23 / **30–33** (z). **No** extrusion/OCS — already WCS.
  Corners are in **sequential** polygon order (NOT the SOLID 0,1,3,2 swap). Triangle when
  corner 3 ≈ corner 2. Code 70 = edge-visibility flags.
- RAY: 10/20/30 = start point; 11/21/31 = **unit direction vector**. Semi-infinite (t ≥ 0).
- XLINE: 10/20/30 = a point on the line; 11/21/31 = **unit direction vector**. Infinite
  (t ∈ ℝ).

## 4. Design

### 4.1 Parser (`parser.ts`)

Add three `readEntity` cases and three `ParsedEntity` union members:

- **3DFACE** → `{ type: '3DFACE', layer, corners: {x,y,z}[] }`. Read c0–c3 from
  10–13 / 20–23 / 30–33. Triangle-collapse: when `c3 ≈ c2` (eps 1e-9) keep `[c0,c1,c2]`,
  else `[c0,c1,c2,c3]` (sequential order — do **not** reorder like SOLID). Carry z for the
  planar gate in `toSketch`. No extrusion field.
- **RAY** → `{ type: 'RAY', layer, x, y, dx, dy }` — base 10/20, dir 11/21.
- **XLINE** → `{ type: 'XLINE', layer, x, y, dx, dy }` — base 10/20, dir 11/21.

(Drop z on RAY/XLINE — the import is onto the XY sketch plane.)

### 4.2 toSketch — 3DFACE

- **Planar gate:** if `max|zᵢ − z₀| > eps` → `drop('3DFACE', 'non-planar (corners not co-Z)')`,
  emit nothing. A face flat at any single z (incl. z≠0) imports fine; a tilted/non-planar
  face is rejected per the locked spec (projecting it onto XY would distort it).
- **Degenerate guard:** fewer than 3 distinct corners → `drop('3DFACE', 'degenerate')` (mirrors
  LEADER's `<2` guard).
- **Emit:** closed construction-line loop from the corners' x,y scaled by `s`,
  `construction: true` always (matches SOLID).
- **Shared emitter:** extract `closedLoop(corners, extrusion, s): SketchPrimitive[]` from the
  current body of `expandSolid`. `expandSolid` calls `closedLoop(e.corners, e.extrusion, s)`;
  a new `expandFace(e, s, drop)` does the planar gate + degenerate guard, then
  `closedLoop(e.corners, /*extrusion*/ undefined, s)`.
- **Dispatch:** add a 3DFACE branch in **both** the main toSketch loop and the `expandInsert`
  block-body loop (3DFACE can appear inside blocks), mirroring SOLID's two dispatch sites.
- **Limitation (documented):** edge-visibility flags (code 70) are ignored — all edges of the
  face are emitted.

### 4.3 toSketch — RAY/XLINE (two-pass, bbox-clamp)

The only structural change to `toSketch`'s flow.

1. **Pass 1 (collect):** in the main loop, RAY/XLINE entities are pushed into a
   `pendingInfinite: DxfEntity[]` list instead of being emitted inline. All other entities are
   processed as today, accumulating into the output `primitives`.
2. **Bbox:** after the main loop, if `pendingInfinite` is non-empty, compute the bounding box
   of the already-emitted `primitives` (in **scaled / mm space**) via a `primExtent(p)` helper:
   - line → its two endpoints
   - circle / arc → center ± r
   - ellipse → center ± max(rx, ry)
   - point → the point
   - spline → all control points
3. **Pass 2 (clamp + emit):** for each pending RAY/XLINE:
   - Direction `(dx,dy)`; if `|dir| ≈ 0` → `drop('RAY'|'XLINE', 'zero direction')`.
   - Base point scaled by `s`; direction is **dimensionless** (not scaled).
   - Slab-clip the parametric line `P(t) = base·s + t·dir` against the (margin-expanded) bbox
     → `[t_min, t_max]`. XLINE uses the full range; RAY clamps to `t ≥ 0` (i.e.
     `max(0, t_min)` … `t_max`, and if `t_max ≤ 0` the ray points away from the bbox).
   - Emit the clipped segment as a `construction: true` line.
   - **Fallback:** empty bbox (no other geometry) OR the line misses the bbox (no slab
     intersection) OR (RAY) the bbox is entirely behind the base → emit a fixed-length
     (~100 mm) construction line centered on (XLINE) / starting at (RAY) the base along the
     direction. This is **not** a drop — the reference line still appears.

### 4.4 Error handling / drops summary

| Case | Behavior |
|---|---|
| 3DFACE non-planar (corners not co-Z) | drop + tally, emit nothing |
| 3DFACE < 3 distinct corners | drop + tally |
| 3DFACE edge-visibility flags (code 70) | ignored (all edges emitted) — documented limitation |
| RAY/XLINE zero direction | drop + tally |
| RAY/XLINE no clampable geometry / line misses bbox | fixed-length fallback (NOT a drop) |

## 5. Testing (TDD red → green per slice)

- **`parser.test`:** 3DFACE quad parse (4 corners) + triangle parse (c3≈c2 → 3 corners);
  RAY parse (base+dir); XLINE parse (base+dir).
- **`toSketch.test`:** 3DFACE planar → 4 (and 3 for triangle) construction lines forming a
  closed loop; 3DFACE non-planar → dropped + tallied, 0 primitives; 3DFACE inside an INSERT
  block → expands within the flattened block; XLINE → clamped segment spans the geometry bbox
  (assert endpoints reach the bbox extents); RAY → clamped base→far only (t≥0); zero-direction
  RAY/XLINE → dropped; empty-geometry RAY/XLINE → fixed-length fallback emitted (1 line).
- **§6 e2e:** a small self-authored fixture DXF containing a 3DFACE + an XLINE + a RAY + a
  real LINE, imported into a new part via the `window.__zilventorImportDxfNewPart` hook;
  assert the resulting construction-line count; real Chromium (assert via
  `window.__zilventorStore`, not pixels — headless viewport is black).

## 6. Verification gate

- shared `tsc` 0 · app `tsc` 0 (cross-package type consumer clean)
- shared `vitest` green
- `lint` clean on real packages (the ~454 `.claude/worktrees` lines are pre-existing noise)
- §6 e2e green (real Chromium)
- **NO manifest bump** (v32 unchanged)

## 7. Out of scope (remaining Phase 4c, future slices)

- HATCH boundary loops (highest real-world value; bigger parsing slice)
- LAYER color/linetype → metadata (needs a model decision; no consumer today)
- parser perf / large-file handling (index group-code pairs per entity to kill per-`num()`
  linear rescans)

After these, Phase 5 (round-trip fidelity / perf / §6 real-browser + the human-gated
real-AutoCAD open of an exported DXF) → M1 merge decision for the whole `feat/dxf-support`
branch (Phases 1+2+3+4a+4b+4c).
