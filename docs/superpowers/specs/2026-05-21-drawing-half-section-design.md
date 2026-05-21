# ZilInventor — Drawing F1.1: Half-Section View Variant

- **Date:** 2026-05-21
- **Status:** Approved — ready for `superpowers:writing-plans`.
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Predecessor:** Drawing F1 — Section Views (`8286a10`), Drawing F3 — Broken Views (`c3f3762`)
- **Estimated batches:** 3–4
- **Spec scope:** Follow-up F1.1 of the Drawing F1 deferred list. Add ANSI-style half-section views to `.zidw` drawings by extending the existing `SectionView` with a new `mode` discriminant, a `splitPlane`, and a `cutSide`. The kernel cut is extended with an oversized-box quarter-space tool to remove the un-cut quadrant without new OCCT numerical fragility. All existing F1 infrastructure (projector, label allocator, cache, Comlink worker, stale banner) is reused unchanged. Bumps manifest v17 → v18.

---

## 1. Context and framing

Drawing F1 shipped full ANSI section views: the user draws a cut line across a parent view, the kernel performs a BOPAlgo half-space cut, and the projector produces a new `SectionView` with hatch on the exposed cut face. Half-section views (ANSI standard practice for symmetric parts) are the most-requested follow-up: the part is cut along TWO orthogonal planes simultaneously, with one quarter removed, exposing both the internal geometry (hatched) and the exterior profile of the un-cut half. The user sees the inside on one side of the section line and the outside on the other — the canonical furniture-CAD use case for showing a drawer box cross-section alongside the cabinet profile in a single view.

F1.1 extends `SectionView` (no new discriminant) with three new fields: `mode: 'full' | 'half'`, `cutSide: -1 | 1`, and `splitPlane: Plane`. The kernel gains two optional parameters on `cutBySectionPlane` that build an additional oversized-box boolean tool to remove the selected quadrant. The projector fingerprint is extended to incorporate the new fields. The tool mode gains a fifth stage (`pickCutSide`) that renders a `<HalfSectionSidePreview>` hover overlay. All other plumbing — stale banners, export, `DeleteViewCommand` cascade, label allocation, tree pane — is unchanged.

ANSI convention (ASME Y14.3): a half-section on a symmetric part shows one half in full section (hatch + internal edges) and the other half in external view (silhouette edges only). The cut line is a centre line (thin chain-dash); the boundary between the two halves is marked by the section line arrows on one side only. In ZilInventor v1 the chain-dash styling and cut-line-only-on-arrow-side rendering are deferred (F1.1.x); the section line renders identically to a full-section line but with the cut side indicated by the arrow.

Scope: 3–4 implementer batches, ~1500-line plan. All F1.x items other than F1.1 (F1.2 stepped, F1.3 do-not-section, F1.4 arrow inversion, F1.5 hatch differentiation, F1.6 nested section parents, F1.7 typed viewMatrix on BaseView, F1.8 arrow-flip overlay) remain deferred.

---

## 2. User-facing behavior

### 2.1 Full workflow narration

The user opens a drawing with a base view of a symmetric part (e.g. a cabinet carcass). They click **Drawing → Place Views → Half Section** in the ribbon. A new button appears next to the existing "Section" button — these are separate buttons, not a toggle.

**Stage 1 — pickParent:** The cursor changes to a cross-hair. The status bar reads "Click a base or projected view to define half-section parent." Clicking an `iso` or `section` view is silently ignored. Clicking a `base` or `projected` view advances to stage 2.

**Stage 2 — pickP0:** Status bar: "Click to set section line start." The user clicks on the parent view canvas; `p0` is recorded in parent-view mm space.

**Stage 3 — pickP1:** Status bar: "Click to set section line end." The user clicks a second point; `p1` is recorded. The section line preview appears as a dotted overlay. The system derives `arrowDirection` from the line geometry vs the parent view centre (arrow points away from centre, same logic as full section).

**Stage 4 — pickDrop:** Status bar: "Drag to place half-section view." The section line is now visible with the standard ANSI heavy line + arrowheads on the parent view. The user drags toward the desired placement position. Unlike full section, the drop gesture does NOT immediately commit: the mouse-up ends the drag phase and transitions to stage 5.

**Stage 5 — pickCutSide (new):** The `<HalfSectionSidePreview>` overlay appears at the drop location. It shows a small diagram of the section line with a half-fill shading on the hovered side (the side that will be removed and exposed). The fill width is at minimum 20 px to remain legible at all zoom levels. The status bar reads "Click or press Enter to confirm cut side. ArrowLeft/ArrowRight to toggle. Esc to cancel." The user can:
- Hover over either side of the section line to preview the cut side (the overlay updates live without any kernel call).
- Press **ArrowLeft** or **ArrowRight** to toggle the cut side (no kernel call; UI only).
- Click on the hovered side, or press **Enter**, to commit. The command is dispatched with the selected `cutSide`.
- Press **Esc** to cancel the entire operation and return to `idle`.

There is NO live kernel preview in stage 5 — the kernel call is deferred until after commit to avoid a ~30 ms thrash on every mouse event.

After commit, the half-section view is created and placed at the drop position. The parent view shows the ANSI section line. The new view shows:
- On the section-plane face: hatch fill (same per-material hatching as full section).
- On the split-plane face: no hatch (the split plane face is edge-on to the view direction by construction; it projects to zero area and therefore produces no hatch segments).
- Edges from both cut planes contribute to the visible 2D edge set.
- The caption reads "SECTION A-A" (same as full section, using the shared label allocator).

**Undo/redo:** `Ctrl+Z` removes both the half-section view and its parent annotation in one step (same `AddSectionViewCommand` revert path). `Ctrl+Y` restores both atomically.

**Deletion from tree:** Right-click → Delete on the half-section view in `DrawingTreePane` invokes `DeleteViewCommand`. The cascade path is unchanged (it already removes by `parentViewId` regardless of `mode`).

### 2.2 ANSI visual description

In the resulting half-section view, the right-hand side of the image (assuming the cut is on the right with `cutSide: 1`) shows the interior of the part with hatch fill across the exposed cut face. The left-hand side shows the exterior profile as if the part were not cut — full silhouette and feature edges, no hatch. The boundary between the two sides at the section line is a visible edge emitted by the projector. From the outside the view looks like two views stitched at the section-line boundary: half a section view and half an orthographic view.

---

## 3. Data model

### 3.1 `SectionView` extension

