# Sub-project 4c — Bill of Materials (Design)

Date: 2026-04-26
Status: Drafted

## 1. Purpose

Add an Inventor-classic Bill of Materials view to ZilInventor's assembly mode: a per-assembly table aggregating component instances by `(partPath, color)`, with persisted user-editable item numbers, an Assembly-ribbon entry point, a BrowserPane "BOM" tab, click-to-select interaction with the viewport, an opt-in viewport color rendering toggle, and CSV export via the browser save dialog. Sub-project 4c sits between 4b (constraints + LM solver) and 4d (sub-assemblies); 4d is explicitly out of scope here.

## 2. Locked decisions (from brainstorming, 2026-04-26)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Aggregation by `(partPath, color)`** — same partPath with different colors yields separate BOM rows, each with its own QTY. | Closer to a furniture cut list than a pure parts-only BOM, while still aggregating identical instances. |
| 2 | **UI placement: BrowserPane "BOM" tab + Assembly-ribbon "BOM" button** — both routes open the same view, single source of truth. | Discoverability via ribbon, classic Inventor placement via the BrowserPane. |
| 3 | **Item-number scheme: stored + user-editable** (Inventor classic). New rows auto-assigned `max(existing) + 1`; user can inline-edit; conflicts deterministically bump the colliding row. A `Renumber` command resequences 1..N by `(partName, color)`. | Matches user's Inventor-2012 muscle memory. |
| 4 | **Color representation: per-assembly named palette + ad-hoc hex fallback.** Components reference a palette name OR carry a one-off hex. | Furniture finishes are named (Maple, White Oak, Walnut Veneer); ad-hoc hex covers edge cases. |
| 5 | **Color rendering: View-tab toggle "Show component colors"** (off by default). When on, viewport tints each component mesh with its assigned color; uncolored stays grey. | User asked for view toggle, not always-on. Matches Inventor's view-style separation. |
| 6 | **CSV columns: `Item#, QTY, Part Name, Color, Part Path`.** Color cell is the palette name OR the hex string OR empty. | Production-ready; Part Path lets downstream tooling match by file. |
| 7 | **BOM row click → multi-select** all matching components in the viewport (Inventor classic). | Reuses the existing selection-highlight path. |
| 8 | **CSV delivery: browser save dialog** (`showSaveFilePicker`) with default name `${assembly.name}-bom.csv`; fallback to `<a download>` on browsers without the API. | Same pattern as the existing Save As. |
| 9 | **Sub-assemblies: deferred to 4d.** 4c assumes flat assemblies; spec calls this out as a known gap. | Keeps 4c as a single focused spec. |

## 3. Data model

### 3.1 Type additions in `packages/shared/src/types.ts`

```ts
export type ComponentColor =
  | { kind: 'palette'; name: string }   // refers to AssemblyDocument.colors[name]
  | { kind: 'hex'; hex: string };       // ad-hoc, e.g. '#cc8866'

export type ComponentInstance = {
  id: string;
  partPath: string;
  position: Vec3;
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  color?: ComponentColor;               // NEW — undefined = "no color"
};

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentIds: string[];
  colors: Record<string, string>;           // NEW — palette: name → hex
  bomItemNumbers: Record<string, number>;   // NEW — rowKey → integer
};
```

### 3.2 Row keys

A single helper in `packages/shared/src/bomRow.ts`:

```ts
export function bomRowKey(partPath: string, color?: ComponentColor): string {
  if (!color) return `${partPath}::none`;
  if (color.kind === 'palette') return `${partPath}::palette:${color.name}`;
  return `${partPath}::hex:${color.hex.toLowerCase()}`;
}
```

Stable across reloads (no random ids); no collisions across the three kinds because of the discriminator prefix.

### 3.3 Aggregation

`aggregateBom(assembly, partNames)` returns:

```ts
type BomRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  partPath: string;
  partName: string;
  color: ComponentColor | undefined;
  componentIds: string[];   // for click-to-select
};
```

Algorithm:
1. Group `assembly.components` by `bomRowKey(c.partPath, c.color)`.
2. For each group, compute QTY = group size.
3. Resolve `partName` from a `partNames: Map<partPath, name>` provided by the caller. The caller (BomTable + ExportBomCsvCommand) builds this map via a small `resolvePartName(opfs, partPath)` helper that unpacks each unique partPath's manifest once and reads `manifest.document.name`, cached in a `partNameCacheRef` keyed by partPath (mirrors the existing `geometryCacheRef` pattern in `App.tsx`). Fallback when unpack fails: `"(missing part)"`.
4. Resolve `itemNumber`:
   - If `assembly.bomItemNumbers[rowKey]` exists, use it.
   - Else assign `max(existing values) + 1` (new key).
