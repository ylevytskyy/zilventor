# ZilInventor — Drawing F3: Broken Views

- **Date:** 2026-05-06
- **Status:** Approved 2026-05-06 — ready for `superpowers:writing-plans`.
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Predecessor:** Drawing F2 — Detail Views (`c518ba0`)
- **Estimated batches:** 4–5
- **No new kernel work** — pure 2D post-projection operation; no OCCT call, no Comlink trip.
- **Spec scope:** Follow-up F3 of the Sub-project 6 deferred list. Add ANSI-style broken views to `.zidw` drawings: adds a `breaks` property directly to existing view kinds (no new view discriminant), two-pick axis-aligned band removal, synthetic zigzag break symbols emitted as `Edge2D` with new `kind: 'break'` tier, baked at projection time, undo/redo via `AddBreakCommand` / `DeleteBreakCommand`. Bumps manifest v16 → v17.

---

## 1. Goal

Enable users to shorten elongated drawing views by removing one or more contiguous bands of geometry along a chosen axis. The result is visually shorter, preserving detail near each end while collapsing the redundant mid-section. Broken views are represented as a property of an existing view — not a new child view — making the feature structurally simpler than F1 (SectionView) or F2 (DetailView): no cascade-delete, no parent reference, no new tree row. The break symbols (ANSI zigzag lines) are synthetic `Edge2D` objects baked into `projection.visibleEdges` at command time, so rendering, PDF/SVG export, and PNG rasterisation require zero plumbing changes beyond a new `kind: 'break'` stroke style in `ViewElement`.

---

## 2. Non-goals (deferred F-items)

- **F3.1** — Wave and double-straight break-symbol styles (only `'zigzag'` rendered in v1; field reserved).
- **F3.2** — `EditBreakCommand` drag handles for repositioning or resizing an existing break band.
- **F3.3** — True-length compensation and break-line symbol on dimension leaders.
- **F3.4** — Snap-to-edge break-region picking (currently freehand pick).
- **F3.5** — Arbitrary-angle (non-axis-aligned) break regions.
- **F3.6** — Section view or detail view as target of a break (only `base`, `projected`, `iso` in scope; `section` field added but untested in v1).
- **F3.7** — User-configurable `gapMm` via numeric input (v1 default is 5 mm; field exists on DTO for forward compat).
- **F3.8** — Broken view as parent of a section or detail view (parent must have unprojected or non-broken projection; deferred).
- **F3.9** — Inherited from F1/F2: Regenerate button re-projects (current implementation only clears local stale flag; cross-cutting fix independent of F3).

---

## 3. Constraints (load-bearing)

- Desktop Chromium only; OPFS-only storage; no server-side rendering.
- **No kernel calls.** `applyBreaks` is pure 2D; it operates on already-projected `Edge2D[]` after the kernel projector has run. No OCCT, no Comlink round-trip.
- **Manifest v16 → v17 additive only.** Existing documents open without error; new field `breaks` is absent on all existing views, equivalent to `breaks: []` at runtime.
- **`Edge2D.kind` union widens to add `'break'`**; existing consumers that exhaustively switch on `kind` must add a branch (they currently switch on `'silhouette' | 'feature' | 'outline' | 'hatch'`).
- Liang-Barsky 1D clip (not circular clip as in F2); one axis-aligned half-plane per side of the band.
- Edge id stability: surviving fragments retain parent edge id; edges crossing the removed band are split into `<id>_a` and `<id>_b`.

---

## 4. Architectural decision — property of existing view, NOT a new view discriminant

**F3 deviates from F1's `SectionView` discriminant and F2's `DetailView` discriminant.** Broken views do not produce a new view — they modify an existing view in place.

