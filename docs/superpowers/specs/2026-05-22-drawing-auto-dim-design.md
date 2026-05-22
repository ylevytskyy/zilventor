# ZilInventor — Drawing F4: Auto-Dimensioning from Sketch Parameters

- **Date:** 2026-05-22
- **Status:** Approved — ready for `superpowers:writing-plans`.
- **Author:** levytskyy@gmail.com + Claude (spec-writer subagent)
- **Predecessor:** Drawing F3 — Broken Views (`c3f3762`), Drawing F1.1 — Half-Section View (`HEAD`)
- **Estimated batches:** 2–3
- **Spec scope:** Follow-up F4 of the Drawing deferred list. Automatically place linear dimensions on a selected drawing view, bound to the sketch parameters that drove the base extrude. Exploits infrastructure already in place: the `DrawingDimension` union, `AddDrawingDimensionCommand`, `DimensionElement`, `SketchParameter`, `DimensionConstraint`, and `Edge2D`. No kernel call. No manifest migration. Manifest format stays at v18.

---

## 1. Context and framing

Drawing F1–F3 delivered views (section, detail, broken) and manual dimensioning. F4 closes the gap between the sketch-parameter world and the drawing world: a single button click reads the part's base extrude sketch, matches its dimension constraints to the 2D projected edges visible in the selected view, and places a set of parametric dimensions that update their displayed values whenever the bound sketch parameter is edited.

The feature is smaller than it first appears because the entire plumbing chain already exists:
- `DrawingDimension` stores the edge references (`from`/`to` as `PointRef`, `offsetMm`) and renders via `DimensionElement.tsx`.
- `AddDrawingDimensionCommand` atomically appends one dim to a sheet; F4's `AutoDimCommand` reuses the same store-mutation pattern for a batch.
- `PartDocument.parameters: Record<string, SketchParameter>` holds the live parameter values.
- `DimensionConstraint` (kinds `'dim-length'` and `'dim-distance'`) carries `paramName: string`, the binding key.

F4 adds three new things: (1) `sourceParameterName?` and `textOverride?` on `DrawingDimension` for parametric binding; (2) `AutoDimCommand` that synthesises the batch; (3) a `findMatchingEdge2D` helper in `packages/shared/src/drawing/autoDim.ts` for geometric edge lookup. Everything else reuses existing infrastructure unchanged.

Scope: 2–3 implementer batches, ~1 200-line plan.

---

## 2. User-facing behavior

### 2.1 Full workflow narration

The user opens a drawing that contains a base view of a part. The part was modelled with a parametric base extrude — the sketch carries `DimensionConstraint` entries of kind `'dim-length'` or `'dim-distance'`, each with a `paramName` referencing a `SketchParameter` in `PartDocument.parameters`.

The user clicks the base view (or any view derived from it) to select it. The Drawing ribbon's **Dimension** panel activates an **Auto-Dim** button. Clicking the button dispatches `AutoDimCommand` targeting the selected view's sheet and the active drawing document.

The command runs synchronously in the browser main thread (no kernel call, no Comlink round-trip):

1. Resolves the part's base extrude sketch from `PartDocument.featureTree`.
2. Iterates the sketch's `DimensionConstraint` entries of kind `'dim-length'` and `'dim-distance'`.
3. For each constraint, projects the referenced sketch primitive's endpoints through the part-to-view transform to find a matching `Edge2D` in `view.projection.visibleEdges`.
4. Places a `DrawingDimension` of the appropriate linear kind (`linear-h`, `linear-v`, or `aligned`) with `sourceParameterName` set to the constraint's `paramName`.
5. Runs the greedy non-overlapping placement algorithm to compute `offsetMm` for each dim.
6. Atomically writes all synthesised dims to the store in one `AutoDimCommand.apply()`.

The view immediately renders the new dimensions with their current parameter values in the dimension text labels.

**Cascade (parameter edit):** When the user later edits a sketch parameter in the Sketcher or via the parameter table — for example changing `width` from 50 mm to 70 mm and triggering a re-extrude + re-project — the drawing view re-renders. `DimensionElement` reads `dim.sourceParameterName`, looks up the matching `SketchParameter` from the active `PartDocument`, and displays the current `value` (rounded to one decimal place). No re-running of `AutoDimCommand` is needed; cascade is render-time only.

**Text override:** If the user double-clicks a dimension text and types a custom label (e.g. `"WIDTH ±0.5"`) the command `EditDimTextCommand` (existing, deferred to F4 edit path) sets `dim.textOverride`. Once set, `DimensionElement` renders `textOverride` verbatim and ignores `sourceParameterName`. The user can clear the override to restore parametric display.

**Undo:** `Ctrl+Z` invokes `AutoDimCommand.revert()`, which removes all dims by their tracked IDs in a single store write. The view instantly reverts to zero auto-dims.

**Re-running:** Running Auto-Dim on a view that already has auto-dims from a previous run appends a new batch rather than replacing it. Users who want a clean re-run should undo the prior batch first (one `Ctrl+Z`). This behavior is simple, predictable, and avoids complex "which dims are mine" tracking.

**Empty result:** If no sketch constraints match any visible edge (e.g. all constraints reference a circle, or the base extrude is not found), `AutoDimCommand.apply()` succeeds with zero dims placed and the app shows a short toast: `"No parametric dimensions found on base sketch."`. No error is thrown; the command is a no-op undo step.

