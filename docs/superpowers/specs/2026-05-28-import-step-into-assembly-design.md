# Import STEP into Active Assembly as a Component

**Status:** Approved design — ready for plan
**Date:** 2026-05-28
**Predecessor:** [2026-05-28 Load STEP file](2026-05-28-load-step-file-design.md) (shipped at `133dbc0` — STEP → new top-level part)

## Goal

Enable the daily furniture-CAD workflow: drop a vendor STEP file (hinge, screw, drawer slide, decorative hardware) straight into an open assembly as a real component — without today's 5-step round-trip (import STEP as new part → save → close → open assembly → insert that part).

## Scope

In scope:
- STEP only (`.step` / `.stp`) — kernel already exposes `importStep`
- When `activeDocument.kind === 'assembly'`: import + insert as a new component at the assembly origin
- When `activeDocument.kind` is `part`, `drawing`, or absent: today's behavior — create a new top-level part and switch to it
- Single file per invocation

Explicitly out of scope (deferred follow-ups, listed at end):
- Additional formats (IGES / BREP / STL / OBJ)
- Multi-select batch import
- STEP-assembly decomposition into multiple sub-parts (we collapse to one solid as `importStep` already does)
- Cursor-attached floating placement preview
- Auto-organize imports into an `Imported/` folder
- Re-import / update existing component geometry
- Drag-and-drop file onto viewport
- Recent Files menu

## UX

### Path A — File → Open (existing menu, context-dispatched)

1. User picks `.step` / `.stp` via File → Open (already accepts these extensions since `19cc9d0`).
2. Dispatch by active document kind:
   - `assembly` → import + insert as component; remain in assembly view
   - `part` / `drawing` / none → today's behavior: create new top-level part, switch to part view
3. Status bar message:
   - Assembly branch: `Imported '<name>.zipt' and inserted into assembly`
   - New-part branch: `Opened STEP as new part` (unchanged from today)

### Path B — Assembly tab button (new)

1. Add a new ribbon button on the Assembly tab labeled **"Insert From STEP…"**, sited next to the existing "Insert Component" button.
2. Disabled when no active assembly.
3. Opens a file picker filtered to `.step` / `.stp`.
4. Effect: identical to Path A's assembly branch — same command dispatched.

Both paths converge on the same atomic command.

## Architecture

### New command: `ImportStepAsComponentCommand`

Atomic, single-undo. Composes existing primitives plus two new steps.

Inputs: `{ stepBytes: Uint8Array, fileName: string }` (plus the usual command context: `kernel`, `store`, `bus`).

Steps:
1. `kernel.importStep({ stepBytes, partName })` — parse STEP, cache the BREP blob, return `{ brepBlobId, triangleCount, boundingBox, faceCount }`. (Already exists.)
2. Build a `PartDocument` containing an `ImportedFeature` referencing the blob, prepended with `ORIGIN_FEATURES`. (Extract a reusable helper from current `importStepIntoNewPart` so both code paths share it.)
3. `kernel.registerPart(part)`. (Already exists, shipped at `133dbc0`.)
4. **New:** persist the new part to OPFS via the existing `packPart` → file-handle write path used by `Save As` / autosave. The part must be a real on-disk `.zipt` so that autosave, restore, BOM, drawings, and sub-assembly loading all work uniformly.
5. **New:** insert as a new component into the active assembly with identity pose at origin. Reuse the component-creation primitive that `InsertComponentCommand` already calls; the only difference is that the part reference is the just-created one rather than a user-picked existing part.

Undo: removes the component from the assembly, evicts the part from OPFS + kernel cache (since this command created it).

Redo: re-registers the part (from kept-in-memory bytes), re-persists, re-inserts.

### Naming

