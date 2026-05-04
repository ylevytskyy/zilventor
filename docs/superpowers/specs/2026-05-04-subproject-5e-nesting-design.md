# ZilInventor — Sub-project 5e: Nesting

- **Date:** 2026-05-04
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 5e of 5a–5e (Furniture plug-in layer). Sheet-stock packing of the 5d cut-list onto material sheets with kerf, per-sheet diagrams, and PDF / per-sheet PNG export.
- **Build order:** 5a ✅ → 5d ✅ → 5b ✅ → 5c ✅ → **5e** (locked during 5a brainstorming, 2026-05-01).
- **Prior art:** Consumes 5d's `CutListResult.rows` directly (already grain-normalized, qty-grouped). Mirrors 5d's BrowserPane-tab + Furniture-ribbon-panel pattern. Mirrors 5b's atomic `CreateCabinetCommand` shape for `GenerateNestCommand`. Extends 5a's `MaterialRegistry` with optional sheet-stock fields (additive, parallel to `defaultThickness`). Bumps manifest v12 → v13.

---

## 1. Scope and non-goals

### 1.1 What 5e delivers

A new **Nesting** `RibbonPanel` on the Furniture tab with **Generate Nest** + **Export PDF** buttons, plus a new **Nesting** tab in the BrowserPane (4th tab after Assembly / BOM / Cut List).

1. `MaterialEntry` gains optional `sheetLengthMm?: number` + `sheetWidthMm?: number`. Both must be set or both omitted; `> 0` if set.
2. `MaterialRegistryEditor` (5a) grows two columns — `Sheet L (mm)`, `Sheet W (mm)` — with the same edit / validate / commit cycle as the existing `defaultThickness` column.
3. New pure module `packages/shared/src/nesting/` exports `packGuillotine(rows, sheetL, sheetW, kerfMm) → NestSheet[]` (per-material) and `packAllMaterials(rows, materials, kerfMm) → NestResult` (multi-material aggregator). Algorithm: greedy guillotine with first-fit-decreasing input ordering (§3).
4. New `GenerateNestCommand({ kerfMm })` — snapshots cut-list + materials, computes per-material packs, writes `asm.nest = NestState`. Symmetric undo via `bus.execute`.
5. New `<NestingTab>` component renders each per-material section (header + sheets) using inline SVG, scaled mm-coords. Each `PlacedPanel` shows `#item · qty-on-sheet`, `LxW`, and a grain arrow if `grain ≠ 'none'`. Per-sheet **Export PNG** button.
6. New `ExportNestPdfCommand` produces a multi-page vector PDF (one page per sheet, true mm scale, A3 landscape default with auto-rotation and auto-fit). New `ExportNestPngCommand` rasterises a single sheet to PNG via `<canvas>.toBlob`.
7. Stale-banner: NestingTab compares the current `inputFingerprint` against the persisted `nest.inputFingerprint`; on mismatch shows ⚠️ "Cut list changed since last nest. [Regenerate]".
8. Manifest bumps v12 → v13 (additive: `AssemblyDocument.nest?: NestState`; `MaterialEntry.sheetLengthMm?` + `MaterialEntry.sheetWidthMm?`).

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 5e-follow-ups | Per-panel grain override at nest time (panel-by-panel `'force-rotated'` flag in the dialog). |
| 5e-follow-ups | Multi-stock-size per material (multiple sheet sizes per material in a per-project sheet registry). |
| 5e-follow-ups | Manual drag-rearrange of placed panels on a sheet. |
| 5e-follow-ups | Cut order / saw-sequence optimisation (which cut to make first to minimise fence resets). |
| 5e-follow-ups | Scrap re-use across runs (track leftover cut-offs from one nest into the next). |
| 5e-follow-ups | Side-by-side algorithm comparison (greedy vs skyline vs maxrects). |
| 5e-follow-ups | Utilisation summary CSV (waste m², sheet count per material). |
| 5e-follow-ups | Zip-all-PNGs export (v1 ships per-sheet PNG button only). |
| 5e-follow-ups | Per-panel barcode / QR labels on the diagram. |
| 5e-follow-ups | Two-stage / strip-based guillotine refinement. |
| post-5e | Hardware nesting / fastener bin allocation. |
| post-5e | Edge-band roll allocation (5d already reports band totals; allocating to physical rolls is separate). |

### 1.3 Migration / file-format impact

Manifest bumps v12 → v13. Both extensions are additive:

- `AssemblyDocument.nest` is **optional** — legacy v12 assemblies open with `nest === undefined` and the NestingTab shows "No nest generated yet".
- `MaterialEntry.sheetLengthMm` / `sheetWidthMm` are **optional** — legacy materials open with both `undefined` and are excluded from nesting with reason "no sheet stock defined" until the user sets the dimensions in `MaterialRegistryEditor`.

The migration v12→v13 is a no-op pass-through. New fields appear via writes only.

### 1.4 Success criteria

5e is done when **all** are demonstrably true:

1. From an active assembly with a `MaterialRegistry` containing one material with `sheetLengthMm = 2440` and `sheetWidthMm = 1220`, after placing 6 panel components of that material via the 5b cabinet generator: opening **Furniture → Nesting → Generate Nest** with kerf = 3mm, then opening the new **Nesting** BrowserPane tab, shows **1 sheet** with the 6 panels packed inside it, each labelled with its 5d cut-list `item#`.
2. Placing more panels than fit on one sheet (e.g. 4 cabinets worth of bottoms + sides) results in **N > 1 sheets** displayed in the tab, all under the same per-material section header. Each panel's `item#` matches the 5d Cut List tab for the same row.
3. Editing the cut list (e.g. adding another cabinet) without regenerating shows the ⚠️ stale banner in the NestingTab. Clicking **Regenerate** clears the banner and re-renders updated sheets.
4. **Export PDF** downloads a multi-page PDF with one page per sheet, true mm scale, A3 landscape default. The downloaded file size is non-zero and `application/pdf`.
5. Per-sheet **Export PNG** downloads a `image/png` file scaled to fit a 1024-px-wide canvas (preserving sheet aspect), file size non-zero.
6. A material in the registry without sheet-stock dimensions is listed in the NestingTab "Excluded" section with reason "no sheet stock defined" and is skipped by the packer (no crash).
7. A panel that exceeds the sheet's largest dimension after rotation (e.g. a 3000mm panel on a 2440mm sheet) is listed in the Excluded section with reason "panel exceeds sheet" and is skipped (no crash).
8. `MaterialRegistryEditor` shows two new columns (`Sheet L`, `Sheet W`). Editing a row with `Sheet L = 2440` + `Sheet W = ` (empty) shows inline error "set both or neither" and disables Save.
9. `Ctrl+Z` after Generate Nest restores the prior `asm.nest` value (undefined for first generation, the previous `NestState` for subsequent ones).
10. Migrating a v12 project opens without error; assembly `nest === undefined`; existing materials' `sheetLengthMm` / `sheetWidthMm` are `undefined` and editable in `MaterialRegistryEditor`.
11. `pnpm -r typecheck`, all unit + integration suites, the new e2e specs, and the new perf spec pass.

---

## 2. Domain model and data shapes

### 2.1 MaterialEntry extension

```ts
// packages/shared/src/material.ts (modified)
interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;
  readonly defaultThickness: number;
  readonly color: string;
  readonly sheetLengthMm?: number;   // NEW — optional, > 0 if set
  readonly sheetWidthMm?: number;    // NEW — optional, > 0 if set
}
```

Validation in `isMaterialEntry` (Reference A — existing function): if either is present, both must be present, both must be finite numbers `> 0`. If both are absent, the entry is valid. Mixed (one present, one absent) is invalid.

### 2.2 NestState (persisted on AssemblyDocument)

```ts
// packages/shared/src/nesting/nestState.ts (new)

interface NestState {
  readonly params: { readonly kerfMm: number };
  readonly generatedAt: number;            // epoch ms (Date.now())
  readonly inputFingerprint: string;       // SHA-256 hex (see §7)
  readonly sheets: readonly NestSheet[];   // flattened, ordered (materialId, sheetIndex)
  readonly excluded: readonly NestExclusion[];
}

interface NestSheet {
  readonly materialId: MaterialId;
  readonly sheetIndex: number;             // 1-based within material
  readonly sheetLengthMm: number;          // snapshot from registry at gen time
  readonly sheetWidthMm: number;           // snapshot
  readonly panels: readonly PlacedPanel[];
  readonly utilizationPct: number;         // (sum panel area) / (sheet area) × 100
}

interface PlacedPanel {
  readonly itemNumber: number;             // CutListRow.itemNumber (links back to 5d)
  readonly rowKey: string;                 // CutListRow.rowKey (stable backref)
  readonly x: number;                      // mm, top-left in sheet space
  readonly y: number;
  readonly length: number;                 // mm, post-rotation (along sheet length axis)
  readonly width: number;                  // mm, post-rotation (along sheet width axis)
  readonly rotated: boolean;               // true if 90° from cut-list L×W
}

type NestExclusionReason = 'no-sheet-stock' | 'panel-exceeds-sheet';

interface NestExclusion {
  readonly materialId: MaterialId;
  readonly reason: NestExclusionReason;
  readonly itemNumbers: readonly number[]; // empty for 'no-sheet-stock'; populated for 'panel-exceeds-sheet'
}
```

