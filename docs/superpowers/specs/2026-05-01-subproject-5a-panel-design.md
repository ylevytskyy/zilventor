# ZilInventor — Sub-project 5a: Panel primitive + edge banding metadata

- **Date:** 2026-05-01
- **Status:** Draft — pending user review
- **Author:** levytskyy@gmail.com + Claude (brainstorming skill)
- **Spec scope:** Sub-project 5a of 5a–5e (Furniture plug-in layer). Foundation for cabinets / cut list / nesting.
- **Build order:** 5a → 5d → 5b → 5c → 5e (locked during brainstorming).
- **Prior art:** Modelled on the Woodwork-for-Inventor convention (panel-as-first-class part with edge-band per face and an automatic cut list).

---

## 1. Scope and non-goals

### 1.1 What 5a delivers

Sub-project 5a introduces the data model, kernel feature, ribbon entry, dialog, and viewport highlight needed for everything later in 5b–5e. The Woodwork-style decisions ("panel = base feature on a regular part", "per-edge bands on the four top-rim edges", "per-project material registry") are locked here.

- A new **`Panel`** kernel feature type, always at feature-tree index 0, at most one per part. Produces an axis-aligned parameterized box with deterministic face naming (`Top / Bottom / Front / Back / Left / Right`) so later features (Hole, Fillet, future Cabinet templates) can target faces predictably.
- A **per-project material registry** on the active assembly's `manifest.json`: `materials: [{ id, name, defaultThickness, color }]`. Loose part editing reads from a per-part scratchpad registry and reconciles into the assembly registry on placement.
- The **`FurnitureTab.tsx`** stub becomes a real ribbon tab with one "Create" panel containing a `Panel` button. Two creation paths:
  1. Inside an empty new part — inserts a Panel base feature.
  2. Inside an assembly — runs a new-part-then-place flow.
- A **`PanelDialog`** component with fields: Length, Width, Thickness (numeric, defaulted from material), Material (dropdown from registry), Grain (`length / width / none`), and four edge-band slots (`Front / Back / Left / Right` — each `null` or a material reference).
- **Edge-band visual highlight** in the 3D viewport: banded edges drawn in a configurable tint when "Show edge bands" toggle in the View tab is on. No modeled band geometry.
- **No change** to the existing BOM tab. Panel data is exposed via the feature tree only; the dedicated Cut List tab arrives in 5d.

### 1.2 Non-goals — explicitly deferred

| Deferred to | Item |
|---|---|
| 5b | Cabinet configurator (parametric library of cabinet templates) |
| 5b | Furniture-tab ribbon entries beyond `Panel` |
| 5c | Hardware library (hinges, drawer slides, shelf pins, screws) |
| 5d | Cut List tab, BOM aggregation by panel dimensions, CSV export |
| 5e | Sheet-stock nesting, kerf, sheet-by-sheet diagrams |
| post-5e | Modeled edge-band geometry (real-thickness slivers in OCCT, STEP-exported) |
| post-5e | Cross-project material library sharing, viewport grain-direction hatching |

### 1.3 Migration / file-format impact

Manifest version bumps from `v9 → v10` because:

1. Assembly manifests gain a `materials: []` array.
2. Part manifests gain a per-part scratchpad `materials: []` array (used only when the part is edited standalone).
3. `Panel` becomes a recognised feature kind.

Existing `v9` files migrate forward by initialising both `materials` arrays to `[]`.

### 1.4 Success criteria

5a is done when **all** are demonstrably true:

1. From the Furniture tab in an assembly context, the user creates a new panel, fills in `L = 600 mm, W = 400 mm`, picks "Birch Plywood 18mm" material (which fills T = 18 mm), grain = length, bands all four edges with "PVC 1mm white", clicks OK.
2. The new `.zipt` is created, opens with a `Panel` base feature, and is placed into the active assembly.
3. The viewport renders the part as a box; toggling "Show edge bands" highlights all four rim edges in the band tint.
4. Editing the Panel feature changes L/W/T and the box re-renders correctly. Editing the material changes both the material reference and (when `thicknessFromMaterial === true`) the thickness.
5. The assembly's `manifest.json` carries a `materials` array with the registry entry and the panel references it by `id`.
6. `pnpm -r typecheck`, all unit/integration test suites, the new e2e specs, and the new perf spec pass.
7. Saving and reloading the assembly preserves panels, materials, and edge bands round-trip.

---

## 2. Data model

