# ZilInventor — Sub-project 5c: Hardware Library

- **Date:** 2026-05-04
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 5c of 5a–5e (Furniture plug-in layer). Hardware parts (hinges, shelf pins) as `.zipt` parts with attach-point metadata. Surfaces hardware in a new BOM section the same way 5b put panels into the cut list.
- **Build order:** 5a ✅ → 5d ✅ → 5b ✅ → **5c** → 5e (locked during 5a brainstorming, 2026-05-01).
- **Prior art:** Mirrors 5a's `MaterialRegistry` for the new `HardwareRegistry`; mirrors 5b's `CabinetDialog` / `OpenCabinetDialogCommand` pattern for the new `HardwareDialog`; extends 5d's CSV builder with a new Hardware section; reuses `PlaceComponentCommand` for hardware placement; bumps manifest to v12.

---

## 1. Scope and non-goals

### 1.1 What 5c delivers

A new **Hardware** `RibbonPanel` on the Furniture tab with a single **Add Hardware** button. Clicking the button (when an assembly is active) opens a modal `HardwareDialog` with a category dropdown and variant grid. On OK:

1. A new `HardwareFeature` discriminant (sibling of `PanelFeature`) is defined in `packages/shared/src/hardware-feature.ts`. Each hardware `.zipt` carries exactly one `HardwareFeature` referencing a `hardwareSkuId`.
2. A new `HardwareRegistry` (per-project, embedded on `PartDocument` and `AssemblyDocument`, mirroring 5a's `MaterialRegistry`) holds canonical name / category / vendor / notes per SKU.
3. A built-in catalog of 7 hardware entries (4 hinges + 3 shelf pins) ships in `packages/shared/src/hardware/builtinCatalog.ts`. New and migrated projects auto-seed `hardware: []` from the built-ins via the v11→v12 migration.
4. Each hardware `.zipt` in OPFS contains a single `extrude` of the part's bounding-box dimensions at origin (cheap, visible in viewport) plus the `HardwareFeature` metadata. Files live at `hardware/<sku>.zipt` under the per-project OPFS root.
5. A new `AddHardwareCommand` writes (or reuses) the `hardware/<sku>.zipt` file and places it into the active assembly via `PlaceComponentCommand`. Symmetric `revert()` removes the placed component; it also deletes the `.zipt` file only if **no `ComponentInstance` in any `.ziasm` in the project's OPFS still references the path** (project-wide reference count, not active-assembly-only — the `hardware/` directory is project-scoped, not assembly-scoped).
6. The 5d cut-list aggregator gains a parallel `aggregateHardwareRecursive` walker. Its output is rendered as a third table block in the Cut List tab UI and as a third CSV section "Hardware" in the exported cut list. Hardware columns: `SKU, Name, Category, Qty, Notes`.
7. The manifest bumps from v11 to v12. Migration v11→v12 adds `hardware: []` to both `PartDocument` and `AssemblyDocument` and seeds the built-in catalog into the project's `AssemblyDocument` registry on first open.

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 5c-follow-ups | Drawer Slides — needs a Drawer Cabinet template (5b follow-up) first. |
| 5c-follow-ups | Screws and other sub-mm fasteners — BOM clutter not justified in v1. |
| 5c-follow-ups | "Manage Hardware" dialog — user cannot edit or add custom SKUs in v1; built-in entries are read-only. |
| 5c-follow-ups | Attach-point snap placement — `AttachPoint` metadata is stored in v1 but the constraint solver does not consume it; placement is free-transform at world origin, same as other components. |
| 5c-follow-ups | Detailed hardware geometry — `.zipt` bounding-box proxy only; no hinge-wing kinematics, no slide channel detail. |
| 5b-follow-ups | `buildBaseCabinet` does NOT auto-emit hardware. The user adds hardware manually via the new dialog after cabinet creation. Cabinet→hardware auto-coupling is deferred. |
| 5e | Nesting / sheet-stock optimization — hardware is excluded from 5e's packing scope. |
| post-5e | Hardware geometry authoring from real 3D data (e.g. STEP import). |
| post-5e | BrowserPane library pane for browsing hardware without opening a dialog. |

### 1.3 Migration / file-format impact

Manifest bumps from v11 to v12. Both `PartDocument` and `AssemblyDocument` gain a `hardware: HardwareEntry[]` field. The migration seeds every existing project's `AssemblyDocument` with the 7 built-in entries (idempotent: if an entry's `id` already exists it is skipped). Part documents gain `hardware: []` (empty) — hardware SKU resolution always reads from the enclosing assembly.

