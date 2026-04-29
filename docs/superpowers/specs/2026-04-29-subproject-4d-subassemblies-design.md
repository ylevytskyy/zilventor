# Sub-project 4d — Sub-assemblies (design spec)

**Date:** 2026-04-29
**Status:** Approved (brainstorming complete; awaiting plan)
**Predecessors:** 4a (placement), 4b (constraints + LM solver), 4c (BOM)
**Successors:** 5 (furniture plug-in), 6 (drawings)

## Goal

Allow a `.ziasm` assembly file to reference another `.ziasm` as one of its components — recursively, to arbitrary depth. Furniture sub-assemblies (drawers, doors, hardware groups) become first-class building blocks. The Bill of Materials rolls up across the whole tree to give a flat parts-only count suitable for cut lists.

## Out of scope

- **Demote / Promote** commands. Sub-assemblies must be authored as their own `.ziasm` file before being placed; bulk regrouping of existing top-level components into a new sub-asm file is deferred.
- **Edit-in-place ("Edit" inside a parent context).** Double-click on a sub-asm in the browser pane opens it as a standalone active document, same as the existing assembly-open flow. Inventor's edit-in-place mode (ghosting, ribbon-context-switch) is not part of 4d.
- **Structured BOM view.** Only flat parts-only aggregation. A sub-asm row never appears in the BOM table; only its leaf parts do.
- **Sub-asm-level work features inheriting into the parent.** Each `.ziasm`'s work features are local to it.
- **Active OPFS file watching.** Cache invalidation after a sub-asm file is edited externally happens via the existing `__zilventorAssemblyInvalidatePart`-style dev hook plus the natural cache drop on tab focus / app reload. Automatic file-watch is a follow-up.

## Locked decisions (from brainstorming)

| # | Decision | Rationale |
|---|---|---|
| Q1 | **Per-instance rigid/flexible flag**, default rigid (Inventor-classic option C). A sub-asm placement can be set "Flexible" to inline its components and constraints into the parent solver. | Furniture mostly needs rigid; flexible mode covers hinge/slide mechanisms when needed. |
| Q2 | **No demote/promote** — sub-asms are placed by file reference only. | Decoupled from core capability; can be added later without re-shaping data model. |
| Q3 | **Flat parts-only BOM aggregation** (recursive). Sub-asm files never appear as BOM rows; their leaves contribute to the parent's flat count. | Cut-list use case wants total leaf-part counts, not nested groupings. |
| Q4 | **Standalone open** for sub-asm browse — double-click activates `.ziasm` as the active document, replacing the current open. No edit-in-place. | Existing `OpenProjectFile` flow works unchanged. |
| Q5 | **Both per-leaf override and top-down placement tint.** ComponentInstance.color on a sub-asm placement tints the whole subtree (top-down). The parent's `colorOverrides: Record<ComponentPathKey, ComponentColor>` map allows a per-leaf override that wins over both placement tint and the leaf's own color. | Inventor-faithful color semantics (occurrence color override + appearance override). |
| Q6 | **Constraint refs use `componentPath: string[]`** instead of `componentId: string`. Picker raycasts can resolve faces on leaves inside any placed sub-asm (rigid or flexible). | Required for flexible mode to be useful; cleanly extends the rigid case via composed-pose math. |
| Q7 | **Cycle handling**: refused at placement time with a status message; broken on load (treated as missing-ref placeholder + diagnostic). **Broken-ref handling**: reuses 4a's missing-part placeholder + diagnostic surface. | Defense-in-depth — placement gate prevents cycles, load-time guard catches externally-introduced cycles. |

## Architecture

### Data model — schema v7 → v8

`packages/shared/src/types.ts` changes:

```ts
export type ComponentInstance = {
  id: string;
  partPath: string;          // .zipt OR .ziasm
  position: { x: number; y: number; z: number };
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  color?: ComponentColor;    // for sub-asm placement: top-down tint
  flexible?: boolean;        // NEW — sub-asm-only; default false (rigid). Ignored on .zipt placements.
};

export type ComponentPath = ReadonlyArray<string>;          // NEW
export type ComponentPathKey = string;                      // NEW — pathKey() join

export type AssemblyConstraintRef =
  | { kind: 'face';  componentPath: ComponentPath; face: FaceName }
  | { kind: 'axis';  componentPath: ComponentPath; axis:
        | { source: 'cylindricalFace'; face: FaceName }
        | { source: 'edge'; edge: EdgeName }
        | { source: 'workAxis'; featureId: string } }
  | { kind: 'point'; componentPath: ComponentPath; point:
        | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
        | { source: 'workPoint'; featureId: string } };
// componentId removed in favor of componentPath; v7 migration: [componentId]

export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentPaths: ComponentPath[];                  // RENAMED from groundedComponentIds
  colors: Record<string, string>;                           // unchanged from 4c (palette name → hex)
  bomItemNumbers: Record<string, number>;
  colorOverrides: Record<ComponentPathKey, ComponentColor>; // NEW — per-leaf override (Q5 B-shape)
};

export type ProjectFile =
  | { formatVersion: 7 | 8; kind: 'part';     ... }
  | { formatVersion: 7 | 8; kind: 'assembly'; ... };
```

Path key serialization: `pathKey(path: ComponentPath): string` joins on the U+0000 (null) character, which the id charset does not contain. Defined in `packages/shared/src/componentPath.ts`.

### Module surface (new)

| Module | Path | Purpose |
|---|---|---|
| `componentPath` | `packages/shared/src/componentPath.ts` | `pathKey`, `parsePathKey`, `pathEquals`, `pathStartsWith` |
| `migrateManifestV7toV8` | `packages/shared/src/fileFormat.ts` | Schema bump (see below) |
| `SubAssemblyCache` | `packages/app/src/assembly/SubAssemblyCache.ts` | `loadSubAssembly(partPath, opfs)`, `invalidate(partPath)`, `loadSubAssemblyTree(activeDoc, opfs)`. Internal `Map<partPath, { doc, innerStaticPoses?, kind: 'ok'\|'missing'\|'cycle'\|'parse' }>`. Recursive load with stack-based cycle detection. |
| `cycleCheck` | `packages/app/src/assembly/cycleCheck.ts` | `wouldCreateCycle(parentDoc, candidatePartPath, opfs): Promise<boolean>` for `PlaceComponentCommand` gate |
| `aggregateBomRecursive` | `packages/app/src/assembly/walkers/aggregateBomRecursive.ts` | Replaces 4c's flat `aggregateBom`. Walks the tree; emits `BomRow[]` keyed by `(leafPartPath, effectiveColor)`. |
| `resolveColor` | `packages/app/src/assembly/walkers/resolveColor.ts` | Top-down precedence: `parent.colorOverrides[pathKey] > placement.color > leaf.color` |
| `flattenForSolver` | `packages/app/src/assembly/walkers/flattenForSolver.ts` | Walks the tree; emits `SolverInput` (pose unknowns, constraint list with path-rewritten refs, kinematic-equality blocks for rigid groups). |
| `composedPoses` | `packages/app/src/assembly/walkers/composedPoses.ts` | Given solver result, returns `Map<ComponentPathKey, Pose>` for every leaf. |
| `visibleLeaves` | `packages/app/src/assembly/walkers/visibleLeaves.ts` | Walks for viewport: `Array<{ componentPath, partPath, worldPose, effectiveColor, visible }>`. |
| `mergeAndPruneColorOverrides` | `packages/app/src/assembly/colorOverrideMerge.ts` | Autosave pre-pack: drops orphan keys, preserves live keys. Sibling of 4c's `mergeAndPruneBom`. |

### Store changes

`useAppStore` assembly slice gains:

| Field / action | Purpose |
|---|---|
| `subAssemblyDocs: Record<partPath, AssemblyDocument>` | Reactive mirror of `SubAssemblyCache` for re-render |
| `subAssemblyDiagnostics: Array<{ partPath, kind: 'cycle'\|'missing'\|'parse', message }>` | Surfaced in StatusBar + diagnostics dialog |
| `expandedSubAsmPaths: Set<ComponentPathKey>` | Browser-pane tree expansion |
| `selectedComponentPaths: ComponentPath[]` | Renamed from `selectedComponentIds`; v7-state migration single-elem |
| `setColorOverride(path, color \| null)` | Writes through to `activeAssembly.colorOverrides` |
| `setComponentFlexible(componentId, flag)` | Top-level only; flips placement's `flexible`; bumps `solverDirty` |

### Commands

| Command | Disposition | Behavior |
|---|---|---|
| `PlaceComponentCommand` | Modified | Detects sub-asm placement (peekProjectKind on candidate `partPath`). For sub-asm: runs `cycleCheck.wouldCreateCycle`. If true: rejects with status message; no state change. Otherwise places. |
| `ToggleSubAssemblyFlexibleCommand` | New | Flips `flexible` flag on a sub-asm placement; bumps `solverDirty`. |
| `SetComponentColorOverrideCommand` | New | Writes/clears `activeAssembly.colorOverrides[pathKey]`. |
| `SetBomItemNumberCommand` | Unchanged surface | Now keyed by `(leafPartPath, effectiveColor)` because the recursive aggregator produces those rows. |
| `ExportBomCsvCommand` | Unchanged | Uses recursive aggregator. |
| `ToggleShowComponentColorsCommand` | Unchanged | Same flag, applies to recursive viewport rendering. |
| `OpenComponentInPlaceCommand` | Deferred | Not shipped (Q4 = A). |

### Dialogs and panels

| UI element | Change |
|---|---|
| `EditComponentDialog` | When the selected component is a `.ziasm` placement, shows: (a) checkbox `Flexible` → `ToggleSubAssemblyFlexibleCommand`; (b) read-only label `Sub-assembly (N components)`. The Color row's existing controls apply at the placement (top-down tint). |
| `BrowserPane` | Replaces flat list with a recursive tree. Sub-asm nodes have expand/collapse triangle, `(N components)` annotation, and a `Flexible` badge if the flag is on. Double-click on sub-asm → `OpenProjectFileCommand(partPath)`. Right-click leaf → `Override color…` → ColorPicker → `SetComponentColorOverrideCommand`. |
| `BomTable` | Same shape; aggregator is recursive. New `Override` badge in the Color cell when an override is in effect for a row whose components are 100% inside one override path. |
| `PlaceComponentDialog` | `loadAssemblyTiles` extended to list both `.zipt` and `.ziasm`. Tile selection runs cycle check before accepting. |
| `StatusBar` | Adds `N components in M sub-assemblies` line. Diagnostic count badge if any cycle/missing/parse issues exist. |

### Viewport (`SceneManager`)

| Method | Change |
|---|---|
| `setComponentMeshes` | Signature: `ComponentLeaf[]` — one entry per leaf with `componentPath`, `partPath`, `worldPose`, `materialColor`, `visible`. Each `THREE.Mesh.userData.componentPath: string[]` for picker. Geometry caching keyed by `partPath` (sub-asm leaves share geometry across instances of the same `.zipt`). |
| Selection overlay | Iterates over `selectedComponentPaths`, matches by path-equality on `userData.componentPath`. |
| `geometryHash` | Hashes leaf set including paths and composed poses. |
| Picker (raycast) | Returns `componentPath`. Constraint picker records on `AssemblyConstraintRef`; component-select picker calls `selectComponent(path)`. |

### Solver pipeline

