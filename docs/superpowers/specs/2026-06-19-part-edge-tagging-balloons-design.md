# Part→Edge Tagging + Anchored Balloon Callouts — Design

**Date:** 2026-06-19
**Branch:** `feat/wall-tall-cabinets`
**Milestone:** 3.1 (Shop-drawing documentation — balloon callouts), elevated to include the part→edge tagging foundation.
**Status:** Design — pending implementation plan.

---

## 1. Goal

Make drawing **balloon callouts** anchor to the **real part** they point at, in both manual and
automatic placement. This requires a foundational capability the drawing subsystem lacks today:
**projected edges carry no part identity**. We add that identity (a "part→edge tag") and then build
the two balloon consumers on top of it.

Concretely, after this work:

- Activating the balloon tool and clicking an edge in an assembly view creates a balloon whose
  item number is resolved from the **part under the click** — no manual number entry.
- An "Auto-balloon" button creates **one balloon per parts-list row**, each anchored to the
  bounding-box center of its part's geometry in a view.

Non-goals (deferred): balloon drag/move; leader snap-to-edge hit-testing; hover/selection highlight
of a part from its edges (the tagging enables it later, but no UI this slice); section/detail-view
balloon anchoring beyond base/projected views.

---

## 2. Key findings (from code trace)

These are established facts, not assumptions:

1. **Component identity already flows through the projector**, encoded in the edge id as a prefix
   `${compIdx}::${partId}::…` (`packages/kernel/src/adapter/drawing/getProjectorInput.ts` assembly
   branch). HLR is a **software z-buffer** (`packages/shared/src/drawing/{depthBuffer,edgeClassifier}.ts`),
   not OCCT HLRBRep — it preserves the id (only appends a `_<runIndex>` suffix on classification).
   So inter-part occlusion is already correct **and** identity survives. No OCCT/HLR rework needed.

2. **Balloon coordinates are sheet-space mm.** `AnnotationElement`'s `balloon` case
   (`packages/app/src/drawing/AnnotationElement.tsx:157`) renders `targetMm`/`textPosMm` raw, with
   **no** view transform (contrast `center-mark` at :128 which applies `view.positionMm + geom*scale`).
   A canvas click yields sheet-space `svgX/svgY`, so manual placement feeds the click point directly.

3. **Item numbers are keyed by part-signature, not component path.**
   `bomItemNumbers: Record<rowKey, number>` where `rowKey = bomRowKey(partPath, effectiveColor)`
   (`packages/shared/src/bomRow.ts`). Identical part+color instances are qty-grouped into one row /
   one item number. `aggregateBomRecursive`
   (`packages/app/src/assembly/walkers/aggregateBomRecursive.ts`) recurses `.ziasm` sub-assemblies,
   assigns each leaf group a `rowKey` + `itemNumber`, and already records each group's component paths
   as `pathKey(path)`.

4. `DrawingView.projection` (the `ProjectedGeometry`) **is persisted** in the saved drawing document
   (`packages/app/src/storage/DrawingPacker.ts`), and `Edge2D` already carries an **optional**
   `sourceFaceIds?` field — precedent for additive optional fields without a format-version bump.

---

## 3. Architecture & data flow

Thread the **stringified component path key** (`pathKey(componentPath)` — the same key space
`aggregateBomRecursive` uses) end-to-end, and expose it on `Edge2D`:

```
loadAssemblyForProjection
   leaf.componentPath  ──pathKey()──►  AssemblyComponentInput.componentPath (string)
        │  (state.activeDrawingSourceComponents)
        ▼
kernel.getProjectorInput({ kind:'assembly', components })
        │  sets componentPath on each EdgeMesh3D (alongside existing id prefix)
        ▼
projectView (shared/projector.ts)         ── preserves componentPath ─┐
classifyEdges (shared/edgeClassifier.ts)  ── preserves componentPath ─┘
        ▼
Edge2D { …, componentPath?: string }   ◄── persisted in DrawingView.projection
        ▼ consumers
   componentItemNumbers(asm, cache, partInfo): Map<ComponentPathKey, number>
        (reuses aggregateBomRecursive grouping → guaranteed-matching key space)
        ▼
   manual balloon click  +  autoBalloonSheet
```

### Resolution: why reuse `aggregateBomRecursive`