```ts
// packages/shared/src/drawing/types.ts (modified)

export type SectionView = {
  readonly id: string;
  readonly kind: 'section';
  readonly parentViewId: string;
  readonly sectionLine: { readonly p0: Vec2; readonly p1: Vec2 };
  readonly arrowDirection: -1 | 1;
  readonly label: string;
  readonly positionMm: Vec2;
  readonly scale: ViewScale;
  readonly showHidden: false;

  // --- NEW in F1.1 ---
  readonly mode: 'full' | 'half';          // 'full' is the F1 default
  readonly cutSide?: -1 | 1;               // present iff mode === 'half'
  readonly splitPlane?: {                  // present iff mode === 'half'
    readonly origin: { readonly x: number; readonly y: number; readonly z: number };
    readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  };
  // α-invariant: mode === 'half' ⟺ cutSide !== undefined && splitPlane !== undefined
  // Enforced at command time (see §7.1).

  readonly plane?: { readonly origin: Vec3; readonly normal: Vec3 }; // section plane (unchanged)
  readonly hatchSegments: readonly HatchSegment[];
  readonly fingerprint: string;
  readonly projection?: {
    readonly visibleEdges: readonly Edge2D[];
    readonly hiddenEdges: readonly Edge2D[];
    readonly bbox: { minX: number; minY: number; maxX: number; maxY: number };
  };
  readonly inputFingerprint?: string;
  readonly breaks?: readonly BreakRegion[];
  readonly rawProjection?: ProjectedGeometry;
};
```

Three new fields are added. All are optional at the TypeScript level to preserve structural compatibility. The α-invariant is a runtime contract enforced by `AddSectionViewCommand` and its property test (§8.3), not a TypeScript type narrowing.

### 3.2 Manifest v17 → v18

```ts
// packages/shared/src/fileFormat.ts (modified)
export const CURRENT_FORMAT_VERSION = 18 as const;

// migrations[17]: additive — back-fill mode: 'full' on existing section views.
17: (mIn) => {
  const m = deepClone(mIn);
  if (m.kind === 'drawing') {
    for (const sheet of m.sheets ?? []) {
      for (const view of sheet.views ?? []) {
        if (view.kind === 'section' && view.mode === undefined) {
          view.mode = 'full';
        }
      }
    }
  }
  return { ...m, formatVersion: 18 };
},
```

Unlike most migrations which are pass-throughs, v17→v18 actively back-fills `mode: 'full'` on every existing `SectionView`. This is the only mutation. `cutSide` and `splitPlane` remain absent on back-filled views (consistent with α-invariant for `mode: 'full'`).

**Test files requiring cascade** (all `toBe(17)` → `toBe(18)` and `CURRENT_FORMAT_VERSION` guards):

```
packages/shared/src/__tests__/fileFormat.spec.ts
packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts
packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts
packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts
packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts
packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts
packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts
packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts
packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts
```

New file to add: `packages/shared/src/__tests__/migrateManifest-v17-to-v18.spec.ts` — two cases:
1. v17 drawing with one `SectionView` (no `mode` field) → v18 output has `mode: 'full'` on that view.
2. v18 drawing with a `SectionView` carrying `mode: 'half'`, `cutSide: 1`, and a `splitPlane` round-trips through `JSON.parse(JSON.stringify(...))` intact.

### 3.3 α-invariant statement

> **α-invariant:** `view.mode === 'half'` if and only if `view.cutSide !== undefined` AND `view.splitPlane !== undefined`.

This is enforced in two places:
- `AddSectionViewCommand.apply()` — throws `'half-section-invariant-violated'` if the invariant would be broken before committing to the store.
- Property test in `packages/app/src/commands/__tests__/AddSectionViewCommand.spec.ts` — generates random `mode`, `cutSide`, `splitPlane` combinations and asserts the invariant holds after `apply()`.

---

## 4. Kernel

### 4.1 Extended `cutBySectionPlane` signature

```ts
// packages/kernel/src/section/cutBySectionPlane.ts (modified)

export function cutBySectionPlane(
  oc: OcctInstance,
  source: unknown /* TopoDS_Compound */,
  plane: Plane,
  arrowDirection: -1 | 1,
  splitPlane?: Plane,   // NEW — present iff mode === 'half'
  splitSide?: -1 | 1,  // NEW — which side of splitPlane to keep; present iff splitPlane defined
): Result;
```

When `splitPlane` is `undefined` (the `mode: 'full'` path), the function is behaviorally identical to the F1 implementation. The two optional parameters have no effect on the existing code path; no regression is possible from the extension.

### 4.2 Quarter-space box tool construction

When `splitPlane` is provided, the kernel builds a **finite oversized box** that occupies the single quadrant to be removed (the intersection of the half-space removed by `plane` and the half-space removed by `splitPlane` on `splitSide`). This box is then subtracted from the source via a second `BRepAlgoAPI_Cut` call.

The finite-box approach is chosen over `BRepAlgoAPI_Common` on two infinite half-spaces because:
- OCCT `BRepAlgoAPI_Common` on two infinite half-spaces is numerically fragile at the intersection edge (unbounded geometry causes tolerance failures on some OCCT versions).
- A finite oversized box is a well-tested OCCT primitive; the existing `buildHalfSpace` already uses the same pattern.

**Box construction algorithm:**

```ts
// Pseudo-code inside cutBySectionPlane when splitPlane is defined:

// 1. Compute the parent-body bounding box expanded by ε = 1 mm on all sides.
const bbox = computeBoundingBox(source);
const ε = 1.0; // mm
const expanded = expandBBox(bbox, ε);

// 2. Start from the expanded bbox as the initial box.
//    Position the box so it occupies the quadrant defined by:
//      - the side of `plane` in direction opposite to `arrowDirection` (already-removed half)
//      - the side of `splitPlane` in direction `splitSide`
//    The box is a BRepPrimAPI_MakeBox aligned to the world axes that covers
//    the quadrant; its faces are NOT required to be coincident with the planes
//    (it can overshoot; it's subtracted, not intersected).
const boxCorner = computeQuadrantBoxCorner(expanded, plane, arrowDirection, splitPlane, splitSide);
const boxExtents = computeQuadrantBoxExtents(expanded, plane, splitPlane);
const quarterBox = buildAlignedBox(oc, boxCorner, boxExtents); // BRepPrimAPI_MakeBox_2

// 3. First cut: source minus halfSpaceBox (section plane) — identical to F1.
const cutResult1 = brepAlgoApiCut(oc, source, halfSpaceBox);

// 4. Second cut: cutResult1 minus quarterBox (split plane).
const cutResult2 = brepAlgoApiCut(oc, cutResult1, quarterBox);

// 5. Classify faces from BOTH cuts via classifyFace (see §4.3).
// 6. Return cutResult2 compound with extended FaceTagMap.
```

