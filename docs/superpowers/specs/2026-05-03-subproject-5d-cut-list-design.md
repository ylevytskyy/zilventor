# ZilInventor — Sub-project 5d: Cut List tab + CSV export

- **Date:** 2026-05-03
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 5d of 5a–5e (Furniture plug-in layer). Turns the 5a Panel primitive into shippable user-facing value.
- **Build order:** 5a ✅ → **5d** → 5b → 5c → 5e (locked during 5a brainstorming, 2026-05-01).
- **Prior art:** Mirrors the 4c BOM tab + 4d recursive walker patterns. Reuses `SubAssemblyCache`, the BrowserPane tab strip, the autosave merge/prune pattern, and the orange selection overlay.

---

## 1. Scope and non-goals

### 1.1 What 5d delivers

A new **Cut List** view in assembly mode: a recursive walk of the active assembly's nested tree collecting every leaf part whose feature-tree base is a `PanelFeature`, aggregated by `(L, W, T, materialId, grain)` (with `(L, W) → (max, min)` normalization only when `grain = none`). Output:

1. A panel-rows table with columns `Item# / QTY / Material / L / W / T / Grain / Front / Back / Left / Right / Part Name / Part Path`.
2. An edge-band totals footer: one row per banding material, length in mm and m, weighted by panel QTY.
3. A non-panel exclusion footer: `Excluded from cut list: N non-panel components (M distinct parts)`.
4. CSV export of all three sections concatenated (panel rows, blank line, band totals header + rows, blank line, exclusion line).
5. Persisted user-editable item numbers (separate map `cutListItemNumbers`) with conflict-bump and a `Renumber` command.
6. BrowserPane third tab `Cut List` + Furniture-ribbon `Cut List` panel with `Cut List` / `Renumber` / `Export CSV` buttons.
7. Row click → multi-select all matching panel instances across the whole tree, same orange overlay as 4c BOM.

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 5b | Cabinet configurator (the parts that *populate* the cut list automatically) |
| 5c | Hardware in the BOM-side view (cut list is panels-only by design) |
| 5e | Sheet-stock nesting / kerf / per-sheet PDF — band totals here are length-only, not material-cost |
| 5e | Material-cost columns ($/sheet, $/m banding) |
| post-5e | Per-edge partial bands (5a F6); bottom-rim bands (5a F5); modeled band geometry (5a F3) |
| post-5e | Custom column ordering / hide-show columns |
| post-5e | Print / PDF view |
| post-5e | Multi-row paste / multi-edit |
| post-5e | Scope picker (per-cabinet sub-assembly cut lists) |
| post-5e | Mixed-unit display (mm/inches toggle); always mm in v1 |
| post-5e | Saved cut-list filters / search |

### 1.3 Migration / file-format impact

Manifest version bumps `v10 → v11` (additive only): `AssemblyDocument` gains `cutListItemNumbers: Record<string, number>` (default `{}`). Part manifests pass through (only `formatVersion` bumps). Legacy v10 files migrate forward by initialising the field to `{}`.

### 1.4 Success criteria

5d is done when **all** are demonstrably true:

1. From a sub-assembly containing 3 placed panels (2 identical, 1 different material), `Furniture → Cut List` opens the BrowserPane Cut List tab and shows 2 rows (QTY 2 and QTY 1) plus a band-totals footer matching the dialog edge-band selections.
2. Recursion: placing the same sub-assembly twice as a sub-component of an outer assembly produces 2 rows of QTY 4 and 2.
3. Edge-band totals: a 600×400 panel with PVC bands on Front+Back, QTY 3 → row in the band-totals footer reads `PVC 1mm white   3600 mm   3.600 m`.
4. Inline-edit `Item#` works with conflict-bump; `Renumber` resequences 1..N by `(materialName ASC, length DESC, width DESC)`.
5. CSV export round-trips the table content (RFC-4180 quoted) and round-trips through `showSaveFilePicker` with `<a download>` fallback.
6. Editing a panel feature inside its `.zipt` (changing L from 600 to 700) and re-opening the Cut List tab reflects the new size after the part-info cache invalidation.
7. `pnpm -r typecheck`, all unit/integration suites, the new e2e specs, and the new perf spec pass.

---

## 2. Data model

All shared types live in `packages/shared/src/`.

### 2.1 `AssemblyDocument` extension

`packages/shared/src/types.ts`:

```ts
export type AssemblyDocument = {
  // ...existing fields
  cutListItemNumbers: Record<string, number>;   // NEW — rowKey → integer, default {}
};
```

### 2.2 `PanelSpec` resolved value

`packages/shared/src/panel-feature.ts` (additive):

