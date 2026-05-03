# ZilInventor — Sub-project 5b: Cabinet Configurator (Base Cabinet v1)

- **Date:** 2026-05-03
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 5b of 5a–5e (Furniture plug-in layer). First parametric cabinet template. Turns 5d's empty cut-list into something with real cabinets in it.
- **Build order:** 5a ✅ → 5d ✅ → **5b** → 5c → 5e (locked during 5a brainstorming, 2026-05-01).
- **Prior art:** Reuses 5a's `PanelFeature` + per-document material registry; 5d's recursive cut-list aggregator (no changes); the 4d nested-`.ziasm` topology; the existing `PlaceComponentCommand` insertion path; the standard modal-dialog UX (PanelDialog, PlaceComponentDialog).

---

## 1. Scope and non-goals

### 1.1 What 5b delivers

A new **Cabinets** ribbon panel in the Furniture tab with a single **Base Cabinet** button. Clicking the button (when an assembly is active) opens a modal `CabinetDialog` with parameter form. On OK:

1. A new TypeScript template module `buildBaseCabinet(params)` produces an in-memory list of `PanelFeature` definitions plus their `ComponentInstance` placement layout for a 6-panel base kitchen cabinet (left side, right side, bottom, top, back, toekick face) plus 0..N adjustable shelves.
2. A new atomic `CreateCabinetCommand` writes one `.zipt` per panel (each `.zipt` is a 5a-shape part with a single `PanelFeature`) and one `.ziasm` containing the placement layout, then drops the cabinet `.ziasm` into the active assembly via `PlaceComponentCommand`.
3. The placed cabinet appears in the BrowserPane as a regular nested component; the 5d cut-list aggregator picks up its panels with no changes; the 4c BOM aggregator picks them up too.
4. Parameter form supports: width / depth / height / toekick height / toekick setback / shelf count / carcass material / back material. Inline validation rejects degenerate cabinets.
5. Undo (`Ctrl+Z`) cleanly tears down the placed component and removes all written files.

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 5b-edit (future) | Re-edit flow: persist the recipe in the `.ziasm` and let the user tweak parameters after placement. v1 is one-shot generate; to change, delete and reinsert. |
| 5b-follow-ups | Per-panel material override; per-edge band override; top-style (full top vs stretchers); back-mount style (rabbet vs overlay); door panels; drawer fronts. |
| 5b-follow-ups | Additional cabinet types: wall, tall, corner, sink-base, drawer-base. |
| 5c | Hardware (hinges, slides, shelf pins, screws) — cabinets in 5b emit panels only. |
| 5e | Nesting / sheet-stock packing — cabinets feed the same cut list 5e will consume. |
| post-5e | User-editable cabinet templates (JSON DSL or `.zicab` library files). |
| post-5e | Wall-snap / floor-snap placement aids. |
| post-5e | "Cabinet" badge / icon on the BrowserPane node. |
| post-5e | Live preview in the dialog (3D thumbnail of the configured cabinet). |

### 1.3 Migration / file-format impact

**None.** Manifest version stays at `v11`. The cabinet emits pure 5a-shape `.zipt` files and pure 5d-shape `.ziasm` files; no new persisted fields. A cabinet placed in v11 is indistinguishable from a hand-assembled 6-panel sub-assembly — by design (the recipe is not persisted in v1).

### 1.4 Success criteria

5b is done when **all** are demonstrably true:

1. From an active assembly, **Furniture → Cabinets → Base Cabinet** opens `CabinetDialog` with sensible defaults (W=600, D=560, H=720, toekick H=100, toekick setback=50, shelf count=1, carcass material from registry, back material from registry).
2. Clicking **OK** with defaults writes 7 `.zipt` files (Left Side / Right Side / Bottom / Top / Back / Toekick / Shelf 1) and 1 `.ziasm` to OPFS, all with the cabinet name as a prefix (default cabinet name `Base Cabinet 1`, with a numeric suffix bumped to avoid collisions with existing cabinets in the same project), and adds the `.ziasm` as a placed component in the active assembly at origin `(0, 0, 0)` with rotation zero.
3. The cabinet origin is at the **back-left-bottom-floor** corner: width along +X, depth along +Y (front face at maximum +Y), height along +Z. With defaults, the front face of the cabinet sits at Y=560.
4. Side panels span floor-to-top (Z = 0 to H); bottom panel sits at Z = `toekickHeight` (its bottom face); top panel sits at Z = `H − T_carcass` (its bottom face); back panel sits flush against the back wall (Y = 0, occupying Y ∈ [0, `T_back`]) and runs floor-to-top, with the bottom/top/shelves resting forward of it at Y ≥ `T_back`; toekick face panel positioned with its front face at Y = `D − toekickSetback` (occupying Y ∈ [`D − toekickSetback − T_carcass`, `D − toekickSetback`]) and running Z = 0 to `toekickHeight`; shelves evenly distributed between Z = `toekickHeight + T_carcass` and Z = `H − T_carcass`.
5. After placement, opening the **Cut List** tab shows 7 distinct rows (one per panel role) with correct L/W/T/material/grain values; the 4c BOM tab shows 7 leaf-component rows (recursing through the cabinet `.ziasm` per 4d).
6. Edge bands are pre-set per template: front edge of left side, right side, bottom, top, and each shelf is banded with the user's chosen band material (or "none"); back panel and toekick get no bands by default.
7. Validation rejects, independently: any dimension ≤ `2 × T_carcass`, `toekickHeight ≥ H/2`, `shelfCount > floor((H − toekickHeight − 2 × T_carcass) / 100mm)`, empty cabinet name, no carcass material picked, no back material picked. If the active assembly's material registry is empty, the dialog inlines the 5a registry-add flow so the user can add materials without leaving the dialog.
8. `Ctrl+Z` after a successful OK removes the placed component **and** deletes all 8 written files from OPFS, returning the project to its pre-OK state.
9. `pnpm -r typecheck`, all unit/integration suites, the new e2e specs, and the new perf spec pass.

---

## 2. Data model

### 2.1 Template parameters (in-memory only, not persisted)

```ts
// packages/shared/src/cabinets/types.ts
interface BaseCabinetParams {
  name: string;                    // user-supplied, default 'Base Cabinet 1' (auto-suffixed for collisions)
  width: number;                   // mm, X-axis. Default 600.
  depth: number;                   // mm, Y-axis. Default 560.
  height: number;                  // mm, Z-axis. Default 720.
  toekickHeight: number;           // mm. Default 100. Set to 0 to disable toekick (still emits no toekick panel; bottom sits at Z=0).
  toekickSetback: number;          // mm. Default 50.
  shelfCount: number;              // integer 0..N. Default 1.
  carcassMaterialId: MaterialId;   // used by sides/top/bottom/shelves/toekick.
  backMaterialId: MaterialId;      // used by back panel only. Different thickness OK; toekick uses carcass.
  bandMaterialId: MaterialId | null; // null => no bands. Applied to template-encoded edges only.
}

interface CabinetBuildOutput {
  panels: ReadonlyArray<CabinetPanelDef>;
  layout: ReadonlyArray<CabinetComponentDef>;
}

interface CabinetPanelDef {
  role: PanelRole;                 // 'leftSide' | 'rightSide' | 'bottom' | 'top' | 'back' | 'toekick' | 'shelf'
  shelfIndex?: number;             // 1-based, only for role='shelf'
  fileNameSuffix: string;          // e.g. 'Left Side' | 'Shelf 1'
  panel: PanelFeature;             // ready to drop into a fresh PartDocument
}

interface CabinetComponentDef {
  fileNameSuffix: string;          // matches CabinetPanelDef.fileNameSuffix
  position: { x: number; y: number; z: number };  // mm in cabinet frame
  rotation: { rx: number; ry: number; rz: number }; // radians
}
```

