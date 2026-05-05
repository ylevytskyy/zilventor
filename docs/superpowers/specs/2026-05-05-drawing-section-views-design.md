# ZilInventor — Drawing F1: Section Views

- **Date:** 2026-05-05
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Follow-up F1 of the Sub-project 6 deferred list. Add full ANSI section views to `.zidw` drawings: two-click cut-line definition on a parent view, BOPAlgo half-space cut via OCCT, per-material hatching, ANSI-style section-line overlay, auto-labelling A-A / B-B / C-C, OPFS BREP cache.
- **Prior art:** Reuses Sub-project 6 projector pipeline (`packages/shared/src/drawing/{projector,fingerprint,edgeClassifier}.ts`), kernel adapter (`getProjectorInput.ts`, `flattenAssemblyForProjection.ts`), 4d composedPoses, 5a material registry (`MaterialSpec`), 6's per-view stale-banner pattern, 6's `AddProjectedViewCommand` drag-place flow. Bumps manifest v14 → v15.

---

## 1. Scope and non-goals

### 1.1 What this feature delivers

1. New `SectionView` discriminant on the `DrawingView` union (`packages/shared/src/types.ts`).
2. Two-click cut-line tool on any existing `base` or `projected` view → drag-preview → click to place. State machine: `pickParent → pickP0 → pickP1 → pickDrop`. ESC cancels at any stage.
3. `AddSectionViewCommand` — single atomic undo step: creates the section line overlay on the parent view and the section view simultaneously.
4. Kernel: `cutBySectionPlane` (BOPAlgo half-space cut), `sectionCache` (OPFS BREP cache, LRU 100 MB), `faceTag` (cut-face vs original-face tagging for hatch targeting).
5. Projector extension: third edge class `hatch`; hatch generator fills tagged cut-faces using per-material angle/spacing from `MaterialSpec`.
6. ANSI section-line rendered on the parent view: heavy line + filled arrowheads at each terminus + letter label (`A`, `B`, `C`…). Rendered as a `<SectionLineOverlay>` SVG component layered above the parent view's `<ViewElement>`.
7. Auto-naming: first section is `A-A`, second `B-B`, third `C-C`; gaps re-used when a section is deleted; overflow wraps `Z-Z → AA-AA`.
8. Caption "SECTION A-A" rendered beneath the section view's bounding box at a scale-adjusted offset.
9. Per-material hatch defaults: `hatchAngleDeg` (default 45°) and `hatchSpacingMm` (default 3 mm) added as optional fields to `MaterialSpec` in `packages/shared/src/types.ts`.
10. Stale fingerprint extended: section view fingerprint = SHA-256 of `(parent.sourceFingerprint + planeFingerprint + scale + label)`. Existing ⚠ banner + `RegenerateViewCommand` handle it unchanged.
11. Export: section views render identically to other views in PDF/SVG/PNG; hatch segments emit as `<line>` SVG elements. No new export plumbing.
12. `EditViewScaleCommand` and `ToggleHiddenLinesCommand` work on section views via the existing command dispatch (the commands already accept `viewId` generically).

### 1.2 Non-goals — explicitly deferred