### 2.3 AssemblyDocument extension

```ts
// packages/shared/src/types.ts (modified)
interface AssemblyDocument {
  // ... existing fields
  readonly nest?: NestState;   // NEW — optional, undefined means "not generated yet"
}
```

`PartDocument` is unchanged.

### 2.4 NestParams (transient, not persisted at module level)

```ts
// packages/shared/src/nesting/types.ts (new)
interface NestInputRow {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly qty: number;
  readonly length: number;
  readonly width: number;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
}
```

The packer takes `NestInputRow[]` not `CutListRow[]` directly — narrows the surface to only what packing needs (no edge-band data, no part names, no thickness). The conversion is a one-line `.map` in `packAllMaterials`.

---

## 3. Packing algorithm

### 3.1 Greedy guillotine with first-fit-decreasing

Per-material packing in `packages/shared/src/nesting/packGuillotine.ts`:

```
input:  rows (filtered to single material), sheetLengthMm, sheetWidthMm, kerfMm
output: { sheets: NestSheet[], oversized: { itemNumber, rowKey }[] }

1. Expand: for each row, push `qty` Panel{itemNumber, rowKey, length, width, grain} into a flat list.
2. Sort panels by max(length, width) DESC, then min(length, width) DESC, then itemNumber ASC (tie-breaker for determinism).
3. Pre-filter (per panel, per its grain constraint):
     grain === 'length' → oversized iff panel.L > sheetL OR panel.W > sheetW
     grain === 'width'  → oversized iff panel.W > sheetL OR panel.L > sheetW
     grain === 'none'   → oversized iff min(L,W) > min(sheetL,sheetW) OR max(L,W) > max(sheetL,sheetW)
   Push oversized panels to `oversized[]` (one entry per qty); remove from active list.
4. While panels remain:
   a. Open new sheet. freeRects = [{x:0, y:0, w:sheetLengthMm, h:sheetWidthMm}].
   b. Loop:
      • Find the first panel (in current order) that fits any free rect in any allowed orientation.
      • Allowed orientation (recall: the input row's `length` is the grain-aligned dim per 5d's `normalizeLW`,
        EXCEPT when grain==='none' in which case `length` is the longer dim):
          grain === 'length' → row.length must lie along sheet-length axis (no rotation, rotated=false)
          grain === 'width'  → row.width  must lie along sheet-length axis (forced rotation, rotated=true).
                               (5b's buildBaseCabinet emits only grain='length'; grain='width' is supported
                               for completeness so future generators can use it.)
          grain === 'none'   → either orientation allowed; prefer the one that leaves the larger of the two
                               child rects (compare max(child.w, child.h) of the bigger child); ties broken
                               by rotated=false first.
      • If no panel fits any free rect → break (close sheet).
      • Place panel at chosen free rect's (x, y). Record `rotated = true` if the panel's stored L is now along sheet's W axis.
      • Guillotine-split the chosen free rect into 0–2 children:
          right child:  { x: x + panelL + kerfMm,   y: y,                   w: rect.w - panelL - kerfMm,   h: panelW }
          bottom child: { x: x,                     y: y + panelW + kerfMm, w: rect.w,                     h: rect.h - panelW - kerfMm }
        (where panelL/panelW are the chosen orientation's dims)
        Only push children where w > 0 AND h > 0.
      • Remove parent free rect; remove placed panel from list.
   c. Sheet closed; sheetIndex++.
5. utilization = sum(panel area) / (sheetL × sheetW) × 100, rounded to 1 decimal.
```

**Rationale for the "right + bottom" split:** This is the classic guillotine free-rectangle bisection (Wäscher / Lodi). It guarantees all cuts are full-stroke saw cuts. The kerf is subtracted on both axes to model material lost to the blade. This split uses the panel-saw "horizontal-then-vertical" convention; the inverse split is mathematically equivalent for total packed area but produces different free-rect shapes — we pick one and stay deterministic.

**Why first-fit-decreasing not best-fit-decreasing:** First-fit is O(n²); best-fit is O(n² log n) and gains ~1-2% density on typical cabinet layouts. Not worth the complexity for v1.