5. Sort by `itemNumber ASC`.
6. Resolve dangling palette refs (`color.kind === 'palette' && !(name in assembly.colors)`) by treating the row as "no color" for display only — the underlying component data is left untouched.

This function is pure; the deferred-write of newly-assigned item numbers happens in the calling layer (see §4.2).

### 3.4 Migration

`migrateManifest` for v7 assembly manifests defaults missing `colors: {}` and `bomItemNumbers: {}`. No format-version bump (additive). Existing 4a/4b assembly files round-trip with empty palette and empty item-number map.

## 4. Components

### 4.1 Shared

- **`packages/shared/src/types.ts`** — type additions (§3.1).
- **`packages/shared/src/bomRow.ts`** (new) — `bomRowKey`, `aggregateBom`, `compareBomRowsForRenumber(a, b)` (sorts by `partName ASC`, ties broken by `bomRowKey ASC` so it's deterministic across reloads), and `pruneBomItemNumbers(assembly)`. No DOM, no kernel, no React deps.

### 4.2 Store (`packages/app/src/store/useAppStore.ts`)

- Replace `selectedComponentId: string | null` with `selectedComponentIds: string[]`. Existing `selectComponent(id | null)` action becomes a one-element shim (`selectComponents([id])` or `selectComponents([])`) for compatibility with the existing E2E tests and call sites.
- Add `selectComponents(ids: string[])` plus `addComponentToSelection(id)`, `removeComponentFromSelection(id)`.
- Add `bomTabActive: boolean` (BrowserPane sub-tab toggle, defaults `false`).
- Add `showComponentColors: boolean` (View-tab toggle, defaults `false`, session-only — not persisted).
- Add `setComponentColor(componentId, color: ComponentColor | undefined)` — updates the component, triggers autosave.
- Add `setAssemblyPaletteColor(name, hex)` and `removeAssemblyPaletteColor(name)` — palette CRUD.
- Add `setBomItemNumber(rowKey, n)` with conflict-bump: if `n` collides with another row's number, the colliding row gets `max(values) + 1`.
- Add `setBomItemNumbers(map: Record<string, number>)` — bulk write used by `RenumberBomCommand` and the deferred-write path.

**Deferred-write of auto-assigned item numbers:** when `BomTable` renders new rows whose rowKey isn't in `bomItemNumbers`, the table itself does NOT mutate the store on render (avoids effect loops). Instead, the resolved item numbers are batched into the next persistence boundary — concretely, the existing OPFS autosave effect reads `aggregateBom(...)` once before pack, merges the resolved item numbers into the assembly doc, then packs. This converges the file to a complete `bomItemNumbers` map without churn during render.

### 4.3 Commands (`packages/app/src/commands/`)

- **`SetComponentColorCommand`** — wraps `setComponentColor`.
- **`SetBomItemNumberCommand`** — wraps `setBomItemNumber` with conflict-bump.
- **`RenumberBomCommand`** — sorts by `(partName ASC, colorKey ASC)`, writes `bomItemNumbers = { rowKey0: 1, rowKey1: 2, … }`. Bound to Assembly-ribbon "Renumber" button.
- **`ExportBomCsvCommand`** — builds CSV from `aggregateBom(...)` + RFC-4180 quoting; opens `showSaveFilePicker`; falls back to `<a download>` when the API isn't present. Bound to a button in the BomTable view.
- **`OpenBomTabCommand`** — `setBomTabActive(true)`. Bound to the Assembly-ribbon "BOM" button and the BrowserPane tab toggle.
- **`ToggleShowComponentColorsCommand`** — flips `showComponentColors`. Bound to a View-tab toggle button.

### 4.4 Shell

- **`packages/app/src/shell/BrowserPane.tsx`** — in assembly mode, render a small tab strip at the top: `Assembly | BOM`. Tab selection is `bomTabActive`. Non-assembly mode: strip hidden, existing tree unchanged.
- **`packages/app/src/shell/BomTable.tsx`** (new) — renders the array from `aggregateBom(...)`. Columns: `Item#` (inline-edit), `QTY` (read-only), `Part Name` (read-only), `Color` (swatch + label, click opens the same color picker as Edit Component dialog — applies to all components in the row), `Part Path` (read-only). Row click → `selectComponents([...row.componentIds])`. Has a top-right "Export CSV" button (`ExportBomCsvCommand`).
- **`packages/app/src/shell/tabs/AssemblyTab.tsx`** — adds a new "BOM" panel after the existing Component / Position / Constraint panels: two buttons, `BOM` (`OpenBomTabCommand`) and `Renumber` (`RenumberBomCommand`).
- **`packages/app/src/shell/tabs/ViewTab.tsx`** — adds `Show component colors` toggle button (`ToggleShowComponentColorsCommand`). Existing ViewTab content untouched.
- **`packages/app/src/shell/EditComponentDialog.tsx`** — adds a Color row using a new shared `ColorPicker` component (§4.4 below).
- **`packages/app/src/shell/ColorPicker.tsx`** (new) — encapsulates: `<select>` listing `(no color)` + palette names (rendered with a `■` swatch via inline `style={{color: hex}}`) + `+ New palette color…` + `Custom hex…`. The two latter options open a small inline form: name input (palette case only) + native `<input type="color">`. Emits the chosen `ComponentColor | undefined` upward.

### 4.5 Viewport

- **`packages/app/src/viewport/SceneManager.ts`** — extends `ComponentMeshSpec` with optional `colorHex?: string`. When present, `setComponentMeshes` sets the mesh's material to a `MeshStandardMaterial` keyed by hex (cached on the SceneManager so two components sharing the same hex share one material instance — no leak across re-renders). When absent, falls back to the existing shared grey material.
- **`packages/app/src/App.tsx` assembly-mesh-sync effect** — resolves each component's color (`palette` → `assembly.colors[name]`; `hex` → as-is; `undefined` → undefined; dangling palette → undefined) into `colorHex?` only when `showComponentColors` is true; otherwise omits `colorHex`. Add `showComponentColors` to the effect's dependency list so flipping the toggle re-syncs.
- **`packages/app/src/viewport/SceneManager.ts` selection emphasis** — new `setSelectedComponentIds(ids: string[])` method. For each component mesh, if its componentId is in the set, the mesh gets an outline overlay (a `LineSegments` instance built from the mesh's `EdgesGeometry`, parented to the mesh, hex `#ff8800` to match Inventor's selection orange); else the overlay is removed. Overlays share a single `LineBasicMaterial` cached on the SceneManager. The overlay is layered on top of any color-tinted material so selection is visible regardless of the View toggle.
- **`packages/app/src/App.tsx` selection sync effect** — a small effect subscribing to `selectedComponentIds` calls `viewportRef.current.getSceneManager()?.setSelectedComponentIds(ids)`. Cleared to `[]` on assembly close.

### 4.6 Storage

- **`packages/kernel/src/storage/AssemblyPacker.ts`** — already serialises `AssemblyDocument` opaquely; the new fields ride along. Add a small save-time pruning step that drops rowKeys from `bomItemNumbers` whose rowKey isn't represented by any component in `assembly.components`. Same pruning logic exposed via a pure helper in `bomRow.ts` (`pruneBomItemNumbers(assembly)`) so the autosave effect can apply it without unpacking-then-repacking.

## 5. Data flow

### 5.1 Place / edit / delete component

`addComponent` / `updateComponent` / `removeComponent` already mutate `assembly.components`. Color edits go through `updateComponent` (no new path needed). The BOM is a derived view — no direct write to `bomItemNumbers` happens here.

### 5.2 BOM render (BrowserPane "BOM" tab active)

1. The component subscribes to `assembly.components`, `assembly.colors`, `assembly.bomItemNumbers`, plus a `partNames: Map<partPath, name>` resolved via a small effect that reads each unique `partPath` once via `loadAssemblyTiles` or an even smaller `resolvePartName` helper that just reads the manifest.
2. Calls `aggregateBom(assembly, partNames)`.
3. Renders the table sorted by `itemNumber ASC`.
4. Click a row → `selectComponents([...row.componentIds])` → the selection-sync effect (§4.5) calls `SceneManager.setSelectedComponentIds(...)` so all matching meshes show the outline overlay.
5. Inline-edit `Item#` → blur fires `SetBomItemNumberCommand(rowKey, n)`.
6. Click Color cell → opens `ColorPicker` → on commit, dispatches one `SetComponentColorCommand` per component in the row.

### 5.3 Renumber

Assembly-ribbon "Renumber" button → `RenumberBomCommand` → resequences `bomItemNumbers = { rowKey0: 1, rowKey1: 2, ... }` by `(partName ASC, colorKey ASC)`. Single store write; autosave picks it up.

### 5.4 Export CSV

BomTable "Export CSV" button → `ExportBomCsvCommand`:
1. Calls `aggregateBom(...)` (same one the table renders).
2. Builds a string: header `Item#,QTY,Part Name,Color,Part Path\n` followed by one row per `BomRow`, each cell escaped per RFC-4180 (quotes wrapping cells that contain `,`, `"`, or `\n`; literal `"` → `""`).
3. Color cell: palette name (`row.color.name`) for palette, hex string (`row.color.hex`) for hex, empty string for undefined.
4. Encodes as UTF-8 (`new TextEncoder().encode(...)`) and writes via `showSaveFilePicker({ suggestedName, types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }] })`. Falls back to `<a download>` + `URL.createObjectURL` on Firefox.
5. User cancels save dialog → silent no-op.
6. Empty assembly → header row only; status bar shows "Exported empty BOM".

### 5.5 Show component colors toggle

View-tab toggle → `setShowComponentColors(v)`. The assembly-mesh-sync effect re-runs (it depends on `showComponentColors`); each component's spec is rebuilt with `colorHex?` either present or absent. SceneManager swaps materials. Toggle state lives in the store but is NOT serialised — session only.

### 5.6 Autosave persistence of derived numbers

OPFS autosave effect (existing 4a code) is extended: every assembly autosave (regardless of which mutation triggered it) merges the resolved BOM item numbers into the file before pack:

```ts
const rows = aggregateBom(assembly, partNames);
const merged = { ...assembly.bomItemNumbers };
for (const r of rows) merged[r.rowKey] = r.itemNumber;
const pruned = pruneBomItemNumbers({ ...assembly, bomItemNumbers: merged });
const toPack = { ...assembly, bomItemNumbers: pruned };
packAssembly(toPack);
```

This converges the file's `bomItemNumbers` to the resolved set without forcing a render-time mutation.

## 6. Error handling and edge cases

- **Palette name overwrite** — adding a palette name that already exists overwrites the hex; intentional.
- **Removing a palette color used by N components** — components keep their `color: { kind: 'palette', name }` reference; aggregator treats the dangling reference as "no color" for display and tinting; re-adding the name restores the link.
- **rowKey hygiene** — save-time pruning drops orphan keys.
- **Empty assembly CSV** — header row only; status bar message.
- **No File System Access** — `<a download>` fallback.
- **User cancels save dialog** — silent no-op.
- **Missing partPath** (4a's existing diagnostic case) — row appears with `Part Name = "(missing part)"`; CSV still includes it.
- **`showComponentColors: true` + dangling palette** — falls back to grey.
- **Non-parsable hex in component** — falls back to grey, console warning.
- **Inline Item# edit conflict** — colliding row gets `max(values) + 1`. Single deterministic bump, no cascading swaps.
- **Inline Item# edit invalid input** (non-positive int / non-int / out-of-range) — input rejects on blur, value reverts; status-bar message.
- **Material caching on SceneManager** — `MeshStandardMaterial` instances keyed by hex; reused across re-renders; disposed on `dispose()` so we don't leak GPU memory across kernel restarts.
- **Multi-select migration** — old `selectedComponentId` shim wraps single-element selection; existing tests pass unmodified; new BOM-driven multi-select uses the array directly.

## 7. Testing strategy

### 7.1 Shared

- `bomRow.spec.ts` — `bomRowKey()` collision-free across the three kinds; `aggregateBom` aggregation + QTY counts + item-number assignment with mixed pre-stored + auto-assigned new keys + sort order + dangling palette refs degrade to "no color" + missing partName fallback. Pure-function tests, no DOM.
- `migrateManifest` extension — legacy v7 assemblies without `colors` / `bomItemNumbers` round-trip with empty defaults.

### 7.2 Kernel

- `AssemblyPacker` round-trip — preserves `colors`, `bomItemNumbers`, `ComponentInstance.color`. Save-time pruning drops orphan rowKeys.

### 7.3 App unit

- Store: `selectComponents` / `setComponentColor` / `setBomItemNumber` (with conflict-bump) / `setBomItemNumbers` / `setAssemblyPaletteColor` / `removeAssemblyPaletteColor` / `bomTabActive` / `showComponentColors`.
- Commands: each new command has a focused spec (state-transition assertions only; no UI).
- `BomTable.spec.tsx` — renders rows from a fixture; click row triggers `selectComponents` with the right ids; inline-edit Item# triggers conflict-bump; "—" shown for unassigned color; Color cell click opens `ColorPicker`.
- `BrowserPane.spec.tsx` — extends existing test: assembly mode renders the tab strip; clicking BOM tab swaps view; non-assembly mode hides the strip.
- `AssemblyTab.spec.tsx` — extends: BOM ribbon panel renders BOM + Renumber buttons in assembly mode.
- `ViewTab.spec.tsx` — Show component colors toggle dispatches the command.
- `EditComponentDialog.spec.tsx` — extends: Color row, palette dropdown, "+ New palette color…" inline form, "Custom hex…" path, "(no color)" sentinel; `setComponentColor` invoked correctly.
- `ColorPicker.spec.tsx` — emits the right `ComponentColor` shape for each option.
- `SceneManager.spec.ts` — `setComponentMeshes` with `colorHex` swaps to `MeshStandardMaterial`; reuses materials across same-hex specs; reverts to shared grey when flag flips off; doesn't leak materials. `setSelectedComponentIds` adds an outline overlay on listed meshes and removes it on others; idempotent on the same array.

### 7.4 E2E (`tests/e2e/assembly/`)

All use `seedAssemblyCubePart` plus a new `seedAssemblyCubePartAlt` (same shape, different name/path so the BOM has multiple distinct rows).

- `bom-place-and-aggregate.spec.ts` — place 3 cubes (same partPath, no color), open BOM tab, expect one row QTY 3, item# 1.
- `bom-color-splits-row.spec.ts` — place 4 cubes, assign 2 of them palette color "Maple", expect two rows: QTY 2 (no color) and QTY 2 (Maple); reload from OPFS, item numbers persist.
- `bom-renumber.spec.ts` — place 3 distinct parts, user inline-renumbers, values persist, Renumber command resets to 1..N by part name.
- `bom-row-click-selects.spec.ts` — click BOM row → `selectedComponentIds` contains all matching ids; assert via a `__zilventorComponentSelectedOverlay(componentId)` dev hook that the matching component meshes carry the orange outline overlay.
- `bom-csv-export.spec.ts` — drive `ExportBomCsvCommand` with a dev hook (`__zilventorBomCsvBytes`) that captures the bytes that would have been written; assert content matches expected CSV (header + escaped fields).
- `bom-color-render-toggle.spec.ts` — flip View-tab toggle; assert via a dev hook `__zilventorComponentMaterialHex(componentId)` that the colored component's mesh material reports the assigned hex when toggle is on and reverts to the shared-grey sentinel when off.
- `bom-broken-palette-ref.spec.ts` — assign palette color, remove palette entry, expect BOM aggregates orphan into "no color" and viewport falls back to grey.

### 7.5 Perf (`tests/perf/`)

- `bom-aggregate-large.spec.ts` — synthetic 200-component assembly. Budget: `aggregateBom` < 5 ms p95, first BOM table render < 50 ms p95 on the 2014–2016 i3/i5 target.

## 8. Out of scope

- Sub-assembly recursion (4d). 4c assumes flat assemblies. The aggregator will be extended in 4d to walk nested `.ziasm` references.
- Mass / volume / material columns (5 — Furniture plug-in layer). The plug-in layer can extend BOM with cut-list fields without re-architecting.
- Palette-manager dialog (rename, batch delete, usage count). Palette grows organically through Edit Component; 4c v1 doesn't need a manager UI.
- Custom column ordering or hide/show columns. Fixed five-column view in v1.
- Multi-row paste / multi-edit. Single-row inline edit only.
- Print / PDF view. CSV is the only export path in v1.
- Per-instance overrides of QTY (e.g., setting a row's QTY to 5 even though only 3 instances exist). QTY is always derived.

## 9. Known gaps and follow-ups

- When 4d ships, `aggregateBom` needs a recursive variant that walks nested `.ziasm` and rolls up child component counts. The data model already supports it (component IDs are unique within the top-level assembly); 4d will need to define how nested item numbers are namespaced.
- The "Custom hex…" path uses the native `<input type="color">` which is a 6-digit `#rrggbb` picker — no alpha, no per-browser palette persistence. Acceptable for v1; a fancier picker is a future polish.
- Palette colors can be deleted with components still referencing them. We rely on graceful degradation rather than a usage-count guard — re-adding the same name restores the link.
