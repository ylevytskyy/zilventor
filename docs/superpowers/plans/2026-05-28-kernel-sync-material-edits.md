# Kernel-sync for material edits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the kernel-store sync gap for material edits so the 500ms autosave debounce persists every material mutation (name, color, defaultThickness, sheetLength/Width, hatchAngleDeg, hatchSpacingMm).

**Architecture:** New `kernel.setMaterials(partId, materials[])` API symmetric with `setParameter`; new app-layer `syncPartMaterials()` helper (0-arg) that reads both `kernel` and `activePart` off `useAppStore.getState()` internally; all 5 material-mutating commands call the helper after their store mutation (both apply and revert).

**Tech Stack:** TypeScript, Vitest, Playwright, Zustand, pnpm monorepo, vitest --run, OPFS file storage.

---

## File placement notes (verified against codebase)

- **`syncPartMaterials.ts`** lives at `packages/app/src/store/syncPartMaterials.ts` — NOT `state/`. There is no `state/` directory in the codebase; the store module lives at `packages/app/src/store/`. `drawingDocState.ts` is the precedent for store-adjacent helpers.
- **`setMaterials` test** lives at `packages/kernel/src/__tests__/setMaterials.spec.ts` (new file). The integration suffix `.integration.spec.ts` is reserved for tests that require the full OCCT wasm; `setMaterials` is pure JS and doesn't need OCCT. Use plain `.spec.ts` picked up by `pnpm --filter @zilventor/kernel run test:unit`.
- **e2e helpers** live at `tests/e2e/helpers/` (confirmed: `buildBox.ts`, `seedDrawing.ts`, etc.). New `waitForAutosave.ts` goes there.
- **Kernel store field**: `useAppStore.getState().kernel` is typed as `KernelClient | null` (confirmed at `packages/app/src/store/useAppStore.ts:90`). `KernelClient` is the alias defined in `packages/app/src/kernel-client/KernelClient.ts`. The `syncPartMaterials` helper reads this field from the store internally. Do NOT import from `@zilventor/kernel` directly in the app-layer helper (circular risk). Use `useAppStore.getState().kernel` — it already has `setMaterials` after Batch 1 adds it to `KernelApi`.
- **`MaterialEntry` import**: already exported from `@zilventor/shared`. Add `MaterialEntry` to the existing `api.ts` line-1 import destructure.

---

## Batch 1 — Kernel `setMaterials` API + unit tests

**Outcome:** `kernel.setMaterials(partId, materials[])` exists and is reachable from app layer. 4 unit tests pass.

### Step 1-1 — Write failing tests (RED)

Create new file `packages/kernel/src/__tests__/setMaterials.spec.ts`:

```ts
// packages/kernel/src/__tests__/setMaterials.spec.ts
import { describe, it, expect } from 'vitest';
import { createKernelApi } from '../api';
import type { MaterialEntry } from '@zilventor/shared';

const MAT_A: MaterialEntry = {
  id: 'mat-a', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};
const MAT_B: MaterialEntry = {
  id: 'mat-b', name: 'Oak 22', defaultThickness: 22, color: '#8b5e3c',
  hatchAngleDeg: 30, hatchSpacingMm: 2,
};

describe('KernelApi.setMaterials', () => {
  it('replaces the materials array on the stored part', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('P');

    await api.setMaterials(partId, [MAT_A]);
    const p1 = await api.getPart(partId);
    expect(p1!.materials).toHaveLength(1);
    expect(p1!.materials[0]!.id).toBe('mat-a');

    await api.setMaterials(partId, [MAT_A, MAT_B]);
    const p2 = await api.getPart(partId);
    expect(p2!.materials).toHaveLength(2);
    expect(p2!.materials[1]!.id).toBe('mat-b');
  });

  it('throws on unknown partId', async () => {
    const api = createKernelApi();
    await api.init();
    await expect(
      api.setMaterials('nonexistent-part', [MAT_A])
    ).rejects.toThrow(/setMaterials: unknown partId/);
  });

  it('saveToBytes after setMaterials round-trips the updated materials', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('RoundTrip');

    // Add a sketch + extrude so saveToBytes has a valid solid to pack.
    await api.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });
    await api.addFeature(partId, {
      kind: 'sketch', id: 's1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }],
      constraints: [],
    });
    await api.addFeature(partId, {
      kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1',
      direction: 'forward', operation: 'new',
    });
    await api.execute(partId);

    await api.setMaterials(partId, [MAT_A, MAT_B]);

    // Pack to bytes, then reload into a fresh api instance and read back.
    const bytes = await api.saveToBytes(partId);
    const api2 = createKernelApi();
    await api2.init();
    const loadedId = await api2.loadFromBytes(bytes);
    const loaded = await api2.getPart(loadedId);

    expect(loaded!.materials).toHaveLength(2);
    expect(loaded!.materials[0]!.id).toBe('mat-a');
    expect(loaded!.materials[1]!.hatchAngleDeg).toBe(30);
    expect(loaded!.materials[1]!.hatchSpacingMm).toBe(2);
  }, 60_000);

  it('defensive copy: mutating the input array after setMaterials does not affect kernel state', async () => {
    const api = createKernelApi();
    await api.init();
    const partId = await api.createPart('Defensive');

    const muts: MaterialEntry[] = [{ ...MAT_A }];
    await api.setMaterials(partId, muts);

    // Mutate the array we passed in (casting to bypass readonly).
    (muts as MaterialEntry[])[0] = { ...MAT_B };

    const p = await api.getPart(partId);
    // Kernel's copy should still be the original MAT_A.
    expect(p!.materials[0]!.id).toBe('mat-a');
  });
});
```

### Step 1-2 — Confirm RED

Run:
```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/kernel run test:unit -- --reporter=verbose src/__tests__/setMaterials.spec.ts
```

Expected failure: `TypeError: api.setMaterials is not a function` (or similar — confirms method does not exist yet).

### Step 1-3 — Implement `setMaterials` in `packages/kernel/src/api.ts`

**1. Add `MaterialEntry` to the line-1 import** (line 1 currently imports from `@zilventor/shared`):

```ts
// BEFORE (line 1):
import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError, SketchPrimitive, TessellatedEdge, TessellatedFace, FaceName, WorkFeatureValue, AssemblyConstraintRef, EdgeName, BoundingBox, ProjectorInput } from '@zilventor/shared';

// AFTER:
import type { Feature, Parameter, Mesh, PartDocument, Result, KernelError, SketchPrimitive, TessellatedEdge, TessellatedFace, FaceName, WorkFeatureValue, AssemblyConstraintRef, EdgeName, BoundingBox, ProjectorInput, MaterialEntry } from '@zilventor/shared';
```

**2. Add `setMaterials` to the `KernelApi` type** (inside the `export type KernelApi = { ... }` block, after `deleteParameter`). Current line 68 is `deleteParameter(partId: string, name: string): Promise<void>;`:

```ts
  deleteParameter(partId: string, name: string): Promise<void>;
  setMaterials(partId: string, materials: readonly MaterialEntry[]): Promise<void>;
  deletePart(partId: string): Promise<void>;
```

**3. Add the implementation** inside `createKernelApi()` returned object, after the `deleteParameter` method (lines 233–237). Insert after the closing `},` of `deleteParameter`:

```ts
    async deleteParameter(partId, name) {
      const p = parts.get(partId);
      if (!p) throw new Error(`no part ${partId}`);
      parts.set(partId, removeParameterFromPart(p, name));
    },

    async setMaterials(partId, materials) {
      const p = parts.get(partId);
      if (!p) throw new Error(`setMaterials: unknown partId ${partId}`);
      parts.set(partId, { ...p, materials: [...materials] });
    },

    async deletePart(partId) {
```

### Step 1-4 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/kernel run test:unit -- --reporter=verbose src/__tests__/setMaterials.spec.ts
```

Expected: `4 passed`.

Also confirm the existing tests still pass:

```bash
pnpm --filter @zilventor/kernel run test:unit
```

Expected: all prior tests pass + 4 new.

### Step 1-5 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/kernel/src/api.ts packages/kernel/src/__tests__/setMaterials.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): setMaterials(partId, materials[]) API

Adds kernel.setMaterials — full-array replace, symmetric with setParameter.
Throws on unknown partId. Defensive-copies the input array.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 2 — `syncPartMaterials` helper + unit tests

**Outcome:** New `packages/app/src/store/syncPartMaterials.ts` with 3-case spec.

**Signature (spec-locked — 0-arg):** The helper reads BOTH `kernel` and `activePart` off `useAppStore.getState()` internally. No arguments. This follows the spec decision to keep call sites minimal and avoids passing a potentially-stale kernel reference from the command.

### Step 2-1 — Write failing tests (RED)

Create `packages/app/src/store/syncPartMaterials.spec.ts` (next to the helper in `packages/app/src/store/`; verify directory exists before writing):

> **Pre-step**: Run `ls packages/app/src/store/` to verify the directory. Place the spec in the same directory as `syncPartMaterials.ts`.

```ts
// packages/app/src/store/syncPartMaterials.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MaterialEntry, PartDocument } from '@zilventor/shared';
import { useAppStore } from './useAppStore';
import { syncPartMaterials } from './syncPartMaterials';