### 2.2 Visual description

After Auto-Dim runs on a front-face base view of a 100×60×40 box with three parameters (width, height, depth):

- A `linear-h` dimension spans the full width above the view bbox, labelled `"100"`.
- A `linear-v` dimension spans the height to the right of the view bbox, labelled `"60"`.
- An `aligned` or second `linear-h` dimension may capture depth depending on orientation.

Each dimension line is rendered identically to a manually placed dimension by the existing `LinearDimension` component in `DimensionElement.tsx`. There is no visual distinction between auto-placed and manual dims.

---

## 3. Data model

### 3.1 `DrawingDimension` extension

Two optional fields are added to all linear members of the `DrawingDimension` union in `packages/shared/src/drawing/types.ts`:

```ts
// packages/shared/src/drawing/types.ts (modified)

export type DrawingDimension =
  | { readonly id: string; readonly kind: 'linear-h';
      readonly viewId: string; readonly from: PointRef; readonly to: PointRef;
      readonly offsetMm: number;
      // --- NEW in F4 ---
      readonly sourceParameterName?: string;  // bound SketchParameter.name
      readonly textOverride?: string;          // user-set; freezes display when present
    }
  | { readonly id: string; readonly kind: 'linear-v';
      readonly viewId: string; readonly from: PointRef; readonly to: PointRef;
      readonly offsetMm: number;
      readonly sourceParameterName?: string;
      readonly textOverride?: string;
    }
  | { readonly id: string; readonly kind: 'aligned';
      readonly viewId: string; readonly from: PointRef; readonly to: PointRef;
      readonly offsetMm: number;
      readonly sourceParameterName?: string;
      readonly textOverride?: string;
    }
  | { readonly id: string; readonly kind: 'radial';
      readonly viewId: string; readonly edgeId: string;
      readonly offsetMm: number; readonly angleDeg: number }
  | { readonly id: string; readonly kind: 'diametric';
      readonly viewId: string; readonly edgeId: string;
      readonly offsetMm: number; readonly angleDeg: number };
```

`radial` and `diametric` do not receive these fields in v1 (F4.1/F4.2 deferred).

### 3.2 Semantics

**`sourceParameterName`** — the `name` field of a `SketchParameter` in `PartDocument.parameters`. At render time, `DimensionElement` resolves the parameter value from the active part document and uses it as the displayed text. If the named parameter is absent (orphan case — F4.5), `DimensionElement` falls back to the geometrically computed distance.

**`textOverride`** — freeform string set by `EditDimTextCommand` (existing command, not modified by F4). When present, it takes precedence over everything else and is rendered verbatim. Clear by setting to `undefined`.

**Priority chain (three modes):**

```
textOverride present → render textOverride (verbatim)
    else sourceParameterName present → resolve SketchParameter.value → render rounded value
        else → render geometrically computed distance (existing behavior, unchanged)
```

### 3.3 No manifest migration

Both fields are optional; existing `DrawingDimension` objects back-fill `undefined` automatically. Format remains v18. No `migrateManifest` change needed.

---

## 4. Sketch → Edge2D matching

### 4.1 Algorithm overview

The central challenge of F4 is mapping a 2D sketch primitive (which lives in sketch-local coordinates) to a projected `Edge2D` (which lives in view-local 2D coordinates after the full projection pipeline). The pipeline is:

```
sketch-local (mm) → extrude transform → 3D part space → view matrix → 2D view space
```

`findMatchingEdge2D` replicates this transform for each sketch primitive endpoint, then searches the view's `visibleEdges` for an edge whose endpoints are within tolerance.

### 4.2 File and signature

New file: `packages/shared/src/drawing/autoDim.ts`

```ts
import type { SketchPrimitive } from '../types';
import type { Edge2D } from './projectedGeometry';
import type { DrawingView } from './types';

/**
 * Project a sketch primitive's endpoints through the extrude and view transforms
 * and find the matching Edge2D in the view's visible edges.
 *
 * @param prim         - The sketch primitive (only 'line' handled in v1; others return null).
 * @param extrudeDepth - The extrude distance in mm (positive, forward direction only).
 * @param viewOrientation - The orientation string used to build the view matrix.
 * @param view         - The DrawingView whose projection.visibleEdges are searched.
 * @param toleranceMm  - Match tolerance in mm (default 1e-3).
 * @returns The matching Edge2D, or null if no match within tolerance.
 */
export function findMatchingEdge2D(
  prim: SketchPrimitive,
  extrudeDepth: number,
  viewOrientation: string,
  view: DrawingView,
  toleranceMm = 1e-3,
): Edge2D | null
```

### 4.3 Step-by-step algorithm (linear primitives only)

For a `SketchPrimitive` of kind `'line'` with endpoints `(x1,y1)` and `(x2,y2)` in sketch-local XY:

1. **Lift to 3D.** The base extrude lies in the XY plane (Z=0 at the sketch face). Endpoints become `(x1, y1, 0)` and `(x2, y2, 0)` in part space. (Forward direction only — `direction: 'forward'` — deferred for `'symmetric'`.)