### 1.4 Success criteria

5c is done when **all** are demonstrably true:

1. From an active assembly, **Furniture → Hardware → Add Hardware** opens `HardwareDialog` with a category dropdown defaulting to "Hinges" and a variant grid showing the 4 hinge SKUs.
2. Selecting the "35mm Cup Hinge — Full Overlay" entry and clicking **OK** places 1 hardware component into the active assembly at world origin, backed by `hardware/hinge-35mm-cup-full.zipt` in OPFS. The `HardwareFeature` on that part carries `hardwareSkuId: 'hinge-35mm-cup-full'` and `attachPoints` with 2 named points (see §2.3).
3. The **Cut List** tab renders a new **Hardware** section (a `HardwareTable`) below the existing 5d cut-list content, containing 1 row: `hinge-35mm-cup-full | 35mm Cup Hinge — Full Overlay | Hinges | 1 | –`. (Whether the existing 5d UI renders edge-band totals as a discrete sibling block or inside `CutListTable` is unchanged by 5c — implementation just appends `HardwareTable` after whatever exists today.)
4. Exporting the cut list CSV produces 4 sections: (1) panel rows, (2) edge-band totals, (3) Hardware rows, (4) Excluded summary. With exactly 1 hardware item placed, the Hardware section contains 1 data row.
5. Adding the same hinge SKU a second time (via Add Hardware again) results in the Hardware table showing **1 row with Qty = 2** (grouped by `hardwareSkuId`), not 2 rows.
6. Adding a shelf-pin hardware item (category "Shelf Pins") and a hinge results in the Hardware table showing **2 rows** (one per distinct SKU), with Qty reflecting placement count.
7. `Ctrl+Z` after a successful OK removes the placed hardware component from the active assembly. If no other component in the active assembly references the same `.zipt`, the file is deleted from OPFS. If another component still references it, the file is retained.
8. Switching to the "Shelf Pins" category in the dialog shows 3 SKUs; the grid updates without closing and reopening the dialog.
9. Migrating a v11 project opens without error; the `AssemblyDocument` gains `hardware` with 7 entries; existing cut-list rows are unaffected.
10. `pnpm -r typecheck`, all unit/integration suites, the new e2e specs, and the new perf spec pass.

---

## 2. Domain model and data shapes

### 2.1 HardwareEntry (registry row)

```ts
// packages/shared/src/hardware-feature.ts
interface HardwareEntry {
  id: string;         // stable SKU key, e.g. 'hinge-35mm-cup-full'
  name: string;       // display name, e.g. '35mm Cup Hinge — Full Overlay'
  category: HardwareCategory;
  vendor: string;     // e.g. 'Blum' or '' for generic
  notes: string;      // free text, e.g. 'Requires 35mm Forstner bit'
}

type HardwareCategory = 'hinges' | 'shelfPins';

type HardwareRegistry = readonly HardwareEntry[];
```

`HardwareRegistry` is embedded on both `PartDocument.hardware` and `AssemblyDocument.hardware`. Parallel to `MaterialRegistry` on the same documents (Reference A).

### 2.2 HardwareFeature (part discriminant)