**No new persisted types.** `CabinetBuildOutput` is consumed once by `CreateCabinetCommand`, then discarded. Each `panel` becomes a fresh `PartDocument` whose `featureTree[0]` is the panel; each layout entry becomes a `ComponentInstance` in the cabinet `.ziasm`.

### 2.2 Panel role → orientation table

Cabinet origin: back-left-bottom-floor corner. Width along +X, depth along +Y (front at max Y), height along +Z. All panels lay flat as boards (length and width define the face, thickness the small dimension).

| Role | Length axis | Width axis | Thickness axis | Length | Width | Thickness | Position (corner at min XYZ) | Rotation |
|---|---|---|---|---|---|---|---|---|
| leftSide | Z | Y | X | H | D | T_c | (0, 0, 0) | identity |
| rightSide | Z | Y | X | H | D | T_c | (W − T_c, 0, 0) | identity |
| bottom | X | Y | Z | W − 2·T_c | D − T_back | T_c | (T_c, T_back, toekickH) | identity |
| top | X | Y | Z | W − 2·T_c | D − T_back | T_c | (T_c, T_back, H − T_c) | identity |
| back | X | Z | Y | W | H | T_back | (0, 0, 0) | identity |
| toekick | X | Z | Y | W − 2·T_c | toekickH | T_c | (T_c, D − toekickSetback − T_c, 0) | identity |
| shelf i | X | Y | Z | W − 2·T_c | D − T_back − 20 | T_c | (T_c, T_back, z_i) | identity |

Where:
- `T_c` = carcass thickness (resolved from `carcassMaterialId` default thickness, typically 18 mm).
- `T_back` = back-panel thickness (resolved from `backMaterialId`, typically 6 mm).
- `D − 20` for shelves: shelves intentionally sit 20 mm shallower than the bottom for finger clearance / wire routing. (Hard-coded constant in v1; configurable later.)
- `z_i` = `toekickH + T_c + i × ((H − toekickH − 2·T_c) / (shelfCount + 1))` for `i ∈ [1, shelfCount]`.

**Grain encoding (per role):**

| Role | Grain |
|---|---|
| leftSide, rightSide | `length` (vertical wood grain on tall sides) |
| bottom, top | `length` (along width direction = X) |
| back | `length` (along height = Z) |
| toekick | `length` (along width = X) |
| shelf | `length` (along width = X) |

If carcass material has `grain === 'none'` (e.g. MDF, particle board) the template's grain hint is ignored by the cut-list aggregator (it normalizes L,W to max,min) but we still set `grain: 'length'` consistently — the aggregator handles `none` materials as a separate case.

**Edge band encoding (per role) — applied only when `bandMaterialId` is non-null:**

| Role | Front | Back | Left | Right |
|---|---|---|---|---|
| leftSide | banded | — | — | — |
| rightSide | banded | — | — | — |
| bottom | banded | — | — | — |
| top | banded | — | — | — |
| back | — | — | — | — |
| toekick | — | — | — | — |
| shelf | banded | — | — | — |

"Front" here is the panel-local `front` edge as seen by the user when the cabinet door is open — corresponds to the panel face whose outward normal (in the cabinet frame) points to +Y. The template builder maps cabinet-frame edges to panel-local Front/Back/Left/Right based on the orientation table above.

### 2.3 File naming

Cabinet auto-name: starts with "Base Cabinet 1"; if `Base Cabinet 1.ziasm` already exists in the active project's OPFS root, increment to "Base Cabinet 2", etc., until a free slot is found. User can override in the dialog before clicking OK.

Generated files (assuming user accepts the default name "Base Cabinet 1" and shelfCount=1):