2. **Apply view matrix.** Use `buildViewMatrix(viewOrientation, bbox)` from `packages/shared/src/drawing/viewMatrix.ts` with the **part's 3D bounding box** — prefer `activePart.cachedGeometry?.boundingBox` when present (an actual 3D AABB in part-local coordinates), and fall back to `view.projection.bbox` lifted to 3D (using minX/maxX for X, minY/maxY for Y, and `[0, extrudeDepth]` for Z) ONLY if the cached geometry bbox is absent. The cached path is correct for ALL view orientations (top, right, iso, etc.); the lifted fallback is only correct for `'front'` views. Apply `apply(Mview, pt3d)` to both lifted endpoints to get 2D view-space coordinates `(u1,v1)` and `(u2,v2)`.

3. **Search visible edges.** For each `Edge2D` in `view.projection.visibleEdges`, check if its first and last points are within `toleranceMm` of `(u1,v1)` / `(u2,v2)` (in either endpoint order — directionality is irrelevant). The check uses Euclidean distance on the 2D projected points.

4. **Return first match.** If multiple edges match (e.g. two collinear edges that share an endpoint), return the edge whose total length most closely matches the sketch primitive's length. Return `null` if no edge matches.

**Non-line primitives:** `'rectangle'`, `'circle'`, `'arc'`, `'spline'` return `null` in v1. Radial/diametric dims for circles and arcs are deferred to F4.1/F4.2.

### 4.4 Failure modes and handling

| Failure | Handling |
|---|---|
| Primitive kind not `'line'` | Return `null`; skip dim silently. |
| View has no projection | `findMatchingEdge2D` is never called; `AutoDimCommand` returns early with toast. |
| No edge within tolerance | Return `null`; skip dim and report count in dev-mode console. |
| Topology change post-regen | Edge ids shift; `findMatchingEdge2D` re-matches by geometry rather than id, so it remains robust as long as coordinates are within tolerance. |
| View bbox is degenerate (all zeros) | Return `null`; all primitives fail to match. |

---

## 5. AutoDimCommand

### 5.1 File and class

New file: `packages/app/src/commands/AutoDimCommand.ts`

```ts
import type { Command } from './Command';
import type { DrawingDocument, DrawingDimension, DrawingView } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';
import { findMatchingEdge2D, greedyPlaceDims } from '@zilventor/shared/src/drawing/autoDim';

export type AutoDimPayload = {
  drawingId: string;
  sheetId: string;
  viewId: string;
};

export class AutoDimCommand implements Command {
  readonly name = 'AutoDim';
  /** IDs of all dims placed by this command; used by revert(). */
  private placedIds: string[] = [];

  constructor(private readonly payload: AutoDimPayload) {}

  async apply(): Promise<void>
  async revert(): Promise<void>
}
```

### 5.2 `apply()` flow

```
1. Read state: activeDocument (must be 'drawing'), activePart (must be defined).
2. Locate sheet by payload.sheetId; locate view by payload.viewId.
3. Guard: view.projection must be defined — throw 'view-projection-missing' if absent.
4. Locate base extrude sketch:
     a. Iterate featureTree.
     b. Find first Feature of kind 'extrude' at index > 0 (or index 0) — call it extrudeFeature.
     c. Find Feature of kind 'sketch' with id === extrudeFeature.sketchRef — call it sketchFeature.
     d. If not found: succeed with empty dims + toast (no throw).
5. Extract DimensionConstraints: sketchFeature.constraints.filter(c =>
     c.kind === 'dim-length' || c.kind === 'dim-distance').
6. If empty: succeed with empty dims + toast.
7. For each DimensionConstraint:
     a. Resolve sketch primitives the constraint targets:
        - `dim-length` (constrains ONE primitive): `prims = [sketchFeature.primitives.find(p => p.id === c.line)]`. Skip if not found.
        - `dim-distance` (constrains TWO primitives via `c.a.primitiveId` and `c.b.primitiveId`): `prims = [findPrim(c.a.primitiveId), findPrim(c.b.primitiveId)]`. The dim is placed BETWEEN the two matched edges. Skip the entire constraint if EITHER primitive lookup fails (this canonicalizes the behavior described in §13 R3).
     b. For each prim in `prims`, call `findMatchingEdge2D(prim, extrudeDepth, viewOrientation, view)`. Skip the constraint if any lookup returns `null`.
        `extrudeDepth = activePart.parameters[extrudeFeature.distanceParam]?.value ?? 0`.
        `viewOrientation` is view-kind-specific (`BaseView.orientation`, etc.).
     c. Determine dim kind:
        - For `dim-length` (single edge): horizontal line → `'linear-h'`, vertical → `'linear-v'`, else `'aligned'`. Classify by endpoint deltas: `|dy| < 1e-3` → `'linear-h'`, `|dx| < 1e-3` → `'linear-v'`, else `'aligned'`.
        - For `dim-distance` (two parallel edges): use the displacement direction between the edge midpoints. Same horizontal/vertical/aligned classification.
     d. Compute `from`/`to` PointRef on the matched edge endpoints (for `dim-length`, both points come from the single edge; for `dim-distance`, one point per edge).
     e. Build `DrawingDimension` candidate with `sourceParameterName = c.paramName`, `offsetMm = 0` (placeholder, replaced by greedy layout in step 8).
     f. Collect all candidates.
8. Run greedyPlaceDims(candidates, view.projection.bbox) → assigns offsetMm to each non-skipped dim.
9. Assign crypto.randomUUID() to each dim.id.
10. Write to store atomically:
      nextDoc = { ...drawing, sheets: sheets.map(s => s.id === sheetId
        ? { ...s, dimensions: [...s.dimensions, ...placedDims] }
        : s) }
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: nextDoc }, activeDrawing: nextDoc })
11. this.placedIds = placedDims.map(d => d.id).
12. If placedDims.length === 0: emit toast "No parametric dimensions found on base sketch."
```

