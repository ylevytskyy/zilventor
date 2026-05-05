# ZilInventor — Drawing F2: Detail Views

- **Date:** 2026-05-05
- **Status:** Approved — ready for `superpowers:writing-plans`.
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Follow-up F2 of the Sub-project 6 deferred list. Add ANSI-style detail views to `.zidw` drawings: circular region picker on any parent view, pure 2D clip of the parent's already-projected `Edge2D` geometry (no OCCT call, no Comlink trip), auto-lettered callout (shared A→Z→AA pool with section views, skipping I and O), circle annotation on parent, scale 2:1 default. Bumps manifest v15 → v16.
- **Prior art:** Reuses Sub-project 6 projector pipeline (`packages/shared/src/drawing/projectedGeometry.ts`, `fingerprint.ts`), F1 label allocator (`packages/shared/src/drawing/sectionLabel.ts`, renamed), F1's `inputFingerprint` stale-banner pattern (`packages/app/src/drawing/ViewElement.tsx`), F1's `SectionLineOverlay.tsx` component shape, and the `'section'` tool-mode state machine in `packages/app/src/drawing/toolMode.ts`.

---

## 1. Scope and non-goals

### 1.1 What this feature delivers

1. New `DetailView` discriminant on the `DrawingView` union (`packages/shared/src/drawing/types.ts`).
2. Three-stage tool mode `'detail'` in `packages/app/src/drawing/toolMode.ts`: `idle → pickRegionCenter → pickRegionRadius → pickDrop`. ESC cancels at any stage.
3. `AddDetailViewCommand` — single atomic undo step: creates the circle callout annotation on the parent view and the detail view simultaneously.
4. Clipping: pure 2D — clip parent's `Edge2D` arrays against the circular region in parent-projected mm space; no kernel call.
5. Rename `allocateSectionLabel` → `allocateCalloutLabel` in `packages/shared/src/drawing/sectionLabel.ts`; updated to pull labels from both `SectionView` and `DetailView` arrays in the same sheet.
6. Parent annotation: `<DetailRegionOverlay>` component layered above the parent view — circle of `regionParent.radiusMm * parentScale` mm radius, letter label 5 mm upper-right of the circle's perimeter.
7. Caption "DETAIL A" rendered below the detail view's bounding box. Scale ratio on a second line (e.g. `"2:1"`).
8. Stale fingerprint: `fingerprintDetailView(parentInputFingerprint, regionParent, scale)` → djb2 string. Mismatch → ⚠ banner + Regenerate button (same banner/button as F1).
9. `MoveViewCommand` and `EditScaleCommand` work on detail views without modification.
10. Export: pre-clipped edges; no SVG `<clipPath>`. `data-role="detail-border"` circle + `data-role="detail-caption"` text in SVG render.
11. Manifest v15 → v16, additive, no-op `migrations[15] = (m) => m`.

### 1.2 Non-goals — explicitly deferred

| Deferred | Item |
|---|---|
| F2.1 | Rectangular detail region. |
| F2.2 | Detail-of-detail (nested zoom). |
| F2.3 | Detail with section-as-parent (works with chosen clipping strategy; add explicit test before promoting). |
| F2.4 | `EditDetailRegionCommand` — drag handles to reposition center or resize radius. |
| F2.5 | Independent `showHidden` toggle on detail (v1 inherits value from parent at create-time; field is mutable but no UI to flip it). |
| F2.6 | Multiple-region detail sharing a single label. |
| F2.7 | Variable-magnification (warped/fish-eye) detail. |
| F2.8 | Auto-callout label placement avoiding existing geometry. |

### 1.3 Migration / file-format impact

Manifest v15 → v16. All extensions are additive:

- New `kind: 'detail'` value on the `DrawingView` union; existing `base` / `projected` / `iso` / `section` unchanged.
- v15 `DrawingDocument` manifests open without error; `views` containing no `detail` entries are unaffected.
- An older app receiving a v16 drawing that contains `kind: 'detail'` views will silently ignore unknown view kinds. This is data loss (the view disappears on save by the older app), consistent with the v13→v14 and v14→v15 precedent.

### 1.4 Success criteria

Feature is done when **all** are true:

1. From an existing drawing with a base view, clicking **Drawing → Place Views → Detail** switches to `'detail'` mode. Three clicks — circle center, circle radius, drop position — create a detail view with clipped edges visible and `"DETAIL A"` + scale caption below.
2. The parent view shows the ANSI callout circle + letter label at 5 mm upper-right.
3. Editing the source part and reopening the drawing shows ⚠ on the detail view. Clicking Regenerate re-clips and clears the banner.
4. `Ctrl+Z` after `AddDetailViewCommand` removes both the detail view and the parent annotation in one step.
5. Exporting to PDF includes the detail view with circle border and caption. Magic-byte check `%PDF-` passes.
6. Full detail-view creation (no kernel path) p95 < 50 ms.
7. `pnpm -r typecheck`, all pre-existing + new unit + e2e + perf suites pass.

---

## 2. Data model

### 2.1 DetailView

```ts
// packages/shared/src/drawing/types.ts (modified)
export type RegionParent = {
  readonly center: Vec2;     // in parent view's local mm space (pre-scale; see §6)
  readonly radiusMm: number; // in parent view's local mm space (pre-scale)
};

export type DetailView = {
  readonly id: string;
  readonly kind: 'detail';
  readonly parentViewId: string;
  readonly regionParent: RegionParent;  // circular region in parent-local mm space
  readonly label: string;               // auto-allocated from shared callout pool: 'A', 'B', …
  readonly positionMm: Vec2;            // sheet-space drop position (consistent with other view kinds)
  readonly scale: ViewScale;            // default { numerator: 2, denominator: 1 } at create time
  readonly showHidden: boolean;         // inherited from parent at create time; mutable on detail itself
  readonly projection?: {               // populated after first clip; absent until then
    readonly visibleEdges: readonly Edge2D[];
    readonly hiddenEdges: readonly Edge2D[];
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
  };
  readonly inputFingerprint?: string;   // djb2 of parentInputFingerprint + regionParent + scale
};
```