```
Base Cabinet 1.ziasm
Base Cabinet 1 - Left Side.zipt
Base Cabinet 1 - Right Side.zipt
Base Cabinet 1 - Bottom.zipt
Base Cabinet 1 - Top.zipt
Base Cabinet 1 - Back.zipt
Base Cabinet 1 - Toekick.zipt
Base Cabinet 1 - Shelf 1.zipt
```

If shelfCount=0, no shelf file is written. If toekickHeight=0, no toekick file is written and the bottom panel sits at Z=0.

---

## 3. UI / UX

### 3.1 Ribbon

`FurnitureTab.tsx` gains a third `RibbonPanel` titled **Cabinets** between **Create** and **Cut List**. Single button: **Base Cabinet** (`aria-label="Base Cabinet"`), enabled when an assembly is active (same enabled-condition as the Cut List buttons). Clicking dispatches `OpenCabinetDialogCommand({ template: 'baseCabinet' })`.

### 3.2 `CabinetDialog`

Modal, dimensions ~480 × 600 px, centered. Reuses the dialog chrome from `PanelDialog`. Sections (top to bottom):

1. **Name** — single text input. Default `Base Cabinet 1` (auto-suffixed). Validation: non-empty after trim.
2. **Dimensions** — three labeled number inputs (Width / Depth / Height) in mm. Defaults 600/560/720. Validation per axis: `> 2 × T_c`.
3. **Toekick** — two number inputs (Height / Setback) in mm. Defaults 100/50. Validation: `0 ≤ height < H/2`, `0 ≤ setback < D − T_c`.
4. **Shelves** — single integer stepper. Default 1. Validation: `0 ≤ shelfCount ≤ floor((H − toekickHeight − 2·T_c) / 100)`.
5. **Materials** — two material pickers (Carcass / Back). Each is a dropdown of the active assembly's material registry filtered by thickness > 0. If registry is empty, dialog shows an inline "Add material" link that reuses the 5a registry-add flow inline.
6. **Edge bands** — single material picker: "None" plus every entry in the registry (no filter — 5a has no `category` field yet). Shows a small preview line: "Front edges of sides, top, bottom, and shelves will be banded." A future 5a follow-up adds a `category: 'band'` filter (tracked as F1 here).
7. **Buttons** — Cancel (Esc) / OK (Enter, default focus). OK disabled while validation errors exist.

All form errors render inline below their input in red; the OK button shows a count badge ("3 errors") if any fail.

### 3.3 Open / submit flow

On OK click:
1. Dialog calls `new CreateCabinetCommand({ template: 'baseCabinet', params, opfs, store }).apply()` and closes itself.
2. Command resolves promise → autosave debounce fires within 500 ms → all 8 files persisted.
3. The cabinet is the new selection in the BrowserPane.
4. The user can immediately open the Cut List tab to verify.

### 3.4 Cancel / failure flow

- Cancel: dialog closes, no command runs.
- Mid-flight failure (e.g. OPFS write fails): command's `apply` throws; any partially-written files are rolled back by the same `revert` logic; toast shows "Cabinet creation failed: {reason}". Project state unchanged.

---

## 4. Architecture

### 4.1 Layer map

```
shared/src/cabinets/
  types.ts                   ← BaseCabinetParams, CabinetBuildOutput, PanelRole
  baseCabinet.ts             ← buildBaseCabinet(params): CabinetBuildOutput
  index.ts                   ← re-exports

app/src/commands/
  CreateCabinetCommand.ts    ← atomic write+place
  OpenCabinetDialogCommand.ts

app/src/dialogs/
  CabinetDialog.tsx          ← form + validation

app/src/shell/tabs/
  FurnitureTab.tsx           ← +Cabinets RibbonPanel

(no kernel changes)
(no shared type changes outside shared/src/cabinets/)
(no manifest version bump)
```

### 4.2 `buildBaseCabinet` (pure function in shared)