| Deferred | Item |
|---|---|
| future F-follow-up | Per-component "do not section" flag (v1 cuts every component). |
| future F-follow-up | Aligned / offset section views (line with bends through multiple parallel planes). |
| future F-follow-up | Half-section (symmetric parts cut to centre line). |
| future F-follow-up | Detail views (F2 of 6's deferred list). |
| future F-follow-up | Broken views (F3 of 6's deferred list). |
| future F-follow-up | Section hatching on assembly drawings per excluded component. |
| future F-follow-up | Visual regression golden-SVG comparison for hatch output. |
| future F-follow-up | `iso` parent view as section source (iso cut requires different plane derivation; deferred because iso views are less common for section cuts in furniture CAD). |

### 1.3 Migration / file-format impact

Manifest v14 → v15. Extensions are additive:

- New `kind: 'section'` value on `DrawingView` union; existing `base` / `projected` / `iso` unchanged.
- New optional fields `hatchAngleDeg?: number` and `hatchSpacingMm?: number` on `MaterialSpec`.
- v14 `DrawingDocument` manifests open without error; `views` containing no `section` entries are unaffected. `migrateManifest(14 → 15)` is a pass-through.
- OPFS cache dir `opfs:/cache/section/` is created on first cut; absent on old projects, created on demand.

### 1.4 Success criteria

Feature is done when **all** are true:

1. From an existing drawing with a base view, clicking **Drawing → Place Views → Section** switches to `pickParent` mode. Clicking the base view, clicking p0, clicking p1, dragging, and clicking to place creates a section view with hatch fill visible and `SECTION A-A` caption.
2. The parent base view shows the ANSI section line (heavy line, arrowheads, `A` labels at each terminus).
3. Editing the source part geometry and reopening the drawing shows ⚠ on the section view. Clicking Regenerate re-cuts and re-projects, clears the banner.
4. `Ctrl+Z` after `AddSectionViewCommand` removes both the section view and the section line overlay from the parent in one step.
5. Exporting to PDF includes the section view with hatch lines as vector paths. Magic-byte check `%PDF-` passes.
6. 20-component assembly section cut p95 < 400 ms (cut + project combined). Standalone projection budget unchanged at 200 ms.
7. `pnpm -r typecheck`, all pre-existing + new unit + e2e + perf suites pass. Pre-existing 35 model/* flakes do not regress.

---

## 2. Data model

### 2.1 MaterialSpec extension

```ts
// packages/shared/src/types.ts (modified)
export type MaterialSpec = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  // --- NEW ---
  readonly hatchAngleDeg?: number;   // default 45 when absent
  readonly hatchSpacingMm?: number;  // default 3 when absent
};
```

Both fields are optional; absence is treated as the default at hatch-generation time (never stored as the literal default — keeps manifests compact and migration-free for existing materials).

### 2.2 DrawingView union extension

```ts
// packages/shared/src/types.ts (modified)
export type DrawingView =
  | BaseView
  | ProjectedView
  | IsoView
  | SectionView;   // NEW
```

### 2.3 SectionView

```ts
export type SectionView = {
  kind: 'section';
  id: string;
  parentViewId: string;
  sectionLine: { p0: Vec2; p1: Vec2 };      // parent-view SVG space (mm from view origin)
  arrowDirection: -1 | 1;                    // +1 = right of line as drawn; -1 = left
  label: string;                             // 'A', 'B', 'C' … 'Z', 'AA', 'AB' …
  position: Vec2;                            // sheet-space positionMm, same frame as other views
  scale: number;                             // ratio numerator/denominator; inherits parent's at create
  showHidden: false;                         // ANSI convention: always false; field is literal false not boolean
  hatchSegments: HatchSegment[];             // populated by projector; empty until first regeneration
  fingerprint: string;                       // SHA-256; see §7
};

export type HatchSegment = { p0: Vec2; p1: Vec2; materialId: string };
```

`Vec2` is `{ x: number; y: number }` (already used by `positionMm` on existing view types).

### 2.4 ProjectFile version bump

```ts
// packages/shared/src/types.ts (modified)
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15; kind: 'part';     ... }
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15; kind: 'assembly'; ... }
  | { formatVersion: 14 | 15;                                   kind: 'drawing';  ... };
```

---

## 3. Kernel — cut pipeline

### 3.1 New files

```
packages/kernel/src/section/
  cutBySectionPlane.ts    — OCCT half-space + BOPAlgo_BOP cut
  sectionCache.ts         — OPFS-keyed BREP cache with LRU eviction
  faceTag.ts              — tag cut-face vs original-face on result compound
```

### 3.2 `cutBySectionPlane.ts`

Half-space construction: build a 2000 × 2000 × 1000 mm box with one face coincident with the section plane, normal pointing opposite to `arrowDirection`. Subtract from source body using `BOPAlgo_BOP` (BooleanCut). Faces classified `ON` (lying in the cut plane) are tagged `cut-face` via `faceTag`; all others are `original-face`.

```ts
// packages/kernel/src/section/cutBySectionPlane.ts
export type SectionPlane = {
  origin: Vec3;   // world-space point on the plane
  normal: Vec3;   // unit normal, pointing in arrowDirection
};

export async function cutBySectionPlane(
  occt: OpenCascade,
  sourceShape: TopoDS_Shape,
  plane: SectionPlane,
): Promise<TopoDS_Compound> {
  // 1. Build half-space box (BRepPrimAPI_MakeBox + gp_Ax2 aligned to plane)
  // 2. BOPAlgo_BOP: op = BOPAlgo_CUT; args = [sourceShape]; tools = [halfSpaceBox]
  // 3. Check BOPAlgo_BOP.HasErrors() → throw SectionCutError if true
  // 4. Walk result compound faces; classify via BRep_Tool::Surface + gp_Pln::Distance:
  //      distance < 1e-4 mm → tag 'cut-face'; else → 'original-face'
  // 5. Return tagged TopoDS_Compound
}
```

Degenerate-cut detection: before BOPAlgo, classify source shape against plane using `BRepClass3d_SolidClassifier`. If every face is `ON` (plane tangent to all geometry), skip the cut, emit a toast "Section plane tangent to geometry; nudge by 0.01 mm", and return the original shape uncut with no `cut-face` tags.

Assembly path: `flattenAssemblyForProjection` yields posed component bodies; call `cutBySectionPlane` on each component's posed `TopoDS_Shape`; union tagged results into a single `TopoDS_Compound` via `BRep_Builder::Add`. Per-face material lookup threads through component metadata already attached by the walker.

### 3.3 `sectionCache.ts`

OPFS path: `opfs:/cache/section/<sha256(sourceFp + planeFp)>.brep`

```ts
// packages/kernel/src/section/sectionCache.ts
export async function getCachedCut(key: string): Promise<ArrayBuffer | null>;
export async function storeCut(key: string, brep: ArrayBuffer): Promise<void>;
export async function evictLru(maxBytes: number): Promise<void>;  // called after storeCut; cap 100 MB
```

LRU eviction: maintain a sidecar `opfs:/cache/section/index.json` tracking `{ key, sizeBytes, lastAccessMs }[]`, sorted by `lastAccessMs` ascending. `evictLru` deletes oldest entries until total size ≤ `maxBytes`. Cache key = `sha256(sourceFp + planeFp)` where `sourceFp` = source geometry fingerprint (reuses §7 machinery) and `planeFp` = `sha256(JSON.stringify({ origin, normal }))` with floats rounded to 1e-3 mm.

### 3.4 `faceTag.ts`

```ts
// packages/kernel/src/section/faceTag.ts
export type FaceClass = 'cut-face' | 'original-face';
export function tagFace(face: TopoDS_Face, cls: FaceClass): void;   // stores on face UserData integer (0 = original, 1 = cut)
export function getFaceClass(face: TopoDS_Face): FaceClass;
```

Uses OCCT `TopoDS_Shape::TShape()->SetFree` slot or a parallel `WeakMap<TopoDS_Face, FaceClass>` — whichever survives the BOPAlgo copy. Concrete choice left to implementer; API surface above is the contract.

---

## 4. Projector extension — hatch generation

### 4.1 Third edge class

```ts
// packages/shared/src/drawing/projectedGeometry.ts (modified)
export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline' | 'hatch';  // 'hatch' is NEW
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
  readonly materialId?: string;   // NEW — populated only when kind === 'hatch'
};
```

Hatch segments are emitted as `Edge2D` with `kind: 'hatch'`. The projector's classify-edges loop is extended with a third pass that operates only on `cut-face`-tagged faces.

### 4.2 Hatch generator algorithm

Inputs per cut-face: the projected face polygon(s) in view space (UV outline); `materialId`; `hatchAngleDeg`; `hatchSpacingMm`.

1. Project the cut-face boundary loop into 2D view space to obtain a polygon (may be non-convex).
2. Generate a grid of parallel lines at `hatchAngleDeg` spaced `hatchSpacingMm` apart, large enough to cover the polygon's bounding box.
3. Clip each line to the polygon:
   - Convex polygon: Sutherland–Hodgman algorithm.
   - Non-convex polygon: ear-clipping triangulation (reuse `depthBuffer.ts` triangle infrastructure), then Sutherland–Hodgman per triangle; union surviving segments.
4. Emit each surviving segment as `Edge2D { kind: 'hatch', materialId }`.

For multi-material assemblies, each component's cut-face set carries its own `materialId`; repeat steps 1–4 per material group.

### 4.3 `projectSectionView` entry point

```ts
// packages/shared/src/drawing/projector.ts (extended)
export function projectSectionView(
  cutCompound: TopoDS_Compound,         // already-cut result from kernel
  viewMatrix: Mat4,                     // plane-aligned view matrix (see §5.2)
  materials: ReadonlyMap<string, MaterialSpec>,
): ProjectedGeometry {
  // Runs standard projectView pipeline on cutCompound.
  // After classifyEdges, runs hatchGenerator on cut-face tagged faces.
  // Merges hatch Edge2D[] into result.visibleEdges (hatch is always "visible").
}
```

---

## 5. Section plane derivation

### 5.1 From 2D line to 3D plane

The user clicks `p0` and `p1` on the parent view's SVG canvas. These are in parent-view space (mm from view origin, pre-scale). To derive the 3D section plane:

```
sectionLineDir2D = normalize(p1 - p0)
sectionLineNormal2D = perp(sectionLineDir2D)  // rotated 90° in arrowDirection sense
planeNormal3D = normalize(R_parent^-1 · [sectionLineNormal2D.x, sectionLineNormal2D.y, 0])
midpoint2D = (p0 + p1) / 2
planeOrigin3D = R_parent^-1 · [midpoint2D.x, midpoint2D.y, depthBuffer.midZ(midpoint2D)]
```

`R_parent` is the parent view's rotation matrix (extracted from its `viewMatrix`). `depthBuffer.midZ` samples the parent's depth buffer at `midpoint2D` to place the plane origin on the model surface (avoids floating origin far from geometry).

### 5.2 Section view matrix

The section view looks in the direction of `arrowDirection` along `planeNormal3D`:

```
R_section = lookAt(eye = planeOrigin3D + arrowDirection * planeNormal3D * 1000,
                   center = planeOrigin3D,
                   up = worldUp)
viewMatrix = T_recenter · R_section
```

`worldUp` defaults to the parent view's up vector to maintain consistent orientation. `T_recenter` centres the cut compound's bbox at origin (same pattern as Sub-project 6 §3.2).

---

## 6. Commands

### 6.1 `AddSectionViewCommand`

```ts
// packages/app/src/commands/AddSectionViewCommand.ts
class AddSectionViewCommand implements Command {
  constructor(private opts: {
    sheetId: string;
    parentViewId: string;
    p0: Vec2;
    p1: Vec2;
    arrowDirection: -1 | 1;
    dropAt: Vec2;
  }) {}
  // apply:
  //   1. Derive section plane (§5.1).
  //   2. kernel.cutBySectionPlane(sourceId, plane) — checks cache first via sectionCache.
  //   3. projectSectionView(cutCompound, viewMatrix, materials) → ProjectedGeometry + hatchSegments.
  //   4. Allocate label via LabelAllocator (§6.3).
  //   5. Push SectionView onto sheet.views[].
  //   6. Attach SectionLineAnnotation onto parent view (§6.4).
  //   7. Persist via bus autosave.
  // revert:
  //   1. Remove SectionView from sheet.views[].
  //   2. Remove SectionLineAnnotation from parent view.
  //   3. Release label back to LabelAllocator.
  //   (Cache entry is NOT evicted on revert — revert just removes the view; cache is LRU-managed.)
}
```

Single undo step — both the section view and the parent annotation are created/removed atomically.

### 6.2 `DeleteSectionViewCommand`

Reuses `DeleteViewCommand` dispatch path — `DeleteViewCommand` already accepts any `viewId`; when the targeted view is `kind: 'section'`, it also removes the associated `SectionLineAnnotation` from the parent view. The cascade logic lives in `DeleteViewCommand.apply`:

```ts
if (view.kind === 'section') {
  // also remove SectionLineAnnotation with annotationId = view.id + '_sectionLine'
}
```

### 6.3 Label allocator

```ts
// packages/app/src/drawing/sectionLabel.ts
export function allocateLabel(usedLabels: readonly string[]): string;
// Sequence: A B C … Z AA AB … ZZ AAA …
// First gap in the current sequence is reused; no gaps → append next.
export function releaseLabel(label: string, usedLabels: string[]): string[];
```

`usedLabels` is derived from `sheet.views.filter(v => v.kind === 'section').map(v => v.label)` at command time. Implementer note: labels are single letters A–Z for 26 sections; furniture drawings never approach Z. Two-letter overflow (`AA`) is specced for completeness but needn't be optimised.

### 6.4 `SectionLineAnnotation`

Section line on parent is stored as a new annotation kind on the parent view's sheet — not on the `DrawingAnnotation` union (which is sheet-scoped), but as a readonly overlay generated from the `SectionView` itself. At render time, `<DrawingCanvas>` maps each `SectionView` to a `<SectionLineOverlay>` component that reads from `view.sectionLine` — no separate stored annotation needed. `DeleteSectionViewCommand` / undo handles cleanup implicitly.

---

## 7. Fingerprint / stale detection

Section view fingerprint:

```ts
function computeSectionViewFingerprint(
  view: SectionView,
  parentSourceFingerprint: string,  // parent view's inputFingerprint
): Promise<string> {
  // SHA-256 of canonical JSON:
  // {
  //   parentSourceFingerprint,
  //   planeOrigin: roundTo3(plane.origin),
  //   planeNormal: roundTo3(plane.normal),
  //   scale: view.scale,
  //   label: view.label,
  // }
}
```

`parentSourceFingerprint` propagates: if the source geometry changes, the parent view becomes stale, the user regenerates the parent, the parent's new fingerprint differs, which marks the section view stale. This two-hop invalidation is correct and requires no special machinery.

The OPFS cache key (`sha256(sourceFp + planeFp)`) is separate from the view fingerprint — the cache key covers what was cut, the view fingerprint covers what was rendered (includes scale and label).

---

## 8. UI

### 8.1 Tool mode extension

```ts
// packages/app/src/drawing/toolMode.ts (modified)
export type DrawingToolMode =
  | 'idle'
  | 'placeBase' | 'placeProjected' | 'placeIso'
  | 'placeSection'          // NEW — four-stage sub-mode (see state machine below)
  | 'addLinearH' | 'addLinearV' | 'addAligned' | 'addRadial' | 'addDiametric'
  | 'addCenterline' | 'addCenterMark' | 'addLeader' | 'addBalloon';

// Sub-state for placeSection (stored in useToolModeStore alongside toolMode):
export type SectionStage = 'pickParent' | 'pickP0' | 'pickP1' | 'pickDrop';
```

State machine transitions:
- Enter `placeSection` → stage `pickParent`. Status bar: "Click a view to define section parent."
- Click on `base` or `projected` view → stage `pickP0`. Status bar: "Click to set section line start."
- Click on canvas (in parent view bounds) → store `p0`, stage `pickP1`. Status bar: "Click to set section line end."
- Click on canvas → store `p1`, derive `arrowDirection` from line geometry vs. parent view centre, stage `pickDrop`. Status bar: "Drag to place section view. Arrow side: [left/right]."
- Click to drop → dispatch `AddSectionViewCommand`. Return to `idle`.
- ESC at any stage → return to `idle`, discard partial state.

Only `base` and `projected` parent views are accepted in `pickParent`. Clicking on `iso` or `section` views in this stage is silently ignored (no error; cursor stays in `pickParent`).

### 8.2 Ribbon button

```ts
// packages/app/src/shell/tabs/DrawingTab.tsx (modified)
// Place Views panel:
//   Base View  |  Projected View  |  Section View  |  Iso View
// "Section" button added between "Projected View" and "Iso View".
```

Button is disabled (greyed) when `activeSheet.views` contains no `base` or `projected` views (nothing to section from).

### 8.3 `<SectionLineOverlay>` component

```tsx
// packages/app/src/drawing/SectionLineOverlay.tsx (new)
// Props: view: SectionView; parentView: BaseView | ProjectedView; scaleRatio: number
// Renders into the parent view's <g> as a sibling layer above edges:
//   - <line> from p0 to p1 with stroke-width 0.5 mm (ANSI heavy line weight)
//   - Two filled arrowheads (SVG <polygon>) at each terminus, pointing in arrowDirection
//   - Two <text> elements at each terminus offset 2 mm from the arrowhead, text = view.label
// All coordinates in parent-view space (SVG mm); scaleRatio applied by parent <g transform>.
```

### 8.4 `<ViewElement>` extension

```tsx
// packages/app/src/drawing/ViewElement.tsx (modified)
// When view.kind === 'section':
//   - Render hatchSegments as <line> elements, stroke-width 0.18 mm (same as hidden-line weight),
//     stroke colour = default foreground (black). No dash pattern (solid hatch lines).
//   - Render "SECTION {label}-{label}" caption as <text> beneath view bounding box,
//     offset = 4 mm * scale below bbox.minY. Font-size 3.5 mm (ISO 3098 standard annotation height).
//   - Visible and hidden edges rendered identically to other view kinds.
//   - showHidden is always false; hidden edge rendering branch is unreachable for section views
//     but remains in the generic path for correctness.
```

### 8.5 `<DrawingTreePane>` extension

Section views appear in the Views sub-tree beneath their sheet, labelled "Section A-A" (or whatever the label is). Parent relationship is shown by indentation only (no visual connector — mirrors how `ProjectedView` shows `from Base` in parentheses).

```
├── Views
│   ├── Base — Front  · 1:1
│   ├── Projected — Right (from Base) · 1:1
│   ├── Section A-A (from Base) · 1:1  ← NEW
│   └── Iso — NE · 1:1
```

Right-click → Delete (invokes `DeleteViewCommand`), Regenerate (invokes `RegenerateViewCommand`).

---

## 9. Tests

### 9.1 Unit tests (~25 new)

**`packages/kernel/src/section/__tests__/cutBySectionPlane.spec.ts`**
- Single body (100×60×40 mm box), mid-plane cut: result compound has exactly 2 cut-faces (the two halves of the bisected face).
- Two-body union, plane between bodies: only one body cut; other body untouched.
- 5-component assembly: each component's posed body cut; per-face `getFaceClass` returns correct tags on all cut faces.
- Plane misses body entirely (plane 500 mm from bounding box): result = original uncut shape, no `cut-face` tags.
- Plane coincident with a face (degenerate): `BRepClass3d_SolidClassifier` detects; function returns original shape, no throw.

**`packages/kernel/src/section/__tests__/sectionCache.spec.ts`**
- Miss → cut → store → hit returns same bytes.
- LRU eviction: store 3 entries totalling 110 MB (cap 100 MB) → oldest entry evicted; remaining 2 sum ≤ 100 MB.

**`packages/shared/src/drawing/__tests__/hatchGenerator.spec.ts`**
- 45°/3mm hatch on a 20×20 mm square: segment count = floor(20 * sqrt(2) / 3) ≈ 9 segments. ±1 tolerance.
- 0°/5mm hatch on the same square: horizontal lines, y-coordinates spaced 5 mm ± 1e-3.
- Non-convex L-shaped cut-face: Sutherland–Hodgman fails (non-convex); ear-clipping triangulation → correct clipped segments (count > 0, all inside polygon).
- Multi-material assembly face group: two materials → two distinct `materialId` values in `hatchSegments`.

**`packages/shared/src/drawing/__tests__/sectionPlane.spec.ts`**
- Front-view parent, horizontal section line (p0 left, p1 right): plane normal = world-Z, origin on XY midplane of bbox.
- Top-view parent, vertical line: plane normal = world-Y.
- Right-view parent: plane normal = world-X.
- 4 iso-parent orientations: not supported — function throws `SectionParentError` for `kind: 'iso'`.

**`packages/app/src/drawing/__tests__/sectionLabel.spec.ts`**
- Empty sheet → allocate → 'A'; allocate again → 'B'.
- Delete 'B' → allocate → 'B' reused (gap fill).
- 26 sections A–Z → allocate → 'AA'.
- Delete 'C' then 'D' → allocate → 'C' (lowest gap first).

**`packages/app/src/commands/__tests__/AddSectionViewCommand.spec.ts`**
- Apply: `sheet.views` gains one `SectionView`; parent view has corresponding overlay data accessible via `view.id`.
- Revert: both removed; `sheet.views` length restored; label released from allocator.
- Apply → revert → apply: idempotent (same label re-allocated).
- Cache: on apply, sectionCache.getCachedCut is called first; on second apply of identical plane, cache hit (getCachedCut called once per unique plane).

**`packages/shared/src/drawing/__tests__/sectionFingerprint.spec.ts`**
- Same inputs → identical hash.
- Change `planeOrigin` by 0.5 mm → different hash.
- Change `parentSourceFingerprint` → different hash.

**`packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts`**
- v14 drawing manifest with no section views → v15 pass-through identical.
- v15 manifest with one section view round-trips through JSON.parse(JSON.stringify).

### 9.2 E2E — `tests/e2e/drawing/T-6-7-section-view.spec.ts`

```
T-6-7: Section view — create, hatch, stale-banner round-trip

1. Create a 100×60×40 mm box part.
2. File → New Drawing → base view (Front, 1:1).
3. Drawing → Place Views → Section.
4. Click base view (pickParent) → click left-centre of view (p0) → click right-centre (p1) →
   drag below base view → click to place.
5. Assert: section view visible in canvas; hatchSegments.length > 0 in store;
   "SECTION A-A" caption present in SVG DOM.
6. Assert: parent view SVG contains a <line> with stroke-width matching ANSI heavy (≥ 0.4 mm).
7. Ctrl+Z → assert section view removed; parent view overlay removed.
8. Ctrl+Y (redo) → section view restored.
9. Edit source part (change box height 40 → 60).
10. Reopen drawing → assert ⚠ stale banner on section view.
11. Click Regenerate → assert banner cleared; hatchSegments updated.
```

### 9.3 Perf — `tests/perf/section-cut.perf.spec.ts`

```ts
// 20-component assembly (5 shelves + 4 side panels + 4 horizontal dividers + 7 hardware items)
// p95 budget: 400 ms for cutBySectionPlane + projectSectionView combined.
// Measured via performance.now() wrapping the kernel worker call.
// Standalone projectView (no cut) budget unchanged: 200 ms.
// Cache hit scenario: second identical cut p95 < 30 ms (OPFS read + projectView only).
```

---

## 10. Performance budget

| Metric | p95 budget | Rationale |
|---|---|---|
| `cutBySectionPlane` + `projectSectionView`, 20-component assembly | 400 ms | BOPAlgo is the heavy step; 400 ms is generous on target hardware (2014–2016 i3/i5 Chromium). |
| Same cut, cache hit (OPFS read + projectView only) | 30 ms | OPFS read of cached BREP + projection. |
| `AddSectionViewCommand` round-trip (worker call) | 450 ms | Includes Comlink RPC overhead. |
| Standalone `projectView` (no cut) | 200 ms | Unchanged from Sub-project 6. |
| `<DrawingCanvas>` first paint with section view + hatch | 120 ms | 20 ms slack over the 100 ms sheet-render budget; hatch adds `<line>` elements but no layout cost. |

---

## 11. Risks

1. **BOPAlgo half-space robustness on degenerate cuts.** Plane tangent to a face surface causes `BOPAlgo_BOP` to produce empty or invalid results. Mitigation: detect via `BRepClass3d_SolidClassifier` before cut (§3.2); skip cut and emit user-visible toast.
2. **Hatch polygon clipping for non-convex cut-face boundaries.** Sutherland–Hodgman is correct only for convex polygons. Mitigation: ear-clipping triangulation for non-convex faces, reusing `depthBuffer.ts` triangle infrastructure (§4.2).
3. **OPFS cache size growth.** Large assemblies produce large BREP blobs. Mitigation: LRU eviction cap 100 MB on `opfs:/cache/section/` (§3.3).
4. **Two-hop stale invalidation latency.** User regenerates parent view, then must separately regenerate section view. Mitigation v1: UI shows both as stale simultaneously; "Regenerate All" ribbon action clears both in one click. Auto-cascade on parent regen deferred.
5. **Iso parent views not supported.** A user clicking an iso view during `pickParent` gets no feedback. Mitigation: show a toast "Section views require an orthographic parent view" and remain in `pickParent` mode.
6. **Float rounding in plane derivation.** 3D plane origin sampled from the depth buffer's mid-Z may drift ±1 pixel across regen. Mitigation: round plane origin to 0.1 mm before hashing (1e-1 mm tolerance for plane derivation; 1e-3 mm used only for geometry fingerprinting where precision matters).

---

## 12. Open questions

1. **Arrow direction control.** Current design infers `arrowDirection` from line geometry vs parent view centre (arrow points away from centre). User may want to flip it interactively before placing. Defer a flip gesture (e.g. pressing `F` during `pickDrop`) to a follow-up if usability testing reveals confusion.
2. **Multiple section views from the same parent.** Allocator assumes unique labels per sheet; two sections from different parents on the same sheet are both labelled sequentially (A-A, B-B). This is correct ANSI behaviour — confirming no conflict in the data model.
3. **Assembly section: per-component hatch angle.** If two adjacent components share the same material, their hatch lines will be co-linear and indistinguishable. ANSI practice rotates hatch 30° or 60° for adjacent components of the same material. Deferred to follow-up; v1 uses per-material angle only.

---

## 13. Scope estimate

~9 implementer batches, ~2500-line plan. Phasing:

| Batch | Content |
|---|---|
| 1 | Types + v14→v15 migration: `SectionView`, `HatchSegment`, `MaterialSpec` extension, `migrateManifest` |
| 2 | Kernel cut: `cutBySectionPlane.ts`, `faceTag.ts`, unit tests |
| 3 | Kernel cache: `sectionCache.ts`, LRU eviction, cache hit/miss tests |
| 4 | Projector hatch: `hatchGenerator`, `Edge2D` `hatch` kind, `projectSectionView` entry point, hatch unit tests |
| 5 | `AddSectionViewCommand`: plane derivation, label allocator, command apply/revert, command tests |
| 6 | Tool mode + state machine: `placeSection` mode, 4-stage state machine, ESC cancel, iso-parent toast |
| 7 | UI: `<SectionLineOverlay>`, `<ViewElement>` hatch render, `<DrawingTreePane>` section row, ribbon button |
| 8 | Tests: T-6-7 e2e spec, section-cut perf spec |
| 9 | Polish: stale-banner two-hop display, Regenerate All ribbon action, caption positioning, self-review fixes |

Smaller than Sub-project 6 (14 batches / 73 commits). Comparable to Sub-project 4b (assembly constraints, 9 batches).

---

## Appendix — file inventory

### New files

```
packages/kernel/src/section/
  cutBySectionPlane.ts
  sectionCache.ts
  faceTag.ts
  __tests__/cutBySectionPlane.spec.ts
  __tests__/sectionCache.spec.ts

packages/shared/src/drawing/
  hatchGenerator.ts
  sectionPlane.ts              (§5.1 plane derivation; pure — no OCCT dependency)
  __tests__/hatchGenerator.spec.ts
  __tests__/sectionPlane.spec.ts
  __tests__/sectionFingerprint.spec.ts

packages/app/src/drawing/
  SectionLineOverlay.tsx
  sectionLabel.ts
  __tests__/sectionLabel.spec.ts

packages/app/src/commands/
  AddSectionViewCommand.ts
  __tests__/AddSectionViewCommand.spec.ts

packages/shared/src/__tests__/
  migrateManifest-v14-to-v15.spec.ts

tests/e2e/drawing/
  T-6-7-section-view.spec.ts

tests/perf/
  section-cut.perf.spec.ts
```

### Modified files

```
packages/shared/src/types.ts              (SectionView, HatchSegment, MaterialSpec, ProjectFile v15)
packages/shared/src/drawing/projector.ts  (projectSectionView export; hatch class in Edge2D)
packages/shared/src/drawing/projectedGeometry.ts  (Edge2D.kind += 'hatch'; materialId field)
packages/shared/src/fileFormat.ts         (CURRENT_FORMAT_VERSION → 15; v14→v15 pass-through migration)
packages/app/src/drawing/toolMode.ts      (DrawingToolMode += 'placeSection'; SectionStage type)
packages/app/src/drawing/ViewElement.tsx  (hatch render + caption for kind === 'section')
packages/app/src/drawing/DrawingTreePane.tsx  (section row in views sub-tree)
packages/app/src/commands/DeleteViewCommand.ts  (cascade: remove SectionLineAnnotation from parent)
packages/app/src/shell/tabs/DrawingTab.tsx  (Section button in Place Views panel)
packages/kernel/src/getProjectorInput.ts   (thread cutBySectionPlane into the worker adapter)
```

---

**End of spec.** All 19 design axes locked to user-selected defaults. Ready for `superpowers:writing-plans`.