All types live in `packages/shared/src/` so both `app` and `kernel` consume them.

### 2.1 Material registry entry

`packages/shared/src/material.ts` (new):

```ts
export type MaterialId = string; // ULID-style, generated at create

export interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;          // display label, e.g. "Birch Plywood 18mm"
  readonly defaultThickness: number;  // mm, used to default Panel.thickness
  readonly color: string;         // CSS hex, e.g. "#d8c896" (used by viewport + future BOM)
}

export type MaterialRegistry = readonly MaterialEntry[];
```

Stored as `materials: MaterialEntry[]` on `Manifest` (both part- and assembly-kind). Empty array on legacy files.

### 2.2 Panel feature

`packages/shared/src/panel-feature.ts` (new):

```ts
export type PanelEdgeKey = 'front' | 'back' | 'left' | 'right';

export interface EdgeBand {
  readonly materialId: MaterialId; // must resolve in active registry; broken refs handled like 4d
}

export type GrainDirection = 'length' | 'width' | 'none';

export interface PanelFeature {
  readonly kind: 'panel';
  readonly id: string;             // feature id, ULID
  readonly length: ParameterRefOrLiteral;     // mm, drives X axis
  readonly width:  ParameterRefOrLiteral;     // mm, drives Y axis
  readonly thickness: ParameterRefOrLiteral;  // mm, drives Z axis
  readonly thicknessFromMaterial: boolean;    // when true, thickness tracks materialId.defaultThickness; flips false on user override
  readonly materialId: MaterialId;            // required; broken => render & flag
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: EdgeBand | null };
  readonly suppressed?: boolean;   // standard feature attr
}
```

`ParameterRefOrLiteral` is the existing param-or-number union (used by Extrude, Hole, etc.).

#### 2.2.1 Face / edge naming convention

The OCCT box generated by `PanelFeature.evaluate` uses these stable names:

- **Faces:** `Top` (+Z), `Bottom` (-Z), `Front` (+Y), `Back` (-Y), `Right` (+X), `Left` (-X).
- **Banded edges:** each `PanelEdgeKey` maps to a single edge between `Top` and the named side face:
  - `front` → top ∧ +Y face
  - `back`  → top ∧ -Y face
  - `left`  → top ∧ -X face
  - `right` → top ∧ +X face

Only the four rim edges adjacent to the Top face are bandable in 5a (matches the convention "edge band wraps the visible top rim"). Bottom-rim banding is deferred follow-up F5.

#### 2.2.2 Origin convention

Panel sits on the XY plane with the origin at the centroid of the bottom face (Z = 0 is the bottom plane, like a sheet on a table). Matches Inventor's typical extruded-feature convention.

### 2.3 Manifest changes (v9 → v10)

Both `kind: 'part'` and `kind: 'assembly'` manifests gain:

```ts
materials: MaterialEntry[];      // empty on legacy files
```

`migrateManifest-v9-to-v10.ts` adds the array unconditionally and bumps `formatVersion: 10`. No other changes. Format-version test added in `shared/__tests__/fileFormat.spec.ts` and `migrateManifest-v9-to-v10.spec.ts`.

### 2.4 Material reconciliation when placing a standalone-edited panel

When a `.zipt` panel with its own `materials` registry is placed into an assembly:

1. For each material referenced by the panel: look up in the assembly's `materials` by `(name.trim().toLowerCase(), defaultThickness)` tuple.
2. If found, rewrite the panel's `materialId` (and any `EdgeBand.materialId`) to the assembly's `id`. Drop the part-level entry.
3. If not found, copy the entry from the part's registry into the assembly's registry (preserving `id`).
4. Repeat through all references; the panel's references now resolve in the assembly registry.

Implemented in `packages/app/src/assembly/reconcileMaterials.ts` (new), called from `PlaceComponentCommand` immediately before adding the new component.

### 2.5 Validation rules

