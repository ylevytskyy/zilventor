# ZilInventor Sub-project 4a — Assembly placement design spec (2026-04-25)

First piece of Sub-project 4 (Assemblies + BOM). Adds the assembly document
type, component placement, multi-mesh viewport rendering, and the assembly
ribbon. Scoped to "drop a part into an assembly at a 3D transform" —
constraints, BOM, and sub-assemblies are deferred to 4b / 4c / 4d.

## Decomposition

Sub-project 4 splits into four pieces:

| Piece | Scope |
|---|---|
| **4a (this spec)** | Multi-part document + component placement |
| 4b | Mate constraints + 3D solver |
| 4c | Bill of Materials |
| 4d | Sub-assemblies |

Each ships as its own spec → plan → implementation cycle on master.

## Scope summary

| Axis | In scope | Deferred |
|---|---|---|
| Doc type | `AssemblyDocument` (separate from `PartDocument`) | Sub-assemblies (4d) |
| Component reference | OPFS path (relative to OPFS root) | Embedded blobs, content-hash addressing |
| Transform | Position (mm) + Euler XYZ (degrees) | Quaternion / matrix |
| Tab model | Single active document, switch via File menu | Multi-tab interface |
| Placement UX | Drop at origin, edit afterward | Ghost-cursor preview, viewport-click drop |
| Component picker | Custom dialog with thumbnail grid | Recent tab, multi-select, drag-and-drop |
| Constraints | None | Mates (4b) — first-component-auto-grounded comes there |
| BOM / item numbers | None | 4c |
| Component color | Single uniform material | Per-component color (4c) |
| Missing component | Red placeholder + diagnostic | Auto-relocation, find-replacement |

## Data model

Added to `packages/shared/src/types.ts`:

```ts
export type ComponentInstance = {
  id: string;                          // unique within the assembly
  partPath: string;                    // OPFS path to .zipt, relative to OPFS root
  position: { x: number; y: number; z: number };  // mm
  rotation: { rx: number; ry: number; rz: number };  // degrees, applied in XYZ order
  visible: boolean;
};

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, ParameterDef>;  // empty in 4a; reserved for future param-driven placements
  components: ComponentInstance[];
};

export type ProjectFile =
  | { formatVersion: 7; kind: 'part'; document: PartDocument; ... }
  | { formatVersion: 7; kind: 'assembly'; document: AssemblyDocument; ... };
```

- `formatVersion` stays at **7**. The discriminated `kind` field replaces the
  prior assumption that every project file held a `PartDocument`. Existing v7
  part files load unchanged because they default to `kind: 'part'` if absent
  (a thin migration shim handles the missing field).