```ts
// packages/shared/src/hardware-feature.ts
interface AttachPoint {
  name: string;
  position: Vec3;   // mm in part-local origin frame
  normal?: Vec3;    // outward normal, unit vector
}

interface HardwareFeature {
  kind: 'hardware';
  id: string;                       // unique within the PartDocument's featureTree
  hardwareSkuId: string;            // foreign key into HardwareRegistry
  bboxMm: { l: number; w: number; h: number }; // bounding-box dims used to build the extrude
  attachPoints: AttachPoint[];
}

function isHardwareFeature(f: unknown): f is HardwareFeature;
```

`kind: 'hardware'` is the discriminant, making `isHardwareFeature` a simple `f.kind === 'hardware'` guard — identical in shape to `isPanelFeature` (`kind: 'panel'`). Reference D.

### 2.3 Attach points per SKU

Each `.zipt` bounding box sits with its minimum corner at the part origin. Attach points for the 7 v1 SKUs:

| SKU | AttachPoint names | Position (mm, in part frame) |
|---|---|---|
| hinge-35mm-cup-full | `cup-center`, `arm-mount` | `(0, 17.5, 0)`, `(48, 17.5, 0)` |
| hinge-35mm-cup-half | `cup-center`, `arm-mount` | `(0, 17.5, 0)`, `(48, 17.5, 0)` |
| hinge-35mm-cup-inset | `cup-center`, `arm-mount` | `(0, 17.5, 0)`, `(48, 17.5, 0)` |
| hinge-26mm-cup-full | `cup-center`, `arm-mount` | `(0, 13, 0)`, `(40, 13, 0)` |
| shelf-pin-5mm-steel | `tip` | `(0, 0, 14)` |
| shelf-pin-5mm-clear | `tip` | `(0, 0, 14)` |
| shelf-pin-7mm-sleeve | `tip` | `(0, 0, 18)` |

Normals are omitted in v1 (all `undefined`). The snap-to-face follow-up will populate them.

### 2.4 Persistence of HardwareRegistry on documents

```ts
// packages/shared/src/types.ts (additions)
interface PartDocument {
  // ... existing fields ...
  hardware: HardwareEntry[];   // always [] on part docs; SKU resolution reads from enclosing assembly
}

interface AssemblyDocument {
  // ... existing fields ...
  hardware: HardwareEntry[];   // populated from built-in catalog on v11→v12 migration
}
```

`hardware` is an optional field in the serialized JSON for backwards compatibility; deserialization defaults it to `[]` when absent.

---

## 3. Built-in catalog

### 3.1 Hinge SKUs (4 entries)

All cup hinges. Bounding box approximates the closed hinge body including the mounting arm at zero-degree opening.

| id | name | bbox L×W×H (mm) | vendor | notes |
|---|---|---|---|---|
| `hinge-35mm-cup-full` | 35mm Cup Hinge — Full Overlay | 48 × 35 × 12 | Blum | Full overlay; requires 35mm Forstner bit |
| `hinge-35mm-cup-half` | 35mm Cup Hinge — Half Overlay | 48 × 35 × 12 | Blum | Half overlay; requires 35mm Forstner bit |
| `hinge-35mm-cup-inset` | 35mm Cup Hinge — Inset | 48 × 35 × 12 | Blum | Inset door; requires 35mm Forstner bit |
| `hinge-26mm-cup-full` | 26mm Cup Hinge — Full Overlay | 40 × 26 × 10 | Generic | Full overlay; requires 26mm Forstner bit |

### 3.2 Shelf pin SKUs (3 entries)

| id | name | bbox L×W×H (mm) | vendor | notes |
|---|---|---|---|---|
| `shelf-pin-5mm-steel` | 5mm Shelf Pin — Steel | 5 × 5 × 28 | Generic | Press-fit into 5mm shelf-pin hole; steel |
| `shelf-pin-5mm-clear` | 5mm Shelf Pin — Clear | 5 × 5 × 28 | Generic | Press-fit into 5mm shelf-pin hole; clear plastic |
| `shelf-pin-7mm-sleeve` | 7mm Shelf Pin — Steel Sleeve | 7 × 7 × 32 | Generic | Sleeve style; requires 7mm hole |