- Panel feature must be at index 0 of `featureTree.features`. The `PartDocument` validator rejects insertion attempts at any other index.
- A part with a Panel feature cannot have its features re-ordered to push Panel out of index 0 (validator-level guard).
- `EdgeBand.materialId` must resolve in the active registry at solve time; broken refs render the box without highlight on that edge and surface a `BROKEN_MATERIAL_REF` warning in the feature panel (analogous to 4d's broken-componentPath handling).
- `materialId` on the Panel itself is *required*; a panel with a broken material reference renders the box with no fill color and shows an inline error in the dialog.
- `length`, `width`, `thickness` must be `> 0` after parameter resolution; non-positive values surface a parametric-evaluation error (same path as Extrude).

---

## 3. Kernel work

### 3.1 New OCCT op — `PanelOps.ts`

`packages/kernel/src/occt/PanelOps.ts` (new). Two responsibilities:

- `buildPanelBox(length, width, thickness): { shape, faceNames, edgeNames }` — generates an axis-aligned box per the §2.2.2 origin convention. Returns the shape plus a face-name map and edge-name map keyed by the §2.2.1 conventions.
- `tagPanelEdges(shape, edgeNames): TaggedShape` — applies persistent face/edge name tags via the existing `FaceNaming` infrastructure so that downstream features (Hole drilling on Top, Fillet on Front edge, etc.) can address faces by stable name across re-solves.

Tests:
- `PanelOps.spec.ts` — geometric correctness (volume = L · W · T, vertex count = 8, axis-aligned bounding box matches inputs).
- `PanelOps.integration.spec.ts` — face-name persistence across re-solve with parameter changes; tagged edges retrievable by `PanelEdgeKey`.

### 3.2 New feature — `PanelFeature.ts`

`packages/kernel/src/adapter/features/PanelFeature.ts` (new). Mirrors the shape of `ExtrudeFeature.ts` and `HoleFeature.ts`:

- `evaluate(ctx)` — resolves `length / width / thickness` parameters, calls `buildPanelBox`, returns the tagged shape as the part's first body.
- Validation guard at evaluation time: if the feature is not at index 0, throws `PANEL_NOT_BASE_FEATURE`. (Belt-and-braces; `PartDocument` already prevents this at insertion.)
- Per-feature broken-ref behavior: if `materialId` doesn't resolve, the feature still evaluates the box (since L/W/T are independent of material once thickness is set) but emits a `BROKEN_MATERIAL_REF` warning attached to the feature.

Tests:
- `PanelFeature.spec.ts` — unit, parameter cascade, suppression toggle, broken-material-ref warning surface.
- `PanelFeature.integration.spec.ts` — full part-document-level round-trip: create panel → evaluate → save → reload → re-evaluate identical.

### 3.3 Feature-tree wiring

`packages/kernel/src/adapter/FeatureTree.ts` learns about `PanelFeature` (registered in the existing feature-kind dispatch alongside Sketch / Extrude / Revolve / Sweep / Hole / Fillet / Chamfer / Shell / LinearPattern / Mirror / WorkAxis / WorkPlane / WorkPoint / Imported).

`PartDocument.ts` adds a `validatePanelInvariant` step: if any `PanelFeature` exists, it must be at index 0 and there must be exactly one. Violations throw `INVALID_PANEL_PLACEMENT`.

Test: `PartDocument.spec.ts` gains cases for "Panel can be inserted at index 0 only" and "second Panel insertion is rejected."

### 3.4 Storage — manifest migration v9 → v10

`packages/shared/src/migrateManifest-v9-to-v10.ts` (new):
- For both `kind: 'part'` and `kind: 'assembly'`: ensure `materials: []` exists.
- Bump `formatVersion: 10`.
- No other changes.

`migrateManifest-v9-to-v10.spec.ts` covers: legacy v9 part → v10 with empty materials; legacy v9 assembly → v10 with empty materials; v10 idempotent.

### 3.5 Worker API surface

No new top-level kernel methods. `PanelFeature` flows through the existing `applyFeature` / `evaluateFeatureTree` paths. The `MaterialRegistry` is pure data — it lives entirely on the main thread (in the manifest and in app state) and is passed *into* `PanelFeature.evaluate` as part of the feature payload (specifically: the resolved `thickness` is computed on main, not on worker, when defaulted from a material; what gets sent to the kernel is the final number).

This means the kernel never needs to know what a "material" is — it only sees three numbers (L, W, T) per panel feature, identical to existing features. Cleanest separation.

---

## 4. App work (UI, viewport, commands)

### 4.1 Furniture tab activation

`packages/app/src/shell/tabs/FurnitureTab.tsx` is rewritten from the stub. It declares one ribbon `RibbonPanel` named "Create" with one button:

| Button | Icon | Command | Enabled when |
|---|---|---|---|
| Panel | (new `PanelIcon` in `packages/icons/src/PanelIcon.tsx`) | `OpenPanelDialogCommand` | Always — dispatch resolves context (empty new part vs assembly) |

Ribbon visibility: tab is visible at all times (matches Sketch / Model / Assembly / View / Inspect / File / Drawing tabs). Clicking the tab when no document is open is allowed (consistent with other tabs); the button just disables itself if neither a part nor assembly is active.

### 4.2 New commands

In `packages/app/src/commands/`:

- **`OpenPanelDialogCommand.ts`** — opens the `PanelDialog`, prefilled in two modes:
  - **Part mode** (an empty part is open in the editor): dialog will produce an `AddPanelFeatureCommand` on submit.
  - **Assembly mode** (an assembly is active, no part open or part is non-empty): dialog will produce a `CreateAndPlacePanelCommand` on submit (creates a new `.zipt`, asks for filename via File System Access, applies the Panel feature, then runs the existing `PlaceComponentCommand` flow).
  Refuses with a clear inline error if a non-empty part is active.
- **`AddPanelFeatureCommand.ts`** — inserts a `PanelFeature` at index 0 of the active part. Undoable. Calls `validatePanelInvariant`. If a part already has any feature, command rejects.
- **`CreateAndPlacePanelCommand.ts`** — composes: new part document → `AddPanelFeatureCommand` → save-as → `PlaceComponentCommand`. Recorded as one undoable transaction.
- **`EditPanelFeatureCommand.ts`** — opens dialog populated from the feature; on OK, replaces the feature in place. Undoable.
- **`AddMaterialCommand.ts`** / **`EditMaterialCommand.ts`** / **`DeleteMaterialCommand.ts`** — operate on the active assembly's `materials` array (or the loose part's scratchpad registry when no assembly is active). Delete is rejected if any panel in the active document references the material; the command surfaces an inline error listing referencing panels.
- **`ToggleShowEdgeBandsCommand.ts`** — flips a UI flag in `useAppStore` (`showEdgeBands: boolean`, default `true`). Bound to a checkbox in the View tab.