The `computeQuadrantBoxCorner` helper finds the world-space corner of the expanded bbox that lies in the quadrant defined by the two planes. Because the box overshoots the geometry bounds by ε, the split is geometrically clean: no source face is tangent to the quarter box.

### 4.3 Extended face tagging

`faceTag.ts` already defines `FaceTagMap`:

```ts
export type FaceTagMap = Map<string, {
  tag: 'cut-face' | 'original-face';
  partId: string;
  materialId: string;
  polygon3D?: Vec3[];
}>;
```

The tag values are extended with a new optional field to record which plane produced the tag:

```ts
export type FaceTagMap = Map<string, {
  tag: 'cut-face' | 'original-face';
  partId: string;
  materialId: string;
  polygon3D?: Vec3[];
  planeSource?: 'section' | 'split';   // NEW — present only on cut-face entries
}>;
```

`classifyFace` is called twice:
- After the first `BRepAlgoAPI_Cut` (section plane): faces lying within distance 1e-4 mm of `plane` are tagged `cut-face` with `planeSource: 'section'`.
- After the second `BRepAlgoAPI_Cut` (split plane): faces lying within distance 1e-4 mm of `splitPlane` are tagged `cut-face` with `planeSource: 'split'`.

All other faces retain `tag: 'original-face'` with `planeSource` absent.

`cutAssemblyBySectionPlane` gains the same two optional parameters and threads them through to per-component `cutBySectionPlane` calls:

```ts
// packages/kernel/src/section/cutBySectionPlane.ts (modified)
export function cutAssemblyBySectionPlane(
  oc: OcctInstance,
  opts: AssemblyCutOptions,
  splitPlane?: Plane,
  splitSide?: -1 | 1,
): Promise<{ compound: unknown; faceTags: FaceTagMap }>;
```

### 4.4 Comlink boundary

The Comlink worker adapter (`packages/app/src/drawing/projectSectionView.ts` and the kernel worker entry point) is unchanged at the message-passing API level. The kernel call passes `splitPlane` and `splitSide` as additional payload fields on the existing worker message type. Because these fields are optional, the worker message schema remains backward-compatible: existing callers that do not set these fields continue to receive full-section behaviour.

---

## 5. Projector

### 5.1 Extended fingerprint

`fingerprintSectionView` in `packages/shared/src/drawing/fingerprint.ts` currently incorporates `parentSourceFingerprint`, `planeFp`, `scale`, `arrowDirection`, and `sectionLine`. It is extended to also hash `mode` and (when `mode === 'half'`) `cutSide` and the split-plane coordinates:

```ts
// packages/shared/src/drawing/fingerprint.ts (modified)
export function fingerprintSectionView(
  view: SectionView,
  parentSourceFingerprint: string,
): string {
  const planeFp = view.plane ? fingerprintPlane(view.plane) : 'no-plane';

  // NEW: split-plane contribution
  const splitFp = (view.mode === 'half' && view.splitPlane)
    ? [
        view.splitPlane.origin.x.toFixed(3),
        view.splitPlane.origin.y.toFixed(3),
        view.splitPlane.origin.z.toFixed(3),
        view.splitPlane.normal.x.toFixed(3),
        view.splitPlane.normal.y.toFixed(3),
        view.splitPlane.normal.z.toFixed(3),
        String(view.cutSide),
      ].join(',')
    : 'full';

  const payload = [
    parentSourceFingerprint,
    planeFp,
    view.scale.numerator,
    view.scale.denominator,
    view.arrowDirection,
    view.sectionLine.p0.x.toFixed(3),
    view.sectionLine.p0.y.toFixed(3),
    view.sectionLine.p1.x.toFixed(3),
    view.sectionLine.p1.y.toFixed(3),
    view.mode,    // NEW
    splitFp,      // NEW
  ].join('|');
  return djb2(payload);
}
```

Consequence: all existing `SectionView` entries in cached drawings have `mode: 'full'` (back-filled by migration). Their fingerprints will recompute on first read post-upgrade because `fingerprintSectionView` now appends `|full|full`. The stale banner fires for all existing section views after the upgrade, prompting the user to Regenerate. This is documented behaviour, not a bug.

### 5.2 `deriveSplitPlane` helper

The split plane is the world plane that contains the section line and the view direction (i.e., perpendicular to the section plane and passing through the section line). It is the plane that divides "near half" from "far half" when looking at the section from the arrowDirection.

```ts
// packages/shared/src/drawing/sectionPlane.ts (modified)

/**
 * Derive the split plane for a half-section view.
 *
 * The split plane is orthogonal to the section plane, contains the section line,
 * and has its normal pointing in the `cutSide` direction along the section line.
 *
 * @param sectionLine  - p0, p1 in parent view-local mm space
 * @param parentViewMatrix - row-major 4×4 view-to-world matrix of the parent view
 * @param cutSide      - which side of the split plane to remove (-1 or +1)
 * @returns A world-space Plane { origin, normal }
 */
export function deriveSplitPlane(
  sectionLine: { p0: Vec2; p1: Vec2 },
  parentViewMatrix: Mat4,
  cutSide: -1 | 1,
): Plane {
  // 1. Section line direction in view space:
  //    lineDir2D = normalize(p1 - p0)
  // 2. The split plane's view-space normal is perpendicular to lineDir2D in the XY plane,
  //    pointing in cutSide direction:
  //    splitNormal2D = { x: -lineDir2D.y * cutSide, y: lineDir2D.x * cutSide, z: 0 }
  // 3. Transform splitNormal2D to world space via inverse(R_parent):
  //    splitNormal3D = normalize(R_parent^{-1} · splitNormal2D)
  // 4. Section line midpoint → world space:
  //    midView = { x: (p0.x+p1.x)/2, y: (p0.y+p1.y)/2, z: depthBuffer.midZ(mid) }
  //    splitOrigin = R_parent^{-1} · midView   (same as sectionPlane origin)
  // 5. Return { origin: splitOrigin, normal: splitNormal3D }
}
```

This helper is pure (no OCCT dependency) and lives alongside the existing `deriveSectionPlane` in `packages/shared/src/drawing/sectionPlane.ts`.

### 5.3 Why the split-plane face produces zero hatch by construction

The split plane is, by construction, parallel to the view direction (it contains the section line, which runs perpendicular to the view normal). Any face that lies in the split plane is therefore edge-on to the view: its projected 2D outline has zero area. The hatch generator in `hatchGenerator.ts` clips hatch lines to the projected face polygon; a zero-area polygon produces zero hatch segments regardless of the face tag. No special case is needed in the projector — the geometry ensures zero hatch on split-plane faces automatically.

The split-plane face still contributes to the **edge set**: the polyline boundary of the face projects to visible edges that divide the section half from the un-cut half in the 2D view. These edges are tagged `planeSource: 'split'` and render as ordinary feature edges (no special stroke).