**Total: 7 entries shipped in v1.** Category breakdown: 4 hinges, 3 shelf pins.

### 3.3 OPFS layout

Each built-in SKU materializes as a file under the per-project OPFS root:

```
hardware/hinge-35mm-cup-full.zipt
hardware/hinge-35mm-cup-half.zipt
hardware/hinge-35mm-cup-inset.zipt
hardware/hinge-26mm-cup-full.zipt
hardware/shelf-pin-5mm-steel.zipt
hardware/shelf-pin-5mm-clear.zipt
hardware/shelf-pin-7mm-sleeve.zipt
```

Files are materialized lazily: on first access via `AddHardwareCommand.apply()`, the command checks `opfs.exists('hardware/<sku>.zipt')`; if absent, it synthesizes and writes the file from the built-in catalog data before placing it. Subsequent placements of the same SKU reuse the existing file without re-writing.

The `extrude` inside each `.zipt` is a box from the origin `(0,0,0)` to `(bbox.l, bbox.w, bbox.h)`. The `featureTree` structure is: `[origin.xy, origin.yz, origin.xz, origin.x, origin.y, origin.z, origin.point, hardwareFeature]` — indices `[0..6]` are the standard 7 origin features produced by `kernel.newPart()` (Reference D); the `HardwareFeature` sits at index 7, mirroring `PanelFeature` placement in 5a parts.

---

## 4. UI / UX

### 4.1 Ribbon

`FurnitureTab.tsx` gains a fourth `RibbonPanel` titled **Hardware** after **Cabinets**. Single button: **Add Hardware** (`aria-label="Add Hardware"`), enabled when an assembly is active (same condition as the Cut List and Cabinets buttons). Clicking dispatches `OpenHardwareDialogCommand()`.

### 4.2 `HardwareDialog`

Modal, dimensions ~440 × 480 px, centered. Reuses the dialog chrome from `CabinetDialog` / `PanelDialog`. Sections (top to bottom):

1. **Category** — dropdown with options "Hinges" and "Shelf Pins" (values `'hinges'` and `'shelfPins'`). Default: "Hinges". Changing the dropdown immediately updates the variant grid without closing.
2. **Variant grid** — a flat list (or 2-column grid) of entries from the built-in catalog filtered by selected category. Each entry shows: name, bounding-box dims, and notes. Exactly one entry is selected at a time; default is the first entry in the filtered list. Keyboard: arrow keys navigate; Enter confirms selection.
3. **Qty** — integer stepper, default 1, range 1–100. Each unit results in one separate `AddHardwareCommand` call (so each placed instance is individually undoable and appears as a separate `ComponentInstance` in the assembly; grouping is done by the aggregator at display time).
4. **Buttons** — Cancel (Esc) / OK (Enter, default focus). OK is always enabled if a variant is selected (no dimension validation — bounding box is fixed by catalog).

### 4.3 Open / submit flow

On OK click:

1. Dialog calls `new AddHardwareCommand({ skuId, opfs, store }).apply()` once per qty unit (qty sequential calls; each is pushed onto the command bus independently for individual undo).
2. Each command writes (or reuses) `hardware/<sku>.zipt` and places it via `PlaceComponentCommand`.
3. Autosave debounce fires within 500 ms.
4. The last placed component is the new selection in the BrowserPane.
5. The Hardware table in the Cut List tab updates immediately on next open.

### 4.4 Cancel / failure flow

- Cancel: dialog closes, no command runs.
- Mid-flight failure (OPFS write fails): `apply` throws; the catch block calls `revert` to remove the placed component (if placed) and delete the `.zipt` file (if newly written); toast shows "Hardware placement failed: {reason}". Project state unchanged.

---

## 5. Architecture

### 5.1 Layer map

