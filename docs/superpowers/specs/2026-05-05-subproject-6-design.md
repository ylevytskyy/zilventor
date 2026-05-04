# ZilInventor — Sub-project 6: 2D Drawing Generation

- **Date:** 2026-05-05
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 6 (final sub-project of the locked roadmap). Generate Inventor-2012-style engineering drawings (orthographic projected views, isometric, manual dimensions, annotations, title block) from `.zipt` parts and `.ziasm` assemblies, exportable to PDF / SVG / PNG.
- **Build order:** 5a ✅ → 5d ✅ → 5b ✅ → 5c ✅ → 5e ✅ → **6** (locked during 5a brainstorming, 2026-05-01).
- **Prior art:** Reuses 5e's per-sheet inline-SVG pattern, 5e's jsPDF multi-page export pipeline, 5e's stale-banner fingerprint pattern, 5b/5e's atomic command shape, 4d's `componentPath`/path-based references, 5d's BrowserPane-tab + Furniture-ribbon-panel rhythm, 3a/3b/3c's `FaceNaming` + `Tessellator` exports for projection input. Bumps manifest v13 → v14.

---

## 1. Scope and non-goals

### 1.1 What Sub-project 6 delivers

A new **Drawing** document kind (`.zidw`) that references a single `.zipt` part or `.ziasm` assembly by path and produces multi-sheet engineering drawings. Activation replaces the 3D viewport with a 2D SVG canvas; the BrowserPane left tree shows the drawing structure.