### 5.4 `projectSectionView` entry point

The `projectSectionView` function signature is unchanged. It receives the already-cut `cutCompound` from the kernel (regardless of full- or half-section), runs the standard projector pipeline, and routes hatch generation based on `faceTags`. The only new behaviour is: tags with `planeSource: 'split'` and `tag: 'cut-face'` are excluded from the hatch pass (they are edge-on and would produce zero segments anyway, but this guard is explicit for clarity).

```ts
// packages/app/src/drawing/projectSectionView.ts — no signature change
// Internal hatch filter (pseudocode):
for (const [faceId, entry] of faceTags) {
  if (entry.tag === 'cut-face' && entry.planeSource !== 'split') {
    // generate hatch for this face
  }
}
```

---

## 6. Tool mode & UI

### 6.1 Extended `SectionToolState` — 5th stage

```ts
// packages/app/src/drawing/toolMode.ts (modified)

export type SectionToolState =
  | { stage: 'idle' }
  | { stage: 'pickP0'; parentViewId: string }
  | { stage: 'pickP1'; parentViewId: string; p0: Vec2 }
  | { stage: 'pickDrop'; parentViewId: string; p0: Vec2; p1: Vec2; arrowDirection: -1 | 1 }
  | {                           // NEW — half-section only
      stage: 'pickCutSide';
      parentViewId: string;
      p0: Vec2;
      p1: Vec2;
      arrowDirection: -1 | 1;
      dropAt: Vec2;
      pendingCutSide: -1 | 1;   // tracks hovered/toggled side before commit
    };
```

The `pickCutSide` stage is only entered when the active section tool mode is "half section" (i.e., the user clicked the **Half Section** ribbon button, not the existing **Section** button). Full-section flows transition from `pickDrop` directly to command dispatch (existing behaviour, unchanged). The store needs one new action:

```ts
// packages/app/src/drawing/toolMode.ts (modified — store additions)
interface ToolModeState {
  // ... existing fields ...
  sectionMode: 'full' | 'half';           // NEW — which ribbon button was clicked

  setSectionMode(m: 'full' | 'half'): void;
  sectionPickCutSide(side: -1 | 1): void; // update pendingCutSide in pickCutSide stage
  sectionCommitCutSide(onDispatch: (cutSide: -1 | 1, dropAt: Vec2) => void): void;
}
```

### 6.2 Stage transition table

| From stage | Action | To stage (full) | To stage (half) |
|---|---|---|---|
| `idle` (mode=section) | enter section mode | `pickP0` (via pickParent) | `pickP0` (via pickParent) |
| `pickDrop` | mouse-up / click to drop | → dispatch command | → `pickCutSide` |
| `pickCutSide` | click / Enter | — | → dispatch command, return `idle` |
| `pickCutSide` | Esc | — | → `idle`, cancel |
| any | Esc | → `idle` (unchanged) | → back one stage |

The four-stage flow (`pickP0 → pickP1 → pickDrop → (full: dispatch | half: pickCutSide)`) reuses the existing `sectionPickP0 / sectionPickP1 / sectionPickDrop` store actions without modification. Only the transition OUT of `pickDrop` differs: for half sections, instead of dispatching the command, the store transitions to `pickCutSide` with `pendingCutSide: 1` (default right side).

### 6.3 Ribbon button — separate "Half Section"

```ts
// packages/app/src/shell/tabs/DrawingTab.tsx (modified)
// Place Views panel:
//   Base View | Projected View | Section | Half Section | Detail | Add Break | Iso
// "Half Section" is a SEPARATE button, NOT a toggle variant of "Section".
// Clicking "Half Section" calls setSectionMode('half') then sets mode to 'section'.
// Clicking "Section" calls setSectionMode('full') then sets mode to 'section'.
```

Both buttons share the same `mode: 'section'` tool mode; the `sectionMode` store field tracks which variant is active. The `SectionLineOverlay` picks up the `sectionMode` from the store to show appropriate hover feedback.

Disabled condition: same as "Section" — greyed when no `base` or `projected` views exist on the active sheet.

### 6.4 `<HalfSectionSidePreview>` component

```tsx
// packages/app/src/drawing/HalfSectionSidePreview.tsx (new)

type Props = {
  sectionLine: { p0: Vec2; p1: Vec2 };  // in sheet-space mm (after scale + position)
  pendingCutSide: -1 | 1;
  zoom: number;                          // sheet zoom factor
  onSideHover: (side: -1 | 1) => void;
  onCommit: (side: -1 | 1) => void;
};

/**
 * Renders as an absolutely-positioned SVG overlay near the drop position.
 * Shows a miniature section line with:
 *   - A dotted half-fill polygon on the pendingCutSide side (the side to be cut away).
 *   - A small arrow on the pendingCutSide side indicating removal.
 *   - Min fill width: 20 px regardless of zoom (clamped in layout).
 * Mouse-enter on each half updates pendingCutSide via onSideHover.
 * Click on either half calls onCommit(side).
 * ArrowLeft / ArrowRight keyboard events (captured at document level while stage=pickCutSide)
 *   toggle pendingCutSide without triggering onCommit.
 * Enter commits with pendingCutSide.
 * Esc calls DrawingCanvas.cancelSection() (routed via onCommit(undefined) sentinel — 
 *   see §6.5 for the escape hatch).
 */
```

No live kernel preview is shown in this overlay. The dotted half-fill is a pure CSS/SVG geometry preview based on the known section-line geometry. The actual half-section geometry is computed only after `onCommit` fires.

### 6.5 Keyboard bindings during `pickCutSide`

| Key | Effect |
|---|---|
| ArrowLeft | Toggle `pendingCutSide` to -1 (left side) |
| ArrowRight | Toggle `pendingCutSide` to 1 (right side) |
| Enter | Commit with current `pendingCutSide` |
| Escape | Cancel, return to `idle` |

Keyboard events are captured at the `DrawingCanvas` level (not at the overlay component) to avoid focus management complexity. The `DrawingCanvas` already handles global keyboard events for ESC cancel in other tool modes.

### 6.6 Hover-side detection geometry

The "which side is the cursor on" determination is a pure 2D sign test in sheet-space (mm, post-scale, post-view-position). Given:

- `p0`, `p1` — section line endpoints in sheet-space (the same coords passed to `<HalfSectionSidePreview>` props).
- `mouse` — current cursor position in sheet-space (`event.clientX/Y` mapped through the existing `DrawingCanvas` → sheet-space transform; same transform used by `pickP0`/`pickP1`).

Compute:

```ts
// packages/shared/src/drawing/sectionPlane.ts (new helper)
export function sideOfSectionLine(
  p0: Vec2,
  p1: Vec2,
  mouse: Vec2,
): -1 | 1 {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const cross = (mouse.x - p0.x) * dy - (mouse.y - p0.y) * dx;
  return cross >= 0 ? 1 : -1;
}
```

Convention: `+1` is the "right" side when looking from `p0` toward `p1`; `-1` is the "left" side. The `<HalfSectionSidePreview>` consumes this on every `mousemove` while `stage === 'pickCutSide'` and updates `pendingCutSide` via `onSideHover`. The sign is stable across zoom because it operates on sheet-space coordinates, not pixel coordinates.

Unit test **HS-SP-5** in `sectionPlane.spec.ts` covers: horizontal/vertical/diagonal section lines × mouse on each side × mouse exactly on the line (returns `+1` by tie-break since `cross === 0`).

---

## 7. Command

### 7.1 `AddSectionViewCommand` apply() delta — half-section path

```ts
// packages/app/src/commands/AddSectionViewCommand.ts (modified)

export type AddSectionViewPayload = {
  drawingId: string;
  sheetId: string;
  parentViewId: string;
  p0: Vec2;
  p1: Vec2;
  arrowDirection: -1 | 1;
  dropAt: Vec2;
  // --- NEW in F1.1 ---
  mode: 'full' | 'half';
  cutSide?: -1 | 1;    // required when mode === 'half'
};

// Inside apply():
// (existing steps 1–3: resolve sheet + parent, derive section plane — unchanged)

// NEW step 3a (half-section only):
if (opts.mode === 'half') {
  // α-invariant guard:
  if (opts.cutSide === undefined) {
    throw new Error('half-section-invariant-violated');
  }
  // Derive split plane from section line, parent view matrix, cutSide:
  splitPlane = deriveSplitPlane(
    { p0: opts.p0, p1: opts.p1 },
    parentViewMatrix,
    opts.cutSide,
  );
  // Compute extended cache fingerprint (see §7.3):
  cacheKey = computeHalfSectionCacheKey(sectionPlane, splitPlane, opts.cutSide, sourceFp);
} else {
  cacheKey = computeFullSectionCacheKey(sectionPlane, sourceFp);  // unchanged
}

// Step 4: cache lookup (extended key for half, existing key for full — unified path):
const cached = await sectionCache.getCachedCut(cacheKey);
if (cached) {
  // ... load from OPFS as before ...
} else {
  // Step 5: kernel cut — NEW: pass splitPlane and cutSide when mode === 'half':
  const result = opts.mode === 'half'
    ? await cutAssemblyBySectionPlane(oc, assemblyCutOptions, splitPlane, opts.cutSide)
    : await cutAssemblyBySectionPlane(oc, assemblyCutOptions);
  // ... store to OPFS ...
}

// Steps 6–8: projectSectionView, label, store — UNCHANGED.
// (projectSectionView receives the cut compound regardless of mode; projector is mode-agnostic.)

// Step 9 — store the SectionView with new fields:
const newView: SectionView = {
  // ... existing fields ...
  mode: opts.mode,
  cutSide: opts.cutSide,        // undefined for 'full'
  splitPlane: splitPlane        // undefined for 'full'
    ? { origin: splitPlane.origin, normal: splitPlane.normal }
    : undefined,
};
// α-invariant check before commit:
if (newView.mode === 'half' && (newView.cutSide === undefined || newView.splitPlane === undefined)) {
  throw new Error('half-section-invariant-violated');
}
```

### 7.2 `AddSectionViewCommand` revert() delta

Revert is identical to the F1 path — remove the `SectionView` from `sheet.views`, remove the label from the allocator, delete the OPFS cache entry by `cacheKey`. The only additional step is deleting the extended cache key (which already contains the split-plane hash for half-sections, so no structural change to the revert logic).

```ts
// revert() — no new logic; cacheKey covers both full and half paths.
await sectionCache.delete(this.cacheKey);
// sectionCache.delete(key: string): Promise<void> already exists in
// packages/app/src/drawing/sectionCache.ts (line 17). F1's revert path
// did NOT call it — F1.1 adds the call.
```

Note: F1's revert intentionally skipped cache eviction ("cache is LRU-managed"). F1.1 adds an explicit `sectionCache.delete(cacheKey)` call on revert so that undo-redo cycles do not accumulate stale half-section cache entries with different splitPlane hashes. No new `sectionCache` API is needed; the existing `delete(key)` method is sufficient.

### 7.3 Cache key extension

The OPFS cache key for half-sections incorporates both planes:

```ts
// Extended cache key for half-section:
// sha256(sourceFp + '|' + planeFp + '|' + splitPlaneFp + '|' + cutSide)
// where:
//   planeFp     = fingerprintPlane(sectionPlane)
//   splitPlaneFp = fingerprintPlane(splitPlane)
//   cutSide      = '1' or '-1'

function computeHalfSectionCacheKey(
  sectionPlane: Plane,
  splitPlane: Plane,
  cutSide: -1 | 1,
  sourceFp: string,
): Promise<string>;

// Full-section key is unchanged from F1:
// sha256(sourceFp + '|' + planeFp)
```

`fingerprintPlane` from `packages/app/src/drawing/planeFingerprint.ts` (already used by `fingerprintSectionView`) rounds floats to 1e-3 mm for determinism.

### 7.4 `DeleteViewCommand` cascade — unchanged

`DeleteViewCommand` identifies the view by `viewId`, removes it from `sheet.views`, and removes any associated `SectionLineOverlay` data derived from it. The cascade keyed on `parentViewId` (for removing section views when a parent is deleted) checks `view.kind === 'section'` — not `view.mode`. Both `mode: 'full'` and `mode: 'half'` views are therefore cleaned up by the existing cascade path without modification.

---

## 8. Tests

### 8.1 Unit tests (~30 new)

#### `packages/kernel/src/section/__tests__/cutBySectionPlane.spec.ts` (extend existing)

- **HS-K-1:** Single 100×60×40 mm box, section plane at x=50, split plane at y=0 (midplane), `cutSide: 1`. Result compound has faces from section plane (tagged `cut-face, planeSource: 'section'`) and faces from split plane (tagged `cut-face, planeSource: 'split'`). Remaining geometry is one quadrant (~1/4 of original volume ± 1%).
- **HS-K-2:** Same box, `splitPlane` omitted (full section). Result is the existing F1 half-space cut (unchanged baseline). Confirms backward compatibility.
- **HS-K-3:** Assembly with 3 components, half-section cut. Each component has section-tagged and split-tagged faces. `cutAssemblyBySectionPlane` with splitPlane/splitSide parameters yields per-component quadrant cuts.
- **HS-K-4:** Plane tangent to box face — existing degenerate-cut detection fires; half-section path returns `{ ok: false, reason: 'tangent' }`.