```
shared/src/hardware/
  builtinCatalog.ts          ← 7 HardwareEntry definitions + bbox + attachPoints
  index.ts                   ← re-exports

shared/src/
  hardware-feature.ts        ← HardwareEntry, HardwareCategory, HardwareFeature,
                                AttachPoint, isHardwareFeature

app/src/commands/
  AddHardwareCommand.ts      ← lazy write + PlaceComponentCommand delegate
  OpenHardwareDialogCommand.ts

app/src/dialogs/
  HardwareDialog.tsx         ← category dropdown + variant grid + qty stepper

app/src/shell/tabs/
  FurnitureTab.tsx           ← +Hardware RibbonPanel

app/src/assembly/walkers/
  aggregateHardwareRecursive.ts  ← parallel to aggregateCutListRecursive

app/src/shell/
  resolveHardwareSpec.ts     ← parallel to resolvePanelSpec

app/src/commands/
  buildCutListCsv.ts         ← +Hardware section (3rd block)

app/src/shell/
  BrowserPane.tsx            ← +HardwareTable block in Cut List tab

shared/src/
  fileFormat.ts              ← CURRENT_FORMAT_VERSION 11→12, migration v11→v12
  types.ts                   ← +hardware field on PartDocument and AssemblyDocument
```

No kernel changes. No changes to `aggregateCutListRecursive` itself (a parallel walker is added instead).

### 5.2 `AddHardwareCommand`

```ts
class AddHardwareCommand implements Command {
  readonly name = 'AddHardware';
  constructor(private opts: {
    skuId: string;
    opfs: OpfsLike;
    store: AppStore;
  }) {}

  private didWriteFile = false;
  private placeCommand: PlaceComponentCommand | null = null;

  async apply(): Promise<void> {
    // 1. Look up HardwareEntry from builtinCatalog by skuId. Throw if not found.
    // 2. const path = `hardware/${skuId}.zipt`;
    // 3. if (!await opfs.exists(path)) { synthesize PartDocument with HardwareFeature + extrude, pack, opfs.write(path, bytes); didWriteFile = true; }
    // 4. this.placeCommand = new PlaceComponentCommand({ partPath: path, opfs });
    //    await this.placeCommand.apply();
  }

  async revert(): Promise<void> {
    // 1. await this.placeCommand?.revert();
    // 2. if (didWriteFile && no other ComponentInstance in active assembly references the path) { await opfs.delete(path); }
  }
}
```

**File-reuse rule:** the `.zipt` at `hardware/<sku>.zipt` is shared across all instances of the same SKU **across the entire project** (any `.ziasm` in OPFS may reference it). `revert()` only deletes the file if `didWriteFile === true` AND a project-wide scan finds zero surviving `ComponentInstance`s pointing at the path. The scan walks every `.ziasm` under the OPFS root, not just the active assembly. Same atomicity model as `CreateCabinetCommand`, with a wider reference-count denominator.

### 5.3 `aggregateHardwareRecursive`

A pure function in `packages/app/src/assembly/walkers/aggregateHardwareRecursive.ts`. Signature mirrors the cut-list walker:

```ts
function aggregateHardwareRecursive(
  activeDoc: AssemblyDocument,
  cache: DocumentCache,
  hardwareRegistry: HardwareRegistry,
): HardwareAggregateResult
```

Where `HardwareAggregateResult = { rows: HardwareRow[] }` and:

```ts
interface HardwareRow {
  skuId: string;
  name: string;
  category: HardwareCategory;
  qty: number;
  notes: string;
}
```

Inner `walk(doc)` recurses into sub-assemblies, finds all `ComponentInstance`s whose resolved `.zipt` has a `HardwareFeature` at feature index 7, groups by `hardwareSkuId`, and accumulates `qty`. Final result is sorted by `category` then `name`.

### 5.4 `resolveHardwareSpec`