```ts
export interface PanelSpec {
  readonly length: number;       // mm, resolved
  readonly width: number;        // mm, resolved
  readonly thickness: number;    // mm, resolved
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: { readonly materialId: MaterialId } | null };
}

export function resolvePanelSpecFromFeature(
  feature: PanelFeature,
  parameters: Record<string, SketchParameter>,
): PanelSpec | null;
```

`PanelSpec` is the post-evaluation snapshot of a `PanelFeature` against its part's `parameters` map. Pure data, no `ParamOrLiteral`. Returns `null` on broken param refs or non-positive resolved values.

### 2.3 Cut-list row types

`packages/shared/src/cutListRow.ts` (new):

```ts
export type CutListRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  // displayed dimensions (post-normalization for grain=none)
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  materialName: string;             // resolved from registry
  grain: GrainDirection;
  edgeBands: {                      // displayed; null = no band
    front: { materialId: MaterialId; materialName: string } | null;
    back:  { materialId: MaterialId; materialName: string } | null;
    left:  { materialId: MaterialId; materialName: string } | null;
    right: { materialId: MaterialId; materialName: string } | null;
  };
  // back-references for the part(s) contributing this row
  partPath: string;                 // first-seen partPath for the row
  partName: string;                 // resolved via partInfo
  componentPathKeys: string[];      // for click-to-select multi-select (4d-style pathKey list)
};

export type EdgeBandTotal = {
  materialId: MaterialId;
  materialName: string;
  totalLengthMm: number;            // sum over (per-edge length × QTY) for all rows banding this material
};

export type CutListExclusion = {
  componentCount: number;           // total non-panel component instances skipped
  partCount: number;                // distinct partPaths represented in those instances
};

export type CutListResult = {
  rows: CutListRow[];
  bandTotals: EdgeBandTotal[];
  excluded: CutListExclusion;
};
```

### 2.4 Row key

```ts
export function cutListRowKey(spec: PanelSpec, normalized: { L: number; W: number }): string {
  return [
    `L=${normalized.L}`,
    `W=${normalized.W}`,
    `T=${spec.thickness}`,
    `M=${spec.materialId}`,
    `G=${spec.grain}`,
  ].join('|');
}
```

Stable across reloads (no random ids); deterministic. Disjoint from `bomRowKey` shape (`${partPath}::...`) so cut-list and BOM keys cannot collide even if both maps existed on the same `AssemblyDocument`.

### 2.5 Normalization rule

```ts
function normalizeLW(spec: PanelSpec): { L: number; W: number } {
  if (spec.grain !== 'none') return { L: spec.length, W: spec.width };
  return { L: Math.max(spec.length, spec.width), W: Math.min(spec.length, spec.width) };
}
```

Encapsulated inside the aggregator. When `grain = none` and `(L, W)` are swapped, both panels merge into the same row.

### 2.6 Manifest migration v10 → v11

`packages/shared/src/migrateManifest-v10-to-v11.ts` (new):
- For `kind: 'assembly'`: ensure `cutListItemNumbers: {}` exists.
- For `kind: 'part'`: pass-through.
- Bump `formatVersion: 11`.

Spec test added in `shared/__tests__/migrateManifest-v10-to-v11.spec.ts`. The `fileFormat.spec.ts` baseline is extended to v11.

### 2.7 Validation rules