### 4.3 Dialog — `PanelDialog.tsx`

`packages/app/src/shell/PanelDialog.tsx` (new). Layout (top-to-bottom):

1. **Dimensions** — three labeled numeric inputs (Length, Width, Thickness). All accept literal mm values or parameter expressions, using the existing `parseParamOrLiteral`. Thickness shows a small "(from material)" badge when `thicknessFromMaterial === true`; typing in the field clears the flag (badge disappears) and switches to override mode. Changing the Material dropdown while the flag is true updates the Thickness field to the new material's `defaultThickness`; while the flag is false, Thickness is left untouched.
2. **Material** — `<select>` dropdown listing the active registry. Adjacent "Manage…" button opens an inline `MaterialRegistryEditor` (a small list with add / edit / delete; closes back into the dialog).
3. **Grain** — three radio buttons (`Length / Width / None`) with a tiny SVG arrow icon next to each.
4. **Edge bands** — a 4-row table: rows labeled Front / Back / Left / Right, each with a material dropdown (`<None>` plus the registry).
5. Standard OK / Cancel footer; pressing Esc cancels; clicking outside dismisses (matches the F7 pattern from 1.5).

A small `PanelDialog.spec.tsx` covers form roundtrip, material picker, edge-band per-row state, override-vs-default thickness behavior, broken-material-ref display.

### 4.4 Browser pane integration

`BrowserPane.tsx` renders `PanelFeature` like any other feature: name "Panel", icon = `PanelIcon`. Double-clicking opens `EditPanelFeatureCommand`. Right-click context menu has Suppress / Delete (using existing handlers — Panel is allowed to be suppressed, in which case the part has no body until re-enabled).

### 4.5 Viewport — edge-band highlight

`packages/app/src/viewport/SceneManager.ts` gains a small subsystem:

- When `useAppStore.showEdgeBands === true`, for every visible part with a Panel feature whose evaluation succeeded, build a `THREE.LineSegments` overlay using each banded edge's geometry (read from the OCCT-tagged edge polylines already produced by the tessellator).
- Tint = the band material's `color` (from the registry). Renders on top of the part wireframe.
- Toggling the flag re-creates only the overlays, not the underlying part meshes (cheap, O(panel-count)).
- For broken band-material refs: the edge is drawn in a fallback warning-yellow stroke (`#cfa84b`) and a console warning is emitted (suppressed if "Show edge bands" is off).

`SceneManager.spec.ts` adds tests for: overlay creation/removal on toggle, color from material, broken-ref fallback. The render path itself is exercised via the Playwright e2e in §6.2.