```ts
// packages/app/src/shell/resolveHardwareSpec.ts
function resolveHardwareSpec(
  part: PartDocument,
  registry: HardwareRegistry,
): { entry: HardwareEntry; feature: HardwareFeature } | null
```

Finds the first `HardwareFeature` in `part.featureTree` (via `find(isHardwareFeature)`), then looks up the `HardwareEntry` by `hardwareSkuId` in the registry. Returns `null` if no `HardwareFeature` is present or SKU is not found in registry.

### 5.5 CSV extension

`buildCutListCsv.ts` gains a third block inserted between the edge-band totals section and the excluded-summary section:

```
# Hardware
SKU,Name,Category,Qty,Notes
hinge-35mm-cup-full,"35mm Cup Hinge — Full Overlay",Hinges,2,Requires 35mm Forstner bit
shelf-pin-5mm-steel,"5mm Shelf Pin — Steel",Shelf Pins,8,Press-fit into 5mm shelf-pin hole; steel
```

The section header `# Hardware` follows the same `# <SectionName>` convention used by the existing two sections.

### 5.6 Cut List tab UI extension

`BrowserPane.tsx`'s Cut List tab gains a third table block rendered below the edge-band totals table. The component is `HardwareTable`, accepting `rows: HardwareRow[]`. Columns: SKU / Name / Category / Qty / Notes. An empty `rows` array renders a single "No hardware" placeholder row, consistent with how the panel cut-list table renders when empty.

### 5.7 Reuse of existing infrastructure

- **`MaterialRegistry` shape** — `HardwareRegistry` is the same shape (array embedded on documents). No new persistence mechanism.
- **`PanelFeature` discriminant pattern** — `HardwareFeature` follows the identical `kind` field convention.
- **`PlaceComponentCommand`** — reused verbatim for hardware placement (Reference E).
- **`isHardwareFeature` guard** — structurally identical to `isPanelFeature` guard.
- **`kernel.newPart()`** — used to produce the origin feature block; `HardwareFeature` appended at index 7 (Reference D).
- **Autosave** — no changes; active-assembly mutation triggers it as with cabinet placement.
- **`CabinetDialog` / `OpenCabinetDialogCommand` pattern** — `HardwareDialog` and `OpenHardwareDialogCommand` follow the identical zero-prop, store-driven singleton portal pattern (Reference B).

---

## 6. Migration v11 → v12

### 6.1 Version bump

`packages/shared/src/fileFormat.ts` line 3: `CURRENT_FORMAT_VERSION = 11` → `12`.

### 6.2 Migration function

Added as a new case in the existing migration switch in `fileFormat.ts`:

```ts
case 11: {
  // Add hardware: [] to PartDocument and AssemblyDocument.
  // Seed AssemblyDocument with built-in catalog entries (skip if id already present).
  doc = addHardwareField(doc);   // sets hardware: [] on all documents
  if (doc.type === 'assembly') {
    doc = seedBuiltinHardware(doc, BUILTIN_CATALOG);
  }
  doc.formatVersion = 12;
  break;
}
```

`addHardwareField` is a 3-line pure function that spreads `hardware: []` onto the document. `seedBuiltinHardware` concatenates entries from `BUILTIN_CATALOG` whose `id` is not already present in `doc.hardware` — making the seed idempotent.

### 6.3 Backwards compatibility

Documents with `formatVersion < 11` go through all prior migrations first (existing behavior). A v12 document opened by a v11 reader is rejected with the existing "format version too new" error — same behavior as all prior bumps.

---

## 7. Error handling and edge cases

### 7.1 Runtime errors during command execution

| Condition | Behavior |
|---|---|
| `skuId` not found in `builtinCatalog` | `apply` throws `HardwareSkuNotFound`; dialog shows "Unknown hardware SKU". |
| OPFS write fails during file synthesis | Catch in `apply`, nothing placed, re-throw with toast. |
| `PlaceComponentCommand` rejects | If file was freshly written, delete it; re-throw with toast. |

