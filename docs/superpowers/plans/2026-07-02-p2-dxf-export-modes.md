# P2 — DXF export modes (R4.1 / R4.4)

Branch: `feat/p2-dxf-export-modes`. Base: local master (post P1 + e2e-repair merges).

## Scope (user-confirmed 2026-07-02)

- **Both exports** get packaging modes: manufacturing (per-panel) AND nest (per-sheet). (ABF itself only modes its nesting output; per-panel is a ZilInventor extension.)
- **Two modes only** (matching ABF's two documented modes):
  - (a) **Per-material folders** — ZIP with entries keyed `sanitize(materialName)/<existing filename>.dxf`. Becomes the default (superset of today's flat zip; per-unit filenames unchanged).
  - (b) **Single combined DXF** — one `.dxf` (no zip) with all units laid out on a **row-wrapped grid, 50mm gutter** (~⌈√n⌉ columns), each unit keeping its INFO label and true-mm geometry. *Layout is our call: ABF's combined layout is undocumented everywhere (vendor's entire statement: "split by material folder, or exported combined into 1 file"); user chose "match ABF exactly first" → research confirmed nothing to match → fell back to recommended grid (user AFK at decision time — layout is swappable, pure function).*
- **Mode selector**: inline ribbon control (segmented/radio) next to each export button in `FurnitureTab`, session-persisted app-store field (no manifest version bump).
- **R4.4**: both modes keep the shared `MANUFACTURING_LAYERS` scheme — no forking of `manufacturingLayers.ts`. R4.3 fidelity tests must stay green untouched (packaging-only change; geometry emission per unit unchanged).

## Tasks

| # | Task | Verify |
|---|------|--------|
| A1 | `layoutCombinedGrid(items: {width,height}[], gutter): {x,y}[]` pure util (TDD) | unit tests: single item at origin, row wrap at ⌈√n⌉ cols, row height = max in row, 50mm gutters |
| A2 | Refactor `renderPanelManufacturingDxf` to emit entities at an (dx,dy) offset; add `renderCombinedManufacturingDxf(inputs)` (one header, union layer table, translated entities) | existing renderer tests green unchanged; new tests: combined file parses, N outlines at expected offsets, layers = union of per-unit layers |
| A3 | Same for nest: `renderCombinedNestDxf(sheets, meta)` reusing A1 util | analogous tests |
| C1 | `buildManufacturingZipEntries` / `buildNestZipEntries`: per-material-folder keys (`sanitize(materialName)/…`) | tests: grouping by material, sanitize applied, filenames inside unchanged |
| D1 | Commands: `mode` param ('folders' \| 'combined'); combined saves single `.dxf` via picker/`<a download>` | tests on command-level entry/bytes building |
| D2 | UI: segmented control ×2 in FurnitureTab + app-store `dxfExportMode` field + i18n en/uk (parity test) | typecheck/lint/i18n parity green; e2e smoke |
| G | Gates: per-package typecheck 0 / lint 0 / app+shared+kernel unit suites green; e2e (fresh dev server, quiet machine) | EXEC evidence |

## Status

- [x] A1–A3 (`a2d57490`, `953288e5`, `c01fb819`)
- [x] C1 (`1594eb7a`)
- [x] D1–D2 (`29e03de5`)
- [x] Gates — typecheck 0 ×3 pkgs; app 3270 / shared 1369 / kernel 306; e2e 230/230 (226 parallel + 4 serial-confirmed load-flakes); e2e spec fix `79c8865a`. Per-package lint scripts don't exist (N/A). Pre-existing (on master too): app test:unit exits 1 from 3 unhandled rejections in App.spec.tsx FakeOrbitControls mock — separate ticket.
- [x] Merge `--no-ff` to local master