```
flattenForSolver(activeDoc, subAsmCache):
  unknowns = []
  pathToUnknown = Map<ComponentPathKey, unknownIndex>
  constraints = []

  walk(parentDoc, parentPath, ancestorChainIsFlexible):
    for c in parentDoc.components:
      path = [...parentPath, c.id]
      isSubAsm = c.partPath endsWith '.ziasm'

      if !isSubAsm:
        if ancestorChainIsFlexible OR parentPath.length === 0:
          unknowns.push(initialPose(c)); pathToUnknown.set(pathKey(path), idx)
        // else: leaf is part of an enclosing rigid composite — no unknown

      else:
        if c.flexible:
          // Inline: placement's own pose IS an unknown, plus we recurse to add child unknowns
          unknowns.push(initialPose(c)); pathToUnknown.set(pathKey(path), idx)
          walk(subDoc, path, ancestorChainIsFlexible=true)
          appendConstraints(subDoc.constraints, prefix=path)
        else:
          // Rigid: ONE unknown for the whole subtree; do NOT walk
          unknowns.push(initialPose(c)); pathToUnknown.set(pathKey(path), idx)
          // Inner static poses come from cache.innerStaticPoses[partPath]

  appendConstraints(activeDoc.constraints, prefix=[])
  return { unknowns, pathToUnknown, constraints }

solveAssembly(SolverInput) → returns poses[unknownIndex] + DOF basis (existing 4b RPC)

composedPoses(activeDoc, subAsmCache, solverResult):
  worldPoses = Map<ComponentPathKey, Pose>

  walk(parentDoc, parentPath, ancestorPose):
    for c in parentDoc.components:
      path = [...parentPath, c.id]
      myPose = pathToUnknown.has(pathKey(path))
        ? solverResult.poses[pathToUnknown.get(pathKey(path))]
        : compose(ancestorPose, innerStaticPose(parentSubAsmPath, c.id))
      worldPoses.set(pathKey(path), myPose)
      if c.partPath endsWith '.ziasm':
        if c.flexible:
          walk(subDoc, path, /* unused for unknown leaves */)
        else:
          for [leafPathKey, innerPose] in cache.get(c.partPath).innerStaticPoses:
            worldPoses.set(pathKey([...path, ...leafPathKey]), compose(myPose, innerPose))

  return worldPoses
```

The kernel's `solveAssembly` and `extractAssemblyRef` RPCs are unchanged. The path-based ref is rewritten down to `(partId, FaceName)` at the parent-side resolver before each RPC.

### Pre-solve for rigid sub-asms

When `SubAssemblyCache.loadSubAssembly(partPath)` returns a fresh assembly doc, an inner LM solve runs once over its components + constraints (treating its own ground references as fixed). The result is stored on the cache entry as `innerStaticPoses: Map<ComponentPathKey, Pose>` keyed by the sub-asm's local component paths. Used by `composedPoses` for rigid-subtree leaf transforms.

If the inner solve has residual norm above tolerance, the cache entry's `kind` stays `'ok'` but a diagnostic is appended noting `inner-solve residual: X` and the parent placement gets a red badge in BrowserPane. This is non-fatal — the rigid subtree still renders with the best-effort poses from the inner LM.

For flexible sub-asms, no pre-solve is run — their inner constraints are inlined into the parent system.

### Save flow

Top-level save serializes only `activeDoc`. Sub-asm files are independent; they're saved when the user opens them as the active document. Per-instance overrides (`colorOverrides`, `ComponentInstance.flexible`) live on the parent's document and ride along on the parent's autosave.

`mergeAndPruneColorOverrides` runs in the autosave pre-pack to drop orphan override keys whose components no longer exist in the live tree (e.g., a sub-asm was edited and a leaf was deleted).

### Cache invalidation