`Vec2` is `{ x: number; y: number }` from `packages/shared/src/drawing/types.ts` (already used by `positionMm` on existing view types).

### 2.2 DrawingView union extension

```ts
// packages/shared/src/drawing/types.ts (modified)
export type DrawingView =
  | BaseView
  | ProjectedView
  | IsoView
  | SectionView
  | DetailView;  // NEW
```

### 2.3 Renamed label allocator signature

```ts
// packages/shared/src/drawing/sectionLabel.ts (modified — rename only)

/**
 * Return the lowest label not in `existingLabels`.
 * Skips I and O per ANSI Y14.3. Fills gaps.
 * existingLabels must include labels from BOTH SectionView and DetailView arrays on the same sheet.
 */
export function allocateCalloutLabel(existingLabels: string[]): string;
// (body identical to current allocateSectionLabel; only the export name changes)
```

The internal `allocateSectionLabel` export is removed; all call sites are updated. See §10 for command usage.

### 2.4 ProjectFile version bump

```ts
// packages/shared/src/drawing/types.ts (modified)
// The DrawingDocument's drawing-kind manifest now accepts formatVersion 16.
// Concretely, in packages/shared/src/fileFormat.ts:
export const CURRENT_FORMAT_VERSION = 16 as const;
```

The `formatVersion` union in `ProjectFile` gains `16` alongside existing `7 | 8 | ... | 15`.

---

## 3. Manifest migration

### 3.1 v15 → v16 migration body

```ts
// packages/shared/src/fileFormat.ts (modified)
// v15 → v16: no-op. DetailView is forward-only; no existing documents need
// structural transformation. (Drawing F2 — detail views)
15: (mIn) => {
  const m = deepClone(mIn);
  return { ...m, formatVersion: 16 };
},
```

### 3.2 Backward-compatibility note

An older app (speaking v15) that opens a v16 `.zidw` file will throw at `migrateManifest` with `"file is from a newer version of ZilInventor (formatVersion=16, current=15)"`. This is the existing behavior for any forward-version mismatch — no special handling needed. Detail view data is not silently lost; the file simply won't open in older builds.

---

## 4. Coordinate-space contract

This section is the authoritative reference for every algorithm that reads or writes `regionParent.center` or `regionParent.radiusMm`. Implementers must follow it exactly.

### 4.1 Definition

`regionParent.center` (a `Vec2`) and `regionParent.radiusMm` (a `number`) are stored in the **parent view's local mm space (pre-scale)**. This is the same coordinate space that `Edge2D.points` live in — the space produced by the projector before the SVG `scale(scaleFactor)` transform is applied.

This space is **not** sheet mm and **not** parent-projected mm scaled by the parent's `ViewScale`. It is the raw output of `projectView` as returned by the projector, before `ViewElement`'s `scale(numerator/denominator)` transform in `packages/app/src/drawing/ViewElement.tsx` line 27.

Storing in pre-scale space means: if the user later changes the parent view's scale from 1:5 to 1:10 via `EditScaleCommand`, the `regionParent` values are unchanged. The same feature region is still selected; only the on-screen rendering adapts.

### 4.2 Transform chain

```
parentLocalMm  ──×(parentScale)──▶  parentProjectedMm  ──+(parentPositionMm)──▶  sheetMm
```

Where `parentScale = parentView.scale.numerator / parentView.scale.denominator`.

### 4.3 Clipping in parent-local mm

Parent's `projection.visibleEdges` and `projection.hiddenEdges` are already in parent-local mm. The stored `regionParent.center` and `regionParent.radiusMm` are also in parent-local mm. Clip directly:

```
clip center = regionParent.center     (parent-local mm)
clip radius = regionParent.radiusMm   (parent-local mm)
```

No scaling is needed before clipping — the coordinate spaces already match.

### 4.4 Transform to detail-local mm