#### `packages/shared/src/drawing/__tests__/sectionPlane.spec.ts` (extend existing)

- **HS-SP-1:** `deriveSplitPlane` — front-view parent, horizontal section line, `cutSide: 1`. Returns plane with normal = world-X (pointing right), origin = section-line midpoint in world space.
- **HS-SP-2:** `deriveSplitPlane` — `cutSide: -1`. Normal flips to -world-X. Same origin.
- **HS-SP-3:** `deriveSplitPlane` — top-view parent, vertical section line. Normal = world-Z.
- **HS-SP-4:** `deriveSplitPlane` — 45° section line. Normal is correctly perpendicular to line direction and perpendicular to view direction.

#### `packages/shared/src/drawing/__tests__/fingerprintSectionView.spec.ts` (new)

- **HS-FP-1:** Two identical half-section views → identical fingerprint.
- **HS-FP-2:** Same view, `cutSide` flipped from 1 to -1 → different fingerprint.
- **HS-FP-3:** Same view, `splitPlane.origin` shifted 0.5 mm → different fingerprint.
- **HS-FP-4:** Full-section view fingerprint ≠ half-section view fingerprint with identical section plane.
- **HS-FP-5:** Back-filled view (`mode: 'full'`, no `splitPlane`) → fingerprint is stable and differs from `mode: 'half'` fingerprint.

#### `packages/shared/src/drawing/__tests__/projectSectionView.spec.ts` (extend existing)

- **HS-PR-1:** Half-section cut compound has split-plane-tagged faces. Projector produces zero hatch segments for those faces.
- **HS-PR-2:** Section-plane-tagged faces produce hatch segments (≥ 1).
- **HS-PR-3:** Edges from both section-plane and split-plane faces appear in `visibleEdges`.
- **HS-PR-4:** Full-section and half-section of the same parent view produce same total edge count or more (half-section has split-plane boundary edges in addition).

#### `packages/app/src/drawing/__tests__/toolMode.spec.ts` (extend existing)

- **HS-TM-1:** `setSectionMode('half')` → `sectionMode === 'half'` in store.
- **HS-TM-2:** Full-section `pickDrop` → dispatch (no `pickCutSide` stage entered).
- **HS-TM-3:** Half-section `pickDrop` → `sectionState.stage === 'pickCutSide'`; `pendingCutSide === 1`.
- **HS-TM-4:** `sectionPickCutSide(-1)` → `pendingCutSide === -1`.
- **HS-TM-5:** `sectionCommitCutSide(onDispatch)` → `onDispatch` called with current `pendingCutSide`; `sectionState.stage === 'idle'`.
- **HS-TM-6:** ESC from `pickCutSide` → `stage === 'idle'`.

#### `packages/app/src/commands/__tests__/AddSectionViewCommand.spec.ts` (extend existing)

- **HS-CMD-1:** `mode: 'half'` with valid `cutSide` and `splitPlane` → `sheet.views` gains one `SectionView` with `mode: 'half'`, `cutSide: 1`, `splitPlane` defined.
- **HS-CMD-2:** `mode: 'half'` with `cutSide: undefined` → throws `'half-section-invariant-violated'`.
- **HS-CMD-3:** Apply half-section → revert → `sheet.views.length` restored; cache key deleted (confirm via `sectionCache.delete` spy called once with the half-section cacheKey).
- **HS-CMD-4:** Apply same half-section twice (same planes) → second apply uses cache hit (kernel cut NOT called second time).
- **HS-CMD-5 (α-invariant property test):** Generate 50 random `(mode, cutSide, splitPlane)` triples. For each valid triple, assert that after `apply()`, the stored view satisfies `mode === 'half' ⟺ (cutSide !== undefined && splitPlane !== undefined)`.

#### `packages/shared/src/__tests__/migrateManifest-v17-to-v18.spec.ts` (new)

- v17 drawing with one `SectionView` missing `mode` → v18 view has `mode: 'full'`.
- v18 drawing with `mode: 'half'` + `cutSide: 1` + `splitPlane` round-trips intact.

### 8.2 E2E — `tests/e2e/drawing/T-6-10-half-section-view.spec.ts` (new)

```
T-6-10: Half-section view — create, hatch, cascade-delete

Precondition: 100×60×40 mm box part; existing drawing with one BaseView (Front, 1:1).

1. Click Drawing → Place Views → Half Section.
2. Click base view (pickParent) → click left-centre (p0) → click right-centre (p1) →
   drag below base view (pickDrop) → click right half (pickCutSide, side=1) → Enter.

Assertion (a): The SectionView in store has mode === 'half', cutSide === 1, splitPlane defined.

Assertion (b): view.hatchSegments.length > 0 AND all hatch segments come from section-plane
               faces (planeSource: 'section'). No hatch from planeSource: 'split' faces.
               Verify: hatchSegments is non-empty; project a point on the split-plane face —
               confirm it has no corresponding hatch segment.

Assertion (c): view.projection.visibleEdges contains at least one edge whose points lie
               approximately on the split-plane (x ≈ p0.x in parent view space). This confirms
               the split-plane boundary is visible as a feature edge.

Assertion (d): Parent base view's SVG contains a <line> or <polyline> with data-role="section-line".
               (The section line is rendered identically to full section via SectionLineOverlay.)

Assertion (e): Delete the parent base view (DeleteViewCommand on parentViewId).
               Assert: the half-section SectionView is also removed from sheet.views
               (cascade-delete works for mode: 'half' identically to mode: 'full').
```

### 8.3 Perf — extend `tests/perf/section-cut.perf.spec.ts`

Add one new measurement block in the existing `section-cut.perf.spec.ts`:

```ts
// Half-section measurement on the same 50×50×30 mm box fixture used in F1:
it('half-section cut+project p95 < 400ms', async () => {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    await runHalfSectionCutAndProject(boxFixture, midPlane, splitPlane, cutSide);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95)]!;
  expect(p95).toBeLessThan(400);
});
```

Budget rationale: same 400 ms as F1's full-section budget. The second `BRepAlgoAPI_Cut` is on an already-reduced compound (one quadrant removed) and is expected to be faster than the first; total overhead is modest.

---

## 9. Performance budget

| Metric | p95 budget | Rationale |
|---|---|---|
| `cutBySectionPlane` + `projectSectionView`, half-section, 20-component assembly | 400 ms | Two `BRepAlgoAPI_Cut` calls sequentially; second cut is on the reduced compound. F1 full-section measured ~29 ms on the 50×50×30 box fixture — 400 ms provides 13× headroom. |
| Same cut, cache hit (OPFS read + project) | 30 ms | Same as F1; cache read dominates. |
| `AddSectionViewCommand` end-to-end round-trip (worker Comlink) | 450 ms | 50 ms Comlink overhead over 400 ms cut budget. |
| `<HalfSectionSidePreview>` hover update (no kernel call) | 16 ms | Pure SVG geometry; no rasterisation. |
| `deriveSplitPlane` helper (pure math) | < 1 ms | Matrix multiply + normalize; no OCCT. |