### 7.2 Edge cases

- **Same SKU placed N times** — N `ComponentInstance`s in the assembly, all referencing the same `hardware/<sku>.zipt`. Aggregator accumulates `qty = N`. Only one `.zipt` file exists.
- **Undo after N placements of same SKU** — each undo call is a separate `AddHardwareCommand.revert()`. The file is deleted only on the last revert (when the **project-wide** reference count drops to zero — see §5.2 file-reuse rule).
- **Same SKU referenced by another project assembly** — if a sibling `.ziasm` (not the active one) holds a `ComponentInstance` pointing at `hardware/<sku>.zipt`, undo of the active-assembly placement leaves the file in place. The file is shared at the project level.
- **Migrated project with pre-existing hardware field** — `seedBuiltinHardware` skips entries whose `id` already exists; duplicate-free.
- **Active assembly is empty** — Add Hardware still works; the placed component is the first item.
- **No active assembly** — Add Hardware button is disabled (same guard as Base Cabinet button).
- **qty = 1 (default)** — single `AddHardwareCommand` call; single undo step.
- **qty = 3** — three sequential `AddHardwareCommand` calls; three separate undo steps (Ctrl+Z × 3 to fully undo).

---

## 8. Testing strategy

### 8.1 Unit tests (`shared`)

In `packages/shared/src/hardware/builtinCatalog.test.ts`:

1. All 7 catalog entries have unique `id` values.
2. All 7 entries have non-empty `name`, `category`, `vendor` (may be empty string for generic), and `notes`.
3. Hinge entries all have `category === 'hinges'`; shelf pin entries all have `category === 'shelfPins'`.
4. Bounding-box dims are all positive numbers.
5. Each attach-point `position` is a valid `Vec3` (all components finite numbers).

In `packages/shared/src/hardware-feature.test.ts`:

6. `isHardwareFeature` returns `true` for a valid `HardwareFeature` object and `false` for a `PanelFeature` or plain object.
7. `resolveHardwareSpec` returns `null` when the part has no `HardwareFeature`; returns `{ entry, feature }` when the part has a `HardwareFeature` with a matching `hardwareSkuId` in the registry.

### 8.2 Aggregator unit tests (`app`)

In `packages/app/src/assembly/walkers/aggregateHardwareRecursive.test.ts`:

1. Assembly with 0 hardware components → `rows: []`.
2. Assembly with 2 instances of the same SKU → 1 row, `qty = 2`.
3. Assembly with 1 hinge + 1 shelf pin → 2 rows, sorted by category then name.
4. Nested assembly (assembly within assembly) — hardware in the sub-assembly is counted in the parent walk.
5. A component that is a panel (has `PanelFeature`) is not included in hardware rows.

### 8.3 Migration unit tests (`shared`)

In `packages/shared/src/fileFormat.test.ts` (new cases alongside existing):

1. v11 `PartDocument` → v12: gains `hardware: []`.
2. v11 `AssemblyDocument` → v12: gains `hardware` with 7 built-in entries.
3. v12 `AssemblyDocument` that already has some hardware entries → migration does not duplicate them.

### 8.4 E2E tests (Playwright)

In `apps/e2e/tests/hardware-add.spec.ts`:

1. **T1 — happy path:** open empty assembly, click Furniture → Hardware → Add Hardware, select "35mm Cup Hinge — Full Overlay" (default), click OK; assert `hardware/hinge-35mm-cup-full.zipt` exists in OPFS, BrowserPane shows 1 component, Cut List tab Hardware table shows 1 row with Qty = 1.
2. **T2 — grouping:** add the same hinge SKU a second time via Add Hardware; assert Hardware table shows 1 row with Qty = 2 (not 2 separate rows).
3. **T3 — undo round-trip:** Ctrl+Z after T1; assert the placed component is removed from the BrowserPane, `hardware/hinge-35mm-cup-full.zipt` is deleted from OPFS, Hardware table shows 0 rows.