1. New `kind: 'drawing'` discriminator on `ProjectFile`. New `DrawingDocument` type (`packages/shared/src/types.ts`). New file extension `.zidw` (gzipped tar — same envelope as `.zipt`/`.ziasm`).
2. `OpenProjectFileCommand` learns to dispatch on `kind`. `CreateDrawingCommand({ sourcePath })` creates a fresh drawing referencing an existing part/assembly path.
3. Pure projection module `packages/shared/src/drawing/projector.ts` (hybrid: OCCT edges + JS depth-buffer hide-test against the existing `Tessellator.ts` mesh). Lives in `shared/` so it can run on either thread; the actual call site is the worker (kernel adapter) where the BRep is held.
4. `DrawingDocument` shape: `sheets[]`, each with `views[] / dimensions[] / annotations[] / titleBlock`. Sheet sizes: ISO A4–A0 + Custom mm × mm. Default A3 landscape.
5. View kinds in v1: `base` (Front / Top / Right / Back / Bottom / Left), `projected` (auto-orthographic from a parent base view), `iso` (NE / NW / SE / SW corner). Section / Detail / Broken deferred.
6. Manual dimensions: `linear-h`, `linear-v`, `aligned`, `radial`, `diametric`. All click-to-add via the Dimension ribbon panel.
7. Annotations: `centerline` (between two parallel edges), `center-mark` (on circular edges), `leader` (free-form text + leader line), `balloon` (item-number circle for assembly drawings — pulls from `bomItemNumbers`).
8. Title block: a single fixed Inventor-2012-style template, fields auto-filled from project + source document properties (drawing name, source name, scale, sheet n/N, date, material, revision). User-editable per drawing.
9. Per-action commands on the bus: `AddBaseViewCommand`, `AddProjectedViewCommand`, `AddIsoViewCommand`, `MoveViewCommand`, `DeleteViewCommand`, `RegenerateViewCommand`, `AddDimensionCommand`, `MoveDimensionCommand`, `DeleteDimensionCommand`, `AddAnnotationCommand`, `MoveAnnotationCommand`, `DeleteAnnotationCommand`, `AddSheetCommand`, `RenameSheetCommand`, `DeleteSheetCommand`, `EditTitleBlockCommand`, `EditDrawingPropertiesCommand`. All symmetric undo via `bus.execute`.
10. New `<DrawingCanvas>` SVG component replaces the 3D `<Viewport>` when `activeDocument.kind === 'drawing'`. New `<DrawingTreePane>` replaces `<AssemblyTab>` / `<BrowserPane>` left tree (sheets → views → dimensions → annotations).
11. Drawing ribbon tab (already stubbed in `Ribbon.tsx`) becomes active for drawing docs and grows panels: **Sheet** | **Place Views** | **Dimension** | **Annotate** | **Export**. The same ribbon tab continues to render its existing stub when active document is part/assembly (drawing operations are scoped to drawing docs).
12. New `ExportDrawingPdfCommand` (multi-page A-series vector PDF via jsPDF, one page per sheet — reuses 5e's pipeline), `ExportDrawingSvgCommand` (one `.svg` per sheet, packaged as a single `.svg` if 1 sheet or as a directory-style `.zip` deferred — v1 ships per-sheet button), `ExportDrawingPngCommand` (per-sheet rasterisation via OffscreenCanvas).
13. Stale-banner per view: each view stores `inputFingerprint` (SHA-256 of source geometry + orientation + scale). On opening a drawing, recompute the fingerprint; mismatch → red ⚠️ "Source changed — Regenerate" on that view's tile in the tree, and the view itself renders dimmed in the canvas. **Per-view, not per-drawing** — a single edited part won't invalidate every view simultaneously, only the views whose source state changed.
14. Manifest v13 → v14 — additive: introduce `kind: 'drawing'`, `DrawingDocument` shape; legacy v13 files (`kind: 'part' | 'assembly'`) untouched.

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 6-follow-ups | **Section views** (cut by a line through a parent view; OCCT BOPAlgo_Section + projection re-run on the cut). |
| 6-follow-ups | **Detail views** (zoomed circular sub-region of a parent view). |
| 6-follow-ups | **Broken views** (compressed long parts with break-symbol). |
| 6-follow-ups | **Auto-dimensioning** from sketch parameters (place dims at parameter values). |
| 6-follow-ups | **Baseline / ordinate / angular** dimension styles. |
| 6-follow-ups | **Hole tables** (annotation that emits a table of all holes in a view). |
| 6-follow-ups | **GD&T** (geometric tolerancing, surface finish, weld symbols). |
| 6-follow-ups | **Multi-template title blocks** (designer / mfg / assembly variants). |
| 6-follow-ups | **User-editable WYSIWYG title block** layout (v1 has a fixed layout; only the field values are editable). |
| 6-follow-ups | **DXF export** (industry CNC import format; a multi-week sub-feature on its own — first-class ask first). |
| 6-follow-ups | **Zip-all-SVG / zip-all-PNG** (v1 ships per-sheet buttons). |
| 6-follow-ups | **Visual regression tests** for drawings (golden-PDF / golden-SVG comparison). |
| 6-follow-ups | **Live regeneration** on every source-document edit (v1 uses stale-banner + manual Update). |
| 6-follow-ups | **ANSI sheet sizes** (A / B / C / D / E). v1 is ISO + Custom only. |
| post-6 | **3D PDF export** (interactive 3D content embedded in the PDF). |
| post-6 | **Drawing templates / BOM-aware "auto-place views per part" wizard.** |

### 1.3 Migration / file-format impact

Manifest bumps v13 → v14. **All extensions are additive:**

- New `kind: 'drawing'` value on the `ProjectFile` discriminator.
- New `DrawingDocument` type (only present when `kind === 'drawing'`).
- Legacy v13 part / assembly manifests round-trip through `migrateManifest` unchanged (v13→v14 migration is a no-op pass-through).
- Old projects open without error; the Drawing ribbon tab renders its stub for part/assembly active documents (existing behaviour preserved).

The `.zidw` envelope is the same gzipped tar as `.zipt`/`.ziasm`: `manifest.json` + (no `blobs/` directory — drawings hold no BRep) + `thumbnail.png` (rasterised first sheet).

### 1.4 Success criteria

Sub-project 6 is done when **all** are demonstrably true:

1. From an active part with a 100×60×40 mm box, **File → New Drawing** creates a fresh `.zidw` referencing that part's path. The drawing opens with one empty A3-landscape sheet and a populated title block (drawing name = source name + " — Drawing", date = today, scale = `1:1`).
2. **Drawing → Place Views → Base** with `orientation = front, scale = 1:1` places a base view at click-position. The view shows the 100×60 silhouette with hidden lines styled dashed.
3. **Drawing → Place Views → Projected** from the base view, dragging right, places a `right` projection at proper aligned offset. Dragging up places a `top` projection. Both share the base view's scale.
4. **Drawing → Place Views → Iso** places an isometric view (NE corner default) showing the box in 3D with hidden-line removal.
5. **Drawing → Dimension → Linear-H** click first edge endpoint, click second edge endpoint, drag offset → places a horizontal dimension showing `100`. Dimension persists across save/load and Ctrl-Z removes it.
6. **Drawing → Annotate → Balloon** on an assembly drawing, clicking a component, places a circle with the BOM `itemNumber` from the parent assembly's `bomItemNumbers`.
7. **Drawing → Export → PDF** downloads a multi-page vector PDF — one page per sheet, A3 landscape — with a non-zero file size and `application/pdf` MIME. Title block is rendered. Views are at correct scale.
8. **Drawing → Export → SVG** (single sheet) downloads one `.svg` per sheet (per-sheet button in the tree pane).
9. **Drawing → Export → PNG** (per-sheet) downloads a 1024-px-wide rasterisation (preserving sheet aspect).
10. Editing the source part (e.g. changing the box from 100×60×40 to 120×60×40) and reopening the drawing shows the ⚠️ "Source changed" banner on each view that depends on geometry, with a per-view **Regenerate** action. Clicking it re-projects and clears the banner.
11. `Ctrl+Z` after each Drawing-tab action restores prior state (including view positions, dimension placements, sheet additions, title-block edits).
12. Migrating a v13 project opens without error; existing parts and assemblies behave identically to the v13 build.
13. `pnpm -r typecheck`, all unit + integration suites, the new e2e specs (T-6-1..T-6-N), and the new perf spec pass. The pre-existing 35 model/* flakes (option N in the resume menu) do not regress.

---

## 2. Domain model and data shapes

### 2.1 ProjectFile / kind extension

```ts
// packages/shared/src/types.ts (modified)
export type ProjectFile =
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; kind: 'part';     createdAt: string; appVersion: string; document: PartDocument }
  | { formatVersion: 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14; kind: 'assembly'; createdAt: string; appVersion: string; document: AssemblyDocument }
  | { formatVersion: 14;                                kind: 'drawing';  createdAt: string; appVersion: string; document: DrawingDocument };  // NEW
```

`activeDocument` in `useAppStore` widens analogously:
```ts
type ActiveDocument =
  | { kind: 'part';     document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument }
  | { kind: 'drawing';  document: DrawingDocument };
```

### 2.2 DrawingDocument

```ts
// packages/shared/src/types.ts (new)
export type DrawingDocument = {
  readonly id: string;
  readonly name: string;                       // user-editable; defaults to "<source.name> — Drawing"
  readonly units: 'mm';
  readonly source: DrawingSource;
  readonly properties: Record<string, string | number | boolean>;
  readonly sheets: readonly DrawingSheet[];   // ≥ 1; first sheet auto-created
  readonly activeSheetId: string;              // which sheet the canvas shows; persisted
};

export type DrawingSource = {
  readonly partPath: string;                   // 'parts/cabinet1.zipt' or 'cabinets/c1.ziasm'
  readonly sourceKind: 'part' | 'assembly';   // cached so we can render disambiguated UI without resolving the file
};
```

### 2.3 DrawingSheet

```ts
export type DrawingSheet = {
  readonly id: string;
  readonly name: string;                       // "Sheet 1" by default; user-editable
  readonly size: SheetSize;
  readonly orientation: 'landscape' | 'portrait';
  readonly views: readonly DrawingView[];
  readonly dimensions: readonly DrawingDimension[];
  readonly annotations: readonly DrawingAnnotation[];
  readonly titleBlock: TitleBlockOverrides;
};

export type SheetSize =
  | { readonly kind: 'iso'; readonly size: 'A0' | 'A1' | 'A2' | 'A3' | 'A4' }
  | { readonly kind: 'custom'; readonly widthMm: number; readonly heightMm: number };

// ISO sizes (mm), in the orientation listed; orientation field on DrawingSheet rotates them.
const ISO_SIZES_MM = {
  A0: { w: 1189, h: 841 },
  A1: { w:  841, h: 594 },
  A2: { w:  594, h: 420 },
  A3: { w:  420, h: 297 },
  A4: { w:  297, h: 210 },
} as const;
```

### 2.4 DrawingView

```ts
export type DrawingView =
  | BaseView
  | ProjectedView
  | IsoView;

export type BaseView = {
  readonly id: string;
  readonly kind: 'base';
  readonly positionMm: { readonly x: number; readonly y: number };  // sheet-space, top-left origin
  readonly scale: ViewScale;                                          // e.g. 1, 1/2, 1/5, 1/10
  readonly orientation: 'front' | 'top' | 'right' | 'back' | 'bottom' | 'left';
  readonly showHidden: boolean;                                       // default true
  readonly projection?: ProjectedGeometry;                            // cached, populated by RegenerateView
  readonly inputFingerprint?: string;                                 // SHA-256; mismatch → stale
};

export type ProjectedView = {
  readonly id: string;
  readonly kind: 'projected';
  readonly positionMm: { x: number; y: number };
  readonly baseViewId: string;                                        // parent base view (must coexist on same sheet)
  readonly direction: 'top' | 'bottom' | 'left' | 'right';            // relative to base
  readonly scale: ViewScale;                                          // shares base's scale by default; locked but editable
  readonly showHidden: boolean;
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type IsoView = {
  readonly id: string;
  readonly kind: 'iso';
  readonly positionMm: { x: number; y: number };
  readonly corner: 'NE' | 'NW' | 'SE' | 'SW';                         // which 3-axis corner faces the viewer
  readonly scale: ViewScale;
  readonly showHidden: boolean;                                       // ISO views default to false (engineering convention)
  readonly projection?: ProjectedGeometry;
  readonly inputFingerprint?: string;
};

export type ViewScale = {
  readonly numerator: number;     // e.g. 1
  readonly denominator: number;   // e.g. 5  →  1:5
};
```

### 2.5 ProjectedGeometry

```ts
// packages/shared/src/drawing/projectedGeometry.ts (new)

export type ProjectedGeometry = {
  readonly visibleEdges: readonly Edge2D[];
  readonly hiddenEdges:  readonly Edge2D[];
  readonly bbox: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
};

export type Edge2D = {
  readonly id: string;                                       // stable id — see §3.4
  readonly kind: 'silhouette' | 'feature' | 'outline';       // line-weight tier; default outline
  readonly points: ReadonlyArray<readonly [number, number]>; // polyline, part-mm space (pre-scale)
  readonly sourceFaceIds?: readonly string[];                // for hover / selection (back-references to FaceNaming)
};
```

`points` are in **part-mm** (the source model's world-space length unit). The view applies `positionMm` and `scale` at render time; this lets the same `ProjectedGeometry` snapshot survive a scale change without re-projection.

### 2.6 DrawingDimension

```ts
export type DrawingDimension =
  | { id: string; kind: 'linear-h';  viewId: string; from: PointRef; to: PointRef; offsetMm: number }
  | { id: string; kind: 'linear-v';  viewId: string; from: PointRef; to: PointRef; offsetMm: number }
  | { id: string; kind: 'aligned';   viewId: string; from: PointRef; to: PointRef; offsetMm: number }
  | { id: string; kind: 'radial';    viewId: string; edgeId: string; offsetMm: number; angleDeg: number }
  | { id: string; kind: 'diametric'; viewId: string; edgeId: string; offsetMm: number; angleDeg: number };

export type PointRef =
  | { kind: 'edge-endpoint'; edgeId: string; end: 'start' | 'end' }
  | { kind: 'edge-midpoint'; edgeId: string }
  | { kind: 'arc-center';    edgeId: string };
```

`viewId` scopes the dimension to a single view — moving / regenerating that view moves the dimension with it. `offsetMm` is the perpendicular distance from the dimensioned features to the dimension line (so the user can drag to reposition without recomputing the underlying refs).

### 2.7 DrawingAnnotation

```ts
export type DrawingAnnotation =
  | { id: string; kind: 'centerline';  viewId: string; edgeIdA: string; edgeIdB: string }
  | { id: string; kind: 'center-mark'; viewId: string; edgeId: string }
  | { id: string; kind: 'leader';      viewId: string; targetMm: { x: number; y: number }; textPosMm: { x: number; y: number }; text: string }
  | { id: string; kind: 'balloon';     viewId: string; targetMm: { x: number; y: number }; textPosMm: { x: number; y: number }; itemNumber: number };
```

`balloon.itemNumber` is filled at placement time from the source assembly's `bomItemNumbers` (looked up via the clicked component's `componentPath`). For part drawings, the Balloon button is disabled.

### 2.8 TitleBlockOverrides

```ts
// All fields optional — empty fields fall back to auto-derived values at render time.
export type TitleBlockOverrides = {
  readonly drawingName?: string;
  readonly partName?: string;
  readonly drawnBy?: string;
  readonly approvedBy?: string;
  readonly scaleText?: string;     // e.g. "1:5" — auto = primary base view's scale
  readonly date?: string;          // ISO yyyy-mm-dd
  readonly material?: string;      // for parts: source PartDocument's material; for assemblies: blank
  readonly revision?: string;
  readonly notes?: string;
};
```

The actual title-block layout is a fixed React component (`<TitleBlock>`); fields are filled by `resolveTitleBlock(drawing, sheet, source)` which merges overrides with auto-derived values. The current sheet's `n/N` is computed from `drawing.sheets` length and the sheet's index — never stored.

---

## 3. Projection algorithm — hybrid OCCT-edges + JS depth-buffer

### 3.1 Overview

Hidden-line removal without rebuilding the OCCT bindings to expose `HLRBRep_Algo`. The pipeline:

1. **Edges** come from the existing `FaceNaming` graph + `Tessellator.ts` edge-tessellation (already in use for sketcher pick highlights). Each BRep edge → a polyline in 3D part-space.
2. **Depth buffer** comes from rasterising the existing `Tessellator.ts` triangle mesh into a CPU-side Z-buffer at scale-aware resolution (~ 1 px ≈ 0.5 mm at print scale).
3. For each edge, sample N points along its polyline. Compare each sample's projected Z against the depth buffer (with epsilon proportional to bbox diagonal). Classify segments as visible / hidden; emit `Edge2D[]` polylines.

### 3.2 View matrix

```
view = T_offset · S_scale · R_orient · T_recenter

R_orient (orientation, parts and assemblies):
  front:  identity
  top:    rotateX(-90°)         (world Z becomes view Y)
  right:  rotateY(-90°)
  back:   rotateY(180°)
  bottom: rotateX(90°)
  left:   rotateY(90°)

For 'iso' views: R_iso(corner) = rotateX(-arctan(1/sqrt(2))) · rotateY(±45°)
  (standard isometric: 30° elevation, 45° azimuth, sign by corner.)

T_recenter: translate so source bbox center → origin (avoids large-coord float loss).
S_scale:   identity (scale is applied at render time, not in projection — keeps Edge2D points in part-mm).
T_offset:  identity in projection (positionMm applied at render time).
```

### 3.3 Depth-buffer build

```ts
// packages/shared/src/drawing/projector.ts
function buildDepthBuffer(
  triangles: ReadonlyArray<[Vec3, Vec3, Vec3]>,  // already in view space (post-R_orient)
  bbox: BoundingBox,
  pixelPitchMm: number,                          // adaptive: max(0.25, bbox_diag / 2048)
): Float32Array {
  // CPU rasterisation. For each triangle: edge-function rasterise; per pixel: barycentric-interp Z;
  // if z < buffer[idx], buffer[idx] = z. (Front-facing only, but we render both sides — silhouette
  // detection is independent.)
}
```

### 3.4 Edge classification

```
input:  edges3d[] (polylines in view space), depthBuf, pixelPitchMm
output: { visibleEdges: Edge2D[], hiddenEdges: Edge2D[] }

For each edge:
  Sample N points along the polyline (N = ceil(arc_length / (0.5 * pixelPitchMm)), min 8).
  For each sample:
    (px, py) = projectXY(point); (px_idx, py_idx) = pixelIndex(px, py, pixelPitchMm)
    z = point.z
    bufZ = depthBuf[py_idx * stride + px_idx]
    epsilon = max(1e-4, 0.5 * pixelPitchMm)   // depth-fight tolerance
    sample.visible = (z <= bufZ + epsilon)

  Run-length-encode samples into visible-runs and hidden-runs.
  For each run, emit one Edge2D with sourceFaceIds = edge.adjacentFaces.
```

**Edge `id` derivation:** `<viewId>_<edgeNameKey>_<runIndex>` where `edgeNameKey` is the existing canonical `EdgeName` key (already used by 3b/3c face naming), and `runIndex` is 0-based per edge per visibility class. This makes dimensions/annotations reference-stable across regen as long as the underlying OCCT edge is unchanged.

### 3.5 Pseudocode entry point

```ts
// packages/shared/src/drawing/projector.ts (pure)
export function projectView(
  source: { triangles: ReadonlyArray<[Vec3, Vec3, Vec3]>; edges: EdgeMesh3D[]; bbox: BoundingBox },
  orientation: 'front' | 'top' | ... | 'iso-NE' | 'iso-NW' | 'iso-SE' | 'iso-SW',
): ProjectedGeometry {
  const Mview = buildViewMatrix(orientation, source.bbox);
  const trisVS = source.triangles.map(t => t.map(v => apply(Mview, v)));
  const edgesVS = source.edges.map(e => ({ ...e, points: e.points.map(p => apply(Mview, p)) }));
  const pitch = adaptivePixelPitch(source.bbox);
  const buf = buildDepthBuffer(trisVS, computeViewBBox(trisVS), pitch);
  return classifyEdges(edgesVS, buf, pitch);
}
```

The function is **pure** — same input gives byte-identical `ProjectedGeometry`. Determinism is critical for stable `inputFingerprint`s.

### 3.6 Source-data adapter (kernel side)

```ts
// packages/kernel/src/adapter/drawing/getProjectorInput.ts (new)
export async function getProjectorInput(occt, partRef): Promise<ProjectorInput> {
  const tess = await tessellate(occt, partRef);   // existing
  const edges = await tessellateEdges(occt, partRef);  // existing helper used by sketcher pick
  return { triangles: tess.triangles, edges, bbox: tess.bbox };
}
```

For assemblies, `getProjectorInput` walks the assembly tree (reusing 4d's recursive walker) and concatenates triangles + edges per component, transformed by the component's pose. Component-color is **not** carried into projection (drawings are monochrome by convention). Suppressed / hidden components are excluded.

---

## 4. Commands

All commands implement `Command` (existing interface). All sketcher-style symmetric undo via captured `prev*` fields. `bus.execute` triggers autosave (existing pattern).

### 4.1 Document-level

```ts
class CreateDrawingCommand implements Command {
  constructor(private opts: { sourcePath: string; sourceKind: 'part' | 'assembly'; sheetSize?: SheetSize }) {}
  // Allocates new id, initialises one default sheet (A3 landscape unless overridden), default title block,
  // sets activeSheetId. Persists via OPFS.
}
```

### 4.2 Sheet-level

```ts
class AddSheetCommand    { constructor(opts: { size?: SheetSize; orientation?: 'landscape' | 'portrait' }) {} }
class RenameSheetCommand { constructor(opts: { sheetId: string; name: string }) {} }
class DeleteSheetCommand { constructor(opts: { sheetId: string }) {} }   // refuses if it's the only sheet
class EditSheetSizeCommand { constructor(opts: { sheetId: string; size: SheetSize; orientation: 'landscape' | 'portrait' }) {} }
```

### 4.3 View-level

```ts
class AddBaseViewCommand      { constructor(opts: { sheetId: string; positionMm: Vec2; orientation: BaseOrient; scale: ViewScale; showHidden?: boolean }) {} }
class AddProjectedViewCommand { constructor(opts: { sheetId: string; baseViewId: string; direction: 'top'|'bottom'|'left'|'right'; positionMm: Vec2 }) {} }
class AddIsoViewCommand       { constructor(opts: { sheetId: string; positionMm: Vec2; corner: 'NE'|'NW'|'SE'|'SW'; scale: ViewScale; showHidden?: boolean }) {} }
class MoveViewCommand         { constructor(opts: { sheetId: string; viewId: string; positionMm: Vec2 }) {} }
class DeleteViewCommand       { constructor(opts: { sheetId: string; viewId: string }) {} }
                              // Cascades: deletes any projected views with this as baseViewId; deletes any
                              // dimensions / annotations with this viewId. Single undo step.
class RegenerateViewCommand   { constructor(opts: { sheetId: string; viewId: string; projection: ProjectedGeometry; inputFingerprint: string }) {} }
                              // Apply called by DrawingTab after projector returns. Replaces the cached
                              // projection + fingerprint atomically. Undoable (revert restores the prior
                              // projection + fingerprint).
class EditViewScaleCommand    { constructor(opts: { sheetId: string; viewId: string; scale: ViewScale }) {} }
class ToggleHiddenLinesCommand { constructor(opts: { sheetId: string; viewId: string; showHidden: boolean }) {} }
```

### 4.4 Dimension / annotation

```ts
class AddDimensionCommand    { constructor(opts: { sheetId: string; dim: DrawingDimension }) {} }
class MoveDimensionCommand   { constructor(opts: { sheetId: string; dimId: string; offsetMm: number; angleDeg?: number }) {} }
class DeleteDimensionCommand { constructor(opts: { sheetId: string; dimId: string }) {} }

class AddAnnotationCommand    { constructor(opts: { sheetId: string; ann: DrawingAnnotation }) {} }
class MoveAnnotationCommand   { constructor(opts: { sheetId: string; annId: string; textPosMm?: Vec2; targetMm?: Vec2 }) {} }
class DeleteAnnotationCommand { constructor(opts: { sheetId: string; annId: string }) {} }
```

### 4.5 Title block

```ts
class EditTitleBlockCommand          { constructor(opts: { sheetId: string; overrides: TitleBlockOverrides }) {} }   // per-sheet
class EditDrawingPropertiesCommand   { constructor(opts: { properties: Record<string, string|number|boolean> }) {} }
```

### 4.6 Export

Non-undoable (file system side effects):

```ts
class ExportDrawingPdfCommand { constructor(opts: { drawing: DrawingDocument; source: PartDocument | AssemblyDocument }) {} }
class ExportDrawingSvgCommand { constructor(opts: { drawing: DrawingDocument; sheetId: string; source: PartDocument | AssemblyDocument }) {} }
class ExportDrawingPngCommand { constructor(opts: { drawing: DrawingDocument; sheetId: string; source: PartDocument | AssemblyDocument; canvasWidthPx?: number }) {} }
```

`renderDrawingPdf` / `renderDrawingSvg` / `renderDrawingPngForSheet` are **pure** functions in `packages/app/src/drawing/render*.ts`. PDF reuses 5e's jsPDF infrastructure; SVG re-emits the on-screen `<DrawingCanvas>` markup (extracted to a pure function).

---

## 5. UI

### 5.1 Active-document switching

`useAppStore.activeDocument` widens to include `kind: 'drawing'`. Top-level `<App>` already switches `<Ribbon>` based on `kind === 'assembly'`; extend that to a 3-way switch: `part` / `assembly` / `drawing`.

When `activeDocument.kind === 'drawing'`:
- Viewport area renders `<DrawingCanvas>` (SVG) instead of `<Viewport>` (three.js).
- BrowserPane left tree renders `<DrawingTreePane>` instead of `<AssemblyTab>` / part feature tree.
- Ribbon shows the **Drawing** tab as the default active tab; `Sketch` / `Furniture` / `Inspect` / `Assembly` panels are hidden (irrelevant for drawing docs); `File` / `View` / `Drawing` are shown.

### 5.2 DrawingTab ribbon panels

```
File · Drawing · View

Drawing tab panels:
┌──────────┬────────────────────┬───────────────────────┬──────────────────────────────────┬───────────────────┐
│  Sheet   │    Place Views     │      Dimension        │           Annotate               │      Export       │
├──────────┼────────────────────┼───────────────────────┼──────────────────────────────────┼───────────────────┤
│ New Sheet│ Base View          │ Linear (H)            │ Centerline                       │ Export PDF        │
│ Sheet…   │ Projected View     │ Linear (V)            │ Center Mark                      │ Export SVG (1)    │
│          │ Iso View           │ Aligned               │ Leader Text                      │ Export PNG (1)    │
│          │                    │ Radial                │ Balloon (assembly only)          │                   │
│          │                    │ Diametric             │                                  │                   │
└──────────┴────────────────────┴───────────────────────┴──────────────────────────────────┴───────────────────┘
```

Each button is a `RibbonPanel` button that switches `<DrawingCanvas>` into the corresponding tool mode (mirrors sketcher tool-mode pattern). Modes: `placeBase`, `placeProjected`, `placeIso`, `addLinearH`, `addLinearV`, `addAligned`, `addRadial`, `addDiametric`, `addCenterline`, `addCenterMark`, `addLeader`, `addBalloon`, `idle` (default — pan/zoom + select).

### 5.3 DrawingCanvas (SVG)

A single full-bleed `<svg>` with three coordinate frames:
- **Page (mm)** — top level `<svg viewBox="0 0 sheetW sheetH" preserveAspectRatio="xMidYMid meet">`.
- **Sheet border + title block** — fixed at sheet edges.
- **Per-view groups** — `<g transform="translate(positionMm.x, positionMm.y) scale(scale.numerator/scale.denominator)">` containing visible (`stroke-width` = 0.35 mm) and hidden (`stroke-dasharray="2 1" stroke-width="0.18 mm"`) edge polylines as `<polyline>` elements.

Pan/zoom: CSS-based on the `<svg>` (via wheel + middle-drag), reuses the sketcher's pan/zoom helper.

Selection: each `<polyline>` has `data-edge-id` and `data-view-id`. Click → store selection in `useAppStore.selectedDrawing[]`. Tool modes consume the selection (e.g. `addLinearH` waits for two `edge-endpoint` selections then prompts for offset).

Stale-banner: each view's group renders a 16×16-mm ⚠️ in its top-left corner when `inputFingerprint !== expected`. Click → invokes `RegenerateViewCommand`.

### 5.4 DrawingTreePane

Replaces `<AssemblyTab>` for drawing docs. Tree:

```
Drawing: <name>
├── Source: <partPath>
├── Sheets
│   ├── Sheet 1 (active)
│   │   ├── Views
│   │   │   ├── Base — Front  · 1:1 · regen ⚠
│   │   │   ├── Projected — Right (from Base) · 1:1
│   │   │   └── Iso — NE · 1:1
│   │   ├── Dimensions (3)
│   │   ├── Annotations (1)
│   │   └── Title Block
│   └── Sheet 2
└── Properties
```

Each leaf is right-click-able for delete / rename / regen.

### 5.5 Dialogs

- `<NewDrawingDialog>` — picks the source part/assembly via OPFS file picker, sheet size + orientation. Triggered by **File → New Drawing**.
- `<AddViewDialog>` — variant per view kind:
  - Base: orientation + scale
  - Projected: parent base view + direction
  - Iso: corner + scale
- `<EditTitleBlockDialog>` — text inputs per `TitleBlockOverrides` field.
- `<AddDimensionDialog>` — only used for radial/diametric (linear/aligned use direct click-click placement); displays the computed value, lets user override the format (decimal places).
- `<AddLeaderTextDialog>` — text input.

### 5.6 Tab mutex update

The N-way BrowserPane tab mutex (currently 4-way: Assembly / BOM / CutList / Nesting) does **not** need to extend for drawings. Drawings replace the entire BrowserPane tree (DrawingTreePane), not add a tab. The existing tab mutex applies only to part/assembly browsers.

---

## 6. Storage & file format

### 6.1 Manifest v13 → v14

```ts
// packages/shared/src/fileFormat.ts (additive)
export const CURRENT_FORMAT_VERSION = 14 as const;

const migrations: Record<number, MigrateFn> = {
  // ... existing migrations 1..12 ...
  13: (m) => ({ ...m, formatVersion: 14 }),  // no-op; new kind 'drawing' is forward-only
};
```

Legacy v13 part / assembly manifests have `kind === 'part' | 'assembly'`; they do not gain a `kind === 'drawing'` field. The widening is at the union level only.

### 6.2 .zidw envelope

Same gzipped tar as `.zipt`/`.ziasm`:
- `manifest.json` — `{ formatVersion: 14, kind: 'drawing', createdAt, appVersion, document: DrawingDocument }`
- `thumbnail.png` — first sheet rasterisation (existing thumbnail pipeline; calls `renderDrawingPngForSheet` at 256-px width)
- No `blobs/` (drawings hold no BRep)

### 6.3 OPFS file layout

```
/<project>/
  parts/
    cabinet1.zipt
  cabinets/
    c1.ziasm
  drawings/                 ← new, by convention only (any path works)
    cabinet1-front.zidw
    c1-assembly.zidw
```

`drawings/` is created on demand by `CreateDrawingCommand`. The `.zidw`'s `source.partPath` is project-relative (matches existing `componentPath` semantics in 4d).

### 6.4 Source-document resolution

When opening a `.zidw`:
1. Read `manifest.json` → `document.source.partPath`.
2. Resolve via OPFS to load the source `.zipt`/`.ziasm`.
3. If source missing → `<DrawingCanvas>` renders an error banner "Source `<partPath>` not found in this project."; views show no projection.
4. If source present → compute current `inputFingerprint` from source geometry; compare to each view's stored `inputFingerprint`; mismatches → stale-banner per view.

Both source and drawing are kept in memory while drawing is open. Editing the source doc isn't possible from drawing mode (the **Drawing** active tab hides the **Sketch** / **Model** panels); the user goes back to the source's tab to edit.

---

## 7. Fingerprint / stale-detection

### 7.1 Per-view input fingerprint

```ts
function computeViewFingerprint(viewSpec: ViewSpec, sourceGeometry: ProjectorInput): Promise<string> {
  // SHA-256 hex of canonical-JSON-stringified:
  //   {
  //     orientation, scale, showHidden,
  //     sourceBboxHash: SHA-256(sourceGeometry.bbox),
  //     sourceTrianglesHash: SHA-256(canonical-binary-encode(sourceGeometry.triangles)),
  //     sourceEdgesHash: SHA-256(canonical-binary-encode(sourceGeometry.edges)),
  //   }
}
```

`sourceGeometry` itself is fingerprinted because the source might be untouched in the manifest sense but have been edited then reverted (different intermediate brep blob). Hashing the geometry directly is the strongest signal.

The triangle / edge hash uses the existing `canonicalEdgeName` machinery for ordering; floats are rounded to 1e-3 mm before hashing (one-micron determinism — well below display tolerance).

### 7.2 Where fingerprints are computed

The async fingerprint runs in the worker (next to projection) — `RegenerateViewCommand.apply` receives the result as part of its options.

When opening a drawing, the main thread fires a **batch** stale-check: one worker round-trip computes the source's geometry hash + each view's fingerprint, returns a `staleViewIds: string[]`. UI marks them; user clicks Regenerate to refresh individual views, or Regenerate-All from the ribbon.

---

## 8. Edit, regeneration, undo semantics

### 8.1 What invalidates a view

Any change to the source document's geometry → the source's `triangles`/`edges` change → fingerprint mismatch on every view. This is the dominant case in furniture work (parametric edits to a panel cabinet).

A change to the view itself (orientation, scale) → fingerprint mismatch on that view only. The view is auto-regenerated *synchronously* during the command's apply (since the user explicitly asked for the new orientation/scale; surfacing a stale-banner instead would feel broken).

A change to the source assembly's component pose / hierarchy without geometry change (e.g. just moving a component) → no fingerprint mismatch (triangles + edges unchanged). The view is correct as drawn. ✅

### 8.2 Regeneration flow

1. `RegenerateViewCommand` is invoked.
2. Main thread: `bus.execute` calls the worker — `getProjectorInput(source) → projectView(input, orientation) → { projection, inputFingerprint }`.
3. Worker returns `RegenerateViewCommand`'s options (set by the command's `prepare()` — a pre-apply async step).
4. Apply: replace the view's `projection` + `inputFingerprint` in place. Capture prior values for undo.
5. Revert: restore prior `projection` + `inputFingerprint`.

### 8.3 Cascade on view delete

`DeleteViewCommand` (when the view is a base view):
1. Find all projected views with `baseViewId === target`. Capture them.
2. Find all dimensions + annotations with `viewId === target` or `viewId ∈ projected children`. Capture them.
3. Atomic remove of all of the above. **Single undo step** — Ctrl-Z restores the base view, all child projections, and all dimensions/annotations.

(Mirrors the 4b assembly-constraint cascade-delete pattern.)

---

## 9. Tests

### 9.1 Unit tests

- `packages/shared/src/drawing/__tests__/projector.spec.ts`
  - Box (100×60×40 mm) front view → 4 outer edges visible, no hidden lines.
  - Box top view → 4 edges visible, no hidden.
  - Box iso view → 9 edges visible (3 silhouette × 3 vertices), 3 hidden (back-corner).
  - Cylinder (Ø50, h 100) front view → 2 silhouette lines + 2 ellipse arcs (top/bottom). Ellipses tessellated to ≥ 16 segments.
  - L-bracket (one notch) front view → notch hidden lines counted exactly.
- `packages/shared/src/drawing/__tests__/projector.determinism.spec.ts` — 100 runs of the same input → byte-identical `ProjectedGeometry`.
- `packages/shared/src/drawing/__tests__/fingerprint.spec.ts` — same input → same hash; one-vertex perturbation → different hash.
- `packages/shared/src/__tests__/migrateManifest-v13-to-v14.spec.ts` — v13 part round-trips; v14 drawing manifest validates.
- `packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts` (and analogous specs for every new command) — apply / revert symmetry.
- `packages/app/src/drawing/__tests__/renderDrawingSvg.spec.ts` — golden-string for trivial box drawing.
- `packages/app/src/drawing/__tests__/resolveTitleBlock.spec.ts` — overrides win over auto-derived; missing → fallback.

### 9.2 Integration tests

- `packages/app/src/__tests__/drawing-roundtrip.integration.spec.ts` — create drawing → add views + dim + annot → save `.zidw` → reload → identical.
- `packages/app/src/__tests__/drawing-regenerate.integration.spec.ts` — change source geometry → fingerprint mismatch → Regenerate → projection updates.

### 9.3 E2E specs (Playwright)

- **T-6-1** Create new drawing from a part: `CreateDrawingCommand` → empty A3 sheet → title block populated.
- **T-6-2** Place base view + projected view: ribbon Place Views → Base → click → Projected → drag-aligned → both visible at correct scale.
- **T-6-3** Place a linear-H dimension between two box endpoints; verify text shows `100`; Ctrl-Z removes it.
- **T-6-4** Edit source part geometry → reopen drawing → stale-banner on view → click Regenerate → updated.
- **T-6-5** Export PDF → magic-bytes `%PDF-` check + non-zero size (mirrors 5e's T-5e-4).
- **T-6-6** Place a balloon on assembly drawing → text matches `bomItemNumbers` lookup.

### 9.4 Perf spec

- `tests/perf/drawing-large.perf.spec.ts` — 50-feature part, 4-view sheet (Front + Top + Right + Iso): single-view projection p95 < 200 ms; whole-sheet render < 100 ms; PDF export of 4-sheet drawing < 500 ms. Mirror 5e's perf-spec shape.

### 9.5 Manual smoke checklist

`docs/superpowers/manual-tests/subproject-6.md` — same shape as 5e's. T1: create drawing from cabinet → Front + Right + Top + Iso views → export PDF → open in Preview → spot-check title block + scales. T2: edit source cabinet (change height) → reopen drawing → regenerate all → exported PDF reflects new geometry. T3: 5-sheet drawing → export PDF → 5 pages.

---

## 10. Performance budget

Target hardware: 2014–2016 i3/i5 office laptop, integrated GPU, 4–8 GB RAM, current Chromium (locked decision in `project_zilinventor_overview.md`).

| Metric | p95 budget | Rationale |
|---|---|---|
| `projectView` single-view, 50-feature part | 200 ms | HLR-class cost; mostly depth-buffer rasterisation. Adaptive pixel pitch capped at 0.25 mm to bound work. |
| `<DrawingCanvas>` first paint, 4-view sheet | 100 ms | SVG mount + edge layout; well under the 16 ms-per-frame UI threshold relaxed for first-paint. |
| `renderDrawingPdf` 4-sheet drawing | 500 ms | jsPDF vector ops + 16 view projections cached. |
| `RegenerateViewCommand` round-trip (worker call) | 300 ms | Includes Comlink RPC overhead; 100 ms slack on the projection budget. |

Failure mode if budget breached: spec follow-up to expose `HLRBRep_Algo` from OCCT (axis A2 escape hatch). Target: ship hybrid first, switch only if measured.

---

## 11. Open questions / risks

1. **Edge tessellation precision.** `Tessellator.ts` currently outputs triangle meshes; edge polylines come from `tessellateEdges` (already used by sketcher pick highlights). Need to verify that edge-polyline density is sufficient for HLR-grade silhouette rendering at A3 print scale. Mitigation: parameterize `chord-error` per view and bump it for drawing use.
2. **Curved silhouettes at large scale.** A 1:1 scale of a 50-mm cylinder rendered onto A3 needs ≥ 64 segments to look smooth. Empirical: 0.5°-tolerance angular tessellation. Configurable via `projectView` second arg if needed.
3. **Iso hidden-line accuracy on assemblies.** Component-to-component occlusion in iso views is correctly handled by the depth buffer (since all components' triangles are in the same buffer), but cross-component edge classification might emit duplicate near-coincident edges where part faces touch. Mitigation: post-pass that merges Edge2D polylines whose endpoints are within `epsilon = 0.1 × pixelPitch`.
4. **Dimension reference stability across regen.** `Edge2D.id = <viewId>_<edgeNameKey>_<runIndex>` is stable as long as the OCCT edge isn't renamed by a 3a/3b/3c feature change. Edge-renaming events (rare) will silently break dimensions referencing those edges. Mitigation in v1: dimension that fails to resolve renders with red ⚠ "Reference broken — re-place dimension"; user fixes manually. Auto-heal deferred.
5. **Title-block layout at small page sizes.** A4 portrait has a tight title block; v1 fixes the layout at A3-landscape proportions and scales linearly. Pages smaller than A4 may have unreadable title-block text. Mitigation: minimum sheet size A4. (Custom < A4 → warn in `<EditSheetSizeCommand>` dialog.)
6. **OPFS source-doc resolution after rename.** If the user renames the source `.zipt` after creating a `.zidw`, the drawing breaks. Mitigation v1: error banner + manual re-link via `<NewDrawingDialog>`-style picker. v2 follow-up: store source as a content-hash-addressed reference (deferred).
7. **PDF font embedding.** jsPDF defaults are sufficient for the title block but limited (Helvetica only). User-specified fonts require font subsetting — not in v1.

---

## Appendix — file inventory

### New files

```
packages/shared/src/
  drawing/
    types.ts                       (DrawingDocument, DrawingSheet, ...)
    projector.ts                   (pure projection)
    projectedGeometry.ts           (ProjectedGeometry, Edge2D)
    fingerprint.ts                 (computeViewFingerprint, computeSourceGeometryHash)
    titleBlock.ts                  (resolveTitleBlock)
    __tests__/projector.spec.ts
    __tests__/projector.determinism.spec.ts
    __tests__/fingerprint.spec.ts
    __tests__/titleBlock.spec.ts

packages/kernel/src/adapter/drawing/
  getProjectorInput.ts             (kernel-side adapter; assembles triangles+edges+bbox)
  __tests__/getProjectorInput.spec.ts

packages/app/src/drawing/
  DrawingCanvas.tsx
  DrawingTreePane.tsx
  TitleBlock.tsx
  ViewElement.tsx                  (single-view <g> with edges + bbox + stale-marker)
  DimensionElement.tsx
  AnnotationElement.tsx
  toolMode.ts                      (drawing tool-mode store slice)
  renderDrawingPdf.ts
  renderDrawingSvg.ts
  renderDrawingPngForSheet.ts
  __tests__/...                    (one spec per non-trivial module)

packages/app/src/commands/
  CreateDrawingCommand.ts
  AddSheetCommand.ts
  RenameSheetCommand.ts
  DeleteSheetCommand.ts
  EditSheetSizeCommand.ts
  AddBaseViewCommand.ts
  AddProjectedViewCommand.ts
  AddIsoViewCommand.ts
  MoveViewCommand.ts
  DeleteViewCommand.ts
  RegenerateViewCommand.ts
  EditViewScaleCommand.ts
  ToggleHiddenLinesCommand.ts
  AddDimensionCommand.ts
  MoveDimensionCommand.ts
  DeleteDimensionCommand.ts
  AddAnnotationCommand.ts
  MoveAnnotationCommand.ts
  DeleteAnnotationCommand.ts
  EditTitleBlockCommand.ts
  EditDrawingPropertiesCommand.ts
  ExportDrawingPdfCommand.ts
  ExportDrawingSvgCommand.ts
  ExportDrawingPngCommand.ts
  __tests__/...                    (apply/revert symmetry per command)

packages/app/src/shell/
  NewDrawingDialog.tsx
  AddViewDialog.tsx
  EditTitleBlockDialog.tsx
  AddDimensionDialog.tsx           (radial/diametric only; linear/aligned use direct placement)
  AddLeaderTextDialog.tsx

tests/e2e/drawing/
  T-6-1-create-new-drawing.spec.ts
  T-6-2-place-views.spec.ts
  T-6-3-add-linear-dim.spec.ts
  T-6-4-stale-banner-regen.spec.ts
  T-6-5-export-pdf-magic.spec.ts
  T-6-6-balloon-bom.spec.ts

tests/perf/
  drawing-large.perf.spec.ts

docs/superpowers/manual-tests/subproject-6.md
```

### Modified files

```
packages/shared/src/types.ts                  (widen ProjectFile union; add DrawingDocument re-export)
packages/shared/src/fileFormat.ts             (CURRENT_FORMAT_VERSION → 14; v13→v14 no-op migration)
packages/shared/src/index.ts                  (export drawing/types, drawing/projector, ...)
packages/app/src/store/useAppStore.ts         (widen ActiveDocument; setActiveDocument handles 'drawing')
packages/app/src/shell/Ribbon.tsx             (3-way active-doc switch; DRAWING_TABS = ['File', 'Drawing', 'View'])
packages/app/src/shell/tabs/DrawingTab.tsx    (replace stub with the 5-panel ribbon implementation)
packages/app/src/App.tsx                      (route viewport-vs-drawing-canvas based on activeDocument.kind)
packages/app/src/storage/openProjectFile.ts   (dispatch on kind; .zidw envelope handler)
packages/app/src/storage/saveProjectFile.ts   (analogous)
```

---

**End of spec.** This is the controller's synthesis of the brainstorming session — all 17 design axes set to recommended. Ready for user review; if approved, transition to `superpowers:writing-plans` for implementation breakdown.