### 4.6 Material registry editor

`packages/app/src/shell/MaterialRegistryEditor.tsx` (new). Embedded inside `PanelDialog` only in 5a — standalone "Manage Materials…" ribbon button is deferred to F1 (likely 5b, when the cabinet configurator wants registry edits without a panel context).

Renders a small flat list:

| Name | Default Thickness (mm) | Color |
| --- | --- | --- |
| Birch Plywood 18mm | 18 | (swatch) |
| MDF 12mm | 12 | (swatch) |
| PVC 1mm white | 1 | (swatch) |

`+ Add` / row hover ⇒ Edit / Delete affordances. Validates uniqueness of `name` within the registry. Delete confirms via inline panel (no modal stack), with reference count.

### 4.7 View-tab toggle

`packages/app/src/shell/tabs/ViewTab.tsx` gets a "Display" panel addition: a labeled checkbox **Show edge bands** bound to `useAppStore.showEdgeBands`, persisted in localStorage like other view toggles. Default on.

---

## 5. Storage, save/load, and reconciliation

### 5.1 ProjectPacker / AssemblyPacker

- `packages/kernel/src/storage/ProjectPacker.ts` — already serialises the manifest verbatim. The new `materials: []` array on part manifests rides through unchanged. `Panel` feature serialisation is handled by the existing per-feature codec dispatch (extend the codec map by one entry).
- `packages/kernel/src/storage/AssemblyPacker.ts` — same: `materials` on the assembly manifest is just another field. Existing tests `AssemblyPacker.spec.ts` and `Opfs.assembly.integration.spec.ts` get one extra case each: a panel-bearing part placed in an assembly with one material entry round-trips.

### 5.2 Migration test fixtures

`packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts` covers:

1. v9 part manifest (no `materials` key) → v10 with `materials: []`. `formatVersion = 10`.
2. v9 assembly manifest (no `materials` key) → v10 with `materials: []`.
3. v10 part manifest with a populated `materials` (representing a standalone-edited panel scratchpad) → v10 unchanged.
4. v10 assembly manifest with a populated `materials` → v10 unchanged.
5. v10 part with a `Panel` feature at index 0 → unchanged.
6. v10 part with a `Panel` feature **not** at index 0 → migration *does not* fix; document fails to open with `INVALID_PANEL_PLACEMENT`. (Migration is not the place to repair invalid feature trees — surface to user.)

### 5.3 Reconciliation on placement

`packages/app/src/assembly/reconcileMaterials.ts` (new) — implements §2.4. Pure function:

```ts
export function reconcileMaterials(
  partRegistry: MaterialRegistry,
  assemblyRegistry: MaterialRegistry,
  panelFeatureRefs: PanelMaterialRef[]   // list of (panelFeatureId, fieldKey, materialId)
): {
  updatedPartFeatures: PanelFeatureRefRewrite[];   // patches to apply to the .zipt before save
  updatedAssemblyMaterials: MaterialRegistry;      // new array to write back
}
```

Strategy:
1. Build a map of assembly materials keyed by `(name.trim().toLowerCase(), defaultThickness)`.
2. For each ref: look up; if found, emit a rewrite from `partMaterialId → assemblyMaterialId`. If not found, copy the part-registry entry into the assembly registry (preserving `id`).
3. Returns a deterministic, side-effect-free result.

Tests in `reconcileMaterials.spec.ts`: empty registries, exact-match merge, no-match copy, multi-panel mixed, case-insensitive name matching, name-collision-with-different-thickness (treated as distinct materials).

`PlaceComponentCommand` runs reconciliation immediately before adding the new component; the part's `.zipt` blob is rewritten in place (existing infrastructure for editing parts already supports this) and the assembly's manifest is updated atomically with the placement.

### 5.4 Cleanup of stale part-scratchpad registries

After reconciliation, the placed `.zipt` keeps its `materials` array as-is — entries the panel still references are untouched, but reconciliation has already rewritten the IDs to assembly-side IDs. To prevent drift, `reconcileMaterials` *also* emits a rewritten part `materials` array that drops entries no longer referenced by any panel feature. The placed `.zipt` ends up with `materials` ⊆ assembly's `materials` (post-rewrite).

Rationale: keeps the part valid as a standalone document (still has its own registry the panel can resolve) but eliminates orphan entries. A round-trip "open the placed part standalone, edit it, re-save" then re-reconciles cleanly.