After clipping (edges are in parent-local mm, relative to the parent's projection origin):

1. Translate clipped edge points: subtract `regionParent.center` so the region center becomes `(0, 0)`.
2. Scale by the ratio of detail scale to parent scale:

```
detailScaleFactor = (detail.scale.numerator / detail.scale.denominator)
                  / (parentView.scale.numerator / parentView.scale.denominator)
```

Multiply every clipped edge point by `detailScaleFactor`. The result is in detail-local mm (the space that `ViewElement` will then `scale(detailScale)` for sheet rendering).

3. Recompute `bbox` from the translated, scaled edge points.

### 4.5 Worked example

Setup:
- Parent view: scale 1:5 → `parentScale = 0.2`
- Region: `center = { x: 10, y: 8 }` (parent-local mm), `radiusMm = 5`
- Detail view: scale 2:1 → `detailViewScale = 2.0`

Step 1 — region in parent-local mm: center `(10, 8)`, radius `5`. Clip parent's edges against this circle (no scaling needed; edges are already in parent-local mm).

Step 2 — translate: subtract `(10, 8)` from every clipped edge point. A point that was at `(12, 9)` in parent-local mm becomes `(2, 1)`.

Step 3 — scale factor:
```
detailScaleFactor = (2 / 1) / (1 / 5) = 2 / 0.2 = 10
```
The point `(2, 1)` becomes `(20, 10)` in detail-local mm.

Step 4 — when `ViewElement` renders the detail view it applies `scale(2.0)` (the detail's own `ViewScale`), placing the point at `(40, 20)` in sheet mm relative to `positionMm`.

The parent annotation circle, rendered by `<DetailRegionOverlay>` in parent-projected mm space:
```
circleCenter_sheet = parentView.positionMm + regionParent.center × parentScale
                   = parentView.positionMm + { x: 10×0.2, y: 8×0.2 }
                   = parentView.positionMm + { x: 2, y: 1.6 }
circleRadius_sheet = regionParent.radiusMm × parentScale = 5 × 0.2 = 1 mm
```

---

## 5. Clipping algorithm

### 5.1 `clipEdgesToCircle`

File: `packages/shared/src/drawing/clipEdgesToCircle.ts` (new)

```ts
export type Segment = { readonly p0: [number, number]; readonly p1: [number, number] };

/**
 * Clip a polyline (array of [x,y] points) against a circle centered at `center`
 * with radius `radius`. Returns an array of Segment[] — zero or more surviving
 * sub-segments. Each segment is fully inside or on the circle boundary.
 */
export function clipPolylineToCircle(
  points: ReadonlyArray<readonly [number, number]>,
  center: { x: number; y: number },
  radius: number,
): Segment[];
```

The function processes consecutive point pairs `(p0, p1)` as line segments and calls `clipLineToCircle` on each.

### 5.2 `clipLineToCircle` (core math)

Pseudocode:

```
function clipLineToCircle(p0, p1, center, radius) -> Segment[]:
  # Translate to circle-centered space
  ax = p0.x - center.x;  ay = p0.y - center.y
  bx = p1.x - center.x;  by = p1.y - center.y
  dx = bx - ax;  dy = by - ay

  # Parametric: P(t) = (ax + t*dx, ay + t*dy), t ∈ [0,1]
  # |P(t)|^2 = r^2  →  quadratic in t:
  A = dx*dx + dy*dy
  if A < 1e-10:  # zero-length segment
    return []

  B = 2 * (ax*dx + ay*dy)
  C = ax*ax + ay*ay - radius*radius

  disc = B*B - 4*A*C

  p0_inside = (ax*ax + ay*ay) <= radius*radius + 1e-9
  p1_inside = (bx*bx + by*by) <= radius*radius + 1e-9

  if disc < 0:
    # No real intersection
    if p0_inside and p1_inside:
      return [Segment(p0, p1)]  # fully inside
    return []                   # fully outside

  sqrt_disc = sqrt(max(disc, 0))
  t1 = (-B - sqrt_disc) / (2*A)
  t2 = (-B + sqrt_disc) / (2*A)
  # clamp to [0,1]
  t_enter = max(min(t1, t2), 0.0)
  t_exit  = min(max(t1, t2), 1.0)

  if disc == 0:
    # Tangent — single intersection point; discard (zero-length segment)
    return []

  if t_exit < t_enter:
    return []   # intersection interval outside [0,1]

  if t_enter >= t_exit - 1e-9:
    return []   # degenerate interval (tangent after clamping)

  # At least part of the segment is inside
  clipped_p0 = (p0.x + t_enter*dx_orig, p0.y + t_enter*dy_orig)  # dx_orig = p1.x-p0.x
  clipped_p1 = (p0.x + t_exit *dx_orig, p0.y + t_exit *dy_orig)
  return [Segment(clipped_p0, clipped_p1)]
```

Note: `dx_orig` / `dy_orig` are `p1 - p0` (not translated), used only for the final point reconstruction.

### 5.3 Arc and circle primitives in `Edge2D`

`Edge2D` in `packages/shared/src/drawing/projectedGeometry.ts` stores all geometry as polylines (`points: ReadonlyArray<readonly [number, number]>`). There are no arc-kind variants. The clipping algorithm operates on consecutive point pairs and is correct as written; no tessellation step is needed.

### 5.4 Full clip call

```ts
// packages/shared/src/drawing/projectDetailView.ts
import { clipPolylineToCircle } from './clipEdgesToCircle';

function clipEdges(
  edges: readonly Edge2D[],
  center: { x: number; y: number },
  radius: number,
): Edge2D[] {
  const result: Edge2D[] = [];
  for (const edge of edges) {
    const segments = clipPolylineToCircle(edge.points, center, radius);
    for (let i = 0; i < segments.length; i++) {
      result.push({
        id: `${edge.id}_clip${i}`,
        kind: edge.kind,
        points: [segments[i]!.p0, segments[i]!.p1],
      });
    }
  }
  return result;
}
```

---

## 6. Projector orchestrator

### 6.1 `projectDetailView`

File: `packages/shared/src/drawing/projectDetailView.ts` (new)

```ts
import type { DetailView, DrawingView, Vec2 } from './types';
import type { Edge2D, ProjectedGeometry } from './projectedGeometry';
import { clipPolylineToCircle } from './clipEdgesToCircle';

export type DetailViewInput = {
  readonly parentView: DrawingView & { projection: ProjectedGeometry };
  readonly regionParent: { center: Vec2; radiusMm: number };
  readonly detailScale: { numerator: number; denominator: number };
  readonly showHidden: boolean;
};

export type DetailViewOutput = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges: readonly Edge2D[];
  readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

/**
 * Pure function. No I/O, no side effects, deterministic.
 * Clips parent edges against the circular region and transforms to detail-local mm.
 * See spec §4 for coordinate-space contract.
 */
export function projectDetailView(input: DetailViewInput): DetailViewOutput;
```

Contract:
- Takes `parentView.projection.visibleEdges` and `projection.hiddenEdges` (parent-local mm).
- Clips against circle `(center=regionParent.center, radius=regionParent.radiusMm)` — both already in parent-local mm.
- Translates clipped edges by `-regionParent.center` (center → origin).
- Scales by `detailScaleFactor = (detailScale.numerator / detailScale.denominator) / (parentView.scale.numerator / parentView.scale.denominator)`.
- Returns `{ visibleEdges, hiddenEdges, bbox }` in detail-local mm.
- If `showHidden` is false, returns `hiddenEdges: []` (clips but discards).
- Does **not** use `crypto`, does **not** import from `packages/kernel/`, is safe for any thread.

---

## 7. Fingerprint

### 7.1 `fingerprintDetailView`

Added to `packages/shared/src/drawing/fingerprint.ts`:

```ts
/**
 * Synchronous djb2 fingerprint for a DetailView.
 * Incorporates parent's source fingerprint, region definition, and scale.
 * Matches the fingerprintSectionView pattern in the same file.
 */
export function fingerprintDetailView(
  parentInputFingerprint: string,
  regionParent: { center: { x: number; y: number }; radiusMm: number },
  scale: { numerator: number; denominator: number },
): string {
  const payload = [
    parentInputFingerprint,
    regionParent.center.x.toFixed(3),
    regionParent.center.y.toFixed(3),
    regionParent.radiusMm.toFixed(3),
    scale.numerator,
    scale.denominator,
  ].join('|');
  return djb2(payload);  // reuse existing djb2() in fingerprint.ts
}
```

The `djb2` function is already defined (non-exported) in `packages/shared/src/drawing/fingerprint.ts`. `fingerprintDetailView` is added to the same file and reuses it.

Floats are rounded to 1e-3 mm (`.toFixed(3)`) to match `fingerprintSectionView`'s determinism convention.

### 7.2 Stale-detection usage

On `AddDetailViewCommand.apply`, compute:

```ts
view.inputFingerprint = fingerprintDetailView(
  parentView.inputFingerprint ?? '',
  regionParent,
  detailScale,
);
```

On drawing open / `RegenerateViewCommand`, recompute and compare. Mismatch → `isStale = true` → ⚠ banner in `ViewElement`.

---

## 8. Commands

### 8.1 `AddDetailViewCommand`

File: `packages/app/src/commands/AddDetailViewCommand.ts` (new)

```ts
import type { DetailView, DrawingView } from '@zilventor/shared';
import { allocateCalloutLabel } from '@zilventor/shared';
import { projectDetailView } from '@zilventor/shared';
import { fingerprintDetailView } from '@zilventor/shared';
import { nanoid } from 'nanoid';

export type AddDetailViewOpts = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  regionCenter: { x: number; y: number };   // parent-local mm
  regionRadiusMm: number;                   // parent-local mm
  dropAt: { x: number; y: number };         // sheet-space position
};

export class AddDetailViewCommand implements Command {
  private newViewId = nanoid();
  private allocatedLabel = '';

  constructor(private opts: AddDetailViewOpts) {}

  async apply(): Promise<void> {
    // 1. Resolve parent view.
    const sheet = resolveSheet(this.opts.drawingId, this.opts.sheetId);
    const parentView = sheet.views.find(v => v.id === this.opts.parentViewId);
    if (!parentView) {
      return errorResult('parent-not-found');
    }

    // 2. Require parent projection to be populated.
    if (!parentView.projection) {
      return errorResult('parent-projection-missing');
    }

    // 3. Allocate label from shared pool (SectionView + DetailView labels).
    const existingLabels = sheet.views
      .filter((v): v is SectionView | DetailView =>
        v.kind === 'section' || v.kind === 'detail')
      .map(v => v.label);
    this.allocatedLabel = allocateCalloutLabel(existingLabels);

    // 4. Determine showHidden from parent.
    const showHidden = parentView.kind !== 'section' && parentView.showHidden;

    // 5. Clip parent edges → projectDetailView.
    const defaultScale = { numerator: 2, denominator: 1 };
    const projection = projectDetailView({
      parentView: parentView as DrawingView & { projection: NonNullable<typeof parentView.projection> },
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      detailScale: defaultScale,
      showHidden,
    });

    // 6. Compute fingerprint.
    const inputFingerprint = fingerprintDetailView(
      parentView.inputFingerprint ?? '',
      { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      defaultScale,
    );

    // 7. Build DetailView.
    const view: DetailView = {
      id: this.newViewId,
      kind: 'detail',
      parentViewId: this.opts.parentViewId,
      regionParent: { center: this.opts.regionCenter, radiusMm: this.opts.regionRadiusMm },
      label: this.allocatedLabel,
      positionMm: this.opts.dropAt,
      scale: defaultScale,
      showHidden,
      projection,
      inputFingerprint,
    };

    // 8. Push onto sheet.views[].
    mutateSheet(this.opts.drawingId, this.opts.sheetId, sheet => ({
      ...sheet,
      views: [...sheet.views, view],
    }));
  }

  revert(): void {
    // Remove DetailView from sheet.views[].
    // Label is automatically released because allocateCalloutLabel reads
    // current views from the sheet at the time of the next allocation.
    mutateSheet(this.opts.drawingId, this.opts.sheetId, sheet => ({
      ...sheet,
      views: sheet.views.filter(v => v.id !== this.newViewId),
    }));
  }
}
```

Error result variants:
- `'parent-not-found'` — `parentViewId` not in `sheet.views`.
- `'parent-projection-missing'` — parent view exists but `projection` is absent (stale / never generated).

Both error variants return without throwing; the command bus surfaces them as user-visible toasts.

### 8.2 `DeleteViewCommand` cascade

`packages/app/src/commands/DeleteViewCommand.ts` (modified):

```ts
// After removing the target view, also remove any detail views that reference it as parent.
const childDetailIds = sheet.views
  .filter((v): v is DetailView => v.kind === 'detail' && v.parentViewId === targetView.id)
  .map(v => v.id);

// Remove target + all child detail views in one mutation.
mutateSheet(..., sheet => ({
  ...sheet,
  views: sheet.views.filter(v => v.id !== targetView.id && !childDetailIds.includes(v.id)),
}));
```

This matches the existing section-children cascade pattern already in `DeleteViewCommand` for `SectionView` children.

### 8.3 `RegenerateViewCommand` extension

`packages/app/src/commands/RegenerateViewCommand.ts` (modified):

```ts
case 'detail': {
  const parent = sheet.views.find(v => v.id === view.parentViewId);
  if (!parent?.projection) break;
  const projection = projectDetailView({
    parentView: parent as ...,
    regionParent: view.regionParent,
    detailScale: view.scale,
    showHidden: view.showHidden,
  });
  const inputFingerprint = fingerprintDetailView(
    parent.inputFingerprint ?? '',
    view.regionParent,
    view.scale,
  );
  updateView(view.id, { projection, inputFingerprint });
  break;
}
```

### 8.4 `MoveViewCommand` and `EditScaleCommand`

Both commands accept a `viewId` and update `positionMm` or `scale` on the matched view via a generic `views.map` replace. `DetailView` carries both fields with the same shape as other view kinds. No modification needed. The plan must **not** add tasks for these commands.

---

## 9. Tool mode

### 9.1 Type additions

```ts
// packages/app/src/drawing/toolMode.ts (modified)

export type ToolMode =
  | 'idle'
  | 'placeBase' | 'placeProjected' | 'placeIso'
  | 'addLinearH' | 'addLinearV' | 'addAligned' | 'addRadial' | 'addDiametric'
  | 'addCenterline' | 'addCenterMark' | 'addLeader' | 'addBalloon'
  | 'section'
  | 'detail';    // NEW

export type DetailToolState =
  | { stage: 'idle' }
  | { stage: 'pickRegionCenter'; parentViewId: string }
  | { stage: 'pickRegionRadius'; parentViewId: string; center: { x: number; y: number } }
  | { stage: 'pickDrop'; parentViewId: string; center: { x: number; y: number }; radiusMm: number };
```

### 9.2 Store additions

```ts
interface ToolModeState {
  // ... existing fields ...
  detailState: DetailToolState;

  enterDetailMode(): void;
  detailPickParent(viewId: string): void;
  detailPickCenter(point: { x: number; y: number }): void;
  detailPickRadius(point: { x: number; y: number }): void;
  detailPickDrop(point: { x: number; y: number }, onDispatch: () => void): void;
  detailCancel(): void;
}
```

Initial state: `detailState: { stage: 'idle' }`.

### 9.3 State machine

```
[idle] ──enterDetailMode()──▶ mode='detail', stage='idle'
                               status bar: "Click a view to define detail region."

stage='idle' ──click base/projected/iso/section view──▶ stage='pickRegionCenter'
                               status bar: "Click to set region center."

stage='pickRegionCenter' ──click canvas (in parent view bounds)──▶ stage='pickRegionRadius'
                               status bar: "Drag to set region radius. [rubber-band circle shown]"

stage='pickRegionRadius' ──click canvas──▶ stage='pickDrop'
                               radiusMm = distance(center, click) in parent-local mm
                               status bar: "Click to place detail view. [ghost bbox follows cursor]"

stage='pickDrop' ──click canvas──▶ dispatch AddDetailViewCommand; stage='idle'; mode='idle'

ESC at any stage ──▶ stage='idle'
ESC when stage='idle' and mode='detail' ──▶ mode='idle'
```

All four parent view kinds (`base`, `projected`, `iso`, `section`) are accepted during `pickRegionCenter` — clicking any of them advances the stage. This enables F2.3 (section-as-parent) without any code change.

### 9.4 Live preview during `pickRegionRadius`

`DrawingCanvas` renders a rubber-band SVG `<circle>` from `center` to cursor position when `detailState.stage === 'pickRegionRadius'`. Circle radius = `distance(center, cursorMm)` in parent-projected mm, rendered at the parent view's transform.

### 9.5 Live preview during `pickDrop`

`DrawingCanvas` renders a ghost `<rect>` (the estimated detail bbox, approximated as `2 * radiusMm * detailScale` square) following the cursor in sheet mm.

### 9.6 Click dispatch in `DrawingCanvas`

```
onCanvasClick(pt: Vec2 /* sheet mm */) {
  if (mode === 'section') { ... existing section dispatch ... }
  if (mode === 'detail') {
    switch (detailState.stage) {
      case 'idle':
        const hitView = hitTestViews(pt, sheet.views);
        if (hitView) detailPickParent(hitView.id);
        break;
      case 'pickRegionCenter':
        // convert pt from sheet mm to parent-local mm
        const parentLocalPt = sheetToParentLocal(pt, parentView);
        detailPickCenter(parentLocalPt);
        break;
      case 'pickRegionRadius': {
        const parentLocalPt = sheetToParentLocal(pt, parentView);
        detailPickRadius(parentLocalPt);
        break;
      }
      case 'pickDrop':
        detailPickDrop(pt, () => {
          bus.execute(new AddDetailViewCommand({ ..., dropAt: pt }));
        });
        break;
    }
  }
}
```

`sheetToParentLocal(sheetPt, parentView)`:
```ts
const scale = parentView.scale.numerator / parentView.scale.denominator;
return {
  x: (sheetPt.x - parentView.positionMm.x) / scale,
  y: (sheetPt.y - parentView.positionMm.y) / scale,
};
```

---

## 10. UI components

### 10.1 `<DetailRegionOverlay>`

File: `packages/app/src/drawing/DetailRegionOverlay.tsx` (new)

```tsx
// Props:
interface Props {
  parentView: BaseView | ProjectedView | IsoView | SectionView;
  detailView: DetailView;
  zoom?: number;
}

// Renders into the parent view's <g> as a sibling layer above edges:
//   - <circle> cx/cy = regionParent.center * parentScale (in parent-projected mm),
//     translated to sheet space by parentView.positionMm.
//     Radius = regionParent.radiusMm * parentScale.
//     stroke-width = 0.35 mm (matches visible edge weight).
//   - <text> letter label (detailView.label) at the circle's upper-right perimeter.
//     Offset: 5 mm upper-right from the circle edge, i.e.
//       labelX = cx + radius * cos(45°) + 5 * cos(45°)
//       labelY = cy - radius * sin(45°) - 5 * sin(45°)
//     font-size 5 mm. data-role="detail-callout-label".
```

Rendered in `DrawingCanvas` as a sibling `<g>` above the parent `<ViewElement>` (same pattern as `<SectionLineOverlay>` for section views).

### 10.2 `<ViewElement>` extension

`packages/app/src/drawing/ViewElement.tsx` (modified):

```tsx
{/* Detail view border + caption */}
{view.kind === 'detail' && (
  <>
    {/* Circle border */}
    <circle
      cx={0} cy={0}
      r={(view as DetailView).regionParent.radiusMm
         * (view.scale.numerator / view.scale.denominator)}
      fill="none"
      stroke="black"
      strokeWidth={0.35}
      data-role="detail-border"
    />
    {/* Caption: "DETAIL A" + scale line */}
    {proj && (
      <text
        x={(proj.bbox.minX + proj.bbox.maxX) / 2}
        y={proj.bbox.maxY + 5 / sheetZoom}
        textAnchor="middle"
        fontSize={4 / sheetZoom}
        fontFamily="sans-serif"
        data-role="detail-caption"
      >
        {`DETAIL ${(view as DetailView).label}`}
        <tspan
          x={(proj.bbox.minX + proj.bbox.maxX) / 2}
          dy={5 / sheetZoom}
          fontSize={3.5 / sheetZoom}
        >
          {`${view.scale.numerator}:${view.scale.denominator}`}
        </tspan>
      </text>
    )}
  </>
)}
```

The `<circle r={...}>` is in detail-local mm (centered at origin), scaled to sheet mm by `ViewElement`'s `scale(scaleFactor)` transform on the parent `<g>`.

### 10.3 Ribbon button

`packages/app/src/shell/tabs/DrawingTab.tsx` (modified):

```
Place Views panel:
  Base View  |  Projected View  |  Section  |  Detail  |  Add Iso
```

"Detail" button inserted between "Section" and "Add Iso". Uses a magnifying-glass Lucide icon if available in the existing set, otherwise falls back to `<Circle>` from `lucide-react`. (TBD: pick exact icon from the existing icon set in use.)

Button is disabled when `activeSheet.views` contains no views with a populated `projection` field (nothing to detail from).

### 10.4 `<DrawingTreePane>` extension

Detail views appear in the Views sub-tree beneath their sheet, labelled `"Detail A (from <parentLabel>)"`:

```
├── Views
│   ├── Base — Front  · 1:1
│   ├── Section A-A (from Base) · 1:1
│   ├── Detail A (from Base) · 2:1   ← NEW
│   └── Iso — NE · 1:1
```

Right-click → Delete (invokes `DeleteViewCommand`), Regenerate (invokes `RegenerateViewCommand`).

---

## 11. Export

### 11.1 SVG render (`renderDrawingSvg.ts`)

Detail views render as part of the normal `sheet.views.map(view => renderViewElement(view))` pass — no special export plumbing. The `<DetailRegionOverlay>` is emitted as a child of the parent view's `<g>` in `renderParentViewGroup`. The SVG output includes:

- `<circle data-role="detail-border" .../>` — circle border in detail-view's `<g>`.
- `<text data-role="detail-caption" .../>` — caption below bbox.
- `<circle data-role="detail-callout-label" .../>` — parent annotation circle.
- `<text data-role="detail-callout-label" .../>` — letter label on parent.

No SVG `<clipPath>` element — edges are pre-clipped in the model.

### 11.2 PDF render (`renderDrawingPdf.ts`)

No changes needed beyond what the SVG render provides. The existing jsPDF SVG-to-PDF path renders `<circle>` and `<text>` elements natively.

### 11.3 PNG render (`renderDrawingPngForSheet.ts`)

No changes needed. The OffscreenCanvas rasteriser draws from the same SVG output.

---

## 12. Tests

### 12.1 Unit tests

**`packages/shared/src/drawing/__tests__/clipEdgesToCircle.spec.ts`** — 8 line-vs-circle cases:

1. Fully inside segment (both endpoints inside circle) → returns one segment equal to the input.
2. Fully outside segment (no intersection) → returns `[]`.
3. One endpoint inside, one outside → returns clipped segment from p0 to intersection.
4. One endpoint outside, one inside → returns clipped segment from intersection to p1.
5. Both endpoints outside, chord passes through circle → returns one segment between the two intersections.
6. Zero-length segment (p0 === p1, inside) → returns `[]`.
7. Tangent line (discriminant = 0) → returns `[]` (single point, discard).
8. Segment exactly on circle boundary (both points on circle) → returns the segment as-is.

**`packages/shared/src/drawing/__tests__/projectDetailView.spec.ts`**:

9. Parent 1:1, region center `(10, 8)` radius `5`, detail 2:1 → output edges are translated by `(-10, -8)` and scaled by `2.0`. Verify a known input point is at expected output coordinate.
10. `showHidden: false` → `hiddenEdges` in output is empty even when parent has hidden edges.
11. Empty projection (parent has zero edges in region) → `visibleEdges: []`, `bbox` is `{0,0,0,0}`.

**`packages/shared/src/drawing/__tests__/sectionLabel.spec.ts`** — renamed allocator + multi-pool:

12. `allocateCalloutLabel(['A'])` → returns `'B'`.
13. Mixed SectionView + DetailView labels `['A', 'B']` → next is `'C'`.
14. Labels `['A', 'C']` (gap) → returns `'B'` (gap-fill).
15. 24 labels allocated (A–Z minus I, O) → next is `'AA'`.

**`packages/shared/src/drawing/__tests__/fingerprintDetailView.spec.ts`**:

16. Same inputs twice → identical string.
17. Change `parentInputFingerprint` → different string.
18. Change `regionParent.center.x` by 0.001 mm → different string (`.toFixed(3)` distinguishes).
19. Change `regionParent.center.x` by 0.0001 mm → same string (below 1e-3 threshold).
20. Change `scale.numerator` → different string.

**`packages/app/src/commands/__tests__/AddDetailViewCommand.spec.ts`**:

21. Apply: `sheet.views` gains one `DetailView` with `kind: 'detail'`; label is `'A'` when no prior callout labels.
22. Revert: view removed; `sheet.views` length restored.
23. Apply → revert → apply: same `label` re-allocated (gap-fill semantics).
24. `parent-not-found` error result when `parentViewId` does not exist.
25. `parent-projection-missing` error result when parent view has no `projection`.
26. Cascade: deleting a parent view via `DeleteViewCommand` also removes any `DetailView` children.

**`packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts`**:

27. v15 drawing manifest with no detail views → v16 pass-through identical.
28. v16 manifest with one detail view round-trips through `JSON.parse(JSON.stringify(...))`.

**`packages/app/src/drawing/__tests__/ViewElement.spec.tsx`** — detail branch snapshot:

29. `<ViewElement view={detailView} .../>` renders a `<circle data-role="detail-border"/>`.
30. Caption text includes `"DETAIL A"` and `"2:1"`.

**`packages/app/src/drawing/__tests__/DetailRegionOverlay.spec.tsx`** — snapshot:

31. `<DetailRegionOverlay>` renders a `<circle>` in parent-projected mm space.
32. Letter label text element present with correct `data-role="detail-callout-label"`.

### 12.2 E2E — `tests/e2e/drawing/T-6-8-detail-view.spec.ts`

```
T-6-8: Detail view — create, clip, annotation, undo/redo

1. Create a 100×60×40 mm box part.
2. File → New Drawing → base view (Front, 1:1).
3. Drawing → Place Views → Detail.
4. Click base view (pickRegionCenter stage).
5. Click at (25, 15) in parent-local mm (center).
6. Click at (25, 30) in parent-local mm (radius = 15 mm, edge of circle).
7. Click to drop below base view.
8. Assert: detail view visible in canvas; `projection.visibleEdges.length > 0` in store.
9. Assert: "DETAIL A" caption present in SVG DOM (data-role="detail-caption").
10. Assert: "2:1" scale line present in caption.
11. Assert: parent view contains <circle data-role="detail-callout-label" />.
12. Assert: <text data-role="detail-callout-label"> text = "A".
13. Ctrl+Z → assert detail view removed from store; parent annotation absent.
14. Ctrl+Y (redo) → detail view restored; caption + annotation visible.
```

### 12.3 Perf — `tests/perf/drawing-detail.perf.spec.ts`

```ts
// 100 iterations of AddDetailViewCommand against a parent view with ~200 edges.
// No kernel call — measures pure 2D clip + transform.
// p95 budget: 50 ms.
// Exposed via window.__zilventorDetailViewMs(n: number) → { p95ms: number }.
```

Pattern mirrors `tests/perf/section-cut.perf.spec.ts`: `page.waitForFunction` on the harness probe, `page.evaluate` to invoke, `expect(p95ms).toBeLessThan(50)`.

---

## 13. Performance characteristics

| Metric | p95 budget | Rationale |
|---|---|---|
| `AddDetailViewCommand` (clip + transform, ~200-edge parent) | 50 ms | No kernel call, no Comlink round-trip. Clipping is O(edges × segments) — for 200 edges, typically < 2 ms; 50 ms is generous. |
| `<DrawingCanvas>` first paint with detail view | 100 ms | Circle border + pre-clipped edges add ~10–30 `<polyline>` elements; no layout cost. |
| Export to SVG with detail view | Unchanged from Sub-project 6 | Pre-clipped edges emit as normal `<polyline>` elements. |

Expected typical p95 for the clip operation on a 200-edge parent: **2–5 ms**. The 50 ms budget has ~10× headroom.

---

## 14. Risks and mitigations

1. **Coordinate-space confusion between parent-local mm and parent-projected mm.** The stored `regionParent` is in parent-local mm (pre-scale). The rendered parent annotation circle must scale by `parentScale`. If implementers scale the region before storing it, the callout drifts when the parent scale changes. Mitigation: the worked example in §4.5 is the canonical reference; reviewers must check the stored `regionParent` values in the test fixtures match the pre-scale expectation.

2. **Clipping a region that overlaps the parent's projected geometry edge cases.** A region that extends past the parent's projected bounding box is valid — edges simply have no intersection beyond the bbox. The clip algorithm returns an empty segment list for those edges; no special handling needed.

3. **Detail of a stale parent.** If `parentView.projection` is absent (parent never generated or stale-cleared), `AddDetailViewCommand` returns `'parent-projection-missing'`. The command bus surfaces a toast: `"Cannot add detail view: parent view has no projection. Regenerate the parent first."` No fallback; user must regenerate the parent explicitly.

4. **Arc-segment precision in `Edge2D`.** All geometry in `Edge2D.points` is already tessellated to polyline segments by the projector. The clip algorithm operates on consecutive point pairs; there are no arc primitives to handle. This was verified against `packages/shared/src/drawing/projectedGeometry.ts` — `Edge2D` has no arc-kind field.

---

## 15. Deferred follow-ups

| ID | Item |
|---|---|
| F2.1 | Rectangular detail region (box instead of circle). |
| F2.2 | Detail-of-detail (nested zoom, `parentViewId` pointing to an existing `DetailView`). |
| F2.3 | Explicit test for section-as-parent (currently expected to work; verify with T-6-9 before closing). |
| F2.4 | `EditDetailRegionCommand` — drag handles for center repositioning and radius resize. |
| F2.5 | UI toggle for `showHidden` on an existing detail view (currently immutable post-create without delete+recreate). |
| F2.6 | Multiple-region detail sharing a single label. |
| F2.7 | Variable-magnification (warped/fish-eye) detail projection. |
| F2.8 | Auto-callout label placement algorithm that avoids existing geometry on the parent view. |

---

## 16. Estimated batches

4–5 implementer batches, ~1200-line plan, single Sonnet writer (no parallel split).

| Batch | Content |
|---|---|
| 1 | Types + migration: `DetailView`, `RegionParent`, `DrawingView` union update, `allocateCalloutLabel` rename, `migrateManifest` v15→v16, `migrateManifest-v15-to-v16.spec.ts`, sectionLabel rename tests. |
| 2 | Clip engine + projector: `clipEdgesToCircle.ts`, `projectDetailView.ts`, `fingerprintDetailView` addition to `fingerprint.ts`, all unit tests for clip + projector + fingerprint. |
| 3 | Commands: `AddDetailViewCommand`, `DeleteViewCommand` cascade, `RegenerateViewCommand` detail branch, command unit tests. |
| 4 | Tool mode + UI: `'detail'` mode + `DetailToolState` in `toolMode.ts`, `<DetailRegionOverlay>`, `ViewElement` detail branch, ribbon button, `<DrawingTreePane>` detail row, component snapshot tests. |
| 5 | Tests + export: T-6-8 e2e spec, `drawing-detail.perf.spec.ts`, export smoke (PDF magic-byte check), self-review fixes. |

---

## Appendix — file inventory

### New files

```
packages/shared/src/drawing/
  clipEdgesToCircle.ts
  projectDetailView.ts
  __tests__/clipEdgesToCircle.spec.ts
  __tests__/projectDetailView.spec.ts
  __tests__/fingerprintDetailView.spec.ts

packages/app/src/drawing/
  DetailRegionOverlay.tsx
  __tests__/DetailRegionOverlay.spec.tsx

packages/app/src/commands/
  AddDetailViewCommand.ts
  __tests__/AddDetailViewCommand.spec.ts

packages/shared/src/__tests__/
  migrateManifest-v15-to-v16.spec.ts

tests/e2e/drawing/
  T-6-8-detail-view.spec.ts

tests/perf/
  drawing-detail.perf.spec.ts
```

### Modified files

```
packages/shared/src/drawing/types.ts
  (DetailView, RegionParent, DrawingView union += 'detail')

packages/shared/src/drawing/sectionLabel.ts
  (rename allocateSectionLabel → allocateCalloutLabel; export name only)

packages/shared/src/drawing/fingerprint.ts
  (add fingerprintDetailView; reuses internal djb2)

packages/shared/src/fileFormat.ts
  (CURRENT_FORMAT_VERSION → 16; migrations[15] no-op)

packages/app/src/drawing/toolMode.ts
  (ToolMode += 'detail'; DetailToolState type; store actions)

packages/app/src/drawing/ViewElement.tsx
  (detail branch: border circle, edges, caption with data-role)

packages/app/src/drawing/DrawingCanvas.tsx
  (detail mode click dispatch; rubber-band circle + ghost bbox preview)

packages/app/src/drawing/DrawingTreePane.tsx
  (detail row in views sub-tree)

packages/app/src/commands/DeleteViewCommand.ts
  (cascade: remove DetailView children on parent delete)

packages/app/src/commands/RegenerateViewCommand.ts
  (case 'detail' branch)

packages/app/src/shell/tabs/DrawingTab.tsx
  (Detail button in Place Views panel)
```

All call sites of `allocateSectionLabel` must be updated to `allocateCalloutLabel`. Known call sites in the current codebase:
- `packages/app/src/commands/AddSectionViewCommand.ts` (line 11, 123)
- `packages/app/src/drawing/DrawingCanvas.tsx` (line 13, 339) — label preview during `pickDrop` stage

The existing `packages/shared/src/drawing/__tests__/sectionLabel.test.ts` must be updated to import `allocateCalloutLabel` and rename the `describe` block accordingly.

---

**End of spec.** All 17 design axes locked. Ready for `superpowers:writing-plans`.
