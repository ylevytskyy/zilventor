# Source-Optional Drawing Export — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)
**Manifest:** v19 — **no bump** (read-only export change, no serialized shape change)

## Problem

The four WYSIWYG drawing-export buttons — **PDF**, **SVG**, **PNG**, **WYSIWYG DXF**, plus the conditional **all-sheets WYSIWYG DXF** — are `disabled={!source}` in `DrawingTab.tsx`. When a drawing is reopened but its source `.zipt`/`.ziasm` file is gone (or never loaded), `activePart`/`activeAssembly`/`activeDrawingSourceDocument` are all null, so `source` is null and all five buttons are dead.

The DXF 1:1 and all-sheets-1:1 buttons already work source-free (gated on `hasProjectedView`), because the projected geometry is fully baked into `drawing.sheets`. This feature brings the WYSIWYG buttons to parity.

## Key facts (verified against code)

- The geometry in `drawing.sheets` (views, projections, dimensions, annotations) is **fully self-contained** — no source needed to render edges/hatch/dimensions.
- `source` feeds exactly two render-time consumers:
  1. **Title block** (`resolveTitleBlock`, `packages/shared/src/drawing/titleBlock.ts`): reads `source.name` → `partName` fallback, `source.materials[0]?.name` → `material`, via the `'materials' in source` discriminator. All other title-block fields come from `drawing.name` / sheet title-block overrides.
  2. **Hole tables** (`renderHoleTableAnnotation` in `renderDrawingSvg.ts` + `renderDrawingDxf.ts`): computes rows from the source part at render time. **Already** renders empty for assembly sources via `const part = 'featureTree' in source ? source : null; if (!part) return '';`.

## Design decisions (locked in brainstorming)

1. **Button gate → `hasProjectedView`** (parity with the 1:1 buttons). Per-sheet buttons (SVG, PNG, per-sheet DXF) gate on `hasProjectedView`; whole-drawing buttons (PDF, all-sheets DXF) gate on `anySheetHasProjectedView`. Consequence: a source-present sheet with no projected view becomes disabled (was enabled) — accepted, since such an export produces nothing meaningful.
2. **Title block → natural blank fallback.** When `source` is null, `partName` and `material` fall back to the sheet's stored title-block override, else blank — exactly how `date`/`drawnBy`/`revision` already degrade. No "source unavailable" marker, no new UI.
3. **Hole tables → skip silently.** Extend the existing assembly behavior: when `source` is null, the hole-table annotation renders nothing. No baking, no manifest bump, no block-on-export.

## Changes

1. **`resolveTitleBlock`** (`packages/shared/src/drawing/titleBlock.ts`) — param `source: PartDocument | AssemblyDocument | null`. Null-guard the `source.name` and `'materials' in source` reads → `partName`/`material` use the override-or-blank path. No other field touched.

2. **Render functions** — `renderDrawingSvg` (`packages/app/src/drawing/renderDrawingSvg.ts`), the `renderDrawingPdf` path, `renderDrawingDxf` (`packages/app/src/drawing/renderDrawingDxf.ts`); PNG renders through SVG. Change the `source` param to `… | null` and thread it to `resolveTitleBlock` + `renderAnnotationGroup`.

3. **Hole-table renderers** (SVG + DXF) — change `'featureTree' in source` to `source != null && 'featureTree' in source`. Null source → `part = null` → existing `if (!part) return ''` skips.

4. **Export commands** — `ExportDrawingPdfCommand`, `ExportDrawingSvgCommand`, `ExportDrawingPngCommand`, `ExportDrawingDxfCommand`, `ExportAllSheetsDxfCommand`: `source` field → `… | null`. No body changes (they pass `source` straight to the render fn).

5. **`DrawingTab`** (`packages/app/src/shell/tabs/DrawingTab.tsx`) — swap `disabled={!source}` → `disabled={!hasProjectedView}` for SVG/PNG/per-sheet DXF and `disabled={!anySheetHasProjectedView}` for PDF + all-sheets DXF. Update the disabled-tooltip `title` strings to "No projected views to export" (matching the 1:1 buttons). `source` (possibly null) is still passed into each command.

## Error handling

No new throws. Null `source` → blank `partName`/`material` in the title block + omitted hole-table annotations. Everything else renders identically.

## Testing (TDD, red→green per slice)

- **shared unit** — `resolveTitleBlock(drawing, sheet, null, …)` → `partName`/`material` blank (or stored override), all other fields intact.
- **app unit** — `renderDrawingSvg` and `renderDrawingDxf` with `source = null` → valid output, title block present, hole-table annotation emits nothing.
- **app unit** — each of the 5 commands constructs + executes with `source = null` without throwing, returning bytes/string.
- **app unit (DrawingTab)** — button enabled when `hasProjectedView && !source`; disabled when `!hasProjectedView`.
- **e2e T-6-27** — real Chromium: drawing active with the source slot nulled via `window.__zilventorStore`, click Export DXF, assert the download parses back with geometry + a blank-`partName` title block.
- **Perf** — unaffected; identical render path, no new compute. No new probe.

## Out of scope

- Baking hole-table rows into the annotation (separate future enhancement; would need a manifest bump).
- A visible "source unavailable" title-block marker.
- Any change to the 1:1 / all-sheets-1:1 buttons (already source-free).