The second `BRepAlgoAPI_Cut` operates on the result of the first cut (roughly half the original geometry), so the combined budget is expected to be 1.3–1.5× the single-cut time, not 2×. The 400 ms budget absorbs this comfortably.

---

## 10. Migration and cache

### 10.1 v17 → v18 manifest migration

The migration is additive with one data mutation: `mode: 'full'` is back-filled on existing `SectionView` entries. `cutSide` and `splitPlane` remain absent. No section line, label, or hatch data is modified.

On upgrade, all existing section views will have their `fingerprintSectionView` output change (because the fingerprint now includes `|full|full`). The stored `view.fingerprint` and `view.inputFingerprint` will no longer match the computed fingerprint, causing stale banners to appear on all section views. This is intended and documented:

> After upgrading to v18, section views show ⚠ "Stale". Clicking "Regenerate" clears the banner. This is a one-time operation per view.

### 10.2 BREP cache wholesale recompute

The OPFS cache at `opfs:/cache/section/` stores keys based on `sha256(sourceFp + planeFp)` (full section) and `sha256(sourceFp + planeFp + splitPlaneFp + cutSide)` (half section). Existing F1 cache entries use the old key format. Because the new `fingerprintSectionView` produces different fingerprints, all existing cache entries become unreachable (no matching key lookup). They are not deleted — the LRU eviction in `sectionCache.ts` (cap 100 MB) handles cleanup over time. On first Regenerate after upgrade, the kernel cut re-runs and stores a new entry with the v18 key format.

No manual cache invalidation is required. No migration step touches OPFS.

---

## 11. Scope and non-goals

### 11.1 What this feature delivers