- Input: `BaseCabinetParams` + the active assembly's material registry (passed in to resolve thicknesses).
- Output: `CabinetBuildOutput` with deterministic ordering (left, right, bottom, top, back, toekick, shelf 1..N).
- Throws typed `CabinetTemplateError` for any validation failure (so the dialog can map error.kind → field-level messages).
- No I/O, no store access — easy to unit-test.

### 4.3 `CreateCabinetCommand`

```ts
class CreateCabinetCommand implements Command {
  readonly name = 'CreateCabinet';
  constructor(private opts: {
    template: 'baseCabinet';
    params: BaseCabinetParams;
    opfs: OpfsLike;
    store: AppStore;
  }) {}

  // produced by apply() so revert() can undo precisely
  private writtenFiles: string[] = [];
  private placedComponentId: string | null = null;
  private placeCommand: PlaceComponentCommand | null = null;
  private resolvedAssemblyName: string | null = null;

  async apply(): Promise<void> {
    // 1. Resolve cabinet name (auto-suffix if collision)
    // 2. buildBaseCabinet(params, registry) → { panels, layout }
    // 3. For each panel: serialize a fresh PartDocument with featureTree=[panel], materials = active assembly's registry,
    //    pack via CURRENT_FORMAT_VERSION, opfs.write to '<cabinetName> - <suffix>.zipt'.
    //    Track each path in writtenFiles.
    // 4. Build a fresh AssemblyDocument with components[] = layout entries (componentPath = sibling .zipt name),
    //    materials = registry copy. Pack via packAssembly. opfs.write to '<cabinetName>.ziasm'.
    //    Track in writtenFiles.
    // 5. this.placeCommand = new PlaceComponentCommand({ partPath: '<cabinetName>.ziasm', opfs });
    //    await this.placeCommand.apply().  Capture the placed component's id.
    // 6. Done. Autosave will persist the active assembly (which now references the new .ziasm) within 500ms.
  }

  async revert(): Promise<void> {
    // 1. await this.placeCommand?.revert();   // removes from active assembly
    // 2. For each file in this.writtenFiles (reverse order): opfs.delete(path).
  }
}
```

Atomicity: if step 3 fails partway through, the catch block calls the same logic as `revert()` to clean up `writtenFiles` so far. PlaceComponentCommand's existing revert handles the assembly side.

### 4.4 Reuse of existing infrastructure

- **5a's `PanelFeature` shape** — used as-is. Each `.zipt` is a 5a-shape part with `featureTree = [originPlanes..., panel]`.
- **5a's per-document material registry** — copied from the active assembly into each `.zipt` (so `materialId` references resolve standalone). `reconcileMaterials` (already in `PlaceComponentCommand`) handles re-merging on placement.
- **5d's recursive aggregator** — no changes. Cabinets are just nested `.ziasm`s of panel `.zipt`s, which is exactly what 5d walks.
- **4c BOM aggregator** — no changes. Same.
- **4d `componentPath`** — used as-is for the cabinet `.ziasm`'s component refs.
- **PlaceComponentCommand** — used as-is for placing the cabinet `.ziasm` into the active assembly.
- **Autosave** — no changes. The active-assembly mutation triggers it; cabinet files are pre-written before placement, so they're already on disk when autosave runs.

### 4.5 Origin frame and place-at-origin choice

The cabinet `.ziasm` lays out its components in cabinet-local coordinates (back-left-bottom-floor corner = (0, 0, 0)). When placed via `PlaceComponentCommand`, it lands at world (0, 0, 0) with identity rotation — cabinet-local and world frames coincide for the first cabinet. Subsequent cabinets land at the same world origin and overlap — the user manually drags or moves them. (Wall-snap / floor-snap auto-placement is post-5e.)

---

## 5. Error handling and edge cases

### 5.1 Validation errors (caught at dialog level)