- `cutListItemNumbers` keys are opaque strings; no save-time validation (mirrors 4c `bomItemNumbers`).
- `PanelSpec` validation happens at resolve time inside `resolvePanelSpec`: if any of L/W/T resolves to `≤ 0` or `NaN`, return `null` (panel is treated as "unresolvable" and excluded with a console warning, rather than crashing the whole cut-list pass).
- Broken `materialId` (panel's primary material missing from the assembly registry) → row is still emitted but `materialName = '(missing material)'` and the row's edge-band totals contributions still apply; flagged in the table with a yellow row tint.
- Broken `EdgeBand.materialId` → that edge cell shows `(missing)` and contributes to no band-total row.

---

## 3. Components

Mostly mirrors the 4c shape so reviewers can map file-by-file.

### 3.1 Shared (`packages/shared/src/`)

- **`cutListRow.ts`** (new) — pure; `cutListRowKey`, `aggregateCutListLocal` (single-doc, used in unit tests), `compareCutListRowsForRenumber(a, b)` (sort by `materialName ASC, length DESC, width DESC, rowKey ASC` for ties), `pruneCutListItemNumbers(liveKeys, stored)`. No DOM, no React, no kernel.
- **`panel-feature.ts`** — gains the `PanelSpec` type and `resolvePanelSpecFromFeature(feature, parameters)`. The OPFS-aware part-loading wrapper lives in app, but the param-resolution math is pure and shared so it's testable in isolation.
- **`migrateManifest-v10-to-v11.ts`** (new) — additive `cutListItemNumbers: {}` for assembly manifests.
- **`types.ts`** — `AssemblyDocument.cutListItemNumbers` field.

### 3.2 App walkers (`packages/app/src/assembly/walkers/`)

- **`aggregateCutListRecursive.ts`** (new) — the recursive walker. Signature:

  ```ts
  export function aggregateCutListRecursive(
    activeDoc: AssemblyDocument,
    cache: Pick<SubAssemblyCache, 'get'>,
    panelSpecs: Map<string, PanelSpec | null>,   // keyed by partPath; null = non-panel
    materials: MaterialRegistry,                 // active assembly's registry
    partInfo: Map<string, PartInfo>,
  ): CutListResult;
  ```

  Algorithm:

  1. Walk the tree (same DFS as `aggregateBomRecursive`); for each leaf component, look up `panelSpecs.get(partPath)`.
  2. `null` → bump exclusion counts (`componentCount++`, track distinct partPaths in a `Set`); continue.
  3. `PanelSpec` → normalize L/W per §2.5, build rowKey, push to a `Map<rowKey, { spec, normalized, componentPathKeys[] }>`. Track first-seen `partPath` per group for display.
  4. After the walk: assemble `CutListRow[]`, resolve `materialName` via the active registry (broken refs → `'(missing material)'`), assemble `bandTotals` (single sweep over rows; per band material accumulate `Σ(perEdgeLength × QTY)` where `front/back → row.length`, `left/right → row.width`).
  5. Item-number assignment: identical to 4d's BOM aggregator — `existing[rowKey]` first, else `max(existing.values) + 1`.
  6. Sort rows by `itemNumber ASC`. Sort bandTotals by `materialName ASC`.

### 3.3 App resolvers (`packages/app/src/shell/`)

- **`resolvePanelSpec.ts`** (new) — sibling to `resolvePartInfo.ts`. Signature:

  ```ts
  export type PanelSpecCache = Map<string, PanelSpec | null>;  // null cached for non-panels
  export async function resolvePanelSpec(opfs, partPath, cache): Promise<PanelSpec | null>;
  ```

  Implementation: if `cache.has(partPath)`, return cached. Else unpack the part manifest from OPFS, find `featureTree.features[0]`. If not a `PanelFeature` (use `isPanelFeature`), cache `null` and return. Else call `resolvePanelSpecFromFeature(feature, partManifest.parameters)`; cache the result and return. Errors during unpack → console warning, cache `null`, return `null`.

- **`loadCutListInputs.ts`** (new) — small effect helper analogous to the existing `partInfo` loading in `App.tsx`. Walks `getReferencedLeafPartPaths(activeDoc, cache)` (already exists from 4d), collects unique partPaths, calls `resolvePanelSpec` per partPath against the shared `panelSpecCacheRef`. Returns the populated `Map<partPath, PanelSpec | null>`.

### 3.4 Store (`packages/app/src/store/useAppStore.ts`)

- Add `cutListTabActive: boolean` (BrowserPane sub-tab, defaults `false`).
- Refactor BrowserPane tab state from two flag booleans (`bomTabActive`, `cutListTabActive`) to a single discriminated state `activeBrowserTab: 'assembly' | 'bom' | 'cutlist'` (defaults `'assembly'`). Both flags are derived (`bomTabActive = activeBrowserTab === 'bom'`); existing tests + commands keep working unchanged.
- Add `setCutListItemNumber(rowKey, n)` with conflict-bump (mirrors `setBomItemNumber` semantics exactly).
- Add `setCutListItemNumbers(map: Record<string, number>)` — bulk write for `RenumberCutListCommand` and the deferred-write path.

### 3.5 Commands (`packages/app/src/commands/`)

- **`SetCutListItemNumberCommand`** — wraps `setCutListItemNumber`.
- **`RenumberCutListCommand`** — sorts by `compareCutListRowsForRenumber`, writes `setCutListItemNumbers({...})` to 1..N. Bound to Furniture-ribbon `Renumber` button. Reads from a shared `cutListResultRef` updated by `CutListTable` on each render; if the ref is empty (e.g. command fired before table mounted), re-runs `aggregateCutListRecursive` itself as a fallback.
- **`ExportCutListCsvCommand`** — builds a 3-section CSV from `aggregateCutListRecursive(...)`; opens `showSaveFilePicker` with `${assembly.name}-cutlist.csv`; falls back to `<a download>`. Bound to Furniture-ribbon `Export CSV` and a button on the table view.
- **`OpenCutListTabCommand`** — `setActiveBrowserTab('cutlist')`. Bound to Furniture-ribbon `Cut List` button and the BrowserPane tab toggle.

`buildCutListCsv.ts` (new, alongside `buildBomCsv.ts`) holds the pure CSV-builder: header + RFC-4180 quote helper + 3-section concat (panel rows / blank / band totals / blank / exclusion line).

### 3.6 Shell UI

- **`packages/app/src/shell/BrowserPane.tsx`** — extends the assembly-mode tab strip from `Assembly | BOM` to `Assembly | BOM | Cut List`. Tab selection becomes the single `activeBrowserTab` discriminant. Adds `aria-label="Cut List tab"` for E2E selector stability; existing `aria-label`s preserved.
- **`packages/app/src/shell/CutListTable.tsx`** (new) — renders `CutListResult` from `aggregateCutListRecursive(...)`. Layout: panel-rows table on top, edge-band totals subsection in the middle (hidden if empty), exclusion footer at the bottom (always shown). Top-right: `Export CSV` button (`ExportCutListCsvCommand`).
- **`packages/app/src/shell/tabs/FurnitureTab.tsx`** — adds a `Cut List` ribbon panel with three buttons: `Cut List` (`OpenCutListTabCommand`), `Renumber` (`RenumberCutListCommand`), `Export CSV` (`ExportCutListCsvCommand`). Existing `Panel` panel untouched.

### 3.7 Storage

- **`packages/kernel/src/storage/AssemblyPacker.ts`** — already serialises `AssemblyDocument` opaquely; the new `cutListItemNumbers` field rides along. The save-time prune lives in the existing autosave pre-pack effect in `App.tsx` (analogous to 4c's `mergeAndPruneBom`).
- **`packages/app/src/storage/mergeCutListItemNumbers.ts`** (new) — pure helper called by autosave: `mergeAndPruneCutList(assembly, cutListResult): AssemblyDocument`.

### 3.8 Viewport

No new viewport code. Selection of cut-list rows reuses the existing `selectComponents([...componentPathKeys])` → `SceneManager.setSelectedComponentIds` path that 4c/4d shipped. The same orange overlay applies.

---

## 4. Data flow

### 4.1 Open the Cut List tab

User clicks Furniture-ribbon `Cut List` (or BrowserPane `Cut List` tab) → `OpenCutListTabCommand` → store sets `activeBrowserTab: 'cutlist'` → BrowserPane re-renders → mounts `<CutListTable>`.

### 4.2 Cut List render pipeline

`CutListTable` mounts and:

1. Subscribes to `activeAssembly` (id, components, parameters, materials, colors, cutListItemNumbers), the global `subAssemblyCacheRef`, the global `partInfoCacheRef`, and a new global `panelSpecCacheRef`.
2. Effect: walks `getReferencedLeafPartPaths(activeDoc, cache)` (already exists from 4d) → for each unique partPath, calls `resolvePanelSpec(opfs, partPath, panelSpecCacheRef)`. Returns the populated `Map<partPath, PanelSpec | null>`.
3. Calls `aggregateCutListRecursive(activeDoc, subAssemblyCacheRef, panelSpecs, materials, partInfo)` → `CutListResult`.
4. Writes the result into a shared `cutListResultRef` so commands (`Renumber`, `Export CSV`) can read it without re-walking.
5. Renders three sections in order: panel rows, band totals (hidden if empty), exclusion footer (always shown).
6. Top-right `Export CSV` button is enabled only when `rows.length > 0` OR `excluded.componentCount > 0` (so the user can still export an empty-cut-list CSV with the exclusion footer).

The aggregation function is pure; the table never mutates the store on render. Newly-assigned item numbers are written to the store only via the autosave path (§4.6).

### 4.3 Inline-edit Item#

User double-clicks an Item# cell → input opens with current value → blur fires `SetCutListItemNumberCommand(rowKey, n)` → store action runs the same conflict-bump logic as `setBomItemNumber`: if `n` collides with another rowKey's stored number, the colliding rowKey gets `max(values) + 1`. Single deterministic bump, no cascading swaps. Invalid input (non-positive int / non-int) → input rejects on blur, value reverts; status-bar message.

### 4.4 Renumber

Furniture-ribbon `Renumber` button → `RenumberCutListCommand`:

1. Reads the current `CutListResult` from `cutListResultRef`. If empty, re-runs `aggregateCutListRecursive` as a fallback.
2. Sorts `rows` by `compareCutListRowsForRenumber` (`materialName ASC, length DESC, width DESC, rowKey ASC`).
3. Builds `{ [rowKey]: i+1 }` for each row in sorted order.
4. Calls `setCutListItemNumbers(...)`. Single store write; autosave persists.

### 4.5 Export CSV

`ExportCutListCsvCommand`:

1. Reads the same `cutListResultRef` the table populated.
2. Calls `buildCutListCsv(result)`:
   - **Section A — panel rows**: header `Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path\n` + one row per `CutListRow`. RFC-4180 quoting (commas, quotes, newlines). Numeric columns serialised with no thousands separator, no trailing zero (e.g. `600`, `18.5`). Edge-band cells: material name or empty.
   - **Blank line.**
   - **Section B — edge-band totals**: header `Edge Band Material,Total Length (mm),Total Length (m)\n` + one row per `EdgeBandTotal`. Length-m formatted to 3 decimal places.
   - **Blank line.**
   - **Section C — exclusion footer**: a single line `Excluded from cut list,${excluded.componentCount} components,${excluded.partCount} distinct parts\n` (CSV-shaped so spreadsheets parse it without choking).
3. Encodes UTF-8 (`new TextEncoder().encode(...)`) → `showSaveFilePicker({ suggestedName: '${name}-cutlist.csv', types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] })` → write. Falls back to `<a download>` + `URL.createObjectURL` on Firefox. User cancels → silent no-op. Bytes captured to `__zilventorCutListCsvBytes` dev hook on every `apply()` (E2E reads it without driving the dialog).

### 4.6 Autosave persistence of derived numbers

Existing OPFS autosave effect gains a parallel branch for cut-list numbers (sits next to the 4c BOM merge):

```ts
const cutResult = aggregateCutListRecursive(assembly, subAsmCache, panelSpecs, materials, partInfo);
const merged = { ...assembly.cutListItemNumbers };
for (const r of cutResult.rows) merged[r.rowKey] = r.itemNumber;
const pruned = pruneCutListItemNumbers(cutResult.rows.map(r => r.rowKey), merged);
const toPack = { ...assembly, cutListItemNumbers: pruned };
packAssembly(toPack);
```

`pruneCutListItemNumbers(liveKeys, stored)` returns a new map containing only the keys present in `liveKeys`. This converges the file's `cutListItemNumbers` to the resolved set without forcing a render-time mutation.

### 4.7 Click-to-select

Row `<tr>` `onClick={() => selectComponents([...row.componentPathKeys])}` → existing 4d selection-sync effect → `SceneManager.setSelectedComponentIds(...)` → orange outline overlays on every matching panel mesh across the whole tree (recursive walk already produces `pathKey` strings for every leaf instance). Same cell-stop-propagation pattern as 4c's `BomTable`: Item# cell stops propagation so inline-edit doesn't double as a row select; QTY/Material/dimensions cells let clicks bubble.

### 4.8 Cache invalidation

`panelSpecCacheRef` is keyed by `partPath`. Invalidated alongside `partInfoCacheRef` by the same hooks 4c established:

- After a part save (kernel `saveProject` callback already calls `partInfoCache.delete(partPath)`) — extend to also delete from `panelSpecCache`.
- After a `OpenProjectFileCommand` (whole project reload) — both caches cleared.
- On `dispose` of the assembly session — both caches cleared.

This ensures a panel feature edit inside a `.zipt` is reflected in the cut list on next render after save (success criterion §1.4.6).

---

## 5. Error handling and edge cases

| Case | Behavior |
|---|---|
| **Empty assembly** (no components) | All three sections render empty: panel-rows table shows "No panels" placeholder; band-totals subsection hidden; exclusion footer reads `Excluded from cut list: 0 components (0 distinct parts)`. CSV export still works (header rows + empty body + exclusion line). |
| **Assembly with only non-panel parts** | Panel-rows table empty + "No panels" placeholder; exclusion footer shows the actual counts. CSV exports the exclusion line as the only data row. |
| **Missing `.zipt`** (4d-style broken `partPath`) | `resolvePanelSpec` catches the OPFS unpack error → returns `null` → counted as a non-panel exclusion (same bucket as a real non-panel). Console warning `panelSpec resolve failed for ${partPath}: ${err}`. The row's instance still appears in 4c BOM as `(missing part)` — no cross-tab interference. |
| **Broken `materialId` on the panel itself** | Row emits with `materialName = '(missing material)'`; row gets a yellow tint (`bg-yellow-50`) and `aria-invalid="true"`; band-total contributions still computed for any banded edges that DO resolve. Aggregation key still uses the raw `materialId` string, so identical broken refs merge. |
| **Broken `EdgeBand.materialId`** | That edge cell shows `(missing)` (no tint on the row); contributes nothing to band-total totals; console warning. |
| **Panel L/W/T resolves to ≤ 0 or NaN** | `resolvePanelSpec` returns `null` → counted as a non-panel exclusion + console warning. Prevents NaN poisoning of band totals. |
| **Mixed grain across two panels with identical L/W/T/material** | `grain = length` and `grain = width` produce different rowKeys → two rows. `grain = none` for both → one row, with `(L, W) → (max, min)` normalization. `grain = none` for one and `grain = length` for the other → two rows (different keys), as intended. |
| **Item# inline edit with non-positive int / non-int / out-of-range** | Input rejects on blur, value reverts; status-bar message `Item number must be a positive integer`. |
| **Item# conflict-bump** | Single deterministic bump: colliding rowKey gets `max(stored values) + 1`. No cascading. Mirrors 4c. |
| **`bomItemNumbers` and `cutListItemNumbers` sharing rowKeys** | Cannot happen by construction — bom row keys have shape `${partPath}::...`; cut-list keys have shape `L=…|W=…|T=…|M=…|G=…`. Disjoint prefix; no validator needed. |
| **`showSaveFilePicker` not available** (Firefox) | Falls back to `<a download>` + `URL.createObjectURL`. Same path as 4c. |
| **User cancels save dialog** | Silent no-op. `__zilventorCutListCsvBytes` is still populated for E2E. |
| **Two different `materialId`s with the same display name** in the registry | Rows aggregate by `materialId` (not name), so they stay separate even though `materialName` displays identically. The CSV's `Material` column repeats the name; the user can disambiguate via the part-path column or by editing the duplicate registry entry. Acceptable; mirrors 4c color name semantics. |
| **Panel `thicknessFromMaterial = true` and the material's `defaultThickness` changes after the panel was created** | The cut list reads the panel's resolved `thickness` field, which is updated by the existing 5a edit pipeline whenever the material changes. So the cut list reflects the new thickness on next render. No new code. |
| **Tab strip overflow** (Assembly / BOM / Cut List on a narrow viewport) | Tab strip is fixed-width labels; on narrow viewports the strip gains `overflow-x: auto` (single CSS rule on the existing tab strip container). No horizontal-scroll-shadow fanciness in v1. |
| **Cut List tab opened while assembly is loading** | `panelSpecs` Map is empty during the load → aggregator emits zero rows + accurate non-panel counts (zero or partial as the walk progresses). Table shows "Loading…" placeholder while `loadCutListInputs` effect is in-flight. Same UX as 4d's BOM during sub-asm load. |
| **Autosave race**: edit Item# inline AND a part save happens between render and autosave | Autosave reads the live `cutListItemNumbers` Map at pack time (which already contains the inline edit). The aggregator output it merges with also reflects the live map. No double-bump. |
| **Memory leak risk** — `panelSpecCacheRef` growing unbounded | Cache entries are small (`PanelSpec` is 6 numbers + a few strings); even 10 000 unique partPaths is < 1 MB. No eviction in v1. Cleared on project close. |
| **Concurrent assembly autosave + cut-list render** | The aggregator is pure, the autosave path uses an immutable snapshot, and the autosave merge writes only `cutListItemNumbers`. Identical pattern to 4c BOM autosave; no new races. |

---

## 6. Testing strategy

### 6.1 Shared (`packages/shared/src/__tests__/`)

- **`cutListRow.spec.ts`** (new):
  - `cutListRowKey()` — distinct keys for distinct (L, W, T, materialId, grain) tuples; identical keys for identical tuples; key shape disjoint from `bomRowKey` shape.
  - `compareCutListRowsForRenumber()` — sort order: materialName ASC, length DESC, width DESC, rowKey ASC for ties.
  - `pruneCutListItemNumbers()` — drops absent keys, preserves present keys.
  - `aggregateCutListLocal()` (single-doc helper for unit tests; not the recursive walker) — covers grouping, normalization (`grain = none` swaps; `grain = length/width` does not), broken material refs, broken edge-band refs, band-totals math (front/back use `length`, left/right use `width`, weighted by QTY).
- **`migrateManifest-v10-to-v11.spec.ts`** (new) — legacy v10 assembly without `cutListItemNumbers` migrates to `{}` and `formatVersion: 11`. Part manifests pass through.
- **`fileFormat.spec.ts`** — extended with v11 baseline.
- **`panel-feature.spec.ts`** — extended: `resolvePanelSpecFromFeature` resolves param refs, returns `null` on broken param refs / non-positive resolved values.

### 6.2 Kernel (`packages/kernel/src/storage/__tests__/`)

- **`AssemblyPacker.spec.ts`** — extended: `cutListItemNumbers` round-trips. Empty map default. Unknown extra keys drop quietly (additive-format hygiene).

### 6.3 App walkers (`packages/app/src/assembly/walkers/__tests__/`)

- **`aggregateCutListRecursive.spec.ts`** (new) — fixture trees:
  - Flat assembly: 3 components, 2 panels (1 identical pair, 1 distinct), 1 non-panel → 2 rows + 1 exclusion + correct band totals.
  - Two-level recursion: outer assembly with two instances of an inner sub-assembly, inner has 2 panels → 2 rows of QTY 2 each.
  - Three-level recursion: ensures `componentPathKeys` accumulates the full path.
  - Mixed grain: `grain = none` panels with swapped L/W merge; `grain = length` panels with swapped L/W do not.
  - Broken material: row emits with `materialName = '(missing material)'`.
  - All non-panel: zero rows + accurate exclusion counts.
  - Empty assembly: `{ rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } }`.
- **Reuse fixtures** from `aggregateBomRecursive.spec.ts` where shapes match; introduce a `seedPanelLeafCache(specs)` helper for the panel-spec map.

### 6.4 App unit (`packages/app/src/`)

- **Store** (`store/__tests__/useAppStore.spec.ts` extended) — `setCutListItemNumber` (with conflict-bump), `setCutListItemNumbers` (bulk), `activeBrowserTab` discriminant migration (`bomTabActive` derived correctly), mutual exclusion of tab states.
- **Commands** (one spec each, state-transition only):
  - `SetCutListItemNumberCommand.spec.ts`
  - `RenumberCutListCommand.spec.ts` — uses a stubbed `cutListResultRef`; verifies the correct rowKey→number map is written; verifies fallback re-walk when ref is empty.
  - `ExportCutListCsvCommand.spec.ts` — captures `__zilventorCutListCsvBytes` and asserts the 3-section content with RFC-4180 escaping.
  - `OpenCutListTabCommand.spec.ts` — sets `activeBrowserTab: 'cutlist'`.
- **`buildCutListCsv.spec.ts`** (new, in `commands/__tests__/`) — pure-function tests for the CSV builder: panel-rows section, band-totals section, exclusion line; all RFC-4180 edge cases (commas, quotes, newlines in material names); empty-result edge case.
- **`shell/__tests__/CutListTable.spec.tsx`** (new) — renders rows from a fixture `CutListResult`; click row triggers `selectComponents(componentPathKeys)`; inline-edit Item# triggers `SetCutListItemNumberCommand`; missing-material row gets the yellow tint; empty result shows "No panels" placeholder; `Export CSV` button enabled rule; band-totals section hidden when empty.
- **`shell/__tests__/BrowserPane.spec.tsx`** — extended: assembly mode renders `Assembly | BOM | Cut List` tabs; clicking each swaps view; tab strip hidden in non-assembly mode (unchanged).
- **`shell/__tests__/resolvePanelSpec.spec.ts`** (new) — fixture OPFS layer: returns cached value, returns `null` for non-panel parts, returns `null` on broken parts (with console warning), populates the cache once per partPath.
- **`shell/tabs/__tests__/FurnitureTab.spec.tsx`** — extended: `Cut List` ribbon panel renders with three buttons; each binds to its command.
- **`storage/__tests__/mergeCutListItemNumbers.spec.ts`** (new) — merge & prune semantics analogous to `mergeBomItemNumbers`.

### 6.5 E2E (`tests/e2e/furniture/`)

All use the existing 5a fixtures plus a new `seedAssemblyPanelPart.ts` helper (a `.zipt` with a `PanelFeature` at index 0 and a configurable spec) and `seedSubAssemblyWithPanels.ts` (recursion fixture).

- **`cut-list-place-and-aggregate.spec.ts`** — place 3 panel parts (2 identical specs, 1 distinct), open Cut List, expect 2 rows (QTY 2 + QTY 1), correct dimensions and material names.
- **`cut-list-grain-normalization.spec.ts`** — place a `grain=none` 600×400 panel and a `grain=none` 400×600 panel of identical material → single row QTY 2 with `L=600 W=400`. Then create a `grain=length` 600×400 panel + `grain=length` 400×600 panel → two distinct rows.
- **`cut-list-edge-band-totals.spec.ts`** — 600×400 panel with PVC bands on Front+Back, QTY 3 → footer totals row reads `PVC 1mm white  3600 mm  3.600 m`.
- **`cut-list-recursive.spec.ts`** — outer assembly with two sub-assembly instances, inner has 2 panels → cut-list rows show appropriate roll-up QTYs.
- **`cut-list-renumber.spec.ts`** — inline-edit Item#, value persists across reload; conflict-bump fires; `Renumber` resequences 1..N by sort order.
- **`cut-list-row-click-selects.spec.ts`** — click cut-list row → `selectedComponentIds` contains all matching path keys; assert via `__zilventorComponentSelectedOverlay(componentId)` that overlays appear on every matching panel mesh across the tree.
- **`cut-list-csv-export.spec.ts`** — drive `ExportCutListCsvCommand` with the dev hook (`__zilventorCutListCsvBytes`); assert content matches expected 3-section CSV (panel rows + blank + band totals + blank + exclusion line, RFC-4180 quoted).
- **`cut-list-non-panel-exclusion.spec.ts`** — assembly with 2 panel parts + 3 non-panel parts → exclusion footer shows `Excluded from cut list: 3 components, 2 distinct parts` (assumes 2 of the 3 non-panel are the same `partPath`).
- **`cut-list-broken-material.spec.ts`** — place a panel, delete its material entry from the registry (force broken ref via OPFS dev hook), open Cut List → row appears with `(missing material)` and yellow tint; band totals for that material absent or accordingly partial.

### 6.6 Perf (`tests/perf/`)

- **`cut-list-aggregate-large.spec.ts`** (new) — synthetic 200-panel assembly across 50 distinct panel specs across 3 nesting levels.
  - **Budget A (pure aggregator):** `aggregateCutListRecursive` p95 < 5 ms over 50 trials. Uses `__zilventorCutListAggregateMs(trials)` dev hook.
  - **Budget B (first-render wall clock):** Cut List tab open → table mount → `data-cutlist-row` first paint ≤ 1500 ms (mirrors 4c BOM first-render budget; dominated by `resolvePanelSpec` OPFS reads on first open).

### 6.7 Manual smoke

`docs/superpowers/manual-tests/subproject-5d.md` (new) — 3 scenarios:

1. **Single cabinet** — open the 5a "Hello-Panel" project, place 4 panels (2 sides, top, bottom), assign Birch 18mm material with PVC bands on top rim, open Cut List, verify 4 rows + correct band totals + Export CSV opens save dialog with sensible filename.
2. **Two-level recursion** — load the 5a "Cabinet-prep" assembly twice as sub-assemblies inside an outer kitchen assembly, verify QTY counts double.
3. **Renumber + edit** — Renumber, manually edit Item#, save & reload, verify persistence and that conflict-bump fires when re-numbering to a colliding value.

---

## 7. Out of scope and known gaps

### 7.1 Explicitly out of scope

See §1.2 (deferred-to table). Headlines: 5b cabinet generator, 5c hardware in BOM, 5e nesting + cost columns, post-5e UX polish (column ordering, PDF export, multi-edit, scope picker, mm/inches, filters).

### 7.2 Known gaps

- **Snapshot-based perf**: first render after a project open does N OPFS reads (one per unique panel `partPath`) for `resolvePanelSpec`. 4c saw ~650 ms wall clock for ~5 unique parts; 5d's 200-panel perf budget allows 1500 ms. If real cabinet assemblies push past 50 unique panel parts, we'll need a batched/parallel OPFS read or shift toward Approach 2 (snapshot on `ComponentInstance`). Will be revisited if the perf spec fails on the user's box.
- **Two materials with identical display names**: aggregator uses `materialId` so rows stay distinct, but the CSV's `Material` column shows the same string. Cabinet shops typically don't do this, but the registry editor doesn't currently prevent it. Optional polish: registry-editor warning on duplicate names.
- **`cutListItemNumbers` and `bomItemNumbers` are siblings** with no shared structure. If a third numbered view ever lands (e.g. nesting sheet IDs), we'll likely refactor both into a single `numbering: Record<scope, Record<rowKey, number>>` shape. Not worth the refactor for two scopes.
- **No usage-count guard on `DeleteMaterialCommand`** for materials referenced only by the cut-list view — but the panel itself already references the material, and the existing 5a `MATERIAL_IN_USE` guard catches that case. No new guard needed.
- **`Renumber` reads from a shared ref** rather than re-walking. If the user clicks Renumber while the cut-list tab is closed (theoretically impossible — the button's parent panel only renders in assembly mode, but the ribbon button is always enabled), the ref may be stale. Mitigation: the `Renumber` command re-runs `aggregateCutListRecursive` itself if the ref is empty. Trivial fallback.

### 7.3 Anticipated follow-ups (for the F-list during execution)

These are likely to surface during implementation; pre-listing them so they don't expand 5d's scope:

- **F1** — Filter chips above the table: "Material =" / "Thickness ≥" — quick narrowing without leaving the tab.
- **F2** — `Material` column with a colored swatch (uses the material's `color` hex from the registry).
- **F3** — Hover over a row → temporary outline overlay on the matching panel meshes (without changing selection state). Useful for "which panel is row 7?".
- **F4** — Group-by-material section header inside the table (visual grouping; rows still aggregate normally).
- **F5** — "Open part" link on each row — opens the row's `partPath` in part-edit mode for direct dimension changes.
- **F6** — Export band totals as a separate CSV (some shops want a saw worksheet AND a banding worksheet as two distinct files).
- **F7** — Aggregate band totals across both rims when 5a F5 (bottom-rim banding) lands.