### 8.5 Perf test (Playwright perf project)

In `apps/e2e/perf/hardware-add.spec.ts`:

1. `AddHardwareCommand.apply()` end-to-end (synthesize `.zipt` + place + autosave) under p95 = 600 ms on the synthetic perf machine. Sample 20 runs. Subsequent placements of the same SKU (file already exists) are expected to be faster; the budget covers the first-placement path.

### 8.6 Manual smoke checklist

`docs/superpowers/manual-tests/subproject-5c.md` — created as part of 5c implementation. Mirrors the shape of `subproject-5b.md`.

### 8.7 Targets

| Suite | Cases added |
|---|---|
| shared unit (catalog + feature) | 7 |
| shared unit (migration) | 3 |
| app unit (aggregator) | 5 |
| e2e (chromium) | 3 |
| perf | 1 |

All existing unit + integration + e2e/perf suites must continue to pass with no modifications.

---

## 9. Build sequencing

Phased — each phase ends green (typecheck + relevant suite passes) and is committed atomically.

1. **Domain types** — `hardware-feature.ts`, `types.ts` additions, `builtinCatalog.ts`, unit tests.
2. **Migration** — `fileFormat.ts` v11→v12 bump + migration function + migration unit tests.
3. **Aggregator + resolver** — `aggregateHardwareRecursive.ts`, `resolveHardwareSpec.ts`, aggregator unit tests.
4. **Command layer** — `AddHardwareCommand.ts`, `OpenHardwareDialogCommand.ts`, command unit tests.
5. **UI** — `HardwareDialog.tsx`, `FurnitureTab.tsx` Hardware `RibbonPanel`, `HardwareTable` in `BrowserPane.tsx`, CSV extension in `buildCutListCsv.ts`.
6. **E2E + perf** — happy path, grouping, undo, perf budget.
7. **Manual smoke checklist** — `docs/superpowers/manual-tests/subproject-5c.md`.

---

## 10. Out-of-scope follow-ups (anticipate F-numbers in execution-state memo)

- **F1** — Drawer Slides SKUs (deferred until Drawer Cabinet template exists in 5b follow-ups).
- **F2** — Screw and fastener SKUs.
- **F3** — "Manage Hardware" dialog: add / edit / delete custom SKUs per project.
- **F4** — Attach-point snap: consume `AttachPoint` metadata in a new constraint or snap command.
- **F5** — Attach-point normals: populate `normal` vectors in the built-in catalog for snap directions.
- **F6** — Detailed hardware geometry: replace bounding-box proxy with real authored `.zipt` geometry.
- **F7** — BrowserPane library pane: browse hardware catalog without opening the Add Hardware dialog.
- **F8** — Cabinet auto-coupling: `buildBaseCabinet` emits hinge / shelf-pin placement hints that the user can accept or dismiss.
- **F9** — Hardware category filter: add more categories (`'drawerSlides'`, `'screws'`, etc.) once SKUs exist.
- **F10** — Per-project custom built-in overrides: allow a project to shadow a built-in SKU with different bbox or notes.

---

## 11. Open questions

None. All design axes were locked during brainstorming:

- Hardware-part shape: hybrid registry + typed feature (§2.1).
- Geometry: bounding box + label (§3.3).
- Attach points: metadata-only, no solver involvement (§2.3).
- Pick UI: ribbon dialog, 5b-style (§4.2).
- Catalog seed: built-in 7 entries, not user-editable in v1 (§3).
- BOM integration: new 4th CSV section, 3rd UI table block (§5.5, §5.6).
- Categories in v1: hinges + shelf pins only (§3).
- OPFS layout: `hardware/<sku>.zipt` (§3.3).
- Manifest version: v12, migration seeds registry (§6).
- Test scope: unit + integration + 3 e2e + 1 perf + manual smoke (§8).
- No 5b coupling: `buildBaseCabinet` does not auto-emit hardware (§1.2).