The naïve resolver would recompute `bomRowKey(partPath, color)` from a clicked component and index
`bomItemNumbers`. That risks **key-format drift** between projection paths and BOM keys (the original
"unknown #2"). Instead we derive the path→item map from `aggregateBomRecursive`'s **own** grouping
(it already collects `componentIds: pathKey(path)[]` per group with the group's `itemNumber`). Inverting
those groups yields `Map<ComponentPathKey, itemNumber>` in exactly the same key space as the parts-list
rows. Resolution is then a direct `map.get(edge.componentPath)` with no recomputation and no drift.

---

## 4. Surface changes

### Types (`packages/shared`)
- `Edge2D.componentPath?: string` (`drawing/projectedGeometry.ts`) — additive optional.
- `EdgeMesh3D.componentPath?: string` (the kernel→app edge mesh shape) — additive optional.
- `AssemblyComponentInput.componentPath: string` — the projector-input component shape gains the path
  key (required on the assembly-input variant; part inputs are unaffected).

### Kernel (`packages/kernel`)
- `getProjectorInput` assembly branch: set `componentPath: comp.componentPath` on each emitted edge.
  Existing `${compIdx}::${partId}::` id prefix is left untouched (no behavioral change to ids).

### Shared projector
- `projectView` (`projector.ts`) and `classifyEdges` (`edgeClassifier.ts`): carry `componentPath`
  from input edge → output `Edge2D` (same pattern already used for `adjacentFaces`/`sourceFaceIds`).

### App
- `loadAssemblyForProjection`: include `componentPath: pathKey(leaf.componentPath)` per component
  (the path is already in scope at the build site).
- `componentItemNumbers(asm, cache, partInfo): Map<ComponentPathKey, number>` — new walker (or an
  additional return from `aggregateBomRecursive`) inverting BOM groups to path→item.
- `DrawingCanvas` `addBalloon` handler (replaces the dead stub at ~:966): on click, find the clicked
  edge in the view projection → `edge.componentPath` → `componentItemNumbers.get(...)` → build balloon
  `{ viewId, targetMm: clickPt, textPosMm: clickPt + OFFSET, itemNumber }` → dispatch
  `AddDrawingAnnotationCommand`. No edge / no resolution → no-op with a `setStatus` hint.
- `autoBalloonSheet(sheet, asm, cache, panelSpecs, partInfo)`: for each parts-list row (item number),
  pick a representative component path with that item that has edges in a view; compute the
  **bbox center of that component's edges in the chosen view** (rule: the view where the component has
  the most edges); convert view-local part-mm → sheet mm via `view.positionMm + local*scale`;
  set `targetMm` = center, `textPosMm` = laddered column position. Returns the balloon list.
- `AutoBalloonCommand` — new batch command: apply appends all generated balloons in one step;
  revert removes them. (One undo entry for N balloons, vs. N separate `AddDrawingAnnotationCommand`s.)
- `DrawingTab`: "Auto-balloon" button in the Annotate panel (disabled unless the active drawing source
  is an assembly), wired to build `autoBalloonSheet(...)` and dispatch `AutoBalloonCommand`.

---

## 5. Anchoring & coordinate handling (detail)

- **Manual.** `targetMm` = clicked sheet point; `textPosMm` = `targetMm` + fixed offset (e.g.
  `{x:+12, y:-12}` mm). Item number from the clicked edge's `componentPath`.
- **Auto.** Per item: bbox of the representative component's edges in the chosen view, in view-local
  part-mm; center → sheet mm via `cx = view.positionMm.x + localCx * (scale.num/scale.den)` (same as
  `center-mark`); `textPosMm` laddered down a column offset to the right of that view's bbox so
  balloons don't overlap. (No balloon-move command exists yet, so initial placement must be readable.)

---

## 6. Persistence

`componentPath` is an **additive optional field** on `Edge2D` (persisted inside
`DrawingView.projection`), mirroring the existing optional `sourceFaceIds`. **No format-version bump.**
Drawings saved before this change have projections without `componentPath`; until a view is
regenerated, a manual balloon click on such a stale projection cannot resolve an item number and
no-ops with a status hint ("regenerate the view to balloon its parts"). This is a documented
limitation, not a migration.

---

## 7. Testing & slicing (TDD red→green per slice)

1. **Kernel tag:** assembly with 2 distinct components → projected edges carry distinct
   `componentPath`. (kernel unit; integration `getProjectorInput` test.)
2. **Shared preserve:** `projectView` + `classifyEdges` carry `componentPath` input→`Edge2D`.
3. **App carry:** `loadAssemblyForProjection` populates `componentPath = pathKey(leaf.componentPath)`.
4. **Resolver:** `componentItemNumbers` returns a path→item map whose values match
   `computePartsListRows` item numbers for the same fixture (incl. one nested `.ziasm`).
5. **Manual click:** `addBalloon` mode click dispatches `AddDrawingAnnotationCommand` with the
   resolved item number (mirrors the existing `addCenterMark` click test); no-edge click no-ops.
6. **Auto-balloon:** `autoBalloonSheet` → N balloons for N parts-list rows, each with the correct
   item number and a sheet-space `targetMm` inside the chosen view's bbox.
7. **Command:** `AutoBalloonCommand` apply appends all; revert removes all (one undo step).
8. **Button + §6 e2e:** real UI — assembly drawing, click "Auto-balloon" → balloon count ==
   parts-list row count; manual balloon-tool click anchors a balloon whose number matches the clicked
   part. (Use `__zilventor*` probes; viewport may be black.)

**Phase-0 verification (resolved by trace, re-confirm in code before slice 1):**
- (a) Balloon `targetMm` is sheet-space — **confirmed** (`AnnotationElement.tsx:157`).
- (b) Path→item key space — **resolved** by reusing `aggregateBomRecursive` grouping (no rowKey
  recomputation). Slice 4's nested-`.ziasm` fixture is the guard that this holds for sub-assemblies.

---

## 8. Risks / deferred

- **Auto-balloon overlap** for tightly-packed parts: the laddered column is a readable MVP; smarter
  leader routing / collision avoidance is deferred.
- **Bbox center in empty space** for L-shaped/concave parts (the leader may start in a gap):
  acceptable for MVP; "midpoint of longest edge" is a documented fallback if it looks wrong in §6.
- **Balloon move/drag** not in scope (no annotation-move command yet; M3.4 moves views only).
- **Hover/selection highlight** from `componentPath` is enabled by this work but not wired here.
- **Stale persisted projections** lack `componentPath` until regenerated (see §6).