**Error handling:** The entire apply() is wrapped in a try-catch. On error, call `this.revert()` to clean up any partial state (mirrors `AddSectionViewCommand` pattern from F1). Re-throw the error so the UI bus can surface it.

### 5.3 `revert()` flow

```
1. If this.placedIds.length === 0: return (no-op).
2. Read state; locate sheet.
3. Filter out dimensions whose id is in this.placedIds.
4. Write updated doc to store.
5. this.placedIds = [].
```

### 5.4 Rejection criteria summary

| Condition | Behavior |
|---|---|
| No active drawing document | return (silent no-op) |
| No active part | return (silent no-op) |
| Sheet not found | throw `'sheet-not-found'` |
| View not found | throw `'view-not-found'` |
| View projection absent | throw `'view-projection-missing'` |
| Base extrude sketch not found | succeed + toast |
| Zero matching edges | succeed + toast |
| Geometric match fails for individual constraint | skip that dim, continue |

### 5.5 Base extrude resolution

**Definition:** Base extrude = the first `Feature` of kind `'extrude'` in `featureTree` (index position; no assumption on feature index being 0). The sketch referenced by `extrudeFeature.sketchRef` is the base sketch. If the first extrude's `operation` is `'cut'` rather than `'new'` or `'join'`, the command still uses it as the source (v1 simplification; F4.3 handles multi-sketch).

**Why feature index rather than fixed index 0:** `featureTree[0]` is always a `sketch`, not an `extrude`, in a standard part. The first `extrude` is at index 1. The command finds it by kind-search, not hardcoded index.

---

## 6. Greedy placement algorithm

### 6.1 Function signature

```ts
// packages/shared/src/drawing/autoDim.ts

/**
 * Assign offsetMm to each candidate dimension using a greedy non-overlapping strategy.
 * Returns a new array with offsetMm filled in; candidates without a match are excluded.
 * Deterministic: given identical input (same bbox, same candidates in the same order),
 * produces byte-identical output — required for .zidw git-diffability.
 *
 * @param candidates  - Dims with offsetMm === 0 (placeholder).
 * @param bbox        - View projection bbox (minX, minY, maxX, maxY).
 * @returns           - Placed dims with offsetMm assigned; overlapping dims are excluded.
 */
export function greedyPlaceDims(
  candidates: DrawingDimension[],
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): DrawingDimension[]
```

### 6.2 Algorithm

**Pre-sort:** Candidates are sorted by dim kind, then by their `from` edge's first-point X coordinate ascending. Deterministic sort ensures byte-identical output across runs.

**Stack-per-side:**
- `linear-h` dims: stacked above the view bbox. Starting offset = `bboxHeight * 0.15` (clamped min 3 mm). Subsequent dims increment by `bboxWidth * 0.15` (clamped min 8 mm, max 20 mm).
- `linear-v` dims: stacked to the right of the view bbox. Same scaling applied to height dimension.
- `aligned` dims: placed at 45° offset from their midpoint; offset starts at `3 mm` and increments by `8 mm`.

**Small-view scaling:** When `bboxWidth < 50 mm` (or `bboxHeight < 50 mm` for vertical dims), the increment is scaled to `bboxWidth * 0.15` (or `bboxHeight * 0.15`). This prevents ugly stacking at tight zoom levels or small detail views.

**Overlap detection:** After computing the candidate's placement rectangle (dim line extent plus ± `fontSize / 2` on each side), check against all previously placed dim bboxes. If overlap: skip the candidate (do not place). Count skipped dims and emit a `console.debug` message in dev mode.

**Determinism guarantee:** Same sketch + same view + same parameter values = same `offsetMm` values. This is ensured by the pre-sort + deterministic floating-point arithmetic (no randomness).

### 6.3 Re-run behavior

Re-running `AutoDimCommand` on a view that already has auto-dims appends a new batch. The placement algorithm sees the existing dims as placed and may compute different offsets for the new batch (since the overlap detector only tracks dims placed in the current run, not pre-existing dims). This is a known limitation documented as F4.8 (user-tunable spacing dialog). Users who want a clean re-run should undo first.

---

## 7. Cascade integration

### 7.1 Render-time text resolution (three modes)

The existing `LinearDimension` component in `packages/app/src/drawing/DimensionElement.tsx` currently computes `textVal` as `Math.round(measuredVal * 10) / 10` (line 76). F4 adds a pre-pass before that line:

```ts
// Inside LinearDimension, after measuredVal is computed:

// F4: parametric text resolution
let displayText: string;
if ('textOverride' in dim && typeof dim.textOverride === 'string') {
  // Mode 1: user override — render verbatim
  displayText = dim.textOverride;
} else if ('sourceParameterName' in dim && typeof dim.sourceParameterName === 'string') {
  // Mode 2: parametric — look up live parameter value
  const paramName = dim.sourceParameterName;
  const activePart = useAppStore.getState().activePart;
  const param = activePart?.parameters[paramName];
  displayText = param !== undefined
    ? String(Math.round(param.value * 10) / 10)
    : String(Math.round(measuredVal * 10) / 10); // orphan fallback (F4.5)
} else {
  // Mode 3: geometric (existing behavior)
  displayText = String(Math.round(measuredVal * 10) / 10);
}
```

