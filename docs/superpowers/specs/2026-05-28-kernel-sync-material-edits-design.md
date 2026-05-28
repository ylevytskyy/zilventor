# Kernel-sync for material edits — design

**Date:** 2026-05-28
**Status:** APPROVED — ready for implementation plan
**Branch target:** master via `feature/kernel-sync-material-edits`
**Manifest bump:** none (live kernel/store sync only; on-disk format unchanged)

## Background

The Zustand store and the kernel each hold their own copy of every part's `materials[]` array. Today, three commands mutate the store's copy directly and the kernel's copy never gets updated:

| Command | What it calls | What it forgets |
|---|---|---|
| `AddMaterialCommand.apply` (`packages/app/src/commands/AddMaterialCommand.ts:29`) | `useAppStore.getState().addMaterial(entry)` | `kernel.setMaterials(...)` doesn't exist |
| `EditMaterialCommand.apply` (`…/EditMaterialCommand.ts:24`) | `useAppStore.getState().updateMaterial(id, patch)` | same |
| `DeleteMaterialCommand.apply` (`…/DeleteMaterialCommand.ts:47`) | `useAppStore.getState().removeMaterial(id)` | same |

Plus two secondary callers of `store.addMaterial`:

- `PlaceComponentCommand` (`…/PlaceComponentCommand.ts:155`) — copies materials from a source part into the destination on placement.
- `CreateAndPlacePanelCommand` (`…/CreateAndPlacePanelCommand.ts:88`) — same pattern.

The kernel's `parts` map (the source of `saveToBytes`) refreshes only on `load` / `loadFromBytes` / feature-tree mutations / parameter mutations (9 `parts.set` call sites in `packages/kernel/src/api.ts`, none of them touching materials). So:

- The user edits a material (name, color, defaultThickness, sheetLength/Width, hatchAngleDeg, hatchSpacingMm).
- The store reflects the edit; the inspector shows it.
- The 500 ms autosave debounce fires `kernel.saveToBytes(activePart.id)`.
- `saveToBytes` reads `parts.get(partId).materials` — **stale** (the materials the kernel was loaded with, not the edited ones).
- The on-disk `.zipt` is written without the edit.
- On next open / reload, the edit is gone.

Two existing e2es (`tests/e2e/drawing/material-hatch-color.spec.ts`, `tests/e2e/drawing/material-hatch-pattern.spec.ts`) hide this gap with a `__zilventorUnpackProject` → splice manifest materials → `__zilventorPackProject` injection that bypasses the natural autosave path. Without the injection, both tests fail. The injection is masking, not fixing.

This spec closes the gap.

## Decisions (locked from brainstorming)

1. **Kernel API shape:** single `kernel.setMaterials(partId, materials[])` — full-array replace, symmetric with `load` / `loadFromBytes`. Not three per-op methods.
2. **Failure mode:** kernel throws on unknown partId (symmetric with `setParameter`). Callers guard via a tiny helper so assembly-active edits become no-ops.
3. **e2e:** drop the `__zilventorPackProject` workaround from BOTH affected specs; prove the fix end-to-end via natural autosave.
4. **Scope:** wire all 5 callers — `AddMaterialCommand`, `EditMaterialCommand`, `DeleteMaterialCommand`, `PlaceComponentCommand`, `CreateAndPlacePanelCommand`. The helper's null-guard means part-vs-assembly target doesn't have to be reasoned about per call site.

## Architecture

### Kernel layer

```ts
// packages/kernel/src/api.ts  — new method on the kernel public API
setMaterials(partId: PartId, materials: readonly MaterialEntry[]): void {
  const part = parts.get(partId);
  if (!part) throw new Error(`setMaterials: unknown partId ${partId}`);
  parts.set(partId, { ...part, materials: [...materials] });
}
```

- Pure mutation. No geometry recomputation. No event emission. No `saveToBytes` side effect.
- Defensive copies the array (callers may continue to hold the input reference).
- Throws on missing partId — loud, symmetric with `setParameter` at `api.ts:227–231`.

### App layer

```ts
// packages/app/src/state/syncPartMaterials.ts  — NEW FILE
import type { Kernel } from "@zilventor/kernel";
import { useAppStore } from "./useAppStore";

/**
 * Mirror activePart.materials from the Zustand store into the kernel's parts map.
 * No-op when no part is active (assembly / drawing / nothing) — kernel doesn't own
 * assembly materials, so the store is the source of truth for those.
 */
export function syncPartMaterials(kernel: Kernel): void {
  const part = useAppStore.getState().activePart;
  if (!part) return;
  kernel.setMaterials(part.id, part.materials);
}
```

### Command call sites (8 insertions)

Each material-mutating command gains one line after its existing store mutation. The kernel reference comes from the same place each command already gets it (constructor / `this.kernel`).

| File | Line (current) | Existing call | New call (after) |
|---|---:|---|---|
| `AddMaterialCommand.ts` | `apply:29` | `addMaterial(entry)` | `syncPartMaterials(this.kernel)` |
| `AddMaterialCommand.ts` | `revert` | `removeMaterial(id)` | `syncPartMaterials(this.kernel)` |
| `EditMaterialCommand.ts` | `apply:24` | `updateMaterial(id, patch)` | `syncPartMaterials(this.kernel)` |
| `EditMaterialCommand.ts` | `revert` | `updateMaterial(id, prev)` | `syncPartMaterials(this.kernel)` |
| `DeleteMaterialCommand.ts` | `apply:47` | `removeMaterial(id)` | `syncPartMaterials(this.kernel)` |
| `DeleteMaterialCommand.ts` | `revert` | `addMaterial(prev)` | `syncPartMaterials(this.kernel)` |
| `PlaceComponentCommand.ts` | `apply:155` | `addMaterial(entry)` | `syncPartMaterials(this.kernel)` |
| `CreateAndPlacePanelCommand.ts` | `apply:88` | `addMaterial(entry)` | `syncPartMaterials(this.kernel)` |