### 5.5 Backward-compat and forward-compat

- Opening a v9 file in 5a-shipped code: migration adds empty `materials`, no Panels exist, file is valid v10.
- Opening a v10 file in pre-5a code: pre-5a code rejects the higher `formatVersion` with the existing "unsupported version" error. (No graceful downgrade — same behavior as v8 → v9 on 4d.)
- A panel feature in pre-5a code: irrelevant since pre-5a code can't open v10 files.

---

## 6. Tests, performance, and verification

### 6.1 Test inventory

| Layer | File | Coverage |
|---|---|---|
| `shared` unit | `material.spec.ts` | `MaterialEntry` shape, registry uniqueness rules, JSON-roundtrip |
| `shared` unit | `panel-feature.spec.ts` | `PanelFeature` shape, edge-band slot serialization, grain enum guard |
| `shared` unit | `migrateManifest-v9-to-v10.spec.ts` | Six cases from §5.2 |
| `shared` unit | `fileFormat.spec.ts` (extended) | v10 listed as current; legacy v9 still readable via migration |
| `kernel` unit | `PanelOps.spec.ts` | Box geometry: bounding box equals (L,W,T); 6 faces; 12 edges; 8 vertices; volume = L · W · T |
| `kernel` integration | `PanelOps.integration.spec.ts` | Face-name persistence across L/W/T parameter change re-solve; edge-name retrieval by `PanelEdgeKey` matches §2.2.1 mapping |
| `kernel` unit | `PanelFeature.spec.ts` | Evaluate/suppress; broken-material-ref warning emitted |
| `kernel` integration | `PanelFeature.integration.spec.ts` | End-to-end: empty part → add Panel → save → reload → evaluate → bytes-identical body |
| `kernel` unit | `PartDocument.spec.ts` (extended) | Panel must be index 0; second panel rejected; reorder past Panel rejected |
| `app` unit | `commands/__tests__/AddPanelFeatureCommand.spec.ts` | Insertion at index 0, undo path, rejection on non-empty part |
| `app` unit | `commands/__tests__/CreateAndPlacePanelCommand.spec.ts` | Composes new-part → add-panel → save-as → place; transactional undo |
| `app` unit | `commands/__tests__/EditPanelFeatureCommand.spec.ts` | Replace-in-place, undo |
| `app` unit | `commands/__tests__/AddMaterialCommand.spec.ts` etc. | Add / Edit / Delete material; delete-with-refs rejection with reference list |
| `app` unit | `commands/__tests__/ToggleShowEdgeBandsCommand.spec.ts` | Store flag flip, persistence |
| `app` unit | `assembly/__tests__/reconcileMaterials.spec.ts` | Six cases from §5.3 |
| `app` unit | `shell/__tests__/PanelDialog.spec.tsx` | Form roundtrip; thickness-from-material badge & override; broken-material-ref display; edge-band rows |
| `app` unit | `shell/__tests__/MaterialRegistryEditor.spec.tsx` | Add/edit/delete; uniqueness validation; reference-count delete confirm |
| `app` unit | `viewport/__tests__/SceneManager.spec.ts` (extended) | Edge-band overlay create/remove on toggle; band tint from material; broken-ref fallback |
| `app` unit | `shell/__tests__/FurnitureTab.spec.tsx` (new) | Furniture tab now renders the Create panel and Panel button |

### 6.2 New e2e specs (Playwright)

In `tests/e2e/furniture/`:

1. **`create-panel-in-empty-part.spec.ts`** — open new part, click Furniture → Panel, fill 600 × 400 mm with "Birch Plywood 18mm" material (auto-fills T = 18), grain = length, band all four edges with "PVC 1mm white". OK. Verify: feature tree shows Panel; viewport shows a box; toggling "Show edge bands" highlights all 4 rim edges in the band tint; manifest carries 2 materials; save and reopen preserves the panel.
2. **`place-panel-into-assembly.spec.ts`** — open new assembly, click Furniture → Panel, fill in dimensions and material, save part to a chosen filename, verify part is placed in assembly browser pane and viewport, manifest of the assembly carries the material registry, panel references it by `id`.
3. **`material-registry-edit.spec.ts`** — open Manage Materials inside Panel dialog, add three materials, edit one's default thickness, attempt to delete one referenced by a panel and confirm rejection. Save/reopen the assembly: registry preserved.
4. **`panel-parametric-cascade.spec.ts`** — create a panel driven by parameters `L = panelL`, `W = panelW`, change parameters, observe geometry update and edge-band overlay re-render at the new dimensions.
5. **`edge-band-toggle.spec.ts`** — toggle the View tab "Show edge bands" checkbox, verify overlay appears/disappears; persistence across reload.