`useAppStore.getState()` is synchronous and always returns current state; this does not add a React subscription (no re-render cycle beyond the normal drawing re-render on store change).

### 7.2 Fingerprint — no change needed

The drawing view fingerprint (`computeViewFingerprint` in `packages/shared/src/drawing/fingerprint.ts`) encodes source geometry, not dimensions. Auto-placed dims are stored in `sheet.dimensions`, not in the view itself — so the stale-banner logic is unaffected. When the source part is reparametrized and the projection is regenerated (stale banner → Regenerate), `findMatchingEdge2D` is not re-run; the cascade simply re-reads the new `param.value` at render time.

### 7.3 Orphan handling (runtime)

If `sourceParameterName` references a parameter that has been deleted from `PartDocument.parameters`, `DimensionElement` falls back to the geometrically computed distance (Mode 3). No visual error is shown. The F4.5 orphan UI (highlighting orphaned dims, offering delete) is deferred.

---

## 8. UI affordance

There is no pre-existing per-view selection state in `useToolModeStore` (verified by grep — no `selectedView*` fields anywhere in `packages/app/src/drawing/`, `packages/app/src/shell/`, or `packages/app/src/store/`). The existing manual dimension buttons (`addLinearH`, `addLinearV`, `addAligned`, `addRadial`, `addDiametric`) all use a **tool-mode + click-on-view** pattern: clicking the ribbon button enters a mode; the user then clicks the target view to place the dim. F4 follows the same pattern.

### 8.1 New `'autoDim'` tool mode

Add `'autoDim'` to the `mode` union in `packages/app/src/drawing/toolMode.ts` (current union: `'idle' | 'placeBase' | ... | 'addDiametric' | 'addCenterline' | ... | 'section' | 'detail' | 'break'`). New tool mode behavior:

- **Entry:** `setMode('autoDim')` from the ribbon button.
- **Cursor / UI feedback:** During `mode === 'autoDim'`, `DrawingCanvas` highlights hovered views (faint outline glow on the `<ViewElement>`'s bbox) to signal "click a view to auto-dimension".
- **Click handler:** When the user clicks a view's content area, `DrawingCanvas` dispatches `AutoDimCommand` with the clicked view's id, then calls `setMode('idle')`.
- **Esc:** Returns to `'idle'` without dispatching.
- **No further stages** — single click commits. Mirrors `addLinearH`'s shape (one click = one outcome) but the outcome is a batch dim placement rather than entering a sub-tool.

### 8.2 Button placement

In `packages/app/src/shell/tabs/DrawingTab.tsx`, the Dimension panel currently has 5 buttons (lines 140–149): `Linear (H)`, `Linear (V)`, `Aligned`, `Radial`, `Diametric`. The `Auto-Dim` button is appended after `Diametric`, inside the same `<RibbonPanel title="Dimension">` block:

```tsx
{/* Auto-Dim: F4 */}
<button
  type="button"
  className="text-xs hover:text-white"
  aria-label="Auto-Dim"
  title="Place parametric dimensions from base sketch parameters — click a view after enabling"
  onClick={() => setMode('autoDim')}
>
  Auto-Dim
</button>
```

The button is NOT disabled based on view state — like the other dim-mode buttons, it always enters its tool mode. If the user clicks on empty space (no view), the click is ignored and the tool mode remains active until ESC or a view click. If the clicked view has no `projection` field, the command rejects with a UI toast: "View has no projection — regenerate the view first."

### 8.3 DrawingCanvas click handler extension

In `packages/app/src/drawing/DrawingCanvas.tsx`, the existing click dispatch (which routes `'addLinearH'`, `'section'`, `'detail'`, etc.) gains an `'autoDim'` branch:

```tsx
if (mode === 'autoDim') {
  const clickedView = findViewAtPoint(sheet, clickX, clickY);
  if (clickedView) {
    void bus.execute(new AutoDimCommand({
      drawingId: drawing.id,
      sheetId: activeSheet.id,
      viewId: clickedView.id,
    }));
    setMode('idle');
  }
  return;
}
```

`findViewAtPoint(sheet, x, y)` is an existing helper (or mirrors the existing view-hit-test used by `addLinearH` etc.). Confirm the helper name in the actual `DrawingCanvas.tsx` before implementing; rename the spec reference if it differs.

---

## 9. Tests

### 9.1 E2E — T-6-11

**File:** `tests/e2e/drawing/T-6-11-auto-dim.spec.ts`

**Fixture setup:**
- Build a part with three sketch parameters: `width=50`, `height=30`, `depth=20`.
- Extrude the base rectangle using these parameters.
- Create a drawing with a front base view (the view's `projection` is populated by store injection, same pattern as T-6-9 / T-6-3).

**Assertions (minimum 5):**

1. After clicking `Auto-Dim` (or dispatching `AutoDimCommand` via `page.evaluate`), `sheet.dimensions.length >= 1` (at least one dim placed).
2. At least one dim in `sheet.dimensions` has `kind === 'linear-h'` and `sourceParameterName === 'width'`.
3. The DOM contains `[data-dim-id]` elements matching the placed count.
4. After injecting an updated `PartDocument` with `width=70` into the store (simulating a parameter edit + regen), the `[data-dim-text]` element for the width dim reads `"70"`.
5. Dispatching `AutoDimCommand.revert()` (or simulating `Ctrl+Z`) reduces `sheet.dimensions.length` back to 0.

**Pattern:** Store-injection pattern from T-6-3/T-6-9. No real canvas clicks needed; `AutoDimCommand` is dispatched via `page.evaluate` dynamic import of `/src/commands/AutoDimCommand.ts`.

### 9.2 Perf — auto-dim.perf.spec.ts

**File:** `tests/perf/auto-dim.perf.spec.ts`

**Strategy:** Expose `window.__zilventorAutoDimMs(n)` in `packages/app/src/App.tsx` (same block as `__zilventorBrokenViewMs`). The probe runs `AutoDimCommand.apply()` against a synthetic 20-constraint sketch + 200-edge view projection, 100 iterations.

**Budget:** p95 < 200 ms. Justification: no kernel call; entire path is synchronous JS (constraint array iteration + 200-edge linear scan + greedy sort). Expected p95 ~5–15 ms giving 13×+ headroom. Budget is set conservatively for CI variance.

```ts
// tests/perf/auto-dim.perf.spec.ts
test('Perf drawing-auto-dim: AutoDimCommand p95 < 200ms', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(
    () => typeof (window as { __zilventorAutoDimMs?: unknown }).__zilventorAutoDimMs === 'function',
    undefined,
    { timeout: 30_000 },
  );
  const { p95ms } = await page.evaluate(
    () => (window as { __zilventorAutoDimMs?: (n: number) => Promise<{ p95ms: number }> })
      .__zilventorAutoDimMs!(100),
  );
  console.log(`[perf] auto-dim p95 = ${p95ms.toFixed(2)} ms (budget 200ms)`);
  expect(p95ms).toBeLessThan(200);
});
```

### 9.3 Unit tests (~25 cases)

**File:** `packages/shared/src/drawing/__tests__/autoDim.spec.ts`

**Category A — `findMatchingEdge2D` (8 tests):**

| # | Scenario | Expected |
|---|---|---|
| A1 | Horizontal line primitive; matching horizontal edge in visibleEdges | Returns the matching Edge2D |
| A2 | Vertical line primitive; matching vertical edge | Returns the matching Edge2D |
| A3 | Line primitive; no edge within 1e-3 tolerance | Returns null |
| A4 | Line primitive; two close edges — returns the one with closer endpoint distance | Returns closer Edge2D |
| A5 | Non-line primitive (circle); returns null | Returns null |
| A6 | View with no projection (projection absent) | Returns null (guard path) |
| A7 | Endpoint order reversed (p1/p0 vs p0/p1) — both orderings match | Returns the Edge2D |
| A8 | Tolerance boundary — edge at exactly 1e-3 distance matches; at 1e-3 + epsilon does not | Correct boundary behavior |

**Category B — `greedyPlaceDims` (7 tests):**

| # | Scenario | Expected |
|---|---|---|
| B1 | Single `linear-h` candidate; bbox 100×60 | offsetMm = 9 (100 × 0.15, clamped to min 3; increment round-trip) |
| B2 | Two `linear-h` candidates, non-overlapping by construction | Both placed; different offsetMm values |
| B3 | Two `linear-h` candidates whose bboxes overlap after placement | Second is skipped (placedDims.length === 1) |
| B4 | Small view (bbox width < 50 mm) | Increment scales to bboxWidth × 0.15 |
| B5 | Mix of `linear-h` and `linear-v` in same call | Each kind sorted independently; both placed |
| B6 | Zero candidates | Returns empty array |
| B7 | Same input twice (determinism) | Identical offsetMm values both runs |

**Category C — `AutoDimCommand` apply/revert (6 tests):**

| # | Scenario | Expected |
|---|---|---|
| C1 | 3-constraint sketch; all 3 edges match | `placedIds.length === 3`; store dims += 3 |
| C2 | 3-constraint sketch; 1 edge non-matching | `placedIds.length === 2`; store dims += 2 |
| C3 | No base extrude found | Succeeds; 0 dims placed; toast emitted |
| C4 | Empty constraint list | Succeeds; 0 dims placed; toast emitted |
| C5 | revert() after apply() | store dims returns to prior count |
| C6 | revert() called without prior apply() | No-op; no throw |

**Category D — `DimensionElement` text resolution (4 tests):**

| # | Scenario | Expected |
|---|---|---|
| D1 | `textOverride = "WIDTH ±0.5"` set | Renders `"WIDTH ±0.5"` verbatim |
| D2 | `sourceParameterName = 'width'`; active part has `width.value = 50` | Renders `"50"` |
| D3 | `sourceParameterName = 'width'`; active part has `width.value = 70` (post-edit) | Renders `"70"` |
| D4 | `sourceParameterName = 'deleted_param'`; parameter absent from active part | Falls back to geometric distance |

---

## 10. Perf budget

**Budget: 200 ms p95 (in-process, no kernel call).**

Justification:
- `AutoDimCommand.apply()` iterates at most O(C) constraints (C ≤ 20 for a typical sketch) × O(E) visible edges (E ≤ 200 for a complex base view) = O(4 000) distance computations, each a simple 2D Euclidean check.
- `greedyPlaceDims` sorts O(C) candidates and checks O(C²) overlap pairs = at most 400 operations for C = 20.
- No async work, no kernel call, no Comlink message.

Expected real-world p95 on CI hardware: ~5–15 ms (estimated from similar pure-JS perf probes: `applyBreaks` p95 = 0.90 ms for 1 000 edges; auto-dim is roughly 4× the work). 200 ms budget provides ~13–40× headroom against CI variance.

Contrast with section view (F1) at 400 ms — that budget covers an OCCT BOPAlgo cut. Auto-dim has zero kernel involvement, hence the lower absolute budget despite a generous headroom multiplier.

---

## 11. Scope and non-goals

### 11.1 In scope (v1)

- Linear dim kinds only: `linear-h`, `linear-v`, `aligned`.
- Sourced from `'dim-length'` and `'dim-distance'` constraint kinds.
- Base extrude sketch only (first extrude feature in `featureTree`).
- `forward` extrude direction only.
- Part documents only (not assembly drawings).
- `findMatchingEdge2D` for `SketchPrimitive` kind `'line'` only.
- Single batch `AutoDimCommand` (one-shot; no incremental/live updates).
- Greedy non-overlapping placement with fixed increment and small-view scaling.
- `sourceParameterName` + `textOverride` data model fields.
- Render-time parametric text resolution in `DimensionElement`.
- Auto-Dim button in Dimension ribbon panel.

### 11.2 Explicitly deferred

| Item | Why deferred |
|---|---|
| Re-run replaces existing auto-dims | Requires tracking which dims are "auto" vs "manual"; defer to F4.8 |
| Radial/diametric for circles/arcs | Requires `arc-center` PointRef matching; defer F4.1 |
| Angular dims | Requires angle constraint kind and SVG arc rendering; defer F4.2 |
| Multi-sketch (second extrude, boss-cut) | Requires iterating all `sketchRef`-linked extrudes; defer F4.3 |
| Baseline / ordinate dim chains | Different layout algorithm; defer F4.4 |
| Orphan UI (highlight deleted-param dims) | Requires tracking orphan state; defer F4.5 |
| Tag-through-pipeline edge IDs | Requires OCCT FaceNaming propagation; defer F4.6 |
| Assembly source drawings | Requires resolving component params; defer F4.7 |
| User-tunable spacing dialog | Requires additional UI panel; defer F4.8 |
| `symmetric` extrude direction | Lift to Z=0 and Z=±depth/2; defer |
| Assembly drawings | Assembly has no single base extrude sketch |

---

## 12. Deferred follow-ups (F4.1 – F4.8)

- **F4.1 Radial/diametric auto-dim.** Place `radial` or `diametric` dims for `'dim-radius'` and `'dim-diameter'` constraints. Requires `arc-center` PointRef resolution and matching arc edges. Dependency: F4.1.
- **F4.2 Angular auto-dim.** Place `angular` dims for `'dim-angle'` constraints. Requires a new `angular` dim kind in the `DrawingDimension` union and SVG arc rendering. Dependency: `DrawingDimension` extension.
- **F4.3 Multi-sketch source.** Iterate all extrudes in `featureTree`, not just the first, collecting constraints from each base sketch. Dependency: F4.1 (once linear is stable).
- **F4.4 Baseline / ordinate chains.** Group dims of the same kind into a baseline chain from a common datum edge, reducing clutter on parts with many constraints. Dependency: F4.3.
- **F4.5 Orphan UI.** After a parameter is deleted from `PartDocument`, highlight the now-orphaned dims in the drawing with a warning icon and offer a bulk-delete. Dependency: None; cross-cutting concern.
- **F4.6 Tag-through-pipeline edge mapping.** Tag sketch primitives with stable IDs propagated through the OCCT projection pipeline (FaceNaming + EdgeNaming), replacing geometric tolerance matching with id-based lookup. Eliminates the risk of false matches on parts with symmetric geometry. Dependency: kernel-side tagging (major effort; deferred to a future roadmap item).
- **F4.7 Assembly source.** For assembly drawings, resolve auto-dims from each component's base extrude sketch, using the component's assembled pose. Dependency: F4.3; assembly part-loading pipeline.
- **F4.8 User-tunable spacing dialog.** Allow users to configure the increment (default 8 mm), initial offset (default 3 mm), and the behavior on re-run (replace vs append). Surfaces as a modal dialog triggered from the Auto-Dim button's dropdown.

---

## 13. Risk register

### R1 — Geometric matching fragility (false matches on symmetric parts)

**Risk:** Parts with symmetric sketches (e.g. a square profile where multiple edges project to the same 2D extent) may produce false matches, causing the wrong `sourceParameterName` to be bound to a dim.

**Likelihood:** Medium on symmetric parts; low on typical asymmetric furniture panels.

**Mitigation:** In v1, accept the limitation. The dim's displayed value will still be correct because it reads the same parameter table. A wrong binding is not catastrophic — the user can delete the dim and place manually. The long-term fix is F4.6 (tag-through-pipeline), which eliminates geometric ambiguity.

**Detection:** `findMatchingEdge2D` emits a `console.debug` note when multiple edges are within tolerance; implementers will see this during manual smoke testing.

---

### R2 — Source parameter deleted (orphaned dims)

**Risk:** After `AutoDimCommand` places dims bound to `sourceParameterName`, the user deletes the parameter from the part. The dim's `sourceParameterName` now references a non-existent parameter.

**Likelihood:** Low in v1 (users rarely delete named parameters); higher after F4.3 (multi-sketch params may have shorter lifespans).

**Mitigation:** `DimensionElement` falls back to geometrically computed distance (Mode 3) silently. The orphan is not visually flagged until F4.5. This is acceptable for v1: the dimension still shows a meaningful geometric value; it simply loses its parametric binding.

---

### R3 — Multi-line constraints (one constraint references two primitives)

**Risk:** `'dim-distance'` constrains the distance between two `PointRef`s on potentially different primitives (`c.a.primitiveId` ≠ `c.b.primitiveId`). Naive single-primitive resolution would silently misplace such dims.

**Likelihood:** Medium — `dim-distance` is commonly used for parallel-line distance (e.g. chamfer offset), where the two primitives are different lines.

**Mitigation:** §5.2 step 7a canonicalizes the resolution: for `'dim-distance'`, look up BOTH primitives (`c.a.primitiveId` and `c.b.primitiveId`); call `findMatchingEdge2D` for each; place ONE `DrawingDimension` whose `from`/`to` PointRefs span the two matched edges; skip the entire constraint if either lookup fails. This is the single source of truth; the plan inherits it directly.

---

### R4 — Performance on large parts (many constraints)

**Risk:** A complex sketch with 50+ constraints and a dense view projection (500+ edges) pushes the O(C × E) scan into triple-digit milliseconds.

**Likelihood:** Low for furniture CAD (typical base sketches have 4–12 dimension constraints; typical projections have 20–80 edges). Elevated for mechanical parts imported from 5c hardware library.

**Mitigation:** The 200 ms p95 budget is generous relative to expected real-world performance (~15 ms). If the probe reveals a case exceeding 200 ms, short-circuit the edge scan with a spatial pre-filter (index edges by bbox before running distance checks). This optimization is not needed in v1.

---

### R5 — Re-running Auto-Dim on a view that already has auto-dims

**Risk:** Clicking Auto-Dim twice creates two overlapping batches of dims, producing a visually noisy drawing with doubled dimension text.

**Likelihood:** High — users will naturally click the button multiple times expecting "refresh".

**Mitigation:** The spec deliberately defines re-run as append (§2.1). The tooltip reads: `"Place parametric dimensions from base sketch parameters"` without implying idempotency. The user can `Ctrl+Z` once to remove the prior batch. The correct fix — detecting and replacing existing auto-dims — requires tracking "auto" vs "manual" dims and is deferred to F4.8 (user-tunable spacing dialog, where the dialog can include a "Replace existing auto-dims" checkbox). Until F4.8, the append behavior is documented in the tooltip or release notes.

---

## Appendix A — File paths created / modified

**New files:**
- `packages/shared/src/drawing/autoDim.ts` — `findMatchingEdge2D`, `greedyPlaceDims`
- `packages/shared/src/drawing/__tests__/autoDim.spec.ts` — ~25 unit tests
- `packages/app/src/commands/AutoDimCommand.ts` — `AutoDimCommand`
- `packages/app/src/commands/__tests__/AutoDimCommand.spec.ts` — C1–C6 tests
- `tests/e2e/drawing/T-6-11-auto-dim.spec.ts` — E2E spec
- `tests/perf/auto-dim.perf.spec.ts` — perf probe

**Modified files:**
- `packages/shared/src/drawing/types.ts` — `DrawingDimension` extension (2 optional fields)
- `packages/app/src/drawing/DimensionElement.tsx` — parametric text resolution (Mode 1/2/3 pre-pass)
- `packages/app/src/shell/tabs/DrawingTab.tsx` — Auto-Dim button in Dimension panel
- `packages/app/src/App.tsx` — `__zilventorAutoDimMs` perf probe

**Unchanged:**
- `packages/shared/src/drawing/fingerprint.ts` — no view fingerprint change needed
- `packages/shared/src/fileFormat.ts` — format stays v18
- All kernel files — no OCCT call
- Export pipeline — auto-dims render as existing `<line>` SVG elements; no new export plumbing

---

## Appendix B — Cross-references to prior specs

| Pattern | Prior spec |
|---|---|
| Atomic apply/revert with `placedIds` tracking | `AddSectionViewCommand` (F1.1 §7) |
| Store-injection E2E pattern | T-6-3 (`T-6-3-add-linear-dim.spec.ts`), T-6-9 (`T-6-9-broken-view.spec.ts`) |
| Perf probe via `window.__zilventorXxxMs` | `drawing-broken.perf.spec.ts` (F3 §15.2) |
| `DimensionElement` rendering | F1 Drawing spec (Sub-project 6); current impl lines 46–98 |
| `DrawingDimension` union | `packages/shared/src/drawing/types.ts` lines 210–215 |
| `DimensionConstraint` kinds | `packages/shared/src/constraints.ts` lines 16–22 |
| `SketchParameter` shape | `packages/shared/src/parameters.ts` lines 3–8 |
| `Feature` union, `PartDocument` | `packages/shared/src/types.ts` lines 43–77 |
| `Edge2D` type | `packages/shared/src/drawing/projectedGeometry.ts` lines 3–8 |
| `buildViewMatrix`, `apply` | `packages/shared/src/drawing/viewMatrix.ts` |
| Greedy non-overlapping placement precedent | F1.1 section placement (greedy label allocation) |