PlaceComponent / CreateAndPlacePanel typically run while an assembly is active — the helper's null-guard short-circuits in that case. The line is still added so that any future part-targeted variant doesn't reintroduce the gap.

## Invariant

> **MS-1.** After any material-mutating command's `apply()` or `revert()` finishes, when `useAppStore.getState().activePart` is non-null, `kernel.parts.get(activePart.id).materials` is structurally equal to `activePart.materials`.

This is the property the kernel unit test asserts at the boundary and the e2e tests prove end-to-end via autosave round-trip.

## Testing

### Kernel unit (`packages/kernel/src/api.spec.ts` — extension)

1. `setMaterials` replaces `parts.get(partId).materials` with the provided array.
2. `setMaterials` throws on unknown partId (regex: `/setMaterials: unknown partId/`).
3. `saveToBytes` after `setMaterials` round-trips with the updated materials (load `.zipt` back → materials match).
4. Defensive copy: mutating the input array after the call doesn't leak into kernel state.

### App-layer unit per command

For each of `AddMaterialCommand.spec.ts`, `EditMaterialCommand.spec.ts`, `DeleteMaterialCommand.spec.ts`:

- Mock `kernel.setMaterials`; after `apply()`, assert called once with `(activePart.id, post-state.activePart.materials)`.
- Assembly-active fixture: `apply()` does NOT call `kernel.setMaterials`.
- After `revert()`, kernel materials match the pre-`apply()` snapshot.

For `PlaceComponentCommand.spec.ts` / `CreateAndPlacePanelCommand.spec.ts`:

- Assembly-active fixture (the existing fixture): `kernel.setMaterials` NOT called — confirms the null-guard.
- If a part-active path exists in the command's tests, assert `setMaterials` IS called with the new materials.

### `syncPartMaterials.spec.ts`

- Part active → calls `kernel.setMaterials(part.id, part.materials)`.
- Assembly active (`activePart === null`, `activeAssembly` set) → does not call kernel.
- Nothing active (both null) → does not call kernel.

### e2e — drop the workaround

In `tests/e2e/drawing/material-hatch-color.spec.ts` (lines 104–126 Part A, 169–190 Part B) and `tests/e2e/drawing/material-hatch-pattern.spec.ts`:

- **Remove** the `__zilventorUnpackProject` → splice → `__zilventorPackProject` blocks.
- Save through the real autosave path: edit material → wait for 500 ms autosave debounce (an explicit `await waitForAutosave(page)` helper, if not already present) → close project → reopen.
- Assert the edited material persists.

**Red→green proof:** the e2e edits land before the helper wiring → run with workaround removed → must fail on the persistence assertion. Wire `syncPartMaterials` into the commands → must pass. This is the load-bearing teeth check.

## Implementation batches (writing-plans starting point)

1. **Kernel `setMaterials` + unit tests.** Adds the public method and 4 unit tests (replace, throw-on-unknown, saveToBytes round-trip, defensive copy). RED for the throw + round-trip case before implementation, GREEN after.
2. **`syncPartMaterials` helper + spec.** New file with the 3-case unit (part active, assembly active, nothing active).
3. **AddMaterialCommand wiring + spec.** Add helper call to `apply` + `revert`. Spec asserts `kernel.setMaterials` is called with the right args; assembly-active does not call.
4. **EditMaterialCommand wiring + spec.** Same shape.
5. **DeleteMaterialCommand wiring + spec.** Same shape.
6. **PlaceComponentCommand + CreateAndPlacePanelCommand wiring.** Add helper call after `addMaterial`. Specs assert no-op under assembly-active fixture (the existing fixture).
7. **e2e teeth-check.** Drop the `__zilventorPackProject` workaround in `material-hatch-color.spec.ts` and `material-hatch-pattern.spec.ts`. Save via natural autosave; reopen; assert material survives.
8. **Final pass review** — Sonnet+ultrathink verifier; fix cosmetic NITs inline; full unit + e2e + perf gate.

## Out of scope (deferred)

- Generic "kernel mirrors store" subscription pattern. Over-engineered for materials; this targeted fix is enough.
- Cleaning up the phantom-fflate lockfile entry. Separate hygiene task.
- Cleaning up the dead `getLastOpenDrawing` export and other session-restore NITs.
- Anything beyond `materials[]` — feature tree / parameters are already synced via the existing `addFeature` / `setParameter` paths.

## Risk register

| Risk | Mitigation |
|---|---|
| The 500 ms autosave debounce makes the e2e timing-sensitive / flaky. | Add an explicit `await waitForAutosave(page)` helper (or reuse an existing one — planner verifies). If still flaky, allow a short polling assertion on the reopened material's persistence rather than a single-shot assert. |
| `PlaceComponentCommand` / `CreateAndPlacePanelCommand` turn out to be invoked with `activePart` set in some flow, causing unexpected kernel writes. | Helper is idempotent and safe — writing the same materials back to the kernel is a no-op semantically. Worst case: a redundant `parts.set`. Acceptable. |
| Other unknown callers of `store.addMaterial` / `updateMaterial` / `removeMaterial` exist beyond the 5 mapped. | Mapping subagent grep'd the whole repo (confidence 92); planner re-greps before committing the batch list. |
| `EditMaterialCommand.revert` path edge case — restoring a material to its previous state when `activePart` changed since `apply` (unlikely but possible). | The helper reads `state.activePart` at call time, so revert syncs whatever's now active. If activePart is null (assembly active), revert is a store-only operation matching today's behavior. |