- Default part name = STEP file stem (e.g., `hinge-blum-110.step` → `hinge-blum-110`).
- On collision with an existing part in the project, auto-suffix `(2)`, `(3)`, … — no name prompt. (Matches Inventor's behavior for component-insert-from-file; user can rename in tree afterwards.)

### Folder location

- New `.zipt` lives at project root (flat), same as today's `importStepIntoNewPart`.
- Auto-organizing into an `Imported/` folder is deferred (F5).

### Pose

- Component inserted at identity transform (translation `[0,0,0]`, identity rotation) — same point as the assembly's origin.
- User repositions afterwards via the existing pointer-drag tool shipped in Sub-project 4b B3.

### Reused infrastructure

| Concern | Reuses |
|---|---|
| STEP parsing | `kernel.importStep` (existing) |
| Part construction | `importStepIntoNewPart` core (refactor to reusable helper) |
| Kernel registration | `kernel.registerPart` (existing, since `133dbc0`) |
| OPFS persistence | `packPart` + existing OPFS file-handle write path (used by Save As / autosave) |
| Component insert into assembly | `InsertComponentCommand` primitive (existing) |
| Repositioning after insert | Pointer-drag tool from 4b B3 (existing) |

### What does **not** change

- Manifest schema — no version bump (this is additive UX over read-only schemas).
- Kernel — no new bindings; `importStep` already returns everything needed.
- Drawing / BOM / nesting subsystems — they consume the new `.zipt` the same way they consume any other part.

## Edge cases

| Case | Behavior |
|---|---|
| STEP fails to parse (malformed / unsupported entities) | Status bar error from the underlying `importStep` rejection; no part created, no component inserted, no OPFS write. |
| Name collision in project | Auto-suffix `(2)`, `(3)`, … on the part name. |
| STEP file contains a sub-assembly tree | `importStep` already collapses to a single solid; carry that behavior forward and add a one-line status note: "Imported as single body". |
| STEP file contains no solids | Treated as parse fail — error + no state change. |
| Active document is a drawing | Same as no-active-doc: create new top-level part, switch focus to it. Drawings can't host components. |
| User cancels the file picker | No-op, no status. |
| Same STEP imported twice into the same assembly | Two separate `.zipt` parts (deduped names) and two component instances; no auto-link. (Re-import / dedupe-by-content-hash is F6.) |
| Path B clicked while no active assembly | Button is disabled; not reachable. |
| Path A invoked while a STEP picker is already open | Browser-native single-picker semantics — not our concern. |

## Tests

### Unit (Vitest)

`packages/app/src/commands/ImportStepAsComponentCommand.spec.ts`:
- Assembly-active path: command inserts exactly one component, persists the new part to OPFS, registers it with the kernel.
- Part-active path: creates standalone part, **does not** mutate the active part or any assembly.
- Drawing-active path: creates standalone part, switches active document to part.
- Name dedupe: importing the same STEP twice yields parts named `name` and `name (2)`.
- Undo: removes the component, evicts the part from OPFS + kernel cache.
- Redo: restores both component and part.

`packages/app/src/shell/tabs/FileTab.spec.tsx` (extended):
- STEP picked while assembly active → dispatches `ImportStepAsComponentCommand`, not the standalone-part path.
- STEP picked while part active → dispatches existing standalone-part path (regression guard).

### Kernel integration (real OCCT)

`packages/app/src/import/importStepIntoAssembly.kernel.spec.ts` (or extend existing kernel-integration suite):
- Given a real `.step` file (reuse `tests/fixtures/cube-10mm.step`), invoking the command on an empty assembly yields one assembly component whose bounding box matches the cube's expected extents within tolerance.

### E2E (Playwright, real OCCT)

`tests/e2e/assembly-import-step.spec.ts`:
- Open a new empty assembly → File → Open `tests/fixtures/cube-10mm.step` → cube renders in the viewport at the origin as a component (verify via a viewport pixel-presence assertion analogous to the existing 2026-05-28 STEP-load e2e) → assembly tree shows one new component referencing the new part → reload the page → component still present (autosave round-trip).
- Same flow via the new Assembly-tab "Insert From STEP…" button.

## File touches

New:
- `packages/app/src/commands/ImportStepAsComponentCommand.ts`
- `packages/app/src/commands/ImportStepAsComponentCommand.spec.ts`
- `packages/app/src/import/importStepIntoAssembly.kernel.spec.ts` (or extend)
- `tests/e2e/assembly-import-step.spec.ts`

Modified:
- `packages/app/src/import/importStepIntoNewPart.ts` — extract the part-construction core into a reusable helper consumed by both the new-part path and the new command.
- `packages/app/src/shell/tabs/FileTab.tsx` — STEP branch in `handleOpen` dispatches by active document kind.
- `packages/app/src/shell/tabs/AssemblyTab.tsx` — new ribbon button "Insert From STEP…", disabled when no active assembly.
- `packages/app/src/shell/tabs/FileTab.spec.tsx` — assembly-dispatch test case.

No manifest changes. No kernel changes.

## Success criteria

1. Open an empty assembly → File → Open `cube-10mm.step` → the cube appears at the assembly origin as a real component (visible in the viewport and in the assembly tree as a component referencing the new part — not a standalone top-level part).
2. Save assembly → reload page → the component is still there (autosave + restore work uniformly because the new part is a real `.zipt` on disk).
3. The same flow works via the new Assembly-tab "Insert From STEP…" button.
4. `pnpm test:unit` stays green (currently ~3016; we add ~6–8 new unit tests + e2e + kernel-integration).
5. `pnpm test:e2e` passes the new `assembly-import-step` spec end-to-end against real OCCT.
6. No regression in existing File → Open behavior for `.zipt` / `.ziasm` / `.zidw` / STEP-with-part-active.

## Deferred follow-ups

| Tag | Description |
|---|---|
| F1 | Additional formats: IGES, BREP, STL, OBJ (requires new kernel bindings) |
| F2 | Multi-select batch import — picker accepts multiple STEPs, each becomes its own component at origin |
| F3 | STEP-assembly decomposition into multiple `.zipt` sub-parts (vs. today's collapse-to-one-solid) |
| F4 | Cursor-attached floating preview placement — new ToolMode + preview render path |
| F5 | Auto-organize imports into `Imported/` folder (or per-material taxonomy) |
| F6 | Re-import / update existing component geometry (content-hash dedupe) |
| F7 | Drag-and-drop file onto viewport |
| F8 | Recent Files menu (today only the last-open auto-restores on boot) |