1. `mode: 'full' | 'half'` on `SectionView`; `cutSide` and `splitPlane` optional fields.
2. Manifest v17 → v18 with `mode: 'full'` back-fill on existing section views.
3. `cutBySectionPlane` extended with `splitPlane` / `splitSide` optional parameters; quarter-space box tool using `BRepPrimAPI_MakeBox` (not `BRepAlgoAPI_Common`).
4. `faceTag.ts` extended with `planeSource: 'section' | 'split'` on `cut-face` entries.
5. `deriveSplitPlane` helper in `sectionPlane.ts`.
6. `fingerprintSectionView` extended to hash `mode` + split-plane fields.
7. `AddSectionViewCommand` extended payload with `mode` / `cutSide`.
8. Explicit `sectionCache.delete(cacheKey)` call on revert (uses existing `sectionCache` API; F1's revert path did not call it).
9. `SectionToolState` extended with `pickCutSide` 5th stage.
10. `HalfSectionSidePreview` overlay component with 20 px min fill width, ArrowLeft/Right toggle, Enter commit, Esc cancel.
11. Separate "Half Section" ribbon button.
12. ~30 unit tests + T-6-10 e2e + perf extension.

### 11.2 Explicitly deferred

All other F1.x items remain deferred:

| ID | Item |
|---|---|
| F1.2 | Stepped / offset section views (line with bends through multiple parallel planes) |
| F1.3 | Per-component "do not section" flag |
| F1.4 | Arrow direction inversion after placement |
| F1.5 | Per-adjacent-component hatch angle rotation (ANSI assembly hatch differentiation) |
| F1.6 | Nested section parents (section-of-section) |
| F1.7 | Typed `viewMatrix` on `BaseView` (currently implicit in `deriveSectionPlane`) |
| F1.8 | Arrow-flip overlay (flip arrow side post-placement) |

Additionally, the following F1.1.x items are deferred to follow-up:

| ID | Item |
|---|---|
| F1.1.1 | Edit existing half-section: flip cut side via property panel |
| F1.1.2 | Convert full ↔ half on existing section view (in-place mode change) |
| F1.1.3 | Live preview during `pickCutSide` (debounced kernel call on hover) |
| F1.1.4 | Half-section on assembly parents with per-component opt-out (depends on F1.3) |

The ANSI chain-dash centre line style (thin chain-dot for the boundary between cut and un-cut halves) is not rendered in v1. The section line renders identically to full section. This is a cosmetic non-compliance with strict ANSI Y14.3 practice; acceptable for furniture CAD.

---

## 12. Deferred follow-ups

### F1.1.1 — Flip cut side via property panel

After a half-section is placed, the user may wish to flip which half was cut without deleting and re-placing. This requires either a dedicated `FlipSectionCutSideCommand` that recomputes the kernel cut with `cutSide * -1`, or an `EditSectionViewCommand` that accepts a new `cutSide`. Both require a property panel entry for `SectionView` — not yet implemented. Deferred until property panels are scoped.

### F1.1.2 — Convert full ↔ half on existing section view

In-place mode change on an existing `SectionView`. A `ConvertSectionModeCommand` that sets `mode`, `cutSide`, and `splitPlane` atomically, recomputes the kernel cut, and refreshes the projection. Blocked on the property panel infrastructure (same as F1.1.1). `deriveSplitPlane` is already available, so the kernel work is straightforward once the command is scoped.

### F1.1.3 — Live preview during `pickCutSide`

Debounced kernel cut on mouse-hover in `pickCutSide` stage. Each hover-side change triggers a 50 ms debounced Comlink call; the result is shown as a ghost projection behind the `<HalfSectionSidePreview>` overlay. Deferred because the UX benefit is modest (the static overlay is already informative) and the 50 ms debounce would require cancellable Comlink messages — not yet implemented.

### F1.1.4 — Half-section on assembly parents with per-component opt-out

Half-section on an assembly drawing where individual components are flagged `do-not-section` (F1.3). Both F1.3 and this item need design work on the per-component exclusion data model. Blocked on F1.3.

---

## 13. Risk register

### Risk 1 — OCCT numerical fragility on the quarter-box tool

**Description:** The oversized-box quarter-space tool is built using `BRepPrimAPI_MakeBox` (world-aligned) rather than a plane-aligned half-space. If the section plane or split plane is nearly parallel to a box face (e.g., for an exactly 45° section line), the `BRepAlgoAPI_Cut` may produce a near-degenerate interface edge.

**Mitigation:** The oversized box overshoots by `ε = 1 mm` on all sides of the parent geometry bounding box. This ensures no source face is within 1 mm of the box face. Degenerate-cut detection (existing `BRepClass3d_SolidClassifier` guard from F1) fires only on source faces, not on the box face, so the guard is sufficient. In practice the furniture CAD geometry (rectangular panels) has axis-aligned faces that are never near-tangent to a world-aligned box. If the guard fires, emit the existing toast: "Section plane tangent to geometry; nudge by 0.01 mm."

### Risk 2 — Fingerprint cache invalidation on upgrade

**Description:** All existing `SectionView` fingerprints become stale after the v17 → v18 migration because `fingerprintSectionView` now appends `|full|full`. Users see unexpected stale banners on all section views after upgrading.

**Mitigation:** This is documented behaviour (§10.1). The stale banner is the correct UX signal — the user needs to Regenerate once to re-lock the fingerprint. The "Regenerate All" ribbon action (deferred from F1 §11 risk 4) would clear all in one click; its absence means the user must click Regenerate per view. For v1 this is acceptable. Note the OPFS cache entries remain valid (keys are content-addressed, not version-stamped), so Regenerate reads from cache on the first run after upgrade, making the re-lock near-instant.

### Risk 3 — Split-plane face hatch-zero invariant

**Description:** The spec claims split-plane faces produce zero hatch by construction (§5.3). If the split plane is not exactly parallel to the view direction (e.g., slight numerical error in `deriveSplitPlane`), the projected face area may be non-zero and the hatch generator may emit a few spurious segments.

**Mitigation:** The projector hatch filter explicitly excludes `planeSource: 'split'` faces from the hatch pass (§5.4), regardless of projected area. The construction-based argument is a sanity check; the explicit filter is the enforcement mechanism. The filter is covered by unit test HS-PR-1.

### Risk 4 — Tool-mode state machine regression

**Description:** The existing `SectionToolState` is a 4-stage discriminated union. Adding a 5th stage (`pickCutSide`) risks breaking consumers that exhaustively pattern-match on the union without a default case (TypeScript would catch this at compile time, but runtime code in `DrawingCanvas.tsx` uses imperative `if` chains that may not cover the new stage).

**Mitigation:** The `pickCutSide` stage is only entered for `sectionMode === 'half'`; the existing `pickDrop` → `dispatch` path is unchanged for `sectionMode === 'full'`. All `if (sectionState.stage === ...)` branches in `DrawingCanvas.tsx` are reviewed as part of the Batch 3 UI task. A unit test (HS-TM-3) verifies that full-section does not enter `pickCutSide`. TypeScript `exhaustiveCheck` on `SectionToolState` is added at all switch sites.

### Risk 5 — Label allocator sharing between full and half section views

**Description:** Both full-section and half-section views share the same label pool via `allocateCalloutLabel`. If the allocator reads `sheet.views.filter(v => v.kind === 'section')` without filtering by `mode`, labels are allocated correctly. The risk is that if a future refactor adds `mode`-filtering (e.g., treating half-section as a separate label series), existing labels would be misallocated.

**Mitigation:** The allocator in `packages/shared/src/drawing/sectionLabel.ts` filters by `kind === 'section'` only, intentionally. A comment is added at the filter site: `// intentional: both mode='full' and mode='half' section views share the label pool per ANSI convention`. This is covered by existing unit tests for `allocateCalloutLabel` which will run against the updated `SectionView` type after v18.

---

## Appendix — file inventory

### New files

```
packages/shared/src/drawing/
  __tests__/fingerprintSectionView.spec.ts

packages/app/src/drawing/
  HalfSectionSidePreview.tsx
  __tests__/toolMode.spec.ts  (extends; may already exist — add new cases)

packages/app/src/commands/__tests__/
  (AddSectionViewCommand.spec.ts extended, not new)

packages/shared/src/__tests__/
  migrateManifest-v17-to-v18.spec.ts

tests/e2e/drawing/
  T-6-10-half-section-view.spec.ts
```

### Modified files

```
packages/shared/src/drawing/types.ts
  (SectionView: mode, cutSide?, splitPlane? fields; α-invariant comment)

packages/shared/src/drawing/sectionPlane.ts
  (deriveSplitPlane export; reuses existing matrix utilities)

packages/shared/src/drawing/fingerprint.ts
  (fingerprintSectionView: mode + splitFp contribution)

packages/shared/src/fileFormat.ts
  (CURRENT_FORMAT_VERSION → 18; migrations[17]: back-fill mode: 'full')

packages/shared/src/__tests__/fileFormat.spec.ts
  (all toBe(17) → toBe(18))

packages/shared/src/__tests__/migrateManifest-v7-to-v8.spec.ts
packages/shared/src/__tests__/migrateManifest-v8-to-v9.spec.ts
packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts
packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts
packages/shared/src/__tests__/migrateManifest-v11-to-v12.spec.ts
packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts
packages/shared/src/__tests__/migrateManifest-v14-to-v15.spec.ts
packages/shared/src/__tests__/migrateManifest-v15-to-v16.spec.ts
packages/shared/src/__tests__/migrateManifest-v16-to-v17.spec.ts
  (all toBe(17) → toBe(18))

packages/kernel/src/section/cutBySectionPlane.ts
  (splitPlane?, splitSide? params; quarter-box construction; planeSource tag)
  (cutAssemblyBySectionPlane: same two optional params)

packages/kernel/src/section/faceTag.ts
  (FaceTagMap.planeSource?: 'section' | 'split' on cut-face entries)

packages/kernel/src/section/__tests__/cutBySectionPlane.spec.ts
  (HS-K-1 through HS-K-4 added)

packages/shared/src/drawing/__tests__/sectionPlane.spec.ts
  (HS-SP-1 through HS-SP-4 added)

packages/shared/src/drawing/__tests__/projectSectionView.spec.ts  (if exists)
  (HS-PR-1 through HS-PR-4 added)

packages/app/src/commands/AddSectionViewCommand.ts
  (payload: mode, cutSide?; apply(): deriveSplitPlane, half-section kernel path;
   revert(): sectionCache.delete(cacheKey) call — existing method, new caller)

packages/app/src/drawing/sectionCache.ts
  (no API change — existing delete(key: string): Promise<void> at line 17
   is now called from AddSectionViewCommand.revert(); F1's revert did not call it)

packages/app/src/drawing/toolMode.ts
  (SectionToolState: pickCutSide stage; sectionMode field; store actions)

packages/app/src/drawing/DrawingCanvas.tsx
  (pickCutSide keyboard handler; half-section dispatch path)

packages/app/src/shell/tabs/DrawingTab.tsx
  (Half Section ribbon button)

tests/perf/section-cut.perf.spec.ts
  (half-section measurement block added)
```

---

**End of spec.** All design axes locked. Ready for `superpowers:writing-plans`.
