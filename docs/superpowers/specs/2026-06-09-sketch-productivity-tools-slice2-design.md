# Sketch Productivity Tools — Slice 2 (Design Spec)

**Date:** 2026-06-09
**Track:** Tier-1 "Inventor 2012 parity for furniture design" (3rd feature; deepens the sketch-tools track first shipped in slice 1 at `08cf120`)
**Baseline:** master `e1b5498`, manifest v20.
**Scope owner decisions (locked in brainstorming):** Project Geometry = straight-edge MVP; Trim/Extend intersections = line+circle+arc; slice-1.x debt = fillet-coincident **+** multi-segment/loop offset.

## Summary

Five deliverables, all app-side. **No new shared fields, no manifest bump (v20 stays), no kernel changes** (projected geometry is baked as ordinary sketch lines; the projection math is pure app-side dot-products). The one genuinely new piece of math is a primitive-intersection module shared by Trim, Extend, and multi-segment Offset.

1. **Trim** tool — remove the picked portion of a primitive up to its nearest intersections.
2. **Extend** tool — lengthen a line/arc end to the nearest intersecting primitive.
3. **Project Geometry** tool — project a straight 3D model edge onto the active sketch plane as a sketch line (non-associative MVP).
4. **Fillet coincident fix** (slice-1.x debt) — pin fillet arc-ends to trimmed line-ends so radius edits don't drift.
5. **Multi-segment / loop offset** (slice-1.x debt) — offset a connected chain/loop of primitives with corner fix-up.

## Architecture context (verified against current code)

- **Picking-tool pattern** (`ActiveToolController.ts`): tools are constructed in `instantiate()` (switch on `ToolKind`), receive callback-only option bags, get `setPrimitives()` then `onPointerClick()` from `handlePointer` instanceof branches. They emit via injected callbacks → `bus.execute(...)` → undo/redo for free. `ToolKind` union lives in **two** places kept in sync manually: `ActiveToolController.ts` (~line 19) and `store/useAppStore.ts` (~line 16). Both must gain `'trim' | 'extend' | 'project-geom'`.
- **Pick helper** (`sketcher/tools/pick.ts`): `pickPrimitiveAt(primitives, pt)` → `{ primitiveId } | null` (5-unit body hit test); `distToSegment` exported.
- **Commands**: `UpdatePrimitiveCommand(id, patch)` merges a `Partial<SketchPrimitive>` and calls `sketcherClient.updatePrimitive` to re-sync the planegcs solver. `DeletePrimitiveCommand` removes a primitive via kernel RPC (`kernel.removePrimitive`) and cascades attached-constraint removal; undo re-adds.
- **SketchPrimitive** (`shared/types.ts` ~26-31): `line {x1,y1,x2,y2}`, `circle {cx,cy,r}`, `arc {cx,cy,r,startAngle,endAngle}`, `rectangle {x,y,w,h}`, `spline`; all optional `construction?`. String `id`.
- **Ribbon**: `shell/tabs/SketchTab.tsx` "Modify" `RibbonPanel` (~lines 122-147) already hosts Offset/Fillet/Chamfer buttons (`aria-pressed`, `disabled={!sketchMode}`). Three new buttons go here.
- **Sketch plane**: `Feature {kind:'sketch'; plane: WorkPlaneRef; ...}`. `SketchFeature.ts` (~88-93) computes the local frame `u`(xDir) and `v = cross(normal, u)` and returns `SketchResult.plane: {origin, normal, xDir}`, surfaced to the app via `ExecuteResult.workFeatures`.
- **3D edges while sketching**: `tessellatedEdgesRef.current` (`App.tsx` ~198) holds `TessellatedEdge[] {edgeName, segments:[Vec3,Vec3][], faceNames}` in **world space** from the last execute. During sketch mode 3D execution is frozen (`App.tsx` ~1075), so the ref holds the last pre-sketch edges — stale-but-correct for a non-associative projection. `EdgePickController` (`model/EdgePickController.ts`) already does ray-based edge selection.

---

## Deliverable 0 — `sketcher/geometry/intersect.ts` (load-bearing)

New pure module. **No intersection math exists today** — this is written from scratch and is the false-green hotspot (see Testing).

```ts
// Each result carries the point and the parameter along EACH input primitive,
// so callers (trim/extend/offset) can order/bracket intersections.
type Hit = { x: number; y: number; tA: number; tB: number };
function intersect(a: SketchPrimitive, b: SketchPrimitive): Hit[];
```