**Determinism:** Stable sort, deterministic free-rect insertion order (right-child pushed before bottom-child), deterministic orientation choice for `grain='none'` (max-leftover-area, ties broken by `rotated=false` first). Same inputs → byte-identical `NestSheet[]`.

### 3.2 Coordinate system

- Sheet coordinates: origin at top-left, +x along sheet length, +y along sheet width.
- All units mm.
- Panels are axis-aligned rectangles. No rotation other than 0° / 90°.

### 3.3 packAllMaterials orchestration

```ts
// packages/shared/src/nesting/packAllMaterials.ts
function packAllMaterials(
  inputRows: NestInputRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): { sheets: NestSheet[]; excluded: NestExclusion[] } {
  // 1. Group rows by materialId.
  // 2. For each material:
  //    - If sheetLengthMm/sheetWidthMm absent → push exclusion 'no-sheet-stock'; skip.
  //    - Else call packGuillotine; map result.sheets into NestSheet[]; if oversized non-empty → push exclusion 'panel-exceeds-sheet' with their itemNumbers.
  // 3. Order output sheets by (materialId.localeCompare, sheetIndex).
}
```

---

## 4. Commands

### 4.1 GenerateNestCommand

```ts
// packages/app/src/commands/GenerateNestCommand.ts
class GenerateNestCommand implements Command {
  constructor(private opts: { kerfMm: number; result: CutListResult; materials: MaterialRegistry }) {}

  private prevNest: NestState | undefined;

  apply(state): void {
    const inputRows = this.opts.result.rows.map(toNestInputRow);
    const { sheets, excluded } = packAllMaterials(inputRows, this.opts.materials, this.opts.kerfMm);
    const fingerprint = computeNestFingerprint(this.opts.result.rows, this.opts.materials, this.opts.kerfMm);
    const newState: NestState = {
      params: { kerfMm: this.opts.kerfMm },
      generatedAt: Date.now(),
      inputFingerprint: fingerprint,
      sheets,
      excluded,
    };
    this.prevNest = state.activeAssembly.nest;
    state.activeAssembly.nest = newState;
  }

  revert(state): void {
    state.activeAssembly.nest = this.prevNest;
  }
}
```

