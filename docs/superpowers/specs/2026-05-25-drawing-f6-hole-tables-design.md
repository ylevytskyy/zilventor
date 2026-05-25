# Drawing F6 — Hole Tables — Design

**Date:** 2026-05-25
**Status:** Approved (pending spec review)
**Feature:** A drawing annotation that tabulates the holes visible in a view (size-grouped tag, X/Y relative to a user-picked datum, and an Inventor-style Description string) into an on-sheet table, with a tag-in-circle + leader marker on each hole.

This is the 9th post-roadmap drawing follow-up, following F2.4 (Edit Detail Region) at HEAD `b5d8762`.

---

## 1. Goals & scope

Produce an Inventor-2012-style hole table on a drawing sheet:

- **Table rows** — one per physical hole, grouped by spec for tagging.
- **Tags** — size-grouped: holes sharing a spec (profile + diameter + termination) get the same letter (A, B, C… by first appearance); instances are numbered (`A1`, `A2`, `B1`). Tags are **stable** across model edits.
- **Columns (MVP)** — `TAG`, `XDIM`, `YDIM`, `DESCRIPTION`.
- **Datum** — user picks a point in the view (a vertex / edge-midpoint / arc-center) as the `0,0` origin; X/Y are measured from it.
- **Markers** — each hole gets a balloon (tag text in a small circle) with a leader line to the hole center, owned by the table element.
- **Live cascade** — the table recomputes X/Y/Description from the current projection + part features on every render (matches dimension behavior). Only the tag map is persisted.

### Out of scope (MVP) — deferred to F6.x

- Iso and detail views (skewed / clipped coordinates).
- `toFace` / `toNext` true geometric depth in the Description (shows `THRU` for MVP).
- Per-cell text overrides; editing the table (move, re-pick datum, add/remove columns); regenerate button.
- Grouped/QTY table mode; explicit 6-column mode.
- DXF export of the table.
- Drag-to-reposition the table or balloons.

---

## 2. Locked decisions (from brainstorming)

| Axis | Decision |
|------|----------|
| Tagging / rows | Inventor-style, size-grouped: `A1, A2, B1…`, one row per hole |
| Datum origin | **User picks a datum point** in the view |
| Columns | `TAG, XDIM, YDIM, DESCRIPTION` (4 columns) |
| Hole markers | **Tag-in-circle + leader**, owned by the table element |
| Diameter source (Description) | **Nominal**, from `HoleFeature.profile.diameter` |
| Cascade | **Live** — recompute each render |
| Architecture | **Provenance-based** (`sourceFaceIds` → featureId → `HoleFeature`) |

---

## 3. Why provenance-based extraction is feasible (verified)

Projected geometry carries feature provenance end-to-end:

- `getProjectorInput.ts:58-66` builds each edge's `adjacentFaces` as `` `${featureId}|${role}|${instance}` `` (e.g. `"H1|hole|0"`).
- `edgeClassifier.ts:84` copies `adjacentFaces` verbatim into `Edge2D.sourceFaceIds`.
- `Edge2D.sourceFaceIds` is part of the **persisted** `ProjectedGeometry` type (`projectedGeometry.ts:7`) and is preserved through clipping (`clipEdgesToCircle.ts:118`) and breaks (`applyBreaks`).

So for any projected edge we can parse the leading `featureId` from each entry in `sourceFaceIds`, look it up in the source `PartDocument.featureTree`, and confirm `feature.kind === 'hole'`. The hole's circular boundary edge is shared between its cylindrical face and an adjacent planar face — at least one of the two `sourceFaceIds` entries carries the hole's `featureId`.

This gives **exact** diameter / depth / termination from the model (Approach B, pure geometric circle-detection, was rejected because depth/termination are unknowable from 2D, and a circle could be a fillet or round boss, not a hole).

---

## 4. Data model

New `DrawingAnnotation` union variant. It rides the **existing** `sheet.annotations[]` array, so there is **no manifest version bump and no migration** (an old file simply has no hole-table entries — identical to how F4 added optional fields).

```ts
// packages/shared/src/drawing/types.ts — add to the DrawingAnnotation union
export type HoleTableAnnotation = {
  kind: 'holeTable';
  id: string;
  viewId: string;                  // the view whose holes are tabulated
  datum: PointRef;                 // user-picked origin (reuses existing PointRef)
  positionMm: readonly [number, number]; // table top-left corner on the sheet
  entries: ReadonlyArray<{ holeFeatureId: string; tag: string }>; // STABLE tag map
};
```

**Only the tag map is persisted.** X/Y, measured center, and Description are recomputed at render time. `entries` exists purely to keep tags stable across model edits:

- A hole present in the projection but missing from `entries` → assigned the next tag (append) and rendered.
- An `entries` row whose `holeFeatureId` no longer resolves to a face-on hole in the view → pruned from the rendered table (kept in the persisted array only until the next command mutates it; render-time filter is the source of truth for what's drawn).

`PointRef` is the existing dimension-anchor type (edge-endpoint / edge-midpoint / arc-center). Reusing it means the datum pick reuses the existing point-snapping the canvas already does for dimensions.

---

## 5. Pure extraction pipeline (`@zilventor/shared`)

A new module `packages/shared/src/drawing/holeTable.ts` — **pure, no store import** (preserves the acyclic static-import rule established in F2.4). Both renderer paths call it.

### 5.1 `extractHolesInView(view, part) → ExtractedHole[]`

```ts
type ExtractedHole = {
  featureId: string;
  centerMm: readonly [number, number]; // circle-fit center in part-mm (pre-scale)
  feature: HoleFeature;                // resolved from part.featureTree
};
```

Steps:
1. Collect `view.projection.visibleEdges` (+ hidden? — **visible only** for MVP).
2. For each edge, parse `featureId` from each `sourceFaceIds` entry (split on `|`, take `[0]`).
3. Group edges by `featureId` where the feature resolves to `kind:'hole'`.
4. Per group, **fit a circle** to the pooled points. Accept the group as a face-on hole iff the fit is closed and radius variance is within tolerance (axis ⊥ view plane). Reject edge-on holes (axis in-plane → no clean circle). This dedupes through-holes / counterbores (multiple concentric circles, one `featureId` → one entry).
5. Emit `{ featureId, centerMm: fitted center, feature }`.

Circle fit: least-squares fit over the pooled points; tolerance constant (named, e.g. `HOLE_CIRCLE_FIT_TOL_MM`) — reject if RMS radius error exceeds it.

### 5.2 `assignHoleTags(holes, existing) → Map<featureId, tag>`

Pure, stable:
1. Start from `existing` (the persisted `entries` map).
2. Holes already in `existing` keep their tag.
3. New holes: compute a **spec signature** (`profile.kind` + resolved diameter + cbore/csk params + `termination.kind` + depth). Holes sharing a signature share a letter; letters are assigned by first-appearance order among already-used letters + new ones; the instance number is `(count of that letter so far) + 1`.
4. Return the merged map.

Spec signature uses **resolved numeric** values (via the param resolver) so two holes with `diameter: {param:'d1'}` and `diameter: {literal: 8}` that both equal 8 group together.

### 5.3 `formatHoleDescription(feature, resolveParam) → string`

Inventor symbol conventions:

| Profile / termination | Output |
|---|---|
| simple + throughAll | `⌀8 THRU` |
| simple + distance(d) | `⌀8 ↧12` |
| simple + toFace / toNext | `⌀8 THRU` (MVP) |
| counterbore | `⌀8 <term> ⌴⌀14 ↧6` |
| countersink | `⌀8 <term> ⌵⌀14×82°` |

Diameter is **nominal** (`resolveParam(profile.diameter)`), formatted to the sheet's precision. `⌀` = U+2300, `↧` = U+21A7, `⌴` = U+2334, `⌵` = U+2335.

### 5.4 `computeHoleTableRows(annotation, view, part, sheet) → HoleTableRow[]`

The single function **both render paths call**. Orchestrates 5.1–5.3 + datum:
```ts
type HoleTableRow = {
  tag: string;
  xDim: number;  // (centerMm - datumMm).x in part-mm — TRUE model dims, NOT scaled by viewport
  yDim: number;
  description: string;
  markerCenterSheetMm: readonly [number, number]; // for the balloon leader target
};
```
- Resolve `datum` (`PointRef`) → a part-mm point via the same resolver dimensions use.
- `xDim = centerMm.x − datumMm.x`, `yDim = centerMm.y − datumMm.y` (true model dimensions, sign per axis).
- Merge `assignHoleTags` output for stable tags.
- Marker center in sheet space = view origin + `centerMm × scale` (same transform the projection render uses).
- Sort rows by tag (letter, then instance).

---

## 6. Rendering — BOTH paths (load-bearing)

Per the two-renderer-paths rule (F5/F1.2 inherited): a new annotation kind MUST land in **both** the React live canvas and the string-SVG export, in the same batch, with a grep-parity check.

### 6.1 Live canvas — `HoleTableElement.tsx`

New component under the drawing canvas annotation layer. Renders:
- **Table grid** at `positionMm`: header row (`TAG XDIM YDIM DESCRIPTION`) + one `<text>`/`<line>` grid per row. Fixed column widths; rows from `computeHoleTableRows`.
- **Per-hole balloons**: a small `<circle>` holding the tag text at an offset from each hole, with a `<line>` leader to `markerCenterSheetMm`.

Plugged into the existing `annotations[]` enumeration in `DrawingCanvas` — add a `case 'holeTable'` to the annotation switch.

### 6.2 Export — `renderHoleTable()` in `renderDrawingSvg.ts`

New function mirroring `renderAnnotationGroup`'s style (string SVG). Add a `case 'holeTable'` to the annotation dispatch in `renderDrawingSvg.ts`. Calls the **same** `computeHoleTableRows`.

**Cascade note (F4 structural dependency):** live recompute relies on `DrawingCanvas` re-rendering propagating to `HoleTableElement` via a non-reactive `getState()` snapshot read (no `useStore` subscription on the part). This works only because `DrawingCanvas` is not `React.memo`'d. Document this dependency on `HoleTableElement` exactly as `DimensionElement` documents it. Any future `React.memo` on `DrawingCanvas` silently breaks the cascade.

---

## 7. Interaction — command + ToolMode + ribbon

### 7.1 `AddHoleTableCommand`

`packages/app/src/.../commands/AddHoleTableCommand.ts`, implementing the existing `Command` interface.
- `apply()`: push a `HoleTableAnnotation` (with freshly assigned `entries` via `assignHoleTags` against the current extraction) onto `sheet.annotations`.
- `revert()`: remove it by id.
- Carries explicit constructed annotation (no hidden state), consistent with other drawing commands.

### 7.2 ToolMode `'holeTable'`

Add `'holeTable'` to the `ToolMode` union (`drawing/toolMode.ts`) and a small state machine:
1. **awaiting-datum** — user clicks a snappable point inside a view → capture `viewId` + `PointRef` datum.
2. **awaiting-placement** — user clicks a sheet location → `bus.execute(AddHoleTableCommand)` with `viewId`, `datum`, `positionMm`. Return to `idle`.
- ESC at any stage cancels back to `idle` with no command.

### 7.3 Ribbon

Add a **Hole Table** button to the Annotate group in `DrawingTab.tsx` → `setMode('holeTable')`. **Disabled** when the active view has no `projection` (same guard pattern as other annotation tools), since extraction needs projected geometry.

---

## 8. Testing

TDD per slice (red → green → refactor). Pure helpers in `@zilventor/shared` are unit-tested directly.

- **Unit (shared):** circle-fit on a known box-with-2-holes fixture; `assignHoleTags` stability (add a hole → existing tags unchanged, new hole appended; remove a hole → others unchanged); spec-signature grouping (same dia/different param ref → same letter); `formatHoleDescription` for all profile × termination combos; dedupe of through-hole's two concentric circles into one row.
- **Unit (app):** `AddHoleTableCommand` apply/revert; ToolMode state machine transitions + ESC cancel; disabled-guard when no projection.
- **E2E (`T-6-15`):** create a part with 2+ holes of 2 distinct sizes → place a base view → place a hole table with a picked datum → assert table rows, tags (`A1, A2, B1`), X/Y relative to datum, and balloon count. Exercise undo via the real command bus.
- **Perf (`T63f`):** `computeHoleTableRows` p95 on a fixture with N holes (target well under the 50ms class budget the other pure helpers hit; expect microseconds).
- **Mid-flight Playwright + screenshot:** drive the actual app to place a hole table; capture + Read back the rendered table + balloons + leaders (byte-size check across screenshots). UI is not "done" until seen rendering.

---

## 9. Implementation batches (≈4)

1. **Shared core (TDD):** `HoleTableAnnotation` type added to the union; `holeTable.ts` with `extractHolesInView`, circle-fit, `assignHoleTags`, `formatHoleDescription`, `computeHoleTableRows`. Unit tests for each. No store import.
2. **Command + ToolMode + ribbon:** `AddHoleTableCommand`, `'holeTable'` ToolMode + state machine, ribbon button + disabled guard, canvas datum/placement click wiring. App unit tests.
3. **Both renderer paths:** `HoleTableElement.tsx` + `DrawingCanvas` case; `renderHoleTable()` + `renderDrawingSvg.ts` case. Grep-parity check. Mid-flight Playwright screenshot here.
4. **E2E + perf:** `T-6-15` e2e, `T63f` perf, final-pass review before merge.

---

## 10. Risks & gotchas

1. **Two renderer paths** — new `holeTable` case MUST land in both `DrawingCanvas` (React) and `renderDrawingSvg.ts` (export) in the same batch. Grep `case 'holeTable'` parity before "done".
2. **F4 cascade structural dependency** — live recompute breaks if `DrawingCanvas` ever gains `React.memo`. Document on `HoleTableElement`.
3. **Acyclic import** — `holeTable.ts` imports only `@zilventor/shared` types, never the app store (F2.4 rule).
4. **Circle-fit robustness** — edge-on holes (axis in view plane) must be rejected (no clean circle); through-holes/counterbores must dedupe by `featureId`. Named tolerance constant; tested.
5. **Tag stability** — adding a hole must not renumber existing rows. Guaranteed by persisting `entries` and only appending. Tested.
6. **Datum resolution** — reuse the exact `PointRef`→point resolver dimensions use; do not reimplement.
7. **Param resolution** — diameter/depth are `ParamOrLiteral`; resolve via the existing resolver, not by reading `.value` directly.