Rationale: A broken view is not a derived view of a parent; it is the same view with chunks removed. Introducing a `BrokenView` kind would force cascade-delete machinery (identical to `DeleteViewCommand`'s section/detail cascades), a new tree node, a new callout annotation, and a new label. None of those apply. The right model is `breaks?: readonly BreakRegion[]` on `BaseView | ProjectedView | IsoView`. The view is "broken" when `breaks.length > 0`. Commands `AddBreakCommand` and `DeleteBreakCommand` mutate this array. When the last break is removed, `view.breaks` becomes `[]` (not `undefined`); the array shape is kept stable to simplify downstream code.

`SectionView` also receives a `breaks?` field (same DTO) for forward compatibility, but in-scope testing does not cover section-as-break-target (F3.6 deferred).

---

## 5. Data model

### 5.1 `BreakRegion` (new type)

```ts
// packages/shared/src/drawing/types.ts (new type)

export type BreakRegion = {
  readonly id: string;           // nanoid(); stable across undo/redo
  readonly axis: 'x' | 'y';     // which axis the band is perpendicular to
  readonly coordA: number;       // view-local mm (pre-scale); lesser boundary
  readonly coordB: number;       // view-local mm (pre-scale); greater boundary; coordB > coordA ALWAYS
  readonly gapMm: number;        // visible gap on sheet after collapse; default 5
  readonly style: 'zigzag';      // wave/double deferred to F3.1; field exists for forward compat
};
```

Invariant enforced at command time: `coordB > coordA`. If the user's two picks produce `coordA >= coordB`, the command throws `'invalid-band'` (see §10).

### 5.2 `breaks` field added to existing view types

```ts
// packages/shared/src/drawing/types.ts (modified)

export type BaseView = {
  readonly id: string;
  readonly kind: 'base';
  readonly positionMm: Vec2;
  readonly scale: ViewScale;
  readonly orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
  readonly breaks?: readonly BreakRegion[];  // NEW — absent = no breaks (treated as [])
  // rawProjection is populated iff `breaks.length > 0`.
  // Invariant: `rawProjection !== undefined` ⟺ `breaks.length > 0`.
  readonly rawProjection?: ProjectedGeometry;
};

export type ProjectedView = {
  readonly id: string;
  readonly kind: 'projected';
  readonly positionMm: Vec2;
  readonly baseViewId: string;
  readonly direction: 'top' | 'bottom' | 'left' | 'right';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
  readonly breaks?: readonly BreakRegion[];  // NEW
  // rawProjection is populated iff `breaks.length > 0`.
  // Invariant: `rawProjection !== undefined` ⟺ `breaks.length > 0`.
  readonly rawProjection?: ProjectedGeometry;
};

export type IsoView = {
  readonly id: string;
  readonly kind: 'iso';
  readonly positionMm: Vec2;
  readonly corner: 'NE' | 'NW' | 'SE' | 'SW';
  readonly scale: ViewScale;
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
  readonly breaks?: readonly BreakRegion[];  // NEW
  // rawProjection is populated iff `breaks.length > 0`.
  // Invariant: `rawProjection !== undefined` ⟺ `breaks.length > 0`.
  readonly rawProjection?: ProjectedGeometry;
};

// SectionView also gets the field for forward compat (F3.6 deferred):
export type SectionView = {
  // ... all existing fields ...
  readonly breaks?: readonly BreakRegion[];  // NEW — untested in v1
  // rawProjection is populated iff `breaks.length > 0`.
  // Invariant: `rawProjection !== undefined` ⟺ `breaks.length > 0`.
  readonly rawProjection?: ProjectedGeometry;
};
```

`DetailView` does NOT receive `breaks` in v1. Detail views are zoomed sub-regions; breaking a detail before/after the region would require region-relative coordinates and is deferred.

### 5.3 `Edge2D.kind` widened

**Before (F2 HEAD):**
```ts
// packages/shared/src/drawing/projectedGeometry.ts
export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
};
```

Note: `'hatch'` kind is added by F1 for `SectionView`'s `hatchSegments` but does NOT appear in `Edge2D` in the current codebase; hatch segments use the separate `HatchSegment` type. The existing union in `projectedGeometry.ts` is `'silhouette' | 'feature' | 'outline'`.

**After (F3):**
```ts
export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline' | 'break';  // 'break' is NEW
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
};
```

`kind: 'break'` is used exclusively for the synthetic zigzag polylines emitted by `applyBreaks`. These edges have no `sourceFaceIds`. Their `id` is `<viewId>_break_<breakId>_<side>` where `side` is `'lo'` (the break at `coordA`) or `'hi'` (the break at `coordB`, if two boundary symbols are emitted — v1 emits one symbol per break at the midpoint of the removed band projected to the kept side; see §8.3).

### 5.4 `ProjectFile` version bump

```ts
// packages/shared/src/fileFormat.ts (modified)
export const CURRENT_FORMAT_VERSION = 17 as const;
// formatVersion union: was 7|8|9|10|11|12|13|14|15|16; becomes 7|8|...|17
// migrations[16]: no-op pass-through (additive; breaks field absent on existing views)
```

---

## 6. Manifest migration — v16 → v17

### 6.1 Migration body

```ts
// packages/shared/src/fileFormat.ts (modified)
// v16 → v17: additive. Broken views store breaks[] on existing view types.
// No existing document contains breaks; absent field === [] at runtime.
16: (mIn) => {
  const m = deepClone(mIn);
  return { ...m, formatVersion: 17 };
},
```

### 6.2 Test files requiring cascade (all `toBe(16)` → `toBe(17)` and `CURRENT_FORMAT_VERSION` guards)

The following files contain `toBe(16)` or `CURRENT_FORMAT_VERSION` assertions that must be updated to `toBe(17)`:

```
packages/shared/src/__tests__/fileFormat.spec.ts
packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts
packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts
packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts
packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts
packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts
```

New file to add:

```
packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts
```

Two cases:
1. v16 drawing manifest with no `breaks` fields → v17 pass-through; no structural change.
2. v17 manifest with one `BaseView` carrying `breaks: [{ id, axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' }]` → round-trips through `JSON.parse(JSON.stringify(...))` intact.

---

## 7. `applyBreaks` algorithm

### 7.1 Module signature

```ts
// packages/shared/src/drawing/applyBreaks.ts (new file)

import type { Edge2D } from './projectedGeometry';
import type { BreakRegion } from './types';

export type ApplyBreaksResult = {
  readonly edges: readonly Edge2D[];             // geometry edges (surviving + translated)
  readonly breakSymbolEdges: readonly Edge2D[];  // synthetic zigzag edges, kind: 'break'
};

/**
 * Pure function. No I/O, no side effects, deterministic.
 * Applies a sequence of BreakRegion strip removals to Edge2D arrays.
 * Breaks must be applied in ascending coordA order (caller is responsible for sorting).
 * Returns compressed geometry edges and synthetic break-symbol edges.
 */
export function applyBreaks(
  edges: readonly Edge2D[],
  breaks: readonly BreakRegion[],
  viewBbox: { minX: number; minY: number; maxX: number; maxY: number },
): ApplyBreaksResult;
```

### 7.2 Per-break processing (one pass per `BreakRegion`)

For each `BreakRegion` (processed in ascending `coordA` order, with cumulative translation accumulator):

**Step 1 — Clip geometry against the removed band:**

For each edge, classify each polyline segment `[p0, p1]` via 1D Liang-Barsky along `axis`:

- Segment entirely before band (`max(p0[axis], p1[axis]) < coordA`): keep, emit unchanged.
- Segment entirely after band (`min(p0[axis], p1[axis]) > coordB`): keep, but mark for translation.
- Segment entirely inside band: drop.
- Segment crossing `coordA` from before → inside: clip at `coordA`; keep before portion.
- Segment crossing `coordB` from inside → after: clip at `coordB`; keep after portion, mark for translation.
- Segment spanning full band (enters before, exits after): clip to produce two segments — before portion (keep) and after portion (mark for translation).

**Step 2 — Translate "after" fragments:**

For each segment or edge flagged for translation, shift it along `axis` by:

```
shift = −(coordB − coordA − gapMm)
```

This collapses the removed band to `gapMm` visible gap. Cumulative shifts: for N breaks applied in order, each subsequent break's `coordA` and `coordB` are in the **original** edge coordinate space (pre-all-breaks). The cumulative shift applied to "after" portions of break `k` is the sum of all shifts from breaks `1..k`.

**Step 3 — Edge id stability:**

- Edge entirely in "before" zone: id unchanged.
- Edge entirely in "after" zone: id unchanged (translation does not split).
- Edge clipped at `coordA` only (before portion): suffix `_a`.
- Edge clipped at `coordB` only (after portion): suffix `_b`.
- Edge spanning the band (both portions survive): `_a` for the before portion, `_b` for the after portion.
- Edge fully inside the band: dropped. Dimension `PointRef`s referencing dropped edge ids are already handled by the existing stale-dimension infrastructure.

**Step 4 — Emit zigzag break symbol:**

Emit one `Edge2D { kind: 'break' }` per break per side (v1: one symbol at the break line boundary after compression). The break symbol is positioned at the **after-translation** coordinate of `coordA` along `axis`, and spans the perpendicular extent of the `viewBbox` plus 5 mm overhang on each side.

Zigzag geometry (sheet coords, pre-`ViewElement` `scale()` transform):
- Direction: perpendicular to `axis` (e.g., for `axis: 'x'`, the zigzag runs along Y).
- Span: `perpMin = viewBbox.perpMin − 5`, `perpMax = viewBbox.perpMax + 5` where `perpMin/perpMax` are `minY/maxY` for `axis: 'x'` and `minX/maxX` for `axis: 'y'`.
- Amplitude: `1.5 mm` (half-peak to half-peak: 0.75 mm each side of the spine).
- Period: `3.0 mm`.
- Pattern: standard sawtooth — for each period, four points form one zigzag tooth:

```
spine_pos = coordA (after cumulative translation)

For i in range(0, floor((perpMax - perpMin) / period) + 1):
  t0 = perpMin + i * period
  t1 = t0 + period * 0.25
  t2 = t0 + period * 0.75
  t3 = t0 + period

  For axis 'x' (zigzag runs along Y):
    points: [(spine_pos, t0), (spine_pos + 1.5, t1), (spine_pos − 1.5, t2), (spine_pos, t3)]
  For axis 'y' (zigzag runs along X):
    points: [(t0, spine_pos), (t1, spine_pos + 1.5), (t2, spine_pos − 1.5), (t3, spine_pos)]
```

All points are clamped to [perpMin, perpMax] so the symbol does not exceed the view bbox + overhang.

Break symbol edge id: `<viewId>_break_<breakId>`.

`breakSymbolEdges` accumulates one entry per break (regardless of how many geometry edges are affected).

### 7.3 Multiple breaks — cumulative translation

When N breaks are applied in ascending `coordA` order:

- Process breaks in sorted order: sort by `coordA` ascending before the loop.
- Maintain a running `cumulativeShift: Record<'x'|'y', number>` initialized to `{ x: 0, y: 0 }`.
- After processing break `k`, add its shift to the accumulator: `cumulativeShift[k.axis] += k.coordB − k.coordA − k.gapMm`.
- Breaks on different axes (one x, one y) accumulate independently. The translation applied to an "after-x" edge is `{ x: cumulativeShiftX, y: 0 }` and vice versa for y.
- Break symbol position: `coordA + cumulativeShift[axis]` at the time break `k` is processed (i.e., after breaks 1..k-1 have been accumulated, but before break k's own shift is applied).

### 7.4 Edge cases (implementer must cover all)

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Zero-length edge (`p0 === p1`) | Classify by point position; if inside band → drop; otherwise keep as-is |
| 2 | Edge entirely before band | Emit unchanged, id unchanged |
| 3 | Edge entirely after band | Emit translated, id unchanged |
| 4 | Edge entirely inside band | Drop completely |
| 5 | Edge tangent to `coordA` (exactly on boundary) | Treat as "before"; keep with id unchanged (1e-9 tolerance) |
| 6 | Edge tangent to `coordB` (exactly on boundary) | Treat as "before translated" start; keep with id unchanged |
| 7 | Edge crosses only `coordA` | Before fragment `_a`; after-of-coordA portion dropped |
| 8 | Edge crosses only `coordB` | Inside portion dropped; after fragment `_b` (translated) |
| 9 | Edge spans full band | Both `_a` (before) and `_b` (after, translated) survive |
| 10 | `axis: 'y'` break on horizontal edge | Analogous to cases 2–9 with y-coord comparison |
| 11 | Two breaks on same axis | Sequential application; cumulative shift; both symbols emitted |
| 12 | Two breaks on different axes (x and y) | Independent shifts; both symbols emitted; geometry translated correctly on both axes |
| 13 | `gapMm > (coordB − coordA)` | Result: "after" fragments are pushed further right than the gap; this is user error — command validates `coordB > coordA` but does not validate `gapMm < coordB − coordA`; documented behavior |
| 14 | Empty edges array input | Returns `{ edges: [], breakSymbolEdges: [<one symbol per break>] }` |

### 7.5 TDD test cases (mandatory table for implementer)

The implementer must write exactly these test cases (file: `packages/shared/src/drawing/__tests__/applyBreaks.spec.ts`) before implementing `applyBreaks`:

| Test id | Input | Assert |
|---|---|---|
| AB-1 | Single horizontal edge `[(0,0), (200,0)]`, one x-break `coordA=50, coordB=150, gapMm=5` | `edges` has 2 fragments: `[(0,0),(50,0)]` id `<id>_a`; `[(55,0),(105,0)]` id `<id>_b` (after-coord=150, shift=−95, so 150−95=55; 200−95=105); `breakSymbolEdges.length === 1` |
| AB-2 | Edge entirely before band `[(0,0),(40,0)]`, x-break `coordA=50, coordB=100` | `edges` has 1 fragment; id unchanged; no translation |
| AB-3 | Edge entirely after band `[(120,0),(200,0)]`, x-break `coordA=50, coordB=100, gapMm=5` | `edges` has 1 fragment; id unchanged; x translated by −45 → `[(75,0),(155,0)]` |
| AB-4 | Edge entirely inside band `[(60,0),(90,0)]`, x-break `coordA=50, coordB=100` | `edges` is empty |
| AB-5 | Edge tangent to `coordA`: `[(50,0),(50,10)]` (vertical edge at x=50), x-break `coordA=50, coordB=100` | Edge entirely at boundary; treat as "before"; keep with id unchanged |
| AB-6 | Two breaks same axis: `coordA1=50, coordB1=100, gapMm=5`; `coordA2=200, coordB2=300, gapMm=5`. Edge `[(0,0),(350,0)]` | 3 surviving fragments; cumulative shift after break 1 = −45; break 2 adjusted position = 200 in original space → after cumulative: break 2 symbol at `200 + (−45) = 155`; after-break-2 shift = −(300−200−5) = −95; total shift on last fragment = −45+(−95) = −140; fragment `[(305,0),(350,0)]` → `[(165,0),(210,0)]` |
| AB-7 | y-axis break `coordA=30, coordB=80, gapMm=5` on vertical edge `[(0,0),(0,200)]` | Analogous to AB-1 with y coords |
| AB-8 | Empty edges array | `edges: []`, `breakSymbolEdges.length === 1` (symbol still emitted) |
| AB-9 | Break symbol geometry: `axis: 'x'`, `coordA=100, coordB=200, gapMm=5`, `viewBbox = {minX:0,minY:0,maxX:300,maxY:60}` | Symbol points: spine at x=105 (after shift of −95 applied to break at 100); perpendicular span Y ∈ [−5, 65]; has sawtooth pattern; point count = 4 × floor(70/3) + 1 or equivalent |
| AB-10 | Edge crossing band on y-axis with `showHidden` edges array also passed | Both visible and hidden edge arrays processed independently; same id-stability rules apply |

---

## 8. Fingerprint extension

### 8.1 Extended `fingerprintBreaksArray`

Added to `packages/shared/src/drawing/fingerprint.ts`:

```ts
/**
 * Synchronous djb2 fingerprint contribution for a BreakRegion array.
 * Encodes axis, coordA, coordB, gapMm, style for each break, sorted by coordA ascending.
 * Matches fingerprintDetailView's pipe-separated, 1e-3mm convention.
 */
export function fingerprintBreaksArray(breaks: readonly BreakRegion[]): string {
  const sorted = [...breaks].sort((a, b) => a.coordA - b.coordA);
  const payload = sorted.map(b =>
    [b.axis, b.coordA.toFixed(3), b.coordB.toFixed(3), b.gapMm.toFixed(3), b.style].join('|')
  ).join(';');
  return djb2(payload);  // reuse existing internal djb2()
}
```

### 8.2 Augmenting `inputFingerprint` on `BaseView | ProjectedView | IsoView`

The existing `inputFingerprint` computation for these view kinds incorporates geometry source state. After F3, it must also incorporate the `breaks` array. The existing fingerprint computation location is inside `AddBreakCommand.apply` and `RegenerateViewCommand`:

```ts
// Pseudo-code for the new fingerprint encoding used in AddBreakCommand and RegenerateViewCommand:
const breaksFp = fingerprintBreaksArray(view.breaks ?? []);
const newFingerprint = djb2([existingGeometryFingerprint, breaksFp].join('|'));
```

Exact implementation: `AddBreakCommand.apply` recomputes `inputFingerprint` as:
```
djb2(<prior inputFingerprint> + '|' + fingerprintBreaksArray(newBreaksArray))
```

`DeleteBreakCommand.apply` recalculates the same way on the post-deletion breaks array.

When source geometry changes (view becomes stale via existing infrastructure), the user regenerates the view. `RegenerateViewCommand` re-runs the full `applyBreaks` pipeline and recomputes `inputFingerprint` incorporating the current `view.breaks`.

### 8.3 Stale-banner semantics

The stale banner (`isStale` in `ViewElement`) appears when the stored `view.inputFingerprint` does not match the freshly computed fingerprint of (source geometry fingerprint + breaks array). This correctly fires when:
- Source geometry changes (existing behavior).
- A break's `coordA/coordB/gapMm/style` changes (if editing were possible; not in v1).
- A new break is added (AddBreakCommand recomputes and stores the new fingerprint, so immediately after the command the view is NOT stale — the fingerprint is fresh).

---

## 9. `applyBreaks` integration — where it runs

`applyBreaks` is called in **exactly two places**:

1. **`AddBreakCommand.apply`** — Behaviour depends on whether the view already has breaks:
   - **First break** (`view.breaks ?? []` is empty): snapshot the current `view.projection` into `view.rawProjection` BEFORE running `applyBreaks`. Both `rawProjection` (the snapshot) and the new `projection` (post-`applyBreaks`) are committed atomically to the store.
   - **Subsequent break** (`view.breaks.length >= 1`): `rawProjection` is already populated; call `applyBreaks(view.rawProjection.visibleEdges, [...view.breaks, newBreak], view.rawProjection.bbox)` and replace `view.projection`. `rawProjection` is unchanged.

2. **`DeleteBreakCommand.apply`** — Behaviour depends on how many breaks remain after removal:
   - **Removing one of N breaks where N >= 2:** call `applyBreaks(view.rawProjection.visibleEdges, remaining, view.rawProjection.bbox)` and replace `view.projection`. `rawProjection` unchanged.
   - **Removing the last break (N == 1):** restore `view.projection = view.rawProjection` (structural copy) and **clear `view.rawProjection` to `undefined`**. The view returns to un-broken state.

3. **`RegenerateViewCommand`** (kernel re-projection): set the freshly-projected geometry as `view.projection`. If `view.breaks.length > 0`: also store the fresh kernel output as `view.rawProjection`, then call `applyBreaks(view.rawProjection.visibleEdges, view.breaks, view.rawProjection.bbox)` and replace `view.projection` with the result. If `view.breaks.length === 0`: `view.rawProjection` stays `undefined`.

### 9.1 `rawProjection` field — α-conditional storage policy

**Invariant: `view.rawProjection !== undefined` ⟺ `view.breaks.length > 0`.** Un-broken views never carry `rawProjection`. Every command path must preserve this invariant.

Rationale: without `rawProjection`, `DeleteBreakCommand` cannot reconstruct the pre-break geometry without re-running the kernel projector. Storing it only when breaks are active keeps the field semantically meaningful and avoids carrying stale geometry on views that have no breaks.

| `breaks` state | `rawProjection` | `projection` |
|---|---|---|
| `breaks.length === 0` | `undefined` | post-projection edges (no breaks applied) |
| `breaks.length >= 1` | post-projection edges, no breaks applied | post-projection + `applyBreaks` output |

Transition rules:
- **First break added:** snapshot `view.projection` → `view.rawProjection`, then replace `view.projection` with `applyBreaks` result.
- **Last break removed:** restore `view.projection = view.rawProjection`, then clear `view.rawProjection = undefined`.

---

## 10. Commands

### 10.1 `AddBreakCommand`

File: `packages/app/src/commands/AddBreakCommand.ts` (new)

```ts
export type AddBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  axis: 'x' | 'y';
  coordA: number;   // view-local mm, pre-scale
  coordB: number;   // view-local mm, pre-scale; must be > coordA
  gapMm?: number;   // default 5
};

export class AddBreakCommand implements Command {
  readonly name = 'AddBreak';
  private breakId: string | null = null;

  constructor(private readonly opts: AddBreakOpts) {}

  async apply(): Promise<void> {
    // 1. Resolve sheet + view.
    // 2. Validate view kind: must be 'base' | 'projected' | 'iso'.
    //    If 'section' | 'detail': throw new Error('view-not-breakable')
    // 3. Validate band: if coordB <= coordA: throw new Error('invalid-band')
    // 4. Validate no overlap: for each existing break with same axis,
    //    if ranges [coordA, coordB] and [existing.coordA, existing.coordB] overlap:
    //    throw new Error('overlapping-break')
    //    Overlap check: max(coordA, existing.coordA) < min(coordB, existing.coordB)
    // 5. Require projection populated: if !view.projection:
    //    throw new Error('view-projection-missing')
    //    (For the first break, the source is view.projection, not view.rawProjection.)
    // 6. Build BreakRegion: { id: crypto.randomUUID(), axis, coordA, coordB, gapMm: opts.gapMm ?? 5, style: 'zigzag' }
    // 7. Detect first-break: prev = view.breaks ?? []; isFirst = prev.length === 0
    // 8. If isFirst: capture rawProjection = view.projection (snapshot before breaks).
    //    Else: rawProjection = view.rawProjection (already populated; unchanged).
    // 9. Compose new breaks array: [...prev, newBreak]
    // 10. Call applyBreaks(rawProjection.visibleEdges, newBreaks, rawProjection.bbox)
    //     Also call applyBreaks for hiddenEdges if view.showHidden is true.
    // 11. Build new projection: { ...rawProjection, visibleEdges: [...result.edges, ...result.breakSymbolEdges] }
    //     Hidden edges: applyBreaks result.edges only (break symbols are always visible).
    // 12. Compute new inputFingerprint: djb2(view.inputFingerprint + '|' + fingerprintBreaksArray(newBreaks))
    // 13. Mutate view atomically: set breaks = newBreaks, rawProjection (if first break), projection = newProjection, inputFingerprint.
    //     α-conditional invariant: after apply, rawProjection !== undefined (breaks.length >= 1).
    // 14. Persist via useAppStore state update (same pattern as AddDetailViewCommand).
  }

  async revert(): Promise<void> {
    // 1. Resolve view.
    // 2. Remove the BreakRegion with id === this.breakId from view.breaks.
    //    remainingBreaks = view.breaks.filter(b => b.id !== this.breakId)
    // 3. If remainingBreaks.length === 0 (reverting the first-and-only break):
    //    restore view.projection = view.rawProjection (break symbols gone).
    //    clear view.rawProjection = undefined. (α-conditional: no breaks → no rawProjection)
    // 4. Else: re-apply applyBreaks(view.rawProjection.visibleEdges, remainingBreaks, ...) → new projection.
    //    rawProjection unchanged.
    // 5. Recompute inputFingerprint.
    // 6. Mutate view in store.
    // Note: breakId is null if apply() threw; revert() is a no-op in that case.
  }
}
```

### 10.2 `DeleteBreakCommand`

File: `packages/app/src/commands/DeleteBreakCommand.ts` (new)

```ts
export type DeleteBreakOpts = {
  drawingId: string;
  sheetId: string;
  viewId: string;
  breakId: string;
};

export class DeleteBreakCommand implements Command {
  readonly name = 'DeleteBreak';
  private deletedBreak: BreakRegion | null = null;

  constructor(private readonly opts: DeleteBreakOpts) {}

  async apply(): Promise<void> {
    // 1. Resolve view.
    // 2. Find break by breakId. If not found: throw new Error('break-not-found')
    // 3. Validate α-conditional invariant: if !view.rawProjection:
    //    throw new Error('view-projection-missing')
    //    (rawProjection must exist whenever breaks exist; absence indicates corrupted state)
    // 4. Stash deletedBreak AND savedRawProjection = view.rawProjection for revert.
    // 5. Remove from view.breaks: remaining = view.breaks.filter(b => b.id !== breakId)
    // 6. If remaining.length === 0 (last break removed):
    //    restore view.projection = view.rawProjection (structural copy, no break symbols).
    //    clear view.rawProjection = undefined. (α-conditional: no breaks → no rawProjection)
    //    Store view.breaks as [] (not undefined).
    // 7. Else (N >= 2 → N-1 breaks):
    //    re-apply applyBreaks(view.rawProjection.visibleEdges, remaining, view.rawProjection.bbox) → new projection.
    //    rawProjection unchanged.
    //    Store view.breaks as remaining.
    // 8. Recompute inputFingerprint.
    // 9. Persist via useAppStore state update.
  }

  async revert(): Promise<void> {
    // 1. Re-insert deletedBreak into view.breaks.
    //    If this transitions breaks from 0 → 1 (i.e., the deleted break was the last one):
    //    restore view.rawProjection = this.savedRawProjection (the snapshot captured in apply).
    //    (α-conditional: transitions from 0 breaks → rawProjection must be restored)
    // 2. Re-apply applyBreaks(view.rawProjection.visibleEdges, restoredBreaks, ...) → new projection.
    // 3. Recompute fingerprint.
    // 4. Persist via useAppStore state update.
  }
}
```

### 10.3 Error cases (exact thrown message strings)

| Error string | When thrown |
|---|---|
| `'view-not-found'` | `viewId` not in `sheet.views` |
| `'view-not-breakable'` | view.kind is `'section'` or `'detail'` |
| `'view-projection-missing'` | **`AddBreakCommand`**: `view.projection === undefined` (view never projected). For a first break, the source is `view.projection`, not `view.rawProjection`. **`DeleteBreakCommand`**: `view.rawProjection === undefined` (corrupted state — the α-conditional invariant requires `rawProjection` to be set when `breaks.length > 0`). |
| `'invalid-band'` | `coordB <= coordA` |
| `'overlapping-break'` | New band overlaps an existing break on the same axis |
| `'break-not-found'` | `DeleteBreakCommand`: breakId not in view.breaks |

User-facing toast messages:
- `'view-not-found'` → "Cannot add break: view not found."
- `'view-not-breakable'` → "Cannot add break: select a base, projected, or iso view."
- `'view-projection-missing'` → "Cannot add break: regenerate the view first."
- `'invalid-band'` → "Cannot add break: click two distinct points along the axis."
- `'overlapping-break'` → "Cannot add break: this band overlaps an existing break."

### 10.4 `RegenerateViewCommand` extension

```ts
// packages/app/src/commands/RegenerateViewCommand.ts (modified)
// After re-projecting the view — newRawProjection is the fresh kernel output:
const rawProj = newRawProjection;
const currentBreaks = view.breaks ?? [];
if (currentBreaks.length > 0) {
  // α-conditional: breaks exist → rawProjection must be populated.
  // Store the fresh kernel output as rawProjection, then apply breaks.
  const { edges: vis, breakSymbolEdges } = applyBreaks(
    rawProj.visibleEdges, currentBreaks, rawProj.bbox
  );
  const { edges: hid } = applyBreaks(rawProj.hiddenEdges, currentBreaks, rawProj.bbox);
  newProjection = {
    ...rawProj,
    visibleEdges: [...vis, ...breakSymbolEdges],
    hiddenEdges: hid,
  };
  // Commit: view.rawProjection = rawProj; view.projection = newProjection.
} else {
  // α-conditional: no breaks → rawProjection stays undefined.
  newProjection = rawProj;
  // Commit: view.rawProjection = undefined; view.projection = newProjection.
}
// Recompute inputFingerprint incorporating current breaks array.
```

---

## 11. Tool mode

### 11.1 `BreakToolState` discriminated union

```ts
// packages/app/src/drawing/toolMode.ts (modified)

export type ToolMode =
  | 'idle'
  | 'placeBase' | 'placeProjected' | 'placeIso'
  | 'addLinearH' | 'addLinearV' | 'addAligned' | 'addRadial' | 'addDiametric'
  | 'addCenterline' | 'addCenterMark' | 'addLeader' | 'addBalloon'
  | 'section'
  | 'detail'
  | 'break';   // NEW

export type BreakToolState =
  | { stage: 'idle' }
  | { stage: 'pickParent' }   // break mode entered; waiting for user to click a view
  | { stage: 'pickAxis'; viewId: string }   // parent selected; user picks axis interactively
  | { stage: 'pickP0'; viewId: string; axis: 'x' | 'y' }
  | { stage: 'pickP1'; viewId: string; axis: 'x' | 'y'; coordA: number };
  // Note: 'pickAxis' stage uses the AddBreakDialog to collect axis (see §12.3)
```

### 11.2 Store additions

```ts
// packages/app/src/drawing/toolMode.ts (modified)
interface ToolModeState {
  // ... existing fields (mode, pendingViewParams, sectionState, detailState) ...
  breakState: BreakToolState;

  enterBreakMode(): void;
  breakPickParent(viewId: string): void;
  breakSetAxis(axis: 'x' | 'y'): void;
  breakPickP0(coord: number): void;    // coord along the chosen axis in view-local mm
  breakPickP1(coord: number, onDispatch: (coordA: number, coordB: number) => void): void;
  breakCancel(): void;
}
```

### 11.3 Stage transition table

| From stage | Action | To stage | Notes |
|---|---|---|---|
| `idle` (mode=break) | `enterBreakMode()` | `pickParent` | Status bar: "Click a base, projected, or iso view to add a break." |
| `pickParent` | click on `base/projected/iso` view | `pickAxis` | Opens `AddBreakDialog` to choose axis |
| `pickParent` | click on `section/detail` view | `pickParent` (unchanged) | Show toast: "Select a base, projected, or iso view." |
| `pickAxis` | user confirms axis in dialog | `pickP0` | Status bar: "Click to set break start (coord along {axis} axis)." |
| `pickAxis` | user dismisses dialog | `pickParent` | Back to parent selection |
| `pickP0` | canvas click | `pickP1` | Records `coordA` (the axis coordinate of click, extracted from canvas hit); status bar: "Click to set break end." |
| `pickP1` | canvas click | `idle` (mode=idle) | If valid (coord ≠ coordA): dispatch `AddBreakCommand`; if same as coordA: show toast and stay in `pickP1` |
| Any stage | ESC | back one stage | `pickP1` → `pickP0`; `pickP0` → `pickAxis`; `pickAxis` → `pickParent`; `pickParent` → `idle` (exits mode) |

Double-ESC behavior: each ESC backs up exactly one stage. From `pickParent`, ESC exits break mode to `idle` entirely (matches `detail`/`section` pattern).

### 11.4 Coordinate extraction from canvas click

Canvas click provides a `Vec2` in sheet mm. To extract the `axis`-aligned coordinate in view-local mm:

```ts
function sheetToViewLocal(sheetPt: Vec2, view: { positionMm: Vec2; scale: ViewScale }): Vec2 {
  const s = view.scale.numerator / view.scale.denominator;
  return {
    x: (sheetPt.x - view.positionMm.x) / s,
    y: (sheetPt.y - view.positionMm.y) / s,
  };
}
// Then: coord = viewLocalPt[state.axis]
```

---

## 12. UI components

### 12.1 `DrawingCanvas` break-mode click dispatch

Mirroring `detail` mode click dispatch in `DrawingCanvas.tsx`:

```ts
if (mode === 'break') {
  switch (breakState.stage) {
    case 'pickParent': {
      const hit = hitTestViews(sheetPt, sheet.views);
      if (!hit) break;
      if (hit.kind === 'section' || hit.kind === 'detail') {
        showToast('Select a base, projected, or iso view.');
      } else {
        breakPickParent(hit.id);
        setAddBreakDialogOpen(true);  // opens axis picker dialog
      }
      break;
    }
    case 'pickP0': {
      const viewLocalPt = sheetToViewLocal(sheetPt, parentView);
      breakPickP0(viewLocalPt[breakState.axis]);
      break;
    }
    case 'pickP1': {
      const viewLocalPt = sheetToViewLocal(sheetPt, parentView);
      breakPickP1(viewLocalPt[breakState.axis], (coordA, coordB) => {
        bus.execute(new AddBreakCommand({
          drawingId,
          sheetId,
          viewId: breakState.viewId,
          axis: breakState.axis,
          coordA,
          coordB,
          gapMm: 5,
        }));
      });
      break;
    }
  }
}
```

### 12.2 `ViewElement` break-symbol rendering

```tsx
// packages/app/src/drawing/ViewElement.tsx (modified)
// Inside the visible edges rendering group, add a kind-aware stroke:

{proj?.visibleEdges.map((e) => {
  if (e.kind === 'break') {
    return (
      <polyline
        key={e.id}
        data-edge-id={e.id}
        data-view-id={view.id}
        data-role="break-symbol"
        points={pointsAttr(e.points)}
        stroke="#111111"
        strokeWidth="0.5"   // heavy line; heavier than visible edges (0.35)
        fill="none"
      />
    );
  }
  return (
    <polyline
      key={e.id}
      data-edge-id={e.id}
      data-view-id={view.id}
      points={pointsAttr(e.points)}
      stroke="#111111"
      strokeWidth="0.35"
      fill="none"
    />
  );
})}
```

Break symbols are emitted as part of `proj.visibleEdges` (with `kind: 'break'`), so they automatically appear in the existing rendering loop. The only change is the kind-aware stroke-width and `data-role`.

Hidden-edge rendering loop does NOT include `kind: 'break'` edges (they are only in `visibleEdges`).

### 12.3 `AddBreakDialog` (axis picker only)

File: `packages/app/src/drawing/AddBreakDialog.tsx` (new)

```tsx
// Minimal dialog: two buttons "Horizontal break (remove X band)" / "Vertical break (remove Y band)".
// Props: open: boolean; onConfirm: (axis: 'x' | 'y') => void; onCancel: () => void
// Width: 260 px. Title: "Choose break direction".
// No coordinate inputs — coordinates come from canvas picks (§11.4).
```

### 12.4 Ribbon button

```
// packages/app/src/shell/tabs/DrawingTab.tsx (modified)
// Place Views panel (after "Detail", before "Add Iso"):
//   Base View  |  Projected View  |  Section  |  Detail  |  Add Break  |  Add Iso
```

"Add Break" uses a `<Scissors>` or `<ChevronsLeftRight>` Lucide icon (pick whichever exists in the codebase's current Lucide set). Button is disabled when no breakable view on the active sheet has a populated `projection` (nothing to break). Note: the check is against `view.projection`, not `view.rawProjection` — under the α-conditional policy `rawProjection` is absent on un-broken views, so `projection` is the correct sentinel.

### 12.5 `DrawingTreePane` — no new row

Breaks are listed **within** the existing view row via a subordinate indicator, not as standalone tree children. When a view has `breaks.length > 0`, its tree label gains a `· [N break(s)]` suffix. Example:

```
├── Views
│   ├── Base — Front · 1:1 · [2 breaks]   ← no child rows
│   ├── Projected — Right (from Base) · 1:1
│   └── Iso — NE · 1:1
```

No right-click → "Add Break" from the tree (breaks are added via the ribbon). Right-click → "Remove All Breaks" is deferred to F3.2.

---

## 13. Export deltas

### 13.1 SVG render (`renderDrawingSvg.ts`)

No changes to `renderDrawingSvg.ts` — break symbol edges are already baked into `view.projection.visibleEdges`. The only delta in the SVG output is the `data-role="break-symbol"` attribute and `strokeWidth="0.5"` on break-kind polylines, which come from `ViewElement`'s render branch.

Exact attribute on break-symbol SVG elements:
```
data-role="break-symbol"
stroke="#111111"
stroke-width="0.5"
fill="none"
```

### 13.2 PDF render (`renderDrawingPdf.ts`)

No changes required. The jsPDF path consumes `visibleEdges` uniformly. Break symbol polylines render as heavy lines automatically via `strokeWidth: 0.5`.

### 13.3 PNG render (`renderDrawingPngForSheet.ts`)

No changes. Delegates to SVG renderer; break symbols appear automatically.

---

## 14. E2E spec — T-6-9

File: `tests/e2e/drawing/T-6-9-broken-view.spec.ts` (new)

### 14.1 Preconditions

- A `BaseView` (front orientation, scale 1:1) exists in the active sheet with a populated `projection` containing at least one edge spanning x-coordinates 0..400 in view-local mm.
- Inject via store (matching T-6-7/T-6-8 pattern): create a synthetic view with a long horizontal edge `[(0,0),(400,0)]`, bbox `{minX:0,minY:−5,maxX:400,maxY:5}`, stored with `breaks: undefined` (or `[]`) and `rawProjection: undefined`. Test asserts that after dispatch of the first `AddBreakCommand`, `rawProjection !== undefined && rawProjection.visibleEdges.length > 0`. This verifies the α-conditional first-break snapshot.

### 14.2 Dispatch sequence

```ts
// Store-injection approach (no real canvas clicks needed):
bus.execute(new AddBreakCommand({
  drawingId,
  sheetId,
  viewId: injectedViewId,
  axis: 'x',
  coordA: 150,
  coordB: 250,
  gapMm: 5,
}));
```

### 14.3 Assertion list (5 required)

1. **Bbox shrunk along x:** After `AddBreakCommand`, retrieve the view from store. `view.projection.bbox.maxX − view.projection.bbox.minX` should be approximately `400 − (250−150−5) = 400 − 95 = 305` (±2 mm tolerance).
2. **Break symbol present:** `view.projection.visibleEdges` contains at least one `Edge2D` with `kind: 'break'`. The SVG rendered contains at least one `<polyline data-role="break-symbol">`.
3. **Undo restores original bbox:** After `Ctrl+Z`, `view.projection.bbox.maxX − view.projection.bbox.minX ≈ 400`.
4. **Redo re-applies break:** After `Ctrl+Y`, bbox shrunk again; `data-role="break-symbol"` present.
5. **α-conditional invariant survives redo of last-break delete:** After `Ctrl+Z` (undo AddBreak) followed by the view reaching `breaks.length === 0`, assert `view.rawProjection === undefined`. This verifies that undoing the sole break correctly clears `rawProjection` and does not leave stale geometry.

---

## 15. Perf spec

File: `tests/perf/drawing-broken.perf.spec.ts` (new)

### 15.1 Probe location

```ts
// packages/app/src/App.tsx (modified — mirrors __zilventorDetailViewMs pattern)
// Expose __zilventorBrokenViewMs on window:
(window as any).__zilventorBrokenViewMs = (n: number) => {
  const edges: Edge2D[] = generateFixtureEdges(1000);  // 1k synthetic edges
  const breaks: BreakRegion[] = [
    { id: 'b1', axis: 'x', coordA: 100, coordB: 300, gapMm: 5, style: 'zigzag' },
  ];
  const bbox = { minX: 0, minY: 0, maxX: 1000, maxY: 100 };
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    applyBreaks(edges, breaks, bbox);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { p95ms: samples[Math.floor(samples.length * 0.95)]! };
};
```

### 15.2 Fixture shape

1000 synthetic `Edge2D` objects, each a 2-point horizontal segment randomly distributed across x ∈ [0, 1000], y ∈ [0, 100]. All `kind: 'silhouette'`.

### 15.3 Budget

`p95 < 50 ms` on the 1k-edge fixture with a single x-axis break. Rationale: applyBreaks is O(edges × segments) 1D clipping — for 1k edges, expected < 1 ms; 50 ms matches the F2 detail-view budget and provides ~50× headroom.

---

## 16. Implementer batch plan

### Batch 1 — Types, migration, `rawProjection` field — α-conditional policy (green gate: typecheck + migration tests)

Tasks:
- Add `BreakRegion` type to `packages/shared/src/drawing/types.ts`.
- Add `breaks?: readonly BreakRegion[]` and `rawProjection?: ProjectedGeometry` to `BaseView`, `ProjectedView`, `IsoView`, `SectionView`. **Important:** `rawProjection` is populated iff `breaks.length > 0` (α-conditional invariant: `rawProjection !== undefined` ⟺ `breaks.length > 0`). Do NOT populate `rawProjection` on views with no breaks — that would violate the invariant and cause `DeleteBreakCommand` to misfire.
- Widen `Edge2D.kind` to include `'break'` in `packages/shared/src/drawing/projectedGeometry.ts`.
- Bump `CURRENT_FORMAT_VERSION` to `17`; add `migrations[16]` no-op in `fileFormat.ts`.
- Add `ProjectFile` union arm `| 17`.
- Cascade all `toBe(16)` → `toBe(17)` in the 8 existing migration test files + `fileFormat.spec.ts`.
- Create `migrateManifest-v16-to-v17.spec.ts` (2 cases per §6.2).
- Add `fingerprintBreaksArray` to `packages/shared/src/drawing/fingerprint.ts`.
- Create `__tests__/fingerprintBreaksArray.spec.ts` (3 cases: empty array, single break, two breaks sorted).
- Green gate: `pnpm -r typecheck` + all migration specs pass.

### Batch 2 — `applyBreaks` (TDD: red→green on all AB-1..AB-10)

Tasks:
- Write all 10 test stubs in `packages/shared/src/drawing/__tests__/applyBreaks.spec.ts` first (they must fail).
- Implement `applyBreaks.ts` making AB-1..AB-10 green one at a time.
- Implement zigzag generator as a pure helper `buildZigzag(axis, spineCoord, perpMin, perpMax, amplitude, period)`.
- Confirm no regressions in existing shared tests.
- Green gate: all 10 AB cases + existing shared suite.

### Batch 3 — Commands (TDD: AddBreakCommand + DeleteBreakCommand)

Tasks:
- Write failing tests for `AddBreakCommand` (5 error cases + 3 happy-path cases) in `__tests__/AddBreakCommand.spec.ts`.
- Implement `AddBreakCommand.ts`.
- Write failing tests for `DeleteBreakCommand` in `__tests__/DeleteBreakCommand.spec.ts`.
- Implement `DeleteBreakCommand.ts`.
- Extend `RegenerateViewCommand.ts` with the post-projection `applyBreaks` call.
- Green gate: all command tests pass.

### Batch 4 — Tool mode + UI + ribbon (Playwright screenshot proof)

Tasks:
- Add `'break'` mode and `BreakToolState` to `toolMode.ts`; add all store actions.
- Add `AddBreakDialog.tsx`.
- Extend `DrawingCanvas.tsx` with break-mode click dispatch.
- Extend `ViewElement.tsx` with `kind: 'break'` stroke branch.
- Add ribbon "Add Break" button to `DrawingTab.tsx` (after "Detail").
- Extend `DrawingTreePane.tsx` with `· [N break(s)]` suffix on view label.
- Run Playwright: render a view with one injected break, take screenshot, confirm `data-role="break-symbol"` polyline is visible.
- Green gate: typecheck + app unit tests + screenshot proof.

### Batch 5 — E2E (T-6-9) + perf + self-review fixes

Tasks:
- Write `T-6-9-broken-view.spec.ts` (4 assertions per §14.3).
- Write `drawing-broken.perf.spec.ts` (p95 < 50 ms per §15).
- Expose `__zilventorBrokenViewMs` probe in `App.tsx`.
- Run full suite: `pnpm -r test`, `pnpm -r typecheck`.
- Fix any regressions found.
- Green gate: T-6-9 green, perf p95 < 50 ms, full suite green.

---

## 17. Deferred F3.1–F3.9

| ID | Title | Rationale for deferral |
|---|---|---|
| F3.1 | Wave + double-straight break styles | Only zigzag needed for ANSI compliance in furniture CAD; style field on DTO is reserved |
| F3.2 | `EditBreakCommand` drag handles | No drag infrastructure for view properties; requires new interaction layer |
| F3.3 | True-length dimension compensation | Dimension text showing compressed length is documented known limitation; fix requires PointRef-to-3D geometry lookup |
| F3.4 | Snap-to-edge break picking | Free-hand pick sufficient for v1; snap infrastructure not yet in DrawingCanvas |
| F3.5 | Arbitrary-angle (non-axis-aligned) breaks | Requires 2D rotated-band clip (Liang-Barsky generalization); not needed for standard furniture drawings |
| F3.6 | Section/detail view as break target | Section break requires hatch regeneration after break; detail break requires region-relative coords; both need separate design passes |
| F3.7 | User-configurable `gapMm` via input | Field on DTO; default 5 mm is correct for furniture-scale drawings; UI for this is low priority |
| F3.8 | Broken view as parent of section/detail | Parent view with breaks produces compressed geometry; section plane derivation against compressed edges is geometrically incorrect without compensation |
| F3.9 | Regenerate button re-projects (cross-cutting fix) | Inherited from F1+F2; `RegenerateViewCommand` correctly re-projects kernel geometry; the UI stale-flag clear-without-regen behavior is a separate bug tracked at F1.9/F2.9 |

---

## Appendix — file inventory

### New files

```
packages/shared/src/drawing/
  applyBreaks.ts
  __tests__/applyBreaks.spec.ts
  __tests__/fingerprintBreaksArray.spec.ts

packages/app/src/drawing/
  AddBreakDialog.tsx

packages/app/src/commands/
  AddBreakCommand.ts
  DeleteBreakCommand.ts
  __tests__/AddBreakCommand.spec.ts
  __tests__/DeleteBreakCommand.spec.ts

packages/shared/src/__tests__/
  migrateManifest-v16-to-v17.spec.ts

tests/e2e/drawing/
  T-6-9-broken-view.spec.ts

tests/perf/
  drawing-broken.perf.spec.ts
```

### Modified files

```
packages/shared/src/drawing/types.ts
  (BreakRegion; breaks? + rawProjection? on BaseView/ProjectedView/IsoView/SectionView)

packages/shared/src/drawing/projectedGeometry.ts
  (Edge2D.kind widens to include 'break')

packages/shared/src/drawing/fingerprint.ts
  (add fingerprintBreaksArray; reuses internal djb2)

packages/shared/src/fileFormat.ts
  (CURRENT_FORMAT_VERSION → 17; migrations[16] no-op)

packages/shared/src/__tests__/fileFormat.spec.ts
  (all toBe(16) → toBe(17))

packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts
packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts
packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts
packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts
packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts
  (all toBe(16) → toBe(17))

packages/app/src/drawing/toolMode.ts
  (ToolMode += 'break'; BreakToolState type; store actions for 5-stage state machine)

packages/app/src/drawing/ViewElement.tsx
  (kind === 'break' stroke branch in visibleEdges render loop)

packages/app/src/drawing/DrawingCanvas.tsx
  (break-mode click dispatch; sheetToViewLocal utility)

packages/app/src/drawing/DrawingTreePane.tsx
  (· [N break(s)] suffix on view label when breaks.length > 0)

packages/app/src/commands/RegenerateViewCommand.ts
  (post-projection applyBreaks call + rawProjection update)

packages/app/src/shell/tabs/DrawingTab.tsx
  (Add Break button in Place Views panel after Detail)

packages/app/src/App.tsx
  (__zilventorBrokenViewMs window probe)
```

---

**End of spec.** All 17 design axes locked to brainstorming decisions. No TBDs. Ready for `superpowers:writing-plans`.