### 6.3 New perf spec

`tests/perf/panel-create-and-render.spec.ts` — places **50 panels** (varied dimensions, half with 4 edge bands, half with 0) into an assembly; measures (a) total time from "Place" command start to viewport repaint, (b) time to toggle "Show edge bands" off→on with all 50 panels visible (overlay rebuild). Both within budgets:

- Place all 50: p95 ≤ 12 s on the target hardware (≈0.24 s per place + reconcile, comparable to existing place perf).
- Toggle overlay rebuild: p95 ≤ 80 ms (must feel instant).

### 6.4 Manual smoke checklist

`docs/superpowers/manual-tests/subproject-5a.md` — three scenarios:

1. **Hello-Panel:** Create a new part, add a Panel via Furniture tab, save as `Side.zipt`. Reopen, verify feature tree and dimensions.
2. **Cabinet-prep:** Create a new assembly. Use Furniture → Panel five times, producing Top, Bottom, Left, Right, Back of a small box; band the top edges of the four uprights but not the back. Save assembly. Reopen, confirm registry and bands persisted, edge highlight visible.
3. **Material-edit-cascade:** With (2) loaded, change the "Birch Plywood 18mm" `defaultThickness` to 19. Confirm panels using it (where T was not overridden) update; panels with explicit T overrides do not.

### 6.5 CI / build verification

- `pnpm -r typecheck` clean across all 5 packages.
- All vitest suites green (extended counts).
- Integration suites green.
- Playwright e2e green (5 new specs).
- Perf spec green within budgets.
- No new ESLint warnings.

---

## 7. Risks, follow-ups, and hand-off

### 7.1 Architectural risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Materials registry on the assembly only** breaks the standalone-part editing UX (no place to define materials when no assembly is active). | Per §2.4 + §5.3, parts carry a scratchpad `materials` array used only when edited standalone; reconciled into the assembly registry on placement. Tested in `reconcileMaterials.spec.ts`. |
| R2 | **Panel must be index 0** is enforced in three places (PartDocument validator, PanelFeature evaluator guard, command rejection). Drift between them could let an invalid part slip through. | Single source of truth: `validatePanelInvariant` in `PartDocument.ts`. Other call sites delegate to it. Direct test in `PartDocument.spec.ts`. |
| R3 | **Edge-name persistence across re-solves** is the same fragility we hit in 3b (fillet) — if OCCT renames an edge after a parameter change, the band highlight disappears. | We never operate on user-picked edges for panels; all four banded edges are *generated* by `PanelOps` and tagged at creation, so re-solve uses the same generation logic with the same naming convention. The integration test in §6.1 is the canary. |
| R4 | **Material-deletion-with-references** — if the registry's delete guard is bypassed (e.g. by direct manifest edit), the panel's material ref becomes broken. | We render the panel with no fill color and surface a `BROKEN_MATERIAL_REF` warning in the feature panel and console, matching 4d's broken-componentPath UX. Same fallback for broken edge-band material refs. |
| R5 | **Format-version bump cascading** — every active branch / WIP doc that opens a v9 file gets auto-migrated to v10. Going back to a pre-5a build then can't open it. | Standard cascade we accept on every sub-project (4a → 4d each bumped). User is told once in the changelog; v9 → v10 migration is purely additive so re-saving in 5a doesn't lose anything a v9 build would have wanted. |

### 7.2 Out-of-scope hand-offs to later sub-projects

| Sub-project | What 5a leaves on the table for it |
|---|---|
| **5b** (Cabinet configurator) | Furniture tab is now real; cabinet configurator just adds another button to it. Cabinet templates emit panels via `AddPanelFeatureCommand`. Material registry pre-exists. |
| **5c** (Hardware library) | Material registry is the seed of a future "library" concept. Hardware parts attach to panels via face names (`Top` etc.) defined in §2.2.1. |
| **5d** (Cut list tab) | Cut list walker reads `PanelFeature.length / .width / .thickness / .grain / .materialId / .edgeBands` directly off the feature tree of every leaf part in the assembly. No data-shape change needed in 5d — only the new tab + aggregation walker + CSV export. |
| **5e** (Nesting) | Cut list (5d) feeds nesting; grain direction is already an enum on every panel. Nesting respects `'length' / 'width'` orientation constraints; `'none'` panels are free to rotate. |