Coverage (this slice): **line-line, line-circle, line-arc** (and the symmetric circle-line, arc-line). Implementation:
- **line-line**: parametric solve; `tA, tB ∈ [0,1]` for segment-bounded hits; report unbounded `t` for Extend's ray query (caller decides clamping).
- **line-circle / line-arc**: substitute the parametric line into the circle equation → quadratic; each root is a candidate; for **arc**, keep only roots whose angle ∈ `[startAngle, endAngle]` (respect the same CCW convention as `ArcTool`/`computeFillet` — `startAngle < endAngle` after normalization).
- `tA` for a line = fractional position along the segment; `tB` for a circle/arc = the angle of the hit.

**Deferred:** arc-arc, circle-circle (slice 3).

---

## Deliverable 1 — Trim (`sketcher/tools/TrimTool.ts`)

Picking tool. On click:
1. `pickPrimitiveAt` → the target primitive `P` and the pick point.
2. Intersect `P` with every other primitive → ordered list of split parameters along `P` (by `tA` for lines, by angle for arc/circle), plus `P`'s own endpoints (0 and 1, or start/end angle) as terminal bounds.
3. Find the interval `[u0, u1]` bracketing the pick point.
4. Remove that interval:
   - **Interior interval** (both bounds are intersections, not P's own ends): `P` splits into two — `DeletePrimitiveCommand(P)` + two new primitives (the outer remnants). Use a single composite command so undo is atomic.
   - **End interval** (one bound is P's own endpoint): shorten — `UpdatePrimitiveCommand(P, {trimmed endpoint})`.
   - **Whole primitive** (no intersections at all): delete `P` entirely.
5. **Orphaned constraints**: dropped (Inventor-2012 trim behavior). `DeletePrimitiveCommand`'s kernel cascade handles removal; new remnant primitives carry no constraints.

Works for `line`, `circle`, `arc`. Rectangle trim is out of scope (rectangle is a single primitive; Non-Goal).

## Deliverable 2 — Extend (`sketcher/tools/ExtendTool.ts`)

Picking tool. On click:
1. `pickPrimitiveAt` → target `P` (line or arc); choose the **near endpoint** (whichever of P's two ends is closer to the pick point).
2. Cast from that endpoint along `P`'s direction (line: tangent ray; arc: continue the circle CCW/CW) and intersect with all other primitives using `intersect.ts` (unbounded-`tA` mode for the line ray).
3. The nearest forward intersection becomes the new endpoint → `UpdatePrimitiveCommand(P, {moved endpoint})` (line: `x2,y2` or `x1,y1`; arc: `endAngle`/`startAngle`). Solver re-syncs via `updatePrimitive`.
4. No forward intersection → no-op (silent).

## Deliverable 3 — Project Geometry (`sketcher/tools/ProjectGeometryTool.ts` + `geometry/projectToSketch.ts`)

Straight-edge MVP, **non-associative**, **workplane-source sketches only**.
1. Active only in sketch mode. Add a `sketchMode &&`-gated pointer path that ray-picks a 3D edge from `tessellatedEdgesRef.current` (reuse `EdgePickController` ray math).
2. Resolve the sketch frame `{origin, normal, xDir}` from the sketch's `SketchResult.plane` (already in `workFeatures`). Compute `yDir = cross(normal, xDir)`.
3. `projectToSketch(p3, frame)` = `{ u: dot(p3−origin, xDir), v: dot(p3−origin, yDir) }`. Project both edge endpoints → emit an **ordinary** sketch `line` (not construction; immediately usable in profiles/constraints).
4. **Guard:** if the sketch plane is **face-sourced** (no `xDir` surfaced — see Risks), show a clear toast ("Project Geometry currently supports workplane-based sketches") and no-op. Only straight edges (segment count == 1, or a near-collinear polyline collapsed to its endpoints) are projected; pick on a curved edge → toast "Curved-edge projection is not yet supported."

## Deliverable 4 — Fillet coincident fix (`sketcher/tools/FilletTool.ts`)

Today `FilletTool` emits the arc + two trim patches + `tangent`×2 + `dim-radius`, but **no `coincident`** pinning the arc's endpoints to the trimmed line endpoints — so a radius edit re-centers the arc while the line ends float free. Fix: after emitting the arc, emit two `coincident` constraints (arc.start ↔ trimmedL1 endpoint, arc.end ↔ trimmedL2 endpoint), using the `coincident` constraint kind (`shared/constraints.ts`). Verify the solver accepts arc-endpoint anchoring (`start`/`end`); if anchoring is point-id-based, reference the correct endpoints. ~15 lines.

## Deliverable 5 — Multi-segment / loop offset (`sketcher/geometry/offset.ts` + `OffsetTool`)

Extend offset from single-primitive to a connected **chain or loop**.
1. **Chain discovery**: from the picked primitive, walk neighbors that share an endpoint (within tolerance) → ordered chain (open) or loop (closed).
2. Offset each segment with the existing `offsetPrimitive(p, d)` (consistent side via the cursor-side sign already in `OffsetTool`).
3. **Corner fix-up**: adjacent offset segments no longer meet — extend/trim them to their mutual intersection (`intersect.ts`) = miter join. For a loop, also fix the closing corner. Concave/degenerate corners where no intersection exists → leave a gap (documented limitation; no self-intersection cleanup in this slice).
4. Emit all offset primitives as one composite command (atomic undo).

Single-primitive offset (slice 1 behavior) is preserved when the pick has no connected neighbors.

---

## Wiring checklist

- `ToolKind` union += `'trim' | 'extend' | 'project-geom'` in **both** `ActiveToolController.ts` and `store/useAppStore.ts`.
- `instantiate()`: three new cases constructing the tools with their callback bags (`emitPrimitive`/`updatePrimitive`/`emitConstraint`/`deletePrimitive` as needed; add a `deletePrimitive` dep if not present, wired to `DeletePrimitiveCommand`).
- `handlePointer`: three new instanceof branches (`setPrimitives` + `onPointerClick`); Project Geometry additionally reads `tessellatedEdgesRef`.
- `SketchTab.tsx` "Modify" panel: Trim, Extend, Project Geometry buttons (`aria-pressed` + `disabled={!sketchMode}`).

## Persistence / manifest

No change. Trim/extend/offset mutate or add ordinary primitives; projected geometry is an ordinary `line`; fillet-coincident adds an existing constraint kind. **Manifest stays v20; no migration.**

## Testing strategy (false-green guard is mandatory)

The slice-1 fillet bug came from a kernel test that **hand-authored the value under test**. Same trap applies to `intersect.ts`. Rules:
- **`intersect.ts` unit tests**: assert against analytically-known crossings (e.g. line `y=0` vs circle `r=5` at `x=0` → hits at ±5), including arc-angle filtering (a hit outside `[start,end]` is rejected).
- **Tool tests** (Trim/Extend/Offset): drive the **real** `intersect.ts` output through the tool — never feed hand-authored intersection coords. Assert the resulting primitive set / endpoint coordinates.
- **Project Geometry**: unit-test `projectToSketch` against a known frame (e.g. an edge on the XY plane projects to itself; an edge on a translated/rotated workplane projects to the expected `u,v`). Drive a real `TessellatedEdge` through the tool.
- **e2e (closes slice-1's gap)**: drive a **non-trivial** case through the live canvas pick→emit→solve→render path — e.g. draw two crossing lines, invoke Trim, click the segment to remove, assert the surviving geometry; project a real model edge and assert the new sketch line's coordinates. Slice-1's e2e bypassed the canvas via `kernelAddSketch`; this slice clicks for real.
- **§6 browser verification** (the gate): Playwright drives each of the five behaviors in the running app; screenshot read back before "done".

## Non-goals / deferred to slice 3

- Arc/circle **projection** (needs a kernel analytic-curve query); **associative** projection (re-project on source edit); **face-sourced** sketch-plane projection (xDir not surfaced).
- **arc-arc / circle-circle** trim intersections.
- **Full-circle-target Trim** (circle→arc conversion): a circle has no endpoints so trimming it requires splitting into an arc first; out of scope this slice. **Trim supports `line` and `arc` targets only this slice.** Circle targets are detected and silently no-op'd with a code comment.
- Rectangle trim/extend; spline trim/extend/offset.
- Offset self-intersection cleanup; concave-corner gap closing.
- Trim re-attaching (rather than dropping) orphaned constraints.

## Risks

1. **`intersect.ts` correctness** — the load-bearing math; mitigated by analytic unit tests + driving real output through tools (no hand-authored values).
2. **Face-sourced sketch xDir gap** — `resolveWorkPlaneRef` returns only `{origin, normal}` for face planes; xDir is computed in `executeSketchFeature` but may not be surfaced. MVP sidesteps via the workplane-only guard + toast.
3. **Trim split → constraint orphaning** — accepted (Inventor-2012 behavior); kernel cascade must not error on orphan removal — verify in integration.
4. **Arc CCW convention** — `intersect.ts` arc filtering must match the `startAngle<endAngle` invariant enforced after the slice-1 fillet fix; reuse the same normalization.
5. **Multi-segment offset corner cases** — concave/degenerate corners leave gaps (documented); no self-intersection handling this slice.