- Euler order is fixed at `'XYZ'` to match Inventor's default. Any 4×4-matrix
  transform layer (for 4b's solver output) sits on top of the Euler value at
  apply time; the storage stays Euler.

## File format — `.ziasm`

Per Sub-project 1 lock:

```
gzipped tar of:
  manifest.json       — { formatVersion: 7, kind: 'assembly', document: {...} }
  thumbnail.png       — assembly-level thumbnail captured at save time
```

No `blobs/` directory in `.ziasm` — components reference parts by `partPath`;
each part's BREP blob lives in its own `.zipt`.

## Storage — `packages/kernel/src/storage/AssemblyPacker.ts`

Parallel to the existing `ProjectPacker.ts`:

```ts
export async function packAssembly(doc: AssemblyDocument, thumbnail: Uint8Array): Promise<Uint8Array>;
export async function unpackAssembly(bytes: Uint8Array): Promise<AssemblyDocument>;
```

Reuses the same tar+gzip helpers `ProjectPacker` already uses. `unpackAssembly`
errors structurally on:

- Malformed tar / gzip
- `manifest.json` not present
- `manifest.kind !== 'assembly'`
- `formatVersion` not in the supported range

## Load pipeline

1. User picks `.ziasm` via File → Open. `Opfs.loadFile` returns raw bytes.
2. Discriminate by file extension first; on tie, peek at `manifest.kind`.
3. `unpackAssembly(bytes)` → `AssemblyDocument`.
4. For each `component` in the doc:
   1. Resolve `component.partPath` against OPFS root.
   2. Load that `.zipt` via existing `unpackPart`.
   3. Extract the cached BREP blob (`PartDocument.cachedGeometry.brepBlobId`,
      already shipped at Shell MVP).
   4. Tessellate via existing `Tessellator.ts` (kernel-side, called via Comlink).
   5. Cache the resulting `BufferGeometry` keyed by `partPath` so the same
      part placed N times tessellates once.
5. For each component, create a `THREE.Mesh` with the cached geometry +
   composed transform; add to scene.

**Missing-component handling.** If `partPath` doesn't resolve in OPFS, render
a red 50 mm wireframe-cube placeholder at the component's transform and
record `{ componentId, message: 'partPath not found' }` in the assembly's
diagnostics panel. Saving the assembly does not strip missing components —
they round-trip so the user can re-link.

## Active-document discrimination

`packages/app/src/store/useAppStore.ts`:

```ts
export type ActiveDocument =
  | { kind: 'part'; document: PartDocument }
  | { kind: 'assembly'; document: AssemblyDocument };

activeDocument: ActiveDocument | null;
```

Replaces the existing `activePart: PartDocument | null`. A backwards-compat
shim during migration: `activePart` becomes a getter that returns
`activeDocument?.kind === 'part' ? activeDocument.document : null`. Every
call site that currently reads `activePart` updates to the new field with
explicit `kind` narrowing.

## Viewport — `packages/app/src/viewport/SceneManager.ts`

Existing `setMesh(geometry)` keeps working for part mode. Add for assembly
mode:

```ts
setComponentMeshes(meshes: Array<{
  componentId: string;
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  visible: boolean;
}>): void;

clearComponentMeshes(): void;
```

`setComponentMeshes` diffs against the prior list by `componentId`:

- New ids → add `THREE.Mesh` instances.
- Removed ids → dispose meshes (NOT geometries, which are shared) + remove.
- Existing ids → update `transform` + `visible` in place.

Geometry sharing: a single `BufferGeometry` may be referenced by multiple
`THREE.Mesh` instances. Disposal is per-mesh; `BufferGeometry` is disposed
only when no mesh references it.

**Transform composition:**

```ts
const m = new THREE.Matrix4();
m.makeRotationFromEuler(new THREE.Euler(degToRad(rx), degToRad(ry), degToRad(rz), 'XYZ'));
m.setPosition(x, y, z);
mesh.matrixAutoUpdate = false;
mesh.matrix.copy(m);
```

**Geometry hash.** The existing `data-geometry-hash` attribute on the
viewport extends to include component transforms (FNV-1a over each
component's id + position + rotation, in addition to vertex positions).

**Selection / highlighting.** `ComponentPickController` does raycasting
against scene meshes and reports the picked `componentId`. Selected
components get a subtle outline (existing outline-pass).

**Materials.** Single uniform flat-shaded material across all components in
4a. Per-component color comes in 4c.

## UI — assembly mode

### Browser pane

When `activeDocument.kind === 'assembly'`, render:

```
Assembly: <name>
├── Components (N)
│   ├── ▸ <componentId> — <partFileName>
│   ├── ▸ <componentId> — <partFileName>
│   └── ...
└── Origin                    (placeholder, populated in 4b)
```

Per-component context menu (right-click): **Edit Position** / **Toggle Visibility** / **Delete**.
Double-click → opens Edit Component Properties dialog.

### Place Component dialog

Custom dialog. Layout:

- Title: "Place Component"
- Tabs: **All Parts** (active in 4a), **Recent** (placeholder for follow-up)
- Grid of tiles (4 columns), each showing:
  - Thumbnail (decoded from the `.zipt`'s `thumbnail.png`)
  - Filename
  - Optional bounding-box dimensions ("30×30×600", computed from the cached
    BREP's bounding box at thumbnail-load time)
- Click a tile to select.
- Footer: **Cancel** / **Place** (disabled until a tile is selected).

Place inserts a `ComponentInstance` at origin with identity rotation, closes
the dialog, persists via autosave.

### Edit Component Properties dialog

Opens on double-click of a component browser node, or via the Edit button.

```
Component: <componentId>
Part: <partPath>

Position:    X [____]   Y [____]   Z [____]    (mm, accept =param refs)
Rotation:   RX [____]  RY [____]  RZ [____]    (degrees)

Visibility: [☑] visible

[Cancel]                              [Apply] [OK]
```

Numeric inputs reuse `parseParamOrLiteral` from Hole. **Apply** persists
without closing; **OK** persists + closes.

### Commands

| Command | Type | Trigger |
|---|---|---|
| `OpenPlaceComponentDialogCommand` | function | P key, ribbon Place button |
| `PlaceComponentCommand` | class | dialog OK |
| `OpenEditComponentDialogCommand` | function | browser dbl-click, ribbon Edit button |
| `EditComponentCommand` | class | dialog OK |
| `DeleteComponentCommand` | class | ribbon Delete, ctx-menu Delete, Delete key on selected |
| `OpenPartFromComponentCommand` | function | ribbon Open Part with a component selected |
| `NewAssemblyCommand` | function | File → New Assembly |

`PlaceComponentCommand` / `EditComponentCommand` / `DeleteComponentCommand`
mirror the `Add*FeatureCommand` class pattern from Hole/Sweep:
`apply()` mutates store + persists via autosave; `revert()` undoes.

### Ribbon

A new **Assembly** ribbon tab, visible only when
`activeDocument.kind === 'assembly'`. Panels:

- **Component:** Place / Edit / Delete buttons.
- **Manage:** Save / Save As / Open Part *(opens the selected component's
  part for editing — closes the assembly first per the single-document
  model)*.

The Model ribbon tab is hidden in assembly mode. The Sketch tab is hidden
too. The Inspect / View tabs remain available.

### Store slice (additions to `useAppStore.ts`)

```ts
placeComponentDialogOpen: boolean
editComponentDialogOpen: boolean
editingComponentId: string | null
editComponentInitialValues: ComponentInstance | null
selectedComponentId: string | null
componentDiagnostics: Array<{ componentId: string; message: string }>

openPlaceComponentDialog: () => void
resetPlaceComponentDialog: () => void
openEditComponentDialog: (id: string) => void
resetEditComponentDialog: () => void
addComponent: (instance: ComponentInstance) => void
updateComponent: (id: string, patch: Partial<ComponentInstance>) => void
removeComponent: (id: string) => void
```

## Component pick controller — `packages/app/src/model/ComponentPickController.ts`

```ts
export class ComponentPickController {
  activate(): void;
  deactivate(): void;
  isActive(): boolean;
  // From viewport raycaster (which carries componentId via mesh.userData):
  selectFromViewport(componentId: string): void;
}
```

Wired to `viewportRef` raycasting hooks. Activates from Edit / Delete
commands or right-click context menu.

## Testing

### Shared unit — `packages/shared/src/__tests__/assembly-document.spec.ts`
- Type narrowing for `ComponentInstance`, `AssemblyDocument`,
  `ProjectFile` discriminated union.
- Empty `AssemblyDocument` round-trips through structural-clone.

### Storage unit — `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`
- `packAssembly` → `unpackAssembly` round-trip preserves doc + thumbnail.
- `unpackAssembly` rejects `kind: 'part'`.
- `unpackAssembly` reports structured error on malformed JSON.

### Storage integration — `packages/kernel/src/storage/__tests__/Opfs.assembly.integration.spec.ts`
- Save `.ziasm` to OPFS, list, load, verify round-trip.
- Save `.zipt` + `.ziasm` referencing it; load assembly; verify part is resolved.
- Load `.ziasm` whose `partPath` is missing — verify it loads with a
  diagnostic and a placeholder.

### Viewport unit — `packages/app/src/viewport/__tests__/SceneManager.spec.ts`
- `setComponentMeshes` adds, updates, removes meshes by id correctly.
- Two components with the same `geometry` reference share the
  `BufferGeometry` instance.
- `clearComponentMeshes` disposes only meshes, not shared geometries (until
  no mesh references remain).

### App unit
- `BrowserPane.spec.tsx` — assembly view renders Components + N leaves;
  double-click opens edit dialog.
- `PlaceComponentDialog.spec.tsx` — thumbnail grid renders; tile click
  selects; Place fires `onPlace(partPath)`.
- `EditComponentDialog.spec.tsx` — position / rotation / visibility
  controls; OK fires `onCommit({...})`.
- `useAppStore.spec.ts` — `activeDocument` discriminator; switching from
  part to assembly clears part-only state.

### Command unit
- `OpenPlaceComponentDialogCommand.spec.ts` — opens dialog + clears stale state.
- `PlaceComponentCommand.spec.ts` — `apply()` adds instance + persists.
- `EditComponentCommand.spec.ts` — `apply()` updates by id; `revert()` restores.
- `DeleteComponentCommand.spec.ts` — `apply()` removes; `revert()` re-adds.

### E2E — `tests/e2e/assembly/`
- `place-component.spec.ts` — create part, save `.zipt`, create assembly,
  place part, assert 1 component + geometry hash reflects 1 mesh.
- `place-multiple.spec.ts` — place same `.zipt` 3×; assert 3 components + 1
  shared geometry + 3 meshes.
- `edit-component-position.spec.ts` — place + double-click + edit position
  + OK + assert geometry hash changes.
- `delete-component.spec.ts` — place + right-click Delete + assert removed.
- `missing-part.spec.ts` — load `.ziasm` whose `partPath` doesn't exist;
  assert placeholder + diagnostic.
- `assembly-roundtrip.spec.ts` — create + save + reload; assert all
  components survive with correct transforms.

### Perf — `tests/perf/assembly-place-debounce.spec.ts`
- 20 rapid Place commits coalesce through autosave; final `.ziasm` has all 20.

## Deferred / not in this release

- **Mate constraints** — entire 4b sub-project.
- **Sub-assemblies** — entire 4d sub-project.
- **Bill of Materials** — entire 4c sub-project.
- **Multi-tab interface** — separate enhancement, not in any sub-project yet.
- **Ghost-cursor preview** during placement.
- **First-component auto-grounded** — meaningless without constraints.
- **Per-component color** — defer to 4c.
- **Component arrays / patterns** (place N copies in a grid).
- **Recent tab in PlaceComponentDialog** — usage tracking is a follow-up.
- **Parametric component placement** — UI for assembly-level parameters
  driving component transforms.
- **Section views, exploded views, animation**.
- **Cross-document undo**.

## Explicitly not refactored

- The `activePart` field gets renamed to `activeDocument` with a
  discriminator. Every call site updates.
- The Model ribbon tab keeps its current shape; just becomes hidden in
  assembly mode.
- No shared "param-dirty → re-execute" dispatcher (3b learning #2 still
  deferred).
- The single-document architecture stays — tabs are a separate enhancement.

## File references

- Spec (this file): `docs/superpowers/specs/2026-04-25-subproject-4a-assembly-placement-design.md`
- Shared types: `packages/shared/src/types.ts`
- Storage: `packages/kernel/src/storage/AssemblyPacker.ts`
- Viewport: `packages/app/src/viewport/SceneManager.ts`
- Pick controller: `packages/app/src/model/ComponentPickController.ts`
- Dialogs: `packages/app/src/shell/PlaceComponentDialog.tsx`,
  `packages/app/src/shell/EditComponentDialog.tsx`
- Commands: `packages/app/src/commands/{OpenPlaceComponentDialogCommand,PlaceComponentCommand,OpenEditComponentDialogCommand,EditComponentCommand,DeleteComponentCommand,OpenPartFromComponentCommand,NewAssemblyCommand}.ts`
- Browser pane: `packages/app/src/shell/BrowserPane.tsx` (assembly branch)
- Ribbon: new `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Store slice: `packages/app/src/store/useAppStore.ts`