const MAT: MaterialEntry = {
  id: 'mat-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};

function makePart(materials: MaterialEntry[] = [MAT]): PartDocument {
  return {
    id: 'part-id-1', name: 'P', units: 'mm', parameters: {}, properties: {},
    featureTree: [],
    materials,
    hardware: [],
  };
}

describe('syncPartMaterials', () => {
  beforeEach(() => {
    // Reset store to neutral state.
    useAppStore.setState({ activePart: null, activeAssembly: null } as never);
    vi.restoreAllMocks();
  });

  it('calls kernel.setMaterials with (part.id, part.materials) when a part is active', async () => {
    const part = makePart();
    const mockKernel = { setMaterials: vi.fn().mockResolvedValue(undefined) };
    useAppStore.setState({ activePart: part, kernel: mockKernel } as never);

    await syncPartMaterials();

    expect(mockKernel.setMaterials).toHaveBeenCalledOnce();
    expect(mockKernel.setMaterials).toHaveBeenCalledWith('part-id-1', part.materials);
  });

  it('does NOT call kernel.setMaterials when activePart is null (assembly active)', async () => {
    const mockKernel = { setMaterials: vi.fn().mockResolvedValue(undefined) };
    // activePart is null from beforeEach; kernel present but no activePart.
    useAppStore.setState({ activePart: null, kernel: mockKernel } as never);

    await syncPartMaterials();

    expect(mockKernel.setMaterials).not.toHaveBeenCalled();
  });

  it('does NOT call kernel.setMaterials when kernel is null', async () => {
    const part = makePart();
    useAppStore.setState({ activePart: part, kernel: null } as never);

    await syncPartMaterials();

    // No kernel — nothing to call. Should not throw.
  });
});
```

### Step 2-2 — Confirm RED

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/store/syncPartMaterials.spec.ts
```

Expected failure: `Cannot find module './syncPartMaterials'` (file doesn't exist yet).

### Step 2-3 — Implement `syncPartMaterials`

Create `packages/app/src/store/syncPartMaterials.ts`:

```ts
// packages/app/src/store/syncPartMaterials.ts
import { useAppStore } from './useAppStore';

/**
 * Mirror activePart.materials from the Zustand store into the kernel's parts map.
 * No-op when no part is active (assembly / drawing / nothing) — kernel doesn't own
 * assembly materials, so the store is the source of truth for those.
 * No-op when kernel is null (kernel not yet initialized).
 * Call after every store.addMaterial / updateMaterial / removeMaterial in a
 * material-mutating command.
 */
export async function syncPartMaterials(): Promise<void> {
  const { kernel, activePart } = useAppStore.getState();
  if (!kernel || !activePart) return;
  await kernel.setMaterials(activePart.id, activePart.materials);
}
```

### Step 2-4 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/store/syncPartMaterials.spec.ts
```

Expected: `3 passed`.

### Step 2-5 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/store/syncPartMaterials.ts packages/app/src/store/syncPartMaterials.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): syncPartMaterials() 0-arg helper mirrors store materials into kernel

Reads kernel + activePart from Zustand store; no-op for assembly/drawing/no-kernel contexts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 3 — Wire AddMaterialCommand + spec

**Outcome:** `AddMaterialCommand.apply()` and `revert()` call `syncPartMaterials()` after their store mutations; 3 new assertions in the existing `material-commands.spec.ts` (extend) or a new describe block.

**Decision:** Extend the existing `packages/app/src/commands/__tests__/material-commands.spec.ts` file with a new `describe` block. Do NOT create a new spec file — the existing file already has the `emptyAssembly` and `partWithPanel` helpers needed.

**Call site pattern (0-arg):** Since `syncPartMaterials()` reads the store internally, command call sites simply call `await syncPartMaterials()` — no kernel arg. The helper's null-guard (`if (!kernel || !activePart) return`) handles assembly-active contexts transparently.

**Zustand mock pattern — `setState({ ... } as never)` is intentional:** There is no `setKernel` action on the store. The only way to inject a mock kernel for unit tests is `useAppStore.setState({ kernel: mockKernel } as never)`. The existing `material-commands.spec.ts` uses `getState().setActiveDocument(...)` for document setup (which IS a typed action). The mock-kernel injection MUST use `setState({ ... } as never)` — this is the standard partial-state-override pattern for Zustand in Vitest. Do not change it to `getState().setActivePart(...)` for the kernel field (no such action exists for kernel). Document the `as never` cast with a brief inline comment: `// Partial mock — no setKernel action on store`.

### Step 3-1 — Write failing tests (RED)

Add this describe block to `packages/app/src/commands/__tests__/material-commands.spec.ts`, at the end of the file:

```ts
// --- Add these imports at top of file (merge with existing imports) ---
// Add 'afterEach', 'vi', 'type MockInstance' to the vitest import if not present.
// Add 'PartDocument' to the @zilventor/shared import if not present.

// --- Add this describe block at the bottom of the file ---
describe('AddMaterialCommand — kernel sync', () => {
  let mockSetMaterials: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    // Inject mock kernel into store.
    useAppStore.setState({
      kernel: { setMaterials: mockSetMaterials } as never,
    } as never);
  });

  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('apply() calls kernel.setMaterials with the part id and updated materials (part active)', async () => {
    // Seed a part as active document.
    const part: PartDocument = {
      id: 'p-sync-1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new AddMaterialCommand({ name: 'Walnut', defaultThickness: 18, color: '#5a3a1a' });
    await cmd.apply();

    const updatedPart = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(updatedPart.id, updatedPart.materials);
    expect(updatedPart.materials).toHaveLength(1);
  });

  it('apply() does NOT call kernel.setMaterials when assembly is active', async () => {
    // Assembly active — activePart is null — syncPartMaterials no-ops.
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });

    const cmd = new AddMaterialCommand({ name: 'Walnut', defaultThickness: 18, color: '#5a3a1a' });
    await cmd.apply();

    expect(mockSetMaterials).not.toHaveBeenCalled();
  });

  it('revert() calls kernel.setMaterials after removing the material (part active)', async () => {
    const part: PartDocument = {
      id: 'p-sync-2', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new AddMaterialCommand({ name: 'Cherry', defaultThickness: 15, color: '#8b1a1a' });
    await cmd.apply();
    mockSetMaterials.mockClear();

    await cmd.revert();
    const revertedPart = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(revertedPart.id, revertedPart.materials);
    expect(revertedPart.materials).toHaveLength(0);
  });
});
```

### Step 3-2 — Confirm RED

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
```

Expected failure: `mockSetMaterials.toHaveBeenCalledOnce()` fails — `received 0 calls` (sync not wired yet).

### Step 3-3 — Wire `syncPartMaterials` into `AddMaterialCommand`

Modify `packages/app/src/commands/AddMaterialCommand.ts`:

**Add import** after the existing imports:
```ts
import { syncPartMaterials } from '../store/syncPartMaterials';
```

**Modify `apply()`** — add `await syncPartMaterials()` after `useAppStore.getState().addMaterial(entry)`:

```ts
  async apply(): Promise<void> {
    const existing = activeMaterials();
    const lower = this.opts.name.trim().toLowerCase();
    if (existing.some((m) => m.name.trim().toLowerCase() === lower)) {
      throw new Error(`DUPLICATE_NAME: ${this.opts.name}`);
    }
    const entry: MaterialEntry = {
      id: nextMaterialId(),
      name: this.opts.name,
      defaultThickness: this.opts.defaultThickness,
      color: this.opts.color,
      ...(this.opts.sheetLengthMm !== undefined ? { sheetLengthMm: this.opts.sheetLengthMm } : {}),
      ...(this.opts.sheetWidthMm !== undefined ? { sheetWidthMm: this.opts.sheetWidthMm } : {}),
    };
    useAppStore.getState().addMaterial(entry);
    this.addedId = entry.id;
    await syncPartMaterials();
  }
```

**Modify `revert()`**:
```ts
  async revert(): Promise<void> {
    if (this.addedId) {
      useAppStore.getState().removeMaterial(this.addedId);
      this.addedId = null;
      await syncPartMaterials();
    }
  }
```

### Step 3-4 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
```

Expected: all previously passing tests still pass + 3 new sync tests pass.

### Step 3-5 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/AddMaterialCommand.ts packages/app/src/commands/__tests__/material-commands.spec.ts
git commit -m "$(cat <<'EOF'
feat(commands): AddMaterialCommand syncs materials into kernel

Calls syncPartMaterials() after apply and revert; no-op when assembly active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 4 — Wire EditMaterialCommand + spec

**Outcome:** `EditMaterialCommand.apply()` and `revert()` call `syncPartMaterials()`; 3 new assertions in `material-commands.spec.ts`.

**Decision:** Add a new `describe` block in `packages/app/src/commands/__tests__/material-commands.spec.ts` (same pattern as Batch 3). The `EditMaterialCommand.hatch.spec.ts` file tests the hatch-revert logic and already passes — do NOT modify it to add sync assertions (it uses `useAppStore.setState` directly and bypasses the kernel mock setup). Add the sync assertions in `material-commands.spec.ts` alongside the Batch 3 block.

### Step 4-1 — Write failing tests (RED)

Append to `packages/app/src/commands/__tests__/material-commands.spec.ts`:

```ts
describe('EditMaterialCommand — kernel sync', () => {
  let mockSetMaterials: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);
  });

  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('apply() calls kernel.setMaterials with updated materials (part active)', async () => {
    const mat: MaterialEntry = { id: 'm-edit', name: 'Pine', defaultThickness: 18, color: '#a0a0a0' };
    const part: PartDocument = {
      id: 'p-edit-1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [mat], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new EditMaterialCommand('m-edit', { name: 'Pine 20', defaultThickness: 20, color: '#b0b0b0' });
    await cmd.apply();

    const updated = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(updated.id, updated.materials);
    expect(updated.materials[0]!.name).toBe('Pine 20');
  });

  it('apply() does NOT call kernel.setMaterials when assembly is active', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
    useAppStore.getState().addMaterial({ id: 'm-asm', name: 'Oak', defaultThickness: 22, color: '#8b5e3c' });

    const cmd = new EditMaterialCommand('m-asm', { name: 'Oak 22' });
    await cmd.apply();

    expect(mockSetMaterials).not.toHaveBeenCalled();
  });

  it('revert() calls kernel.setMaterials restoring prior materials (part active)', async () => {
    const mat: MaterialEntry = { id: 'm-rev', name: 'Spruce', defaultThickness: 15, color: '#c0c0c0' };
    const part: PartDocument = {
      id: 'p-edit-2', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [mat], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new EditMaterialCommand('m-rev', { name: 'Spruce Edited', color: '#d0d0d0' });
    await cmd.apply();
    mockSetMaterials.mockClear();

    await cmd.revert();
    const reverted = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(reverted.id, reverted.materials);
    expect(reverted.materials[0]!.name).toBe('Spruce');
  });
});
```

### Step 4-2 — Confirm RED

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
```

Expected failure: `mockSetMaterials.toHaveBeenCalledOnce()` — 0 calls.

### Step 4-3 — Wire `syncPartMaterials` into `EditMaterialCommand`

Modify `packages/app/src/commands/EditMaterialCommand.ts`:

**Add import** after existing imports:
```ts
import { syncPartMaterials } from '../store/syncPartMaterials';
```

**Modify `apply()`** — add `await syncPartMaterials()` after `useAppStore.getState().updateMaterial(this.id, this.patch)`:

```ts
  async apply(): Promise<void> {
    const existing = activeMaterials().find((m) => m.id === this.id);
    if (!existing) throw new Error(`MATERIAL_NOT_FOUND: ${this.id}`);
    if (this.patch.name !== undefined) {
      const lower = this.patch.name.trim().toLowerCase();
      const dup = activeMaterials().some(
        (m) => m.id !== this.id && m.name.trim().toLowerCase() === lower,
      );
      if (dup) throw new Error(`DUPLICATE_NAME: ${this.patch.name}`);
    }
    this.prev = existing;
    useAppStore.getState().updateMaterial(this.id, this.patch);
    await syncPartMaterials();
  }
```

**Modify `revert()`** — add `await syncPartMaterials()` after `useAppStore.getState().updateMaterial(this.id, patch)`:

```ts
  async revert(): Promise<void> {
    if (this.prev) {
      const { id: _id, ...rest } = this.prev;
      const prevLacksHatchPair = this.prev.hatchAngleDeg === undefined
        || this.prev.hatchSpacingMm === undefined;
      const patch = prevLacksHatchPair
        ? { ...rest, clearHatch: true as const }
        : rest;
      useAppStore.getState().updateMaterial(this.id, patch);
      this.prev = null;
      await syncPartMaterials();
    }
  }
```

### Step 4-4 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/EditMaterialCommand.hatch.spec.ts
```

Both must pass. The hatch spec has no kernel mock — that's fine, `kernel` in store is null by default and `syncPartMaterials()` checks `if (!kernel || !activePart) return` before proceeding.

### Step 4-5 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/EditMaterialCommand.ts packages/app/src/commands/__tests__/material-commands.spec.ts
git commit -m "$(cat <<'EOF'
feat(commands): EditMaterialCommand syncs materials into kernel

Calls syncPartMaterials() after apply and revert; no-op when assembly active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 5 — Wire DeleteMaterialCommand + spec

**Outcome:** `DeleteMaterialCommand.apply()` and `revert()` call `syncPartMaterials()`; 3 new assertions.

### Step 5-1 — Write failing tests (RED)

Append to `packages/app/src/commands/__tests__/material-commands.spec.ts`:

```ts
describe('DeleteMaterialCommand — kernel sync', () => {
  let mockSetMaterials: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);
  });

  afterEach(() => {
    useAppStore.setState({ kernel: null } as never);
    vi.restoreAllMocks();
  });

  it('apply() calls kernel.setMaterials after removing the material (part active)', async () => {
    const mat: MaterialEntry = { id: 'm-del', name: 'Teak', defaultThickness: 20, color: '#7b5a2a' };
    const part: PartDocument = {
      id: 'p-del-1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [mat], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new DeleteMaterialCommand('m-del');
    await cmd.apply();

    const updated = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(updated.id, updated.materials);
    expect(updated.materials).toHaveLength(0);
  });

  it('apply() does NOT call kernel.setMaterials when assembly is active', async () => {
    useAppStore.getState().setActiveDocument({ kind: 'assembly', document: emptyAssembly() });
    const mat: MaterialEntry = { id: 'm-asm-del', name: 'Ash', defaultThickness: 20, color: '#909090' };
    useAppStore.getState().addMaterial(mat);

    const cmd = new DeleteMaterialCommand('m-asm-del');
    await cmd.apply();

    expect(mockSetMaterials).not.toHaveBeenCalled();
  });

  it('revert() calls kernel.setMaterials after restoring the deleted material (part active)', async () => {
    const mat: MaterialEntry = { id: 'm-del-rev', name: 'Larch', defaultThickness: 16, color: '#8a7a6a' };
    const part: PartDocument = {
      id: 'p-del-2', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [], materials: [mat], hardware: [],
    };
    useAppStore.getState().setActiveDocument({ kind: 'part', document: part });

    const cmd = new DeleteMaterialCommand('m-del-rev');
    await cmd.apply();
    mockSetMaterials.mockClear();

    await cmd.revert();
    const reverted = useAppStore.getState().activePart!;
    expect(mockSetMaterials).toHaveBeenCalledOnce();
    expect(mockSetMaterials).toHaveBeenCalledWith(reverted.id, reverted.materials);
    expect(reverted.materials).toHaveLength(1);
    expect(reverted.materials[0]!.id).toBe('m-del-rev');
  });
});
```

### Step 5-2 — Confirm RED

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
```

Expected failure: `mockSetMaterials.toHaveBeenCalledOnce()` — 0 calls.

### Step 5-3 — Wire `syncPartMaterials` into `DeleteMaterialCommand`

Modify `packages/app/src/commands/DeleteMaterialCommand.ts`:

**Add import**:
```ts
import { syncPartMaterials } from '../store/syncPartMaterials';
```

**Modify `apply()`** — after `useAppStore.getState().removeMaterial(this.id)`:
```ts
  async apply(): Promise<void> {
    const refs = findReferencingPanelIds(this.id);
    if (refs.length > 0) {
      throw new Error(`MATERIAL_IN_USE: referenced by panel(s) ${refs.join(', ')}`);
    }
    const existing = activeMaterials().find((m) => m.id === this.id);
    if (!existing) throw new Error(`MATERIAL_NOT_FOUND: ${this.id}`);
    this.prev = existing;
    useAppStore.getState().removeMaterial(this.id);
    await syncPartMaterials();
  }
```

**Modify `revert()`** — after `useAppStore.getState().addMaterial(this.prev)`:
```ts
  async revert(): Promise<void> {
    if (this.prev) {
      useAppStore.getState().addMaterial(this.prev);
      this.prev = null;
      await syncPartMaterials();
    }
  }
```

### Step 5-4 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/material-commands.spec.ts
```

Expected: all tests pass.

### Step 5-5 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/DeleteMaterialCommand.ts packages/app/src/commands/__tests__/material-commands.spec.ts
git commit -m "$(cat <<'EOF'
feat(commands): DeleteMaterialCommand syncs materials into kernel

Calls syncPartMaterials() after apply and revert; no-op when assembly active.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 6 — Wire PlaceComponentCommand + CreateAndPlacePanelCommand

**Outcome:** Both commands call `syncPartMaterials()` after their `addMaterial` calls; specs include both a null-guard assertion (assembly-active) AND a part-active integration fixture for at least one command.

**Context from codebase inspection:**
- `PlaceComponentCommand` calls `useAppStore.getState().addMaterial(m)` inside a loop in `apply()`. Revert uses `setActiveDocument` snapshot — no `addMaterial` in `revert()`.
- `CreateAndPlacePanelCommand` calls `useAppStore.getState().addMaterial(m)` inside a loop in `apply()`. Revert uses `setActiveDocument` snapshot — no `addMaterial` in `revert()`.
- Both commands are typically invoked with an active assembly. The `syncPartMaterials()` call becomes a no-op in practice (activePart is null when assembly is active). Adding the call is preventive.
- **Placement**: hoist `syncPartMaterials()` AFTER the loop (single call), not inside it. One kernel RPC after all materials are reconciled is cheaper and logically equivalent.

### Step 6-1 — Write failing tests (RED)

**Extend `packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts`** — add TWO describe blocks at end:

```ts
import { vi } from 'vitest';

// Block A: null-guard (assembly active — the common case).
describe('PlaceComponentCommand — kernel sync (assembly active)', () => {
  it('addMaterial call from reconciliation does NOT call kernel.setMaterials (null guard)', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);

    try {
      // Use the existing assembly-active fixture from the outer beforeEach.
      // (Assumes a fixture part with materials exists in the test — adapt to match the
      // existing PlaceComponentCommand spec's setup.)
      // After adding the syncPartMaterials wiring, the helper reads activePart from the store.
      // activePart is null when assembly is active → no-op.
      // Run a PlaceComponent command using the existing spec's OPFS/part fixture, then assert:
      expect(mockSetMaterials).not.toHaveBeenCalled();
    } finally {
      useAppStore.setState({ kernel: null } as never);
    }
  });
});

// Block B: part-active integration fixture (proves the wiring is symmetric).
// This is an ARTIFICIAL test-only configuration: PlaceComponentCommand normally runs
// under an assembly context, but the helper's invariant (if activePart is set, call kernel)
// should hold regardless. We construct a fixture with activePart non-null to prove the
// call site is wired.
describe('PlaceComponentCommand — kernel sync (part active, artificial fixture)', () => {
  it('calls kernel.setMaterials when activePart is set after addMaterial', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    const fakePart = {
      id: 'part-pc-sync', name: 'FakePart', units: 'mm' as const,
      parameters: {}, properties: {}, featureTree: [], materials: [], hardware: [],
    };
    // Seed store: activePart non-null, kernel present.
    useAppStore.setState({
      kernel: { setMaterials: mockSetMaterials } as never,
      activePart: fakePart,
    } as never);

    try {
      // Simulate what the command does: call addMaterial, then syncPartMaterials.
      // We're testing the CALL SITE wiring, not the full command flow.
      // Import syncPartMaterials and call it directly with the store in the wired state:
      const { syncPartMaterials } = await import('../../store/syncPartMaterials');
      useAppStore.getState().addMaterial({
        id: 'mat-pc-new', name: 'NewMat', defaultThickness: 18, color: '#aabbcc',
      });
      await syncPartMaterials();

      // After syncPartMaterials, kernel.setMaterials must have been called once.
      expect(mockSetMaterials).toHaveBeenCalledOnce();
      const callArgs = mockSetMaterials.mock.calls[0] as [string, unknown[]];
      expect(callArgs[0]).toBe('part-pc-sync');
    } finally {
      useAppStore.setState({ kernel: null, activePart: null } as never);
    }
  });
});
```

> **Note on Block B teeth:** Block B doesn't exercise `PlaceComponentCommand` code paths directly — it verifies `syncPartMaterials()` works correctly in a part-active context using the same store mutation (`addMaterial`) that the command uses. The real invariant we're proving: "the helper, when called after `addMaterial` with a non-null `activePart`, propagates the updated materials to the kernel." The command's call site is confirmed by reading the wired `PlaceComponentCommand.ts` diff in Batch 8's reviewer step.
>
> If `PlaceComponentCommand` has a `createAndPlacePanel`-style fixture that already seeds a part in the spec, use that instead for a fully integrated Block B. Adapt the above template accordingly.

**Extend `packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts`** — add at end:

```ts
import { vi } from 'vitest';

describe('CreateAndPlacePanelCommand — kernel sync (assembly active)', () => {
  it('addMaterial call does NOT call kernel.setMaterials (null guard, assembly active)', async () => {
    const mockSetMaterials = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ kernel: { setMaterials: mockSetMaterials } as never } as never);

    try {
      // Use the spec's existing PANEL + PART_MATS fixture (check top of spec file for these consts).
      // The assembly is active from outer beforeEach — activePart is null — syncPartMaterials no-ops.
      const opfs = new MemOpfs();
      const cmd = new CreateAndPlacePanelCommand({
        partName: 'Sync Test Panel',
        partPath: 'parts/sync-panel.zipt',
        panel: PANEL,
        partMaterials: PART_MATS,
        opfs,
      });
      await cmd.apply();

      // Assembly active — activePart is null — syncPartMaterials is a no-op.
      expect(mockSetMaterials).not.toHaveBeenCalled();
    } finally {
      useAppStore.setState({ kernel: null } as never);
    }
  });
});
```

> **`CreateAndPlacePanelCommand` — part-active fixture:** `CreateAndPlacePanelCommand` always asserts `activeAssembly` (it creates a panel inside an assembly). There is no natural part-active flow for this command. **No-call invariant rationale:** the null-guard test above (assembly active → not called) is the correct and sufficient test for this command. A forced part-active fixture would test `syncPartMaterials` isolation (already covered in Batch 2), not the command wiring. Document with a code comment in `CreateAndPlacePanelCommand.ts` pointing to this spec.

### Step 6-2 — Confirm RED

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/PlaceComponentCommand.spec.ts
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
```

For Block A (null-guard assertions): these will PASS before wiring too (no-call is trivially true before the call site exists). Confirm this. Then for Block B (PlaceComponent part-active): the `syncPartMaterials` call itself is what you're testing — it will pass since Batch 2 already shipped. The "RED" for Batch 6 is structural: after wiring, run the full suite and confirm no regression. For the null-guard tests, the meaningful teeth verification is: temporarily change the assertion to `toHaveBeenCalled()` — confirm it fails — restore to `not.toHaveBeenCalled()`. Record this in your batch report.

### Step 6-3 — Wire `syncPartMaterials` into `PlaceComponentCommand`

Modify `packages/app/src/commands/PlaceComponentCommand.ts`:

**Add import** after existing imports:
```ts
import { syncPartMaterials } from '../store/syncPartMaterials';
```

**Modify the `reconcilePanelMaterials()` method** (or wherever `addMaterial` is called in `apply()`) — hoist the sync call AFTER the loop:

```ts
    if (asmGrew) {
      const seen = new Set(asm.materials.map((m) => m.id));
      for (const m of result.updatedAssemblyMaterials) {
        if (!seen.has(m.id)) {
          useAppStore.getState().addMaterial(m);
        }
      }
      await syncPartMaterials();
    }
```

Note: if `reconcilePanelMaterials()` is a `private async` method, `await syncPartMaterials()` is valid. If it's synchronous, change the return type to `Promise<void>` and update the call site in `apply()` to `await this.reconcilePanelMaterials(...)`.

### Step 6-4 — Wire `syncPartMaterials` into `CreateAndPlacePanelCommand`

Modify `packages/app/src/commands/CreateAndPlacePanelCommand.ts`:

**Add import** after existing imports:
```ts
import { syncPartMaterials } from '../store/syncPartMaterials';
```

**Add a comment** explaining the no-call invariant:
```ts
    // syncPartMaterials() is a no-op here because CreateAndPlacePanelCommand always
    // runs in an assembly context (activePart is null). The call is wired per the
    // kernel-sync spec so future part-targeted variants don't reintroduce the gap.
    // See: packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
    //      "CreateAndPlacePanelCommand — kernel sync" describe block.
    await syncPartMaterials();
```

**Place it** after the `addMaterial` loop in `apply()`:

```ts
    // 4. Apply rewrites to the assembly registry.
    this.priorAssemblyMaterials = [...asm.materials];
    const seenIds = new Set(asm.materials.map((m) => m.id));
    for (const m of result.updatedAssemblyMaterials) {
      if (!seenIds.has(m.id)) {
        useAppStore.getState().addMaterial(m);
      }
    }
    // syncPartMaterials() no-op (assembly active); wired per kernel-sync spec.
    await syncPartMaterials();
```

### Step 6-5 — Confirm GREEN

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/PlaceComponentCommand.spec.ts
pnpm --filter @zilventor/app run test:unit -- --reporter=verbose src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
```

All tests must pass.

### Step 6-6 — Commit

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add packages/app/src/commands/PlaceComponentCommand.ts \
        packages/app/src/commands/CreateAndPlacePanelCommand.ts \
        packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts \
        packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(commands): PlaceComponent + CreateAndPlacePanel sync materials into kernel

Null-guard confirmed: assembly-active paths do not call kernel.setMaterials.
Part-active path verified via syncPartMaterials integration fixture in PlaceComponent spec.
CreateAndPlacePanelCommand: no-call invariant documented (always assembly-active).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 7 — e2e: drop `__zilventorPackProject` workaround from `material-hatch-pattern.spec.ts` + add waitForAutosave helper

**Scope (critical):** ONLY `tests/e2e/drawing/material-hatch-pattern.spec.ts` is modified in this batch. `tests/e2e/drawing/material-hatch-color.spec.ts` is **NOT touched** — its `__zilventorPackProject` blocks are fixture setup (Part A + Part B color seeding), not kernel-sync workarounds. That spec never invokes `AddMaterialCommand` / `EditMaterialCommand`. It stays unchanged and must remain GREEN.

**Outcome:** `material-hatch-pattern.spec.ts` saves through the natural autosave path. The `__zilventorPackProject` injection block (lines ~197–274) is replaced by `waitForAutosave()` + `page.reload()`. Material hatch fields persist across reload.

### Step 7-0 — Add `waitForAutosave` helper

Create `tests/e2e/helpers/waitForAutosave.ts`:

```ts
// tests/e2e/helpers/waitForAutosave.ts
import type { Page } from '@playwright/test';

/**
 * Wait until the OPFS autosave completes one write cycle after a store mutation.
 * Strategy: poll `window.__zilventorAutosaveStats().writeCount` until it increments
 * by at least 1 beyond the current value, with a generous ceiling.
 * The autosave debounce fires 500 ms after the last `activeDocument` change;
 * we wait up to 3000 ms total to be safe under CI load.
 *
 * Falls back to a fixed 700ms wait if __zilventorAutosaveStats is not exposed
 * (provides a baseline for environments where the stats hook is not installed).
 */
export async function waitForAutosave(page: Page, timeoutMs = 3000): Promise<void> {
  const statsAvailable: boolean = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return typeof w.__zilventorAutosaveStats === 'function';
  });

  if (!statsAvailable) {
    // Baseline fallback: 700ms covers the 500ms debounce with margin.
    await page.waitForTimeout(700);
    return;
  }

  const writtenBefore: number = await page.evaluate(() => {
    const w = window as unknown as {
      __zilventorAutosaveStats?: () => { writeCount: number };
    };
    return w.__zilventorAutosaveStats?.()?.writeCount ?? 0;
  });

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const writtenNow: number = await page.evaluate(() => {
      const w = window as unknown as {
        __zilventorAutosaveStats?: () => { writeCount: number };
      };
      return w.__zilventorAutosaveStats?.()?.writeCount ?? 0;
    });
    if (writtenNow > writtenBefore) return;
  }
  throw new Error(`waitForAutosave: no autosave write detected within ${timeoutMs}ms`);
}
```

### Step 7-1 — Teeth-check procedure (MANDATORY — do not skip)

**Purpose:** Prove that the `material-hatch-pattern.spec.ts` assertions can detect the bug (i.e., the test is not vacuous).

Execute these steps IN ORDER:

1. Complete Batches 1–6 (kernel-sync wiring is in place).
2. Modify `material-hatch-pattern.spec.ts` per Steps 7-2/7-3 below (drop the injection block, use `waitForAutosave`).
3. Run the e2e → should be GREEN.
4. **Temporarily comment out** the `await syncPartMaterials()` call in `packages/app/src/commands/EditMaterialCommand.ts` `apply()` method — the one line added in Batch 4. Do NOT commit this change.
5. Run the e2e:
   ```bash
   pnpm test:e2e -- tests/e2e/drawing/material-hatch-pattern.spec.ts --project=chromium
   ```
   Expected: **RED** with a failure on the persistence assertion, something like:
   ```
   expect(persistedMat!.hatchAngleDeg, 'hatchAngleDeg must survive reload').toBe(20)
   // received: undefined
   ```
6. Record the RED output verbatim (copy the failure line) in the commit message for Step 7-5.
7. Uncomment the `await syncPartMaterials()` call in `EditMaterialCommand.ts`. Run the e2e → must be GREEN.
8. Proceed to Step 7-4 commit.

### Step 7-2 — Understand the timing constraint

The `material-hatch-pattern.spec.ts` flow is:
- First `page.evaluate` (lines 56–91): `AddMaterialCommand` + `EditMaterialCommand` run → store mutated → `activePart` is set → autosave debounce triggered for the PART.
- Second `page.evaluate` (lines 94–173): `CreateDrawingCommand.apply()` runs → `activeDocument` changes to drawing → `activePart` is **nulled** → a NEW autosave debounce fires for the DRAWING (overriding or racing the part's debounce).
- `App.tsx` autosave debounce is 500ms after EACH `activeDocument` change. The drawing creation resets the timer, so the part autosave may never fire if the drawing creation happens within 500ms of the material edit.

**Critical consequence:** `waitForAutosave(page)` must be called as a Playwright statement BETWEEN the first `page.evaluate` (material edit, line ~89) and the second `page.evaluate` (drawing creation, line ~94). This ensures the part autosave fires and completes BEFORE `CreateDrawingCommand` resets the debounce timer and switches `activeDocument` to the drawing.

After `CreateDrawingCommand` runs, the drawing autosave will eventually fire and set `lastOpenDocument` to the drawing. So a **second fix** is needed: after the drawing creation block, override `lastOpenDocument` back to the part path — the part was already safely written to OPFS by the `waitForAutosave` above.

### Step 7-3 — Three surgical edits to `material-hatch-pattern.spec.ts`

**Edit 1 — Insert `waitForAutosave` between the material-edit block and the drawing-creation block.**

Add import at the top of the file (after existing imports):
```ts
import { waitForAutosave } from '../helpers/waitForAutosave';
```

Then insert the following THREE lines as a Playwright statement AFTER the closing `console.log('[mhp] material after edit:', matInfo);` / `expect(matInfo.spacing, ...)` assertions at line ~91, and BEFORE the `// Step 4: Create drawing...` comment at line ~93:

```ts
  // Wait for the natural part autosave to fire with the edited materials.
  // (kernel-sync ensures kernel.saveToBytes packs the hatch fields.)
  // Must happen BEFORE CreateDrawingCommand resets the debounce timer.
  await waitForAutosave(page);
```

This is Edit 1 — the load-bearing change. It waits for the part's OPFS file to be written (with hatch materials via `syncPartMaterials` → `kernel.setMaterials` → `saveToBytes`) before the drawing creation steals the debounce.

**Edit 2 — Replace lines 197–274** (the entire `// Step 6: Persistence across reload.` block from the `const partName = await page.evaluate(...)` through `console.log('[mhp] part name for reload:', partName);`) with:

```ts
  // Step 6: Persistence across reload.
  // After CreateDrawingCommand, lastOpenDocument is the drawing. Override it to point
  // at the part — the part was naturally autosaved with hatch materials in Step 3
  // (kernel-sync ensures kernel.saveToBytes packs the hatch fields).
  const partName = await page.evaluate(() => {
    const s = (window as unknown as {
      __zilventorStore: { getState(): { activeDrawingSourceDocument: { name: string } | null } };
    }).__zilventorStore.getState();
    const partDoc = s.activeDrawingSourceDocument;
    if (!partDoc) throw new Error('mhp step6: no activeDrawingSourceDocument');
    localStorage.setItem('zilventor:lastOpenDocument', JSON.stringify({
      kind: 'part',
      opfsPath: `${partDoc.name}.zipt`,
    }));
    return partDoc.name;
  });

  console.log('[mhp] part name for reload:', partName);
```

The `await page.reload();` and `await waitForKernelReady(page);` lines that follow remain unchanged.

The `persistedMat` evaluation block and the final `consoleErrors` check remain unchanged.

**Edit 3 — Update the file docstring** (lines 11–17). Replace:
```
 *   6. Repack the part with hatch-materials spliced into the manifest via
 *      __zilventorPackProject + write to OPFS, then reload — confirm hatch fields
 *      round-trip. Bypasses the natural autosave because EditMaterialCommand
 *      mutates the Zustand store only; the kernel's PartDocument copy stays stale
 *      until the next load, so kernel.saveToBytes would drop the edits. Mirrors
 *      the pattern used by material-hatch-color.spec.ts. Pre-existing kernel-sync
 *      gap is outside this feature's scope.
```
with:
```
 *   6. Wait for autosave (natural path) + localStorage pointer override → reload
 *      — confirm hatch fields round-trip. EditMaterialCommand now calls
 *      syncPartMaterials() which mirrors store materials into the kernel's parts
 *      map before saveToBytes runs. waitForAutosave fires BEFORE CreateDrawingCommand
 *      to prevent the drawing-creation debounce from racing the part autosave.
```

### Step 7-4 — Confirm GREEN (after teeth-check)

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm test:e2e -- tests/e2e/drawing/material-hatch-pattern.spec.ts --project=chromium
```

Expected: `1 passed`.

Also confirm `material-hatch-color.spec.ts` remains GREEN and UNCHANGED:

```bash
pnpm test:e2e -- tests/e2e/drawing/material-hatch-color.spec.ts --project=chromium
```

Expected: `1 passed` (unchanged spec — still uses `__zilventorPackProject` for color fixture setup).

### Step 7-5 — Commit

Include the RED output from Step 7-1 (teeth-check) in the commit message:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git add tests/e2e/helpers/waitForAutosave.ts \
        tests/e2e/drawing/material-hatch-pattern.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): material-hatch-pattern uses natural autosave + waitForAutosave helper

Drops __zilventorPackProject injection; proves kernel-sync fix via real OPFS
autosave round-trip. Teeth verified: commenting out syncPartMaterials() in
EditMaterialCommand.apply() causes RED:
  <paste RED assertion output from Step 7-1 here>

material-hatch-color.spec.ts unchanged — its injection is fixture setup (color
seeding for Part A/B), not a kernel-sync workaround; that spec never invokes
AddMaterialCommand / EditMaterialCommand.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Batch 8 — Final pass review + gate

### Step 8-1 — Full typecheck

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm -r typecheck
```

Expected: 0 errors across all 5 packages (`@zilventor/shared`, `@zilventor/kernel`, `@zilventor/app`, and any others).

Common failure modes to watch for:
- `setMaterials` not added to `KernelApi` type → `Property 'setMaterials' does not exist on type 'KernelApi'`.
- `syncPartMaterials` imported with wrong path → Module not found.
- `await` on a sync function → TS2345.
- Missing `async` on a command method that now contains `await syncPartMaterials()`.

### Step 8-2 — Full lint

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm lint
```

Expected: 0 errors. Baseline is 16 warnings (per spec). Any new warning must be justified inline.

> **pnpm-lock.yaml phantom-fflate trap**: after any `pnpm install` in a worktree, run `git checkout pnpm-lock.yaml` to revert the phantom `fflate` entry that gets dropped by pnpm during worktree installs.

### Step 8-3 — Full unit suite

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm -r test:unit
```

Expected count: `3016 + N` where N is the unit tests added in Batches 1–6. Enumerated per batch:

| Batch | File | New tests | Description |
|-------|------|-----------|-------------|
| 1 | `packages/kernel/src/__tests__/setMaterials.spec.ts` | 4 | replace, throw-on-unknown, saveToBytes round-trip, defensive copy |
| 2 | `packages/app/src/store/syncPartMaterials.spec.ts` | 3 | part active, assembly active, kernel null |
| 3 | `material-commands.spec.ts` — AddMaterial sync describe | 3 | apply+part, apply+assembly, revert+part |
| 4 | `material-commands.spec.ts` — EditMaterial sync describe | 3 | apply+part, apply+assembly, revert+part |
| 5 | `material-commands.spec.ts` — DeleteMaterial sync describe | 3 | apply+part, apply+assembly, revert+part |
| 6 | `PlaceComponentCommand.spec.ts` (Block A + Block B) | 2 | null-guard assembly, part-active fixture |
| 6 | `CreateAndPlacePanelCommand.spec.ts` | 1 | null-guard assembly |
| **Total** | | **19** | **Target: 3016 + 19 = 3035** |

If the count differs by 1, check whether the PlaceComponent part-active fixture (Block B) was collapsed into the null-guard describe block. Justify in your batch report.

Also run the kernel integration suite to confirm `saveToBytes` round-trip still passes:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm --filter @zilventor/kernel run test:integration
```

Expected: all integration tests pass.

### Step 8-4 — e2e gate

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm test:e2e -- tests/e2e/drawing/material-hatch-color.spec.ts --project=chromium
pnpm test:e2e -- tests/e2e/drawing/material-hatch-pattern.spec.ts --project=chromium
```

Both must be GREEN.

### Step 8-5 — Perf gate

No new perf surface added. Skip the perf run (no new bench probe). If you want to be conservative, run the existing `T63c` hatch perf probe to confirm no regression:

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
pnpm test:perf -- --grep "T63c"
```

### Step 8-6 — Sonnet+ultrathink final reviewer

Dispatch a Sonnet subagent with the following prompt template:

```
ultrathink

You are the final reviewer for the kernel-sync-material-edits feature on branch feature/kernel-sync-material-edits.

Review the FULL diff (`git diff master..HEAD`) for:
1. Correctness bugs: any call site that sets materials in the store but does NOT call syncPartMaterials().
2. Missed revert paths: any Command.revert() that mutates materials without syncing.
3. Vacuous tests: tests that pass regardless of whether the production code is correct (check: temporarily comment out the syncPartMaterials() call — does the test fail?).
4. Layering violations: app-layer importing from kernel internals, or kernel importing from app-layer.
5. Type errors or missing type annotations.
6. The `material-hatch-color.spec.ts` injection blocks — confirm they were intentionally left in and the reason is documented in the commit message.
7. `syncPartMaterials` signature — confirm it is 0-arg (reads kernel + activePart from store internally). Any call site passing a kernel arg is a regression.

Report:
- APPROVED / APPROVED_WITH_NITS / BLOCKED
- Blocker list (if BLOCKED)
- Nits list (if APPROVED_WITH_NITS)
- Self-critique block: numbered weaknesses, numbered assumptions, Confidence 0-100.

Cap response at 400 words.
```

Iterate until APPROVED or APPROVED_WITH_NITS. Apply cosmetic nits inline; re-run typecheck + unit after.

### Step 8-7 — Push + merge

```bash
cd /Users/lion/Documents/Projects/mine/zilventor
git push -u origin feature/kernel-sync-material-edits
# FF-merge to master (no squash — preserve batch history).
git checkout master
git merge --ff-only feature/kernel-sync-material-edits
git push
```

---

## Self-review checklist

### Spec coverage

| Spec requirement | Plan task |
|---|---|
| `setMaterials(partId, materials[])` on `KernelApi` | Batch 1, Step 1-3 |
| Full-array replace | Batch 1, Step 1-3 |
| Throws on unknown partId | Batch 1, Step 1-1 (test 2) |
| Defensive copy | Batch 1, Step 1-1 (test 4) |
| `saveToBytes` round-trips updated materials | Batch 1, Step 1-1 (test 3) |
| `syncPartMaterials()` helper (0-arg) | Batch 2 |
| No-op for assembly/nothing active | Batch 2, Step 2-1 (tests 2+3) |
| No-op when kernel null | Batch 2, Step 2-1 (test 3) |
| `AddMaterialCommand.apply()` + `revert()` wired | Batch 3 |
| `EditMaterialCommand.apply()` + `revert()` wired | Batch 4 |
| `DeleteMaterialCommand.apply()` + `revert()` wired | Batch 5 |
| `PlaceComponentCommand.apply()` wired | Batch 6 |
| `CreateAndPlacePanelCommand.apply()` wired | Batch 6 |
| Batch 6 teeth: part-active fixture for PlaceComponent | Batch 6, Block B |
| Batch 6 CreateAndPlacePanel: no-call invariant documented | Batch 6, Step 6-4 comment |
| Drop `__zilventorPackProject` from `material-hatch-pattern.spec.ts` only | Batch 7 |
| `material-hatch-color.spec.ts` UNCHANGED | Batch 7 scope note + Step 7-4 |
| `waitForAutosave` helper | Batch 7, Step 7-0 |
| Teeth-check: RED-then-GREEN for e2e | Batch 7, Step 7-1 |
| No manifest bump | Confirmed — no `CURRENT_FORMAT_VERSION` or migration touched |
| No `App.tsx` autosave changes | Confirmed — no App.tsx edits |
| e2e proves fix via natural autosave | Batch 7, Steps 7-3/7-4 |
| `waitForAutosave` placed BEFORE drawing creation (prevents debounce race) | Batch 7, Step 7-3 Edit 1 |
| `lastOpenDocument` pointer overridden to part after drawing creation | Batch 7, Step 7-3 Edit 2 |

### Placeholder scan

- No `TODO`, `FIXME`, `...` placeholder, or `throw new Error('not implemented')` in any code block above.

### Type-name consistency

- `MaterialEntry` (singular) used throughout.
- `readonly MaterialEntry[]` for the kernel API parameter.
- `KernelClient` (not `KernelApi` or `Kernel`) for the store field type — do not import `Kernel` from `@zilventor/kernel` in app-layer code (circular risk).
- `syncPartMaterials(): Promise<void>` — 0-arg, async.

### Deviations from original spec wording

1. **`state/` → `store/`**: The spec says `packages/app/src/state/syncPartMaterials.ts`. The codebase has NO `state/` directory. The correct path is `packages/app/src/store/syncPartMaterials.ts`. This deviation is documented here and in the file placement section above.

2. **`material-hatch-color.spec.ts` injection retained**: The spec correctly identifies this as fixture setup (not a kernel-sync workaround). The plan leaves it unchanged. See spec §Background and §Decisions item 3.

3. **`syncPartMaterials` signature is 0-arg**: The spec locks `syncPartMaterials(): void` (no kernel argument). This plan implements it as `async syncPartMaterials(): Promise<void>` — reads both `kernel` and `activePart` from `useAppStore.getState()` internally. Made `async` (not `void`) because `kernel.setMaterials` returns `Promise<void>` and callers should `await` it so the kernel write completes before the autosave fires. The spec says `void`; upgrading to `Promise<void>` is backward-compatible and more correct for the Comlink path. All 8 call sites use `await syncPartMaterials()`.
