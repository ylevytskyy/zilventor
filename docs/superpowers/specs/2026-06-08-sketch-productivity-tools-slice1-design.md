# Sketch Productivity Tools — Slice 1 — Design

**Date:** 2026-06-08
**Status:** Approved (design); pending implementation plan
**Context:** First slice of the Tier-1 "Inventor 2012 parity for furniture design" work. Adds three pure-2D sketch tools the sketcher currently lacks. Project-geometry and trim/extend are deferred to later slices; multi-segment offset, non-touching fillet, and associative offset are explicit non-goals (see Non-Goals).

## Goal

Give the 2D sketcher three Inventor-staple productivity tools, scoped to the highest value-per-risk subset:

1. **Construction geometry** — reference primitives that are fully constrainable but excluded from profiles/extrude.
2. **Offset** — one-shot, single-primitive parallel/concentric copy.
3. **Fillet / Chamfer** — parametric, editable corner rounding/beveling.

Success = a furniture designer can: draw a rectangle, offset it inward as a panel inset, fillet a corner with an editable radius, drop a construction centerline, and extrude — with the construction geometry correctly excluded from the profile.

## Architecture grounding (verified)

- **`SketchPrimitive`** union: `shared/src/types.ts:26` — `line | rectangle | circle | arc | spline`, each with a string `id`. Sketch feature stores `primitives: SketchPrimitive[]` + `constraints: SketchConstraint[]` (`types.ts:48`).
- **Tool framework**: `app/src/sketcher/tools/SketchTool.ts` (abstract base: `handle(ToolEvent) -> ToolOutput`, `getAnchor`, `reset`, `numericFieldCount`). Tools emit `{kind:'committed', primitive, snapEvents}`. Registered in `ActiveToolController.instantiate()`; `ToolKind` union in `store.ts:16`; ribbon in `shell/tabs/SketchTab.tsx`.
- **Constraints / planegcs**: `shared/src/constraints.ts:24`. planegcs binding `sketcher-worker/src/GcsSystem.ts` already binds `tangent_la` (line-arc tangent) and `circle_radius` — fillet can be fully parametric. **No offset/parallel-at-distance constraint exists** → offset must be one-shot geometry.
- **Profile / closed-loop detection**: `kernel/src/occt/SketchOps.ts:375` `combineEdgesIntoWires`. Edges are built from primitives by the caller (`kernel/src/adapter/features/SketchFeature.ts`). Construction filter goes at the edge-build stage, before `combineEdgesIntoWires`.
- **Rendering**: `app/src/sketcher/render/CommittedSketchRenderer.ts:buildObject` builds one Three object per primitive (currently a single `LineBasicMaterial`). Draft/preview overlay: `app/src/sketcher/overlay/SketchOverlay.ts` `setDraftPolyline`.

## Design

### 1. Data model
- Add optional `construction?: boolean` to every `SketchPrimitive` variant (`shared/src/types.ts:26`). Absent/false = normal geometry.
- Additive + optional, defaults false → **no manifest bump expected**. Verify the sketch serializer/packer round-trips the field; if it whitelists keys, add `construction` to the whitelist. A round-trip test gates this.

### 2. Construction geometry
- **Construction toggle** in the SketchTab ribbon: while active, any tool's newly committed primitive is stamped `construction: true`.
- **"Toggle Construction" command** acting on the current selection — converts existing primitives to/from construction.
- **Rendering**: in `CommittedSketchRenderer.buildObject`, branch on `p.construction` → dashed + dimmer using `LineDashedMaterial` (requires `geometry.computeLineDistances()`).
- **Kernel**: in `SketchFeature.ts`, filter out `construction` primitives before building edges for `combineEdgesIntoWires` → excluded from profiles and extrude. **Still passed to planegcs** so they remain fully constrainable (layout / symmetry references).

### 3. Offset tool (one-shot, single-primitive)
New `OffsetTool extends SketchTool`:
- Step 1: select one primitive. Step 2: cursor side picks direction. Step 3: type or drag the distance. Commit.
- Produces a **new independent primitive** (no live link to the source):
  - line → parallel line at distance
  - circle → concentric circle (r ± d)
  - arc → concentric arc (r ± d, same start/end angles)
  - rectangle → inset/outset rectangle (square corners)
- Live preview via `SketchOverlay` draft polyline.
- New geometry inherits the current construction-toggle state like any other tool.

### 4. Fillet / Chamfer tools (parametric, editable)
- **FilletTool**: pick two lines sharing a corner (common endpoint) → trim both back to the tangent points, insert an arc, add constraints: `tangent`(line1, arc), `tangent`(line2, arc), `coincident`(arc ends ↔ trimmed line ends), `dim-radius`(arc). Radius editable; default value via numeric entry.
- **ChamferTool**: pick two lines sharing a corner → trim both, insert a connecting line; **equal-distance setback** (single value). Matches the existing symmetric constant-distance 3D chamfer.
- Both reuse already-bound `tangent_la` + `circle_radius` planegcs functions. The solver refines positions from the tool's initial placement.

### 5. UI wiring
- `SketchTab` ribbon: add a Construction toggle button + Offset, Fillet, Chamfer buttons.
- `ToolKind` union (`store.ts:16`) gains `'offset' | 'fillet' | 'chamfer'`.
- `ActiveToolController.instantiate()` gains cases for the three new tools.

## Non-Goals (explicit deferrals)

1. **Offset = single primitive only.** Multi-segment open-chain / connected-loop offset (with corner extend/trim/round) is deferred.
2. **Fillet/Chamfer require a shared corner.** No auto-extend of non-touching lines.
3. **Chamfer = equal-distance setback only.** distance-distance and distance-angle variants deferred.
4. **Offset is one-shot / non-associative.** No live link that updates the offset when the source changes.
5. Project geometry and trim/extend are separate later slices.
6. **Fillet/Chamfer operate on two `line` primitives sharing a corner — rectangle corners are NOT filletable in slice 1.** Because `rectangle` is a single primitive (not four lines), rounding its corners would require exploding it to lines. Deferred because the **3D fillet feature already exists** for rounded panel/top corners on the solid; in-sketch fillet in slice 1 targets line-based profiles (swept/revolved/complex 2D). Rectangle-corner fillet (via auto-explode) is a candidate for a later slice.

## Testing strategy (TDD, red→green per tool)

- **shared**: `construction` flag round-trips serialize/deserialize.
- **kernel**: profile extraction excludes `construction` primitives; offset geometry math (parallel-line distance, concentric arc/circle r±d, rectangle inset); real-OCCT integration — a sketch containing a construction line + a fillet extrudes to the expected solid (construction excluded).
- **worker**: fillet solves to an arc tangent to both lines with the radius honored; chamfer setback is equal on both legs.
- **app**: each tool's pointer state machine produces the expected committed primitive + constraints; ribbon/`ToolKind` wiring.
- **e2e**: rectangle → offset inward 10mm → fillet a corner at R5 → extrude uses the outer non-construction loop; a construction line is excluded from the profile.

## Risks / open implementation questions

- **Serializer whitelist**: if sketch persistence enumerates fields explicitly, `construction` must be added or it silently drops on save/reload (round-trip test catches this).
- **Fillet trim bookkeeping**: trimming the two source lines to tangent points must update their endpoints consistently with the new `coincident` constraints; getting initial placement close enough for the solver to converge.
- **Rectangle as a single primitive**: offset handles this directly (inset rectangle). Fillet/chamfer do NOT (resolved as Non-Goal #6 — line-only in slice 1).
- **Construction in planegcs**: confirm construction primitives are still emitted to the solver (they should be — only the kernel profile builder filters them).