When any sub-asm file is saved (whether via this app's autosave path or via a dev hook), the cache entry for that `partPath` is dropped. The load effect re-unpacks. Rigid pre-solve re-runs if applicable. `solverDirty` is bumped so the parent re-solves with the new inner static poses. The viewport re-renders with the new tessellated geometry.

## Error handling

### Schema migration v7 → v8

`migrateManifestV7toV8` runs in `migrateManifest`:

| v7 field | v8 field | Migration |
|---|---|---|
| `AssemblyDocument.groundedComponentIds: string[]` | `groundedComponentPaths: ComponentPath[]` | `ids.map(id => [id])` |
| `AssemblyConstraintRef.componentId: string` | `componentPath: string[]` | `[componentId]` |
| (n/a) | `colorOverrides: {}` | default `{}` |
| (n/a) | `ComponentInstance.flexible?: boolean` | absent |

`formatVersion: 8` written by `kernel.saveToBytes` and `packAssembly`. Load handles v7 (auto-upgrade in memory) and v8.

### Cycles

- **Placement gate** in `PlaceComponentCommand`: `cycleCheck.wouldCreateCycle(activeDoc, candidatePartPath, opfs)` runs before accepting a `.ziasm` placement. The check unpacks the candidate, walks its `.ziasm` components recursively, and checks whether the active document's path is in the transitive closure. If yes: command rejects with `setStatusMessage('Cannot place: would create a cycle.')` plus a one-line diagnostic showing the cycle path. No state change.
- **Load-time guard** in `SubAssemblyCache.loadSubAssembly`: a stack of currently-loading paths is maintained. If a `.ziasm` references a `partPath` already on the stack, the second occurrence is treated as broken-ref. The placement renders as placeholder; a `subAssemblyDiagnostic` of `kind: 'cycle'` is appended.

### Broken sub-asm refs

Same path as 4a's leaf-part missing-part diagnostic. `loadSubAssembly` returns `{ kind: 'missing'|'parse', message }`. `visibleLeaves` emits a placeholder cube at the placement; the `assemblyMeshSync` effect renders it. `BomTable` skips broken sub-asms (their leaves are unreachable). `subAssemblyDiagnostics` accumulates the issue.

User recovery: fix the file (rename it back, restore from backup) and trigger `__zilventorSubAsmInvalidate(partPath)` or reload the app.

### Constraints with broken refs

A constraint whose `componentPath` resolves into a missing/cycle sub-asm has its residual contribution skipped. `brokenRef: true` is set on the per-constraint solver result, surfaced in BrowserPane with a red badge — same as 4b.

### Color override pointing at a stale path

When a sub-asm is edited externally and a leaf is deleted, `colorOverrides[stalePathKey]` becomes orphan. Pruned during autosave merge by `mergeAndPruneColorOverrides`, analogous to 4c's `pruneBomItemNumbers`.

### Inner over-constrained sub-asm

The inner pre-solve's LM produces a residual norm; if above tolerance, diagnostic appended, BrowserPane red-badges the placement. Render uses best-effort inner poses; parent placement still works.

## Testing

### Unit tests (vitest)

| Package | Suite | Coverage |
|---|---|---|
| shared | `componentPath.spec.ts` | `pathKey`/`parsePathKey` round-trip; `pathEquals`/`pathStartsWith`; U+0000 separator never collides with id charset |
| shared | `migrateManifest-v7-to-v8.spec.ts` | round-trip a v7 fixture (2 parts + 1 mate) → v8 → re-load matches; refs migrate to single-elem `componentPath`; `groundedComponentIds → groundedComponentPaths` |
| app | `SubAssemblyCache.spec.ts` | lazy-load happy path; cycle `A → B → A` returns cycle entry; broken-ref returns `missing` entry; `invalidate` + reload path; rigid pre-solve runs once and stores `innerStaticPoses` |
| app | `aggregateBomRecursive.spec.ts` | flat parts-only roll-up across 3 levels; key `(leafPartPath, effectiveColor)`; override propagation top-down; broken sub-asm contributes 0 rows |
| app | `resolveColor.spec.ts` | precedence `parent.colorOverrides[key] > placement.color > leaf.color`; missing override falls through; deeper nesting still resolves |
| app | `flattenForSolver.spec.ts` | rigid sub-asm = 1 unknown for whole subtree, leaves not added; flexible = inlined unknowns + path-prefixed constraints; rigid-containing-flexible (currently invalid; tested for sane error) |
| app | `composedPoses.spec.ts` | rigid leaf world pose = composite ∘ inner static; flexible leaf world pose = own unknown; deep nesting composes correctly |
| app | `cycleCheck.spec.ts` | direct cycle, transitive cycle, non-cycle |
| app | `mergeAndPruneColorOverrides.spec.ts` | orphan keys pruned; live keys preserved; integrates with autosave pre-pack |
| app | command suites (additions) | `ToggleSubAssemblyFlexibleCommand`, `SetComponentColorOverrideCommand`, `PlaceComponentCommand` cycle-rejection |

### Integration tests

| Package | Suite | Coverage |
|---|---|---|
| kernel | `assemblyPacker-v8-roundtrip.spec.ts` | pack/unpack v8 with sub-asm references, `colorOverrides`, `flexible`-flagged components |
| app | `subassembly-load-tree.spec.ts` | OPFS-roundtrip a 3-level tree; `subAssemblyDocs` populated correctly; cycle-on-disk → diagnostic |

### E2E (Playwright, `tests/e2e/assembly/`)

| Spec | Goal |
|---|---|
| `subasm-place-rigid` | Author `drawer.ziasm` (3 parts, 1 mate). Open new top assembly, place `drawer.ziasm` twice. Both render at correct positions; BOM aggregates 6 leaves. |
| `subasm-flexible-toggle` | Place `drawer.ziasm` once, toggle flexible. Inner constraint shows in parent's solver-DOF readout (DOF count drops vs. rigid). |
| `subasm-constraint-reach` | Top constraint pinning a top-level part to a face on a leaf inside a placed sub-asm. Resolve, render, verify pose. |
| `subasm-cycle-rejection` | Try to place A inside B inside A. Place rejected; status message; no placement added. |
| `subasm-broken-ref` | Place `drawer.ziasm`, then OPFS-rename it. Reload top assembly. Placeholder + diagnostic; remaining BOM rows correct. |
| `subasm-color-override` | Place `drawer.ziasm` (panels oak). Override one panel to walnut via per-leaf override. Viewport color, BOM splits row. Override at placement (top-down) tints all panels of one instance. |
| `subasm-invalidate-cascade` | Open `drawer.ziasm`, edit a panel size, save. Top assembly auto-re-loads, parent re-solves with new inner static poses, viewport reflects size change. |
| `subasm-bom-recursive` | 3-level tree (cabinet/drawer/panel) with mix of placement-tinted and override colors. CSV export; verify columns and quantities. |

### Perf

| Spec | Budget |
|---|---|
| `subasm-aggregate-bom-deep` | `aggregateBomRecursive` p95 across a 3-level tree with 200 leaves: < 5 ms |
| `subasm-flatten-and-solve` | `flattenForSolver` + `solveAssembly` p95 across 5 rigid sub-asms (10 leaves each = 50 leaves) and 30 parent-level constraints: < 200 ms |
| `subasm-load-tree` | Cold-cache `loadSubAssemblyTree` p95 for a 50-leaf tree: < 1500 ms |

### Test fixtures

Add `tests/e2e/helpers/seedSubAssembly.ts` to author multi-part `.ziasm` fixtures (drawer, cabinet, etc.) by composing the existing 4a/4b single-part seeders.

### Dev hooks (under `import.meta.env.DEV`)

| Hook | Purpose |
|---|---|
| `__zilventorSubAsmCacheGet(partPath)` | Returns cached `AssemblyDocument` or null |
| `__zilventorSubAsmInvalidate(partPath)` | Forces cache eviction + reload + re-solve |
| `__zilventorComponentPathToLeafCount(path)` | Returns descendant leaf count |
| `__zilventorComposedPoseFor(path)` | Returns world pose at a path, after current solve |

## Implementation phasing (tentative)

The plan document (a follow-up to this spec) will break this into ~8–10 phases:

1. Shared types + path utilities + v7→v8 migration
2. `SubAssemblyCache` + cycle detection
3. Recursive walkers (BOM, color, viewport leaves)
4. `flattenForSolver` + `composedPoses`
5. Rigid pre-solve integration
6. Store slice changes (subAsmDocs, expansion, color overrides)
7. Commands (cycle gate, flexible toggle, color override)
8. Dialogs + BrowserPane recursion + StatusBar diagnostics
9. Viewport pathways (path-keyed meshes, selection overlay, picker)
10. Autosave merge/prune + dev hooks
11. E2E suite
12. Perf

Cross-cutting validation points: `pnpm -r typecheck` clean after every phase; kernel + app vitest green after every phase; E2E + perf at the end.