| Condition | Message (inline, under field) |
|---|---|
| `width ≤ 2 × T_c` | "Width must exceed 2× carcass thickness ({2·T_c} mm)." |
| `depth ≤ 2 × T_c` | Likewise for depth. |
| `height ≤ 2 × T_c + toekickHeight` | "Height must exceed toekick + 2× carcass thickness." |
| `toekickHeight ≥ H / 2` | "Toekick must be less than half the cabinet height." |
| `toekickSetback ≥ D − T_c` | "Toekick setback must be less than depth − carcass thickness." |
| `shelfCount > maxShelves` | "Maximum {maxShelves} shelves fit in this height." |
| `name.trim() === ''` | "Cabinet name required." |
| `carcassMaterialId` not in registry | "Pick a carcass material." |
| `backMaterialId` not in registry | "Pick a back material." |

### 5.2 Runtime errors (during command execution)

| Condition | Behavior |
|---|---|
| OPFS write fails partway | Catch in `apply`, run rollback (delete files written so far), re-throw with toast. |
| `PlaceComponentCommand` rejects (e.g. cycle detection — cannot happen here since cabinet is fresh, but defensively) | Rollback all written files, re-throw with toast. |
| Material registry mutates between dialog open and OK click | The dialog reads the registry on submit; if the chosen `materialId` is no longer present, surface a "Material no longer available" inline error and abort. |
| Cabinet name collision after auto-suffixing 99 times | Use UUID suffix as last resort. (Defensive — extremely unlikely.) |

### 5.3 Edge cases

- **`shelfCount = 0`** — no shelf files written; no shelf entries in layout.
- **`toekickHeight = 0`** — no toekick file written; bottom panel sits at Z=0; sides still go floor-to-top.
- **`bandMaterialId = null`** — no edges banded; all per-edge `EdgeBand` slots are `null` on every panel.
- **Empty material registry** — dialog inlines the 5a registry-add UI; OK is disabled until carcass + back materials exist.
- **Active assembly is itself nested inside another assembly** — irrelevant; the cabinet places into whichever assembly is *active* (top-level edited document).
- **No active assembly** — Base Cabinet button is disabled (Q1).

---

## 6. Testing strategy

### 6.1 Unit tests (`shared`)

In `packages/shared/src/cabinets/baseCabinet.test.ts`:

1. Default params → 7 panels (left, right, bottom, top, back, toekick, 1 shelf), 7 layout entries, deterministic ordering.
2. `shelfCount = 0` → 6 panels, no shelf entry.
3. `shelfCount = 3` → 9 panels, shelves at evenly-spaced Z values matching the formula in §2.2.
4. `toekickHeight = 0` → 6 panels, no toekick file, bottom panel `position.z = 0`.
5. Side-panel positions: left at X=0, right at X = `W − T_c`. Both span Z = 0..H.
6. Back panel at Y=0, depth direction = back-to-front, length = H, width = W, thickness = T_back.
7. Edge-band encoding when `bandMaterialId = 'pvc-white'`: front edge of sides/top/bottom/shelves carries the band; back/toekick carry nothing; left/right edges carry nothing.
8. Validation: `width = T_c` throws `CabinetTemplateError({ kind: 'widthTooSmall' })`.
9. Validation: `shelfCount = 99` with H=720 throws `shelfCountTooLarge` with `maxShelves` populated.

Target: 9–12 tests on the pure builder.

### 6.2 Command unit tests (`app`)

In `packages/app/src/commands/CreateCabinetCommand.test.ts`:

1. Apply with default params → 8 OPFS entries (1 `.ziasm` + 7 `.zipt`), all prefix-named, active assembly gains 1 component referencing the cabinet `.ziasm`.
2. Apply then revert → OPFS empty (of the 8 entries), active assembly back to pre-apply state.
3. Apply twice with same default name → second cabinet auto-suffixes to "Base Cabinet 2", no collisions.
4. Mid-flight rollback: stub OPFS to fail on the 4th write; assert all 3 prior files are deleted, no component placed, command rejects.
5. Apply with empty material registry → command rejects with `MaterialRegistryEmpty` (dialog gate, but defensive in command too).