### 7.3 Deferred / nice-to-have items (post-5a)

To be tracked in the eventual `project_subproject_5a_execution_state.md`:

- **F1** — Standalone "Manage Materials…" button on the Furniture tab, callable without a Panel context (deferred, mentioned in §4.6).
- **F2** — Viewport grain-direction hatching on the top face (Q8 alternative B; defer until nesting needs the visual cue).
- **F3** — Modeled edge-band geometry as actual OCCT bodies (Q6 alternative B; defer until STEP-export of bands becomes necessary).
- **F4** — Cross-project material library sharing (Q4 alternative B/D; defer until users actually have multiple projects sharing materials).
- **F5** — Banded edges on bottom rim (currently only top rim per §2.2.1).
- **F6** — Per-edge partial bands (e.g. half a side); currently each edge is fully banded or unbanded.
- **F7** — Material color-picker integration with the existing palette in 4c (today the material `color` is a free-form hex; align with 4c's palette in 5c when hardware also gets palette-driven appearances).

### 7.4 Sub-project ordering re-check

5a is independent of 5b/5c/5d/5e in the dependency graph: panels can be created and saved before any cut list or cabinet template exists. The recommended sequence stays: **5a → 5d → 5b → 5c → 5e**, since 5d turns 5a into something with shippable user-facing value before the configurator and hardware layers arrive.

### 7.5 Estimated scope of 5a

Roughly comparable to 3b (fillet) or 4c (BOM): ~30–40 plan tasks across these phases:

1. Shared types (`MaterialEntry`, `PanelFeature`, manifest v10).
2. Migration `v9 → v10`.
3. Kernel `PanelOps` + `PanelFeature` + `FaceNaming` integration.
4. `PartDocument.validatePanelInvariant` and feature-tree wiring.
5. Commands (`OpenPanelDialogCommand`, `AddPanelFeatureCommand`, `CreateAndPlacePanelCommand`, `EditPanelFeatureCommand`, `AddMaterialCommand`, `EditMaterialCommand`, `DeleteMaterialCommand`, `ToggleShowEdgeBandsCommand`).
6. UI (`PanelDialog`, `MaterialRegistryEditor`, `FurnitureTab` activation, `ViewTab` toggle).
7. Browser-pane integration.
8. Viewport edge-band overlay.
9. Reconciliation on placement (`reconcileMaterials`).
10. Storage round-trip tests.
11. e2e + perf specs.
12. Manual-smoke checklist + commit.

---

## Appendix — Brainstorming decision trail

Locked during the 2026-05-01 brainstorming session:

| # | Question | Choice |
|---|---|---|
| Q-decomp | Sub-project 5 split | 5-way (5a–5e), build order 5a → 5d → 5b → 5c → 5e |
| Q-style | Reference style | Woodwork-for-Inventor: panel-as-first-class part with edge band per face, automatic cut list, optional nesting |
| Q1 | Panel ↔ Part | A — Panel is a Part; Panel becomes a feature kind |
| Q2 | Where dimensions come from | C — L/W explicit; T defaulted from material with override (tracked via `thicknessFromMaterial: boolean` on `PanelFeature`) |
| Q3 | Edge banding model | A — per-edge, 4 rim slots (Front/Back/Left/Right) |
| Q4 | Material registry scope | A — per-project, on the assembly's manifest |
| Q5 | Panel feature placement | A — base feature, index 0, at most one |
| Q6 | Viewport edge-band visualization | C — edge highlight only, no modeled geometry; toggle in View tab |
| Q7 | Where Panel command lives | A — Furniture tab; supports both part-context and assembly-context flows |
| Q8 | Grain direction | A — three-value enum (length / width / none); no viewport hatching in 5a |
| Q9 | BOM tab in 5a | A — no change to BOM tab; cut list is 5d work |
| §2.2.1 confirm | Bandable edges | 4 edges adjacent to Top face only (bottom-rim deferred to F5) |
| §2.3 confirm | Format version bump | v9 → v10 |
| §3 confirm | Origin convention | Bottom face on XY plane; origin at centroid of bottom face |
| §4.6 confirm | `MaterialRegistryEditor` standalone | In-Panel-only in 5a; standalone deferred to F1 |
| §4.7 confirm | `showEdgeBands` default | True |