Constructor receives `result` + `materials` snapshot (mirrors 5d's `RenumberCutListCommand({ result })` pattern — Reference B). Apply is synchronous (no OPFS writes; `NestState` lives entirely in the in-memory assembly doc and is persisted on the next autosave).

### 4.2 ExportNestPdfCommand

```ts
// packages/app/src/commands/ExportNestPdfCommand.ts
class ExportNestPdfCommand implements Command {
  constructor(private opts: { nest: NestState; materials: MaterialRegistry }) {}
  apply(): Promise<void> {
    const blob = renderNestPdf(this.opts.nest, this.opts.materials); // pure jsPDF
    triggerDownload(blob, `nest-${timestamp()}.pdf`);
  }
  revert(): void { /* no-op — exports are not undoable */ }
}
```

Non-undoable (download is a side effect). `renderNestPdf` is a pure function — given a `NestState` + `MaterialRegistry`, returns a `Blob`. Lives in `packages/app/src/nesting/renderNestPdf.ts`.

### 4.3 ExportNestPngCommand

```ts
// packages/app/src/commands/ExportNestPngCommand.ts
class ExportNestPngCommand implements Command {
  constructor(private opts: { sheet: NestSheet; materials: MaterialRegistry }) {}
  apply(): Promise<void> {
    const blob = await renderNestSheetPng(this.opts.sheet, this.opts.materials, { canvasWidthPx: 1024 });
    triggerDownload(blob, `nest-${this.opts.sheet.materialId}-${this.opts.sheet.sheetIndex}.png`);
  }
  revert(): void { /* no-op */ }
}
```

Per-sheet, not per-nest. v1 has one PNG button per sheet thumbnail in the tab. Zip-all is F-item.

### 4.4 OpenNestingTabCommand

```ts
// packages/app/src/commands/OpenNestingTabCommand.ts
class OpenNestingTabCommand implements Command {
  // Mirrors OpenCutListTabCommand (which mirrors OpenBomTabCommand). NOT inheritance —
  // each tab-open command is its own class. Sets nestingTabActive=true on the store and
  // clears assemblyTabActive / bomTabActive / cutListTabActive (mutual exclusion).
  apply(state): void { /* ... */ }
  revert(state): void { /* restore prior tab-active flags */ }
}
```

---

## 5. UI

### 5.1 NestingTab component

```tsx
// packages/app/src/shell/NestingTab.tsx
function NestingTab({ result, nest, materials }: Props) {
  const fingerprint = useMemo(() => computeNestFingerprint(result.rows, materials, nest?.params.kerfMm ?? 3), [...]);
  const stale = nest && fingerprint !== nest.inputFingerprint;

  if (!nest) return <EmptyState>Click "Generate Nest" on the Furniture tab to start.</EmptyState>;

  // Group nest.sheets by materialId; preserve insertion order.
  const grouped = groupBy(nest.sheets, 'materialId');

  return (
    <div>
      {stale && <StaleBanner onRegenerate={() => bus.execute(new GenerateNestCommand({ ... }))} />}
      {Object.entries(grouped).map(([materialId, sheets]) => (
        <MaterialSection key={materialId} ...>
          {sheets.map((s) => <SheetSvg key={`${s.materialId}-${s.sheetIndex}`} sheet={s} material={materials.find(...)} />)}
        </MaterialSection>
      ))}
      {nest.excluded.length > 0 && <ExcludedSection excluded={nest.excluded} materials={materials} />}
    </div>
  );
}
```

### 5.2 SheetSvg rendering

Each sheet is one `<svg>` with `viewBox="0 0 sheetL sheetW"`, scaled to fit the pane width (preserve aspect ratio via `preserveAspectRatio="xMidYMid meet"`).

Children:
- Sheet outline: `<rect x=0 y=0 width=sheetL height=sheetW fill="white" stroke="#888" strokeWidth=2/>`.
- Per panel, a `<g>` with:
  - Filled rect using `material.color`, dark stroke `#222`, stroke-width 1.
  - `<text>` `#${itemNumber}` top-left padded.
  - `<text>` `${length}×${width}` centred (only if rect is large enough — heuristic: rect width > 200mm).
  - Grain arrow: `<path d="...">` arrow pointing along sheet length if `grain === 'length'`, along sheet width if `grain === 'width'`. Omitted if `grain === 'none'`.
- Sheet header (above SVG, plain HTML): `Sheet ${sheetIndex} — ${utilizationPct}% utilisation` + per-sheet **Export PNG** button.

### 5.3 BrowserPane integration

Add a 4th tab to the assembly-mode tab strip. Existing tab strip (5d) already uses `aria-label="Assembly tab"` / `"BOM tab"` / `"Cut List tab"` for E2E selectors — add `aria-label="Nesting tab"`. Mutual exclusion: opening any one of the four tabs closes the others (existing pattern).

Cache: same `panelSpecCacheRef` + `subAssemblyCache` already populated by 5d's `useCutListResult` hook. The Nesting tab consumes the same `cutListResult` — no new cache needed.

### 5.4 Furniture ribbon panel

```
┌─────────────────────┐
│  Nesting            │
├─────────────────────┤
│ [Generate Nest]     │
│ [Export PDF]        │
└─────────────────────┘
```

- **Generate Nest** opens a small dialog: kerf input (mm, default 3, validated `> 0`), summary line "N panels across M materials will be nested" computed from the current `cutListResult` + non-excluded materials, OK / Cancel. OK runs `bus.execute(new GenerateNestCommand({...}))`.
- **Export PDF** disabled (`aria-disabled`) when `asm.nest === undefined`. Otherwise runs `bus.execute(new ExportNestPdfCommand({ nest: asm.nest!, materials }))`.

### 5.5 MaterialRegistryEditor extension

The existing editor (`packages/app/src/shell/MaterialRegistryEditor.tsx`) gets two new `<input type="number">` columns: **Sheet L (mm)**, **Sheet W (mm)**. Empty input → `undefined`. Validation in the row's `error` field: "Set both Sheet L and Sheet W, or leave both empty." Save disabled until valid.

`AddMaterialCommand` and `EditMaterialCommand` accept new `sheetLengthMm?: number` + `sheetWidthMm?: number` opts. They round-trip through the existing `MaterialRegistry` reducers without any new command.

---

## 6. PDF / PNG export

### 6.1 PDF — jsPDF, vector

Add `jspdf` to `packages/app/package.json` (latest stable, ~50KB gz). Use only the core API (`addPage`, `rect`, `text`, `setFillColor`, `setDrawColor`, `setFontSize`, `lines`).

```ts
// packages/app/src/nesting/renderNestPdf.ts
function renderNestPdf(nest: NestState, materials: MaterialRegistry): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  nest.sheets.forEach((sheet, i) => {
    const orientation: 'landscape' | 'portrait' =
      sheet.sheetLengthMm >= sheet.sheetWidthMm ? 'landscape' : 'portrait';
    if (i === 0) {
      // First page already added by jsPDF constructor; if its orientation is wrong, switch:
      if (orientation !== 'landscape') pdf.deletePage(1), pdf.addPage('a3', orientation);
    } else {
      pdf.addPage('a3', orientation);
    }
    const material = materials.find((m) => m.id === sheet.materialId);
    drawSheetPdf(pdf, sheet, material, { marginMm: 10 });
  });
  return pdf.output('blob');
}
```

`drawSheetPdf` computes the per-page scale = `min((pageW - 2·margin) / sheetL, (pageH - 2·margin) / sheetW)` from the page's actual dimensions (queried via `pdf.internal.pageSize`), then draws the title bar + sheet outline + each placed panel using vector primitives.

`drawSheet` is the page-renderer:
- Compute scale = min((pageW - 2·margin) / sheetL, (pageH - 2·margin) / sheetW).
- Title bar at top: `${material.name} — Sheet ${sheetIndex}/${total} — ${utilizationPct}% util`.
- Sheet outline + each `PlacedPanel` rendered in vector primitives (`pdf.rect`, `pdf.text`).

### 6.2 PNG — offscreen canvas, raster

```ts
// packages/app/src/nesting/renderNestSheetPng.ts
async function renderNestSheetPng(sheet: NestSheet, materials: MaterialRegistry, opts: { canvasWidthPx: number }): Promise<Blob> {
  const aspect = sheet.sheetWidthMm / sheet.sheetLengthMm;
  const canvas = new OffscreenCanvas(opts.canvasWidthPx, Math.round(opts.canvasWidthPx * aspect));
  const ctx = canvas.getContext('2d')!;
  drawSheetCanvas(ctx, sheet, materials, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: 'image/png' });
}
```

`drawSheetCanvas` mirrors `drawSheet` (same primitives, different draw target). Both can call a shared `drawSheetCommands(sheet, material, scale)` that returns an array of `{type:'rect',...} | {type:'text',...}` instructions, dispatched per renderer. v1 is fine with two near-duplicate functions; refactor to a `Renderer` interface is an F-item if a third target appears.

### 6.3 triggerDownload helper

```ts
// packages/app/src/nesting/triggerDownload.ts
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

Reused for both PDF and PNG. No `showSaveFilePicker` (Safari support gap; F-item).

---

## 7. Stale detection

```ts
// packages/shared/src/nesting/fingerprint.ts
async function computeNestFingerprint(
  rows: readonly CutListRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): Promise<string> {
  const payload = JSON.stringify({
    rows: rows
      .map((r) => ({
        rowKey: r.rowKey, qty: r.qty,
        length: r.length, width: r.width, thickness: r.thickness,
        materialId: r.materialId, grain: r.grain,
      }))
      .sort((a, b) => a.rowKey.localeCompare(b.rowKey)),
    sheetStock: materials
      .filter((m) => m.sheetLengthMm !== undefined)
      .map((m) => [m.id, m.sheetLengthMm, m.sheetWidthMm])
      .sort(([a], [b]) => a.localeCompare(b)),
    kerfMm,
  });
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

Note the **`async`** signature. The NestingTab uses a `useEffect` to compute the current fingerprint and store it in local state for the stale comparison. `GenerateNestCommand.apply` awaits the fingerprint before assigning `nest`. (One async call per Generate; the tab re-computes only when `result.rows` / `materials` / `nest.params.kerfMm` references change.)

Edge bands are deliberately excluded — they don't affect packing layout. Item-number renumbering (5d) is also excluded — it changes labels but not geometry, so a renumber should not invalidate the nest. The `rowKey` (which encodes L/W/T/material/grain) is what we hash.

---

## 8. Persistence

### 8.1 Manifest v12 → v13

Both extensions are additive and the migration is a no-op:

```ts
// packages/shared/src/manifest.ts (modified)
export const CURRENT_MANIFEST_VERSION = 13;

function migrateManifest(doc: unknown, fromVersion: number): unknown {
  // ... existing v7..v12 migrations
  if (fromVersion < 13) {
    // No-op: v13 only adds optional fields. No backfill needed.
    // AssemblyDocument.nest stays undefined.
    // MaterialEntry.sheetLengthMm / sheetWidthMm stay undefined.
  }
  return doc;
}
```

`AssemblyPacker` (kernel) opaquely round-trips the new `nest` field — no kernel-side changes needed (5d set the same precedent for `cutListItemNumbers`).

### 8.2 Determinism & re-open

Re-opening a project with persisted `nest`:
- The NestingTab renders the persisted `sheets[]` directly (no recomputation).
- `useEffect` computes the current fingerprint from `result.rows` + `materials` + `nest.params.kerfMm`.
- If fingerprint matches → no banner.
- If fingerprint differs (e.g. user edited cut-list since last save) → stale banner.

### 8.3 Snapshot semantics

`NestSheet.sheetLengthMm` / `sheetWidthMm` are **snapshotted from the registry at Generate time**, not looked up live. If the user later changes a material's `sheetLengthMm` in the registry editor, the persisted `nest.sheets[*].sheetLengthMm` keeps the value used for the current packing — it's part of the layout. The fingerprint mismatch will surface the stale banner; regeneration picks up the new sheet stock.

---

## 9. Testing strategy

### 9.1 Shared unit (`packages/shared/src/nesting/__tests__/`)

Target: ~30 tests.

- `packGuillotine`:
  - Empty input → 0 sheets, 0 oversized.
  - Single panel fits → 1 sheet, 1 panel at (0,0), `rotated=false`.
  - Single panel exceeds sheet → 0 sheets, 1 oversized.
  - Two same-size panels with grain='none' → 1 sheet if both fit; deterministic placement.
  - Grain='length' panel forces no rotation even if rotated would pack better.
  - Grain='width' forces rotation (panel stored L = 600, W = 400 with grain='width' on a 2440×1220 sheet → placed as W=600 along sheet length, L=400 along sheet width, `rotated=true`).
  - Kerf is applied between adjacent panels (place two side-by-side, third panel position is `panel1.length + kerf`).
  - First-fit-decreasing ordering verified by golden-test on a 6-panel mix.
  - Determinism: same input array twice → byte-identical sheet output.
  - Multi-sheet: 3 large panels that each occupy >50% of a sheet → 3 sheets.
- `packAllMaterials`:
  - Mixed materials → each material gets its own sheet block; sheet ordering is `(materialId.localeCompare, sheetIndex)`.
  - Material missing sheet stock → exclusion `'no-sheet-stock'`.
  - Material with oversized panel → exclusion `'panel-exceeds-sheet'` listing the itemNumber.
- `computeNestFingerprint`:
  - Same inputs → same hash.
  - Renumbering (different `itemNumber`, same `rowKey`) → same hash.
  - Edge-band changes → same hash (we don't include edges).
  - Kerf change → different hash.
  - Sheet-stock change → different hash.

### 9.2 App unit (`packages/app/src/commands/__tests__/`)

Target: ~20 tests.

- `GenerateNestCommand` apply / revert / re-apply (idempotent on same inputs).
- `ExportNestPdfCommand` produces a Blob of `application/pdf`, multi-page.
- `ExportNestPngCommand` produces a Blob of `image/png`.
- `MaterialRegistryEditor`: rendering with sheet-stock columns; validation of "set both or neither"; round-trip through `EditMaterialCommand`.
- `NestingTab`: empty state when `nest === undefined`; rendering with one material / multiple sheets; stale banner appears on fingerprint mismatch; per-sheet PNG button visible.
- Mutual-exclusion of Nesting tab with Assembly / BOM / Cut List tabs.

### 9.3 E2E (`packages/app/e2e/furniture/`)

4 chromium specs:

- **T-5e-1 (`nesting-single-sheet.spec.ts`)**: Place 6 panels of one material via existing `seedAssemblyPanelPart` helper; ensure the registry has sheet stock; click Generate Nest with kerf 3; open Nesting tab; expect 1 sheet visible with 6 `#item` labels matching the 5d Cut List.
- **T-5e-2 (`nesting-multi-sheet.spec.ts`)**: Place 4 cabinets (use 5b's `CreateCabinetCommand`); Generate; expect ≥ 2 sheets in the Nesting tab; verify all panels' `item#` are present across sheets.
- **T-5e-3 (`nesting-stale-banner.spec.ts`)**: Generate; verify no banner. Add another panel; verify banner appears in NestingTab. Click Regenerate (the banner button); verify banner disappears and new sheet count reflects the addition.
- **T-5e-4 (`nesting-export-pdf.spec.ts`)**: Generate; click Export PDF; capture the download via Playwright `page.waitForEvent('download')`; assert filename ends `.pdf` and `download.suggestedFilename().startsWith('nest-')`; assert downloaded file size > 0 bytes.

### 9.4 Perf (`packages/app/perf/`)

1 perf spec:

- **`nest-large.perf.spec.ts`**: Synthetic `CutListResult` with 200 panels across 1 material on a 2440×1220 sheet (~5–6 sheets expected). Run `packAllMaterials` 20× and measure p95. Budget: **p95 < 50ms** (greedy guillotine is O(panels² × free-rects), expected fast on a modern CPU). Print result line as 5d does.

### 9.5 Manual smoke

`docs/superpowers/manual-tests/subproject-5e.md` — 4 scenarios:
- T1: One cabinet → Generate → 1 sheet.
- T2: Three cabinets across two materials → 2 material sections.
- T3: Material with no sheet stock → excluded section.
- T4: Edit cabinet height → stale banner → Regenerate.

---

## 10. Build sequence (suggested phasing for the implementation plan)

(Detailed task-level breakdown is the writing-plans skill's job. This is a hint for ordering.)

| Phase | Work | Verifies |
|---|---|---|
| 1 | Shared types + `MaterialEntry` extension + manifest v12→v13 + `NestState` types | typecheck clean across packages |
| 2 | `packGuillotine` + `packAllMaterials` + `computeNestFingerprint` (pure shared) | shared unit suite green |
| 3 | `MaterialRegistryEditor` extension + `EditMaterialCommand` updated | app unit + manual sheet-stock entry works |
| 4 | `GenerateNestCommand` + store wiring + ribbon panel + dialog | app unit green; manual ribbon click writes `asm.nest` |
| 5 | `<NestingTab>` + `SheetSvg` + BrowserPane 4th tab + stale banner | manual: switch to tab and see SVG; banner toggles |
| 6 | `renderNestPdf` + `ExportNestPdfCommand` + ribbon button | manual: download a PDF; opens in viewer |
| 7 | `renderNestSheetPng` + `ExportNestPngCommand` + per-sheet button | manual: download a PNG; opens in viewer |
| 8 | E2E specs T-5e-1..T-5e-4 | full e2e run green |
| 9 | Perf spec + manual smoke doc | perf p95 within budget; smoke doc shipped |

---

## 11. References

- **Reference A (existing — `packages/shared/src/material.ts`)**: `MaterialEntry`, `MaterialId`, `MaterialRegistry`, `isMaterialEntry`, `HEX_COLOR_RE`. The sheet-stock fields plug into `isMaterialEntry`'s validation.
- **Reference B (existing — 5d at HEAD)**: `packages/shared/src/cutListRow.ts` exports `CutListRow`, `CutListResult`, `cutListRowKey`, `normalizeLW`. `packages/app/src/assembly/walkers/aggregateCutListRecursive.ts` is the consumer; 5e reads its output.
- **Reference C (existing — 5b at HEAD)**: `packages/app/src/commands/CreateCabinetCommand.ts` — the atomic command + revert pattern. `GenerateNestCommand` follows the same shape minus OPFS writes (5e's apply is in-memory only).
- **Reference D (existing — 5d at HEAD)**: `packages/app/src/shell/CutListTable.tsx` and `BrowserPane.tsx` — the third-tab pattern. 5e's NestingTab is the fourth.

---

## 12. Risks and open questions

- **jsPDF bundle size.** Adding `jspdf` (~50KB gz) is the only new prod dep. Acceptable — 5e is a furniture-shop feature and PDF export is core. No tree-shaking concern (we use the whole jsPDF core API).
- **OffscreenCanvas browser support.** Chrome / Edge / Safari 16.4+ / Firefox 105+. The app's e2e is chromium-only, so no compatibility issue in the test matrix. If a Safari user reports failure, fall back to a regular `<canvas>` at the cost of an extra DOM node.
- **First-fit-decreasing density.** Documented suboptimality vs best-fit (~1–2%) and vs maxrects (~5–10%). Acceptable for v1; algorithm-comparison F-item allows future upgrade without spec change (the `packGuillotine` interface stays).
- **Deterministic vs locally-better orientation choice.** For `grain='none'`, the "max-leftover-area" heuristic can produce a non-globally-optimal layout. v1 explicitly does not chase global optimality.
- **Async fingerprint inside synchronous Command.apply.** Resolved by making `GenerateNestCommand.apply` async (returns `Promise<void>`). The `CommandBus` already supports async commands (5b's `CreateCabinetCommand` does the same with OPFS writes).