### 6.3 E2E tests (Playwright)

In `apps/e2e/tests/cabinet-base.spec.ts`:

1. **T1 — happy path:** open empty assembly, click Furniture → Cabinets → Base Cabinet, accept defaults, click OK; assert 8 files in OPFS, BrowserPane shows nested cabinet, 3D viewport renders 7 panels in a cabinet shape.
2. **T2 — cut list integration:** after T1, open Cut List tab; assert 7 rows with correct L/W/T/material/grain values; assert band totals footer reflects banded edges.
3. **T3 — undo:** Ctrl+Z after T1; assert OPFS is empty, BrowserPane back to empty assembly.

### 6.4 Perf tests (Playwright perf project)

In `apps/e2e/perf/cabinet-create.spec.ts`:

1. Create-cabinet command end-to-end (write 8 files + place + autosave) under p95 = 600 ms on the synthetic perf machine. Sample 20 runs.

### 6.5 Targets

| Suite | Cases added |
|---|---|
| shared unit | 9–12 |
| app unit (commands) | 5 |
| e2e (chromium) | 3 |
| perf | 1 |

All existing 1241 unit + 196 integration + 67 e2e/perf must continue to pass with no modifications.

---

## 7. Risks and open questions

### 7.1 Risks

- **Edge-band material picker is unfiltered in v1** — the registry has no `category` field, so the dialog lists every registry entry under the band picker. A user could pick a 18 mm sheet material as a "band". **Mitigation:** documented; F1 adds a `category: 'band'` filter once 5a's registry gains the field.
- **First-cabinet-at-origin overlap** — placing two cabinets stacks them at world origin. **Mitigation:** documented; user drags in viewport. Wall-snap is post-5e.
- **Recipe not persisted = no future regenerate** — user accepts this in F1; if they later want re-edit, they'll regenerate from scratch. The deferred 5b-edit sub-project would add manifest fields and a regenerate-in-place command.

### 7.2 Open questions (none blocking)

- **Should shelf depth-shrink (the 20mm finger-clearance constant in §2.2) be configurable?** Decision: hard-code 20mm in v1; add a parameter only if real users complain.
- **Should the cabinet have a "label" or "tag" stored as a property on the placed component?** Decision: no — the file name is the label. Re-naming is a normal `.ziasm` rename.

---

## 8. Build sequencing

Phased — each phase ends green (typecheck + relevant suite passes) and is committed atomically. Detailed per-task breakdown lives in the plan doc.

1. **Foundation** — `shared/src/cabinets/{types,baseCabinet,index}.ts` + unit tests.
2. **Command layer** — `CreateCabinetCommand`, `OpenCabinetDialogCommand`, command unit tests.
3. **UI** — `CabinetDialog.tsx` + Furniture-tab Cabinets RibbonPanel.
4. **E2E + perf** — happy path, cut-list integration, undo, perf budget.
5. **Manual smoke checklist** — `docs/superpowers/manual-tests/subproject-5b.md` (mirrors 5d's smoke doc shape).

---

## 9. Out-of-scope follow-ups (anticipate F-numbers in execution-state memo)

- **F1** — Edge-band material category filter (depends on 5a `category` field).
- **F2** — Live 3D preview thumbnail in the dialog.
- **F3** — Wall-snap / floor-snap helper on cabinet placement.
- **F4** — "Cabinet" badge / icon on BrowserPane node.
- **F5** — Configurable shelf depth-shrink (currently hard-coded 20mm).
- **F6** — Per-panel material override in dialog (the C3 option).
- **F7** — Per-edge band override in dialog.
- **F8** — Door panels / drawer fronts as additional roles.
- **F9** — Additional cabinet types (wall, tall, corner) — each is essentially a new `build*Cabinet` module + ribbon button reusing `CreateCabinetCommand`.
- **F10** — Recipe persistence + re-edit (`5b-edit`).
