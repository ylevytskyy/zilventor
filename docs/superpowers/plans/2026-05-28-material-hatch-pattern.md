# Material hatch PATTERN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `MaterialEntry.hatchAngleDeg` / `hatchSpacingMm` editable per material in the Material Registry editor AND wire the hatchLookup with a `materials[0]` fallback so the per-material angle/spacing applies to single-PART section views as well as assembly sections.

**Architecture:** Surgical 5-file change. (a) Store `updateMaterial` reducer mirrors the existing `clearSheetStock` branch for a new `clearHatch` flag. (b) `EditMaterialCommand.revert()` emits `clearHatch: true` when the prev snapshot lacked the pair, so spread-merge revert doesn't leak newly-added keys. (c) `MaterialRegistryEditor.tsx` adds two columns + two edit-row inputs + `validateHatchPattern`, mirroring the existing Sheet L/W + `clearSheetStock` UX exactly. Both-or-neither pairing. (d+e) Three `hatchLookup` definitions (`AddSectionViewCommand` full/half + stepped + `regenerateSectionView`) get a 1-line tweak so `materialId === ''` falls back to `materials[0]`, mirroring the color feature's part-source fallback. No manifest bump, no kernel change, no renderer change.

**Tech Stack:** TypeScript / React / Zustand store / Vitest (unit) / Playwright (real-env e2e). Existing patterns referenced: `validateSheetStock`, `clearSheetStock`, the `RowEditState` discriminated union, the inline error row, the `colorForFace` part-source fallback, and the `material-hatch-color.spec.ts` e2e.

**Spec:** `docs/superpowers/specs/2026-05-28-material-hatch-pattern-design.md`

---

## File Structure

- **Modify** `packages/app/src/store/useAppStore.ts:283` (type) and `packages/app/src/store/useAppStore.ts:692-720` (reducer) — `clearHatch` plumbing.
- **Modify** `packages/app/src/commands/EditMaterialCommand.ts:5-8` (patch type) and `:36-42` (revert).
- **Modify** `packages/app/src/shell/MaterialRegistryEditor.tsx` — columns, inputs, validation, submit branching.
- **Modify** `packages/app/src/commands/AddSectionViewCommand.ts:138-140` AND `:295-297` — hatchLookup fallback.
- **Modify** `packages/app/src/drawing/regenerateSectionView.ts:138-140` — hatchLookup fallback.
- **Create** `packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts`.
- **Create** `packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts`.
- **Create** `packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx`.
- **Create** `packages/app/src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts`.
- **Create** `tests/e2e/drawing/material-hatch-pattern.spec.ts` (real-env Playwright).

Files explicitly NOT touched: `packages/shared/src/material.ts` (type already correct; `isMaterialEntry` intentionally not hardened), `packages/shared/src/drawing/projectSectionView.ts` (already consumes per-face hatchSpec), `packages/shared/src/drawing/hatchGenerator.ts` (already consumes angle/spacing), `packages/kernel/src/section/cutBySectionPlane.ts` (the `materialId: ''` stamp stays — fix is at the app boundary), `AddMaterialCommand.ts` (Add form stays minimal), all 3 renderers.

**Real PartDocument shape** (from `packages/kernel/src/adapter/PartDocument.ts:44-63` and `packages/shared/src/types.ts:67`): `{ id, name, units, parameters, properties, featureTree, materials, hardware }`. No `updateLog`, no `parameterCascade` — test seeds must use this shape exactly. `@testing-library/jest-dom` matchers are globally registered via `packages/app/src/test-setup.ts:1` (bare import); test files MUST NOT import any jest-dom subpath.

---

### Task 1: Store reducer — `clearHatch` support

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts:283` (interface) and `:692-720` (reducer)
- Test: `packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

function seedPart(mat: Record<string, unknown>): void {
  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [], materials: [mat], hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('useAppStore.updateMaterial — clearHatch', () => {
  beforeEach(() => {
    seedPart({
      id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 30, hatchSpacingMm: 2,
    });
  });

  it('strips both hatch keys when clearHatch: true', () => {
    useAppStore.getState().updateMaterial('m1', { clearHatch: true });
    const m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
    expect(m.name).toBe('Wood');
    expect(m.defaultThickness).toBe(18);
    expect(m.color).toBe('#aabbcc');
  });

  it('clearHatch atomically combines with other patch fields', () => {
    useAppStore.getState().updateMaterial('m1', { name: 'Oak', clearHatch: true });
    const m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.name).toBe('Oak');
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('setting hatch then clearing round-trips', () => {
    seedPart({ id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc' });
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 60, hatchSpacingMm: 4 });
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(60);
    expect(m.hatchSpacingMm).toBe(4);

    useAppStore.getState().updateMaterial('m1', { clearHatch: true });
    m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('clearHatch on an assembly material also strips both keys', () => {
    const asm = {
      id: 'a', name: 'A', units: 'mm' as const, parameters: {},
      components: [], constraints: [],
      groundedComponentPaths: [], bomItemNumbers: {}, cutListItemNumbers: {},
      colorOverrides: {}, colors: {}, properties: {},
      materials: [{
        id: 'm2', name: 'Steel', defaultThickness: 3, color: '#999999',
        hatchAngleDeg: 20, hatchSpacingMm: 1,
      }],
      hardware: [],
    };
    useAppStore.setState({
      activePart: null,
      activeAssembly: asm,
      activeDocument: { kind: 'assembly', document: asm },
    } as never);

    useAppStore.getState().updateMaterial('m2', { clearHatch: true });
    const m = useAppStore.getState().activeAssembly!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/store/__tests__/updateMaterial-clearHatch.spec.ts`
Expected: FAIL. Either TS error on `clearHatch` not being in the patch type, or runtime failure because the reducer doesn't strip the keys → `'hatchAngleDeg' in m` is still `true`.

- [ ] **Step 3: Extend the interface type at `useAppStore.ts:283`**

Replace:

```typescript
  updateMaterial(id: string, patch: Partial<Omit<MaterialEntry, 'id'>> & { clearSheetStock?: true }): void;
```

with:

```typescript
  updateMaterial(id: string, patch: Partial<Omit<MaterialEntry, 'id'>> & { clearSheetStock?: true; clearHatch?: true }): void;
```

- [ ] **Step 4: Extend the reducer at `useAppStore.ts:692-702`**

Replace:

```typescript
  updateMaterial: (id, patch) => set((s) => {
    const { clearSheetStock, ...rest } = patch as typeof patch & { clearSheetStock?: true };
    const applyPatch = (m: MaterialEntry): MaterialEntry => {
      if (m.id !== id) return m;
      const merged: MaterialEntry = { ...m, ...rest };
      if (clearSheetStock) {
        const { sheetLengthMm: _l, sheetWidthMm: _w, ...stripped } = merged;
        return stripped as MaterialEntry;
      }
      return merged;
    };
```

with:

```typescript
  updateMaterial: (id, patch) => set((s) => {
    const { clearSheetStock, clearHatch, ...rest } = patch as typeof patch & { clearSheetStock?: true; clearHatch?: true };
    const applyPatch = (m: MaterialEntry): MaterialEntry => {
      if (m.id !== id) return m;
      let merged: MaterialEntry = { ...m, ...rest };
      if (clearSheetStock) {
        const { sheetLengthMm: _l, sheetWidthMm: _w, ...stripped } = merged;
        merged = stripped as MaterialEntry;
      }
      if (clearHatch) {
        const { hatchAngleDeg: _a, hatchSpacingMm: _sp, ...stripped } = merged;
        merged = stripped as MaterialEntry;
      }
      return merged;
    };
```

(The rest of `updateMaterial` — the `activeAssembly` / `activePart` branches below — is unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/store/__tests__/updateMaterial-clearHatch.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full app suite**

Run: `pnpm --filter app exec vitest run`
Expected: all green (1872 + 4 = 1876). Existing `clearSheetStock` tests must still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/updateMaterial-clearHatch.spec.ts
git commit -m "feat(store): clearHatch flag strips hatch keys in updateMaterial"
```

---

### Task 2: `EditMaterialCommand.revert` correctness for "no-hatch ⇒ set" case

**Files:**
- Modify: `packages/app/src/commands/EditMaterialCommand.ts:5-8` (patch type) and `:36-42` (revert)
- Test: `packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts` (create)

Revert currently spread-merges the prev snapshot, which can't remove keys absent from prev. If apply ADDED `hatchAngleDeg`/`hatchSpacingMm` (prev had neither), naive revert leaves them in place. Fix: when prev's hatch pair is incomplete, emit `clearHatch: true` so the merge strips any newly-added hatch.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditMaterialCommand } from '../EditMaterialCommand';

function seedPartWithBareMaterial(): void {
  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [],
    materials: [{ id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc' }],
    hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('EditMaterialCommand — hatch revert correctness', () => {
  beforeEach(() => {
    seedPartWithBareMaterial();
  });

  it('revert removes hatch keys when prev had no hatch (apply added them)', async () => {
    const cmd = new EditMaterialCommand('m1', {
      name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 20, hatchSpacingMm: 2,
    });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(20);
    expect(m.hatchSpacingMm).toBe(2);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);
  });

  it('revert restores hatch values when prev had hatch', async () => {
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 30, hatchSpacingMm: 1.5 });

    const cmd = new EditMaterialCommand('m1', {
      name: 'Wood', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 60, hatchSpacingMm: 4,
    });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(60);
    expect(m.hatchSpacingMm).toBe(4);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(30);
    expect(m.hatchSpacingMm).toBe(1.5);
  });

  it('apply with clearHatch then revert restores previous hatch', async () => {
    useAppStore.getState().updateMaterial('m1', { hatchAngleDeg: 30, hatchSpacingMm: 1.5 });

    const cmd = new EditMaterialCommand('m1', { clearHatch: true });
    await cmd.apply();
    let m = useAppStore.getState().activePart!.materials[0]!;
    expect('hatchAngleDeg' in m).toBe(false);
    expect('hatchSpacingMm' in m).toBe(false);

    await cmd.revert();
    m = useAppStore.getState().activePart!.materials[0]!;
    expect(m.hatchAngleDeg).toBe(30);
    expect(m.hatchSpacingMm).toBe(1.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/EditMaterialCommand.hatch.spec.ts`
Expected: TS error on `clearHatch` patch in test case 3 (if Task 1's type isn't applied yet, this should still fail because Task 1 only extended the store interface — the EditMaterialPatch type also needs `clearHatch`). Plus the first test fails: revert spread-merge leaves the keys in place.

- [ ] **Step 3: Extend the patch type at `EditMaterialCommand.ts:5-8`**

Replace:

```typescript
export type EditMaterialPatch = Partial<Omit<MaterialEntry, 'id'>> & {
  /** When true, the reducer removes sheetLengthMm + sheetWidthMm from the entry (atomic with any other patch fields). */
  clearSheetStock?: true;
};
```

with:

```typescript
export type EditMaterialPatch = Partial<Omit<MaterialEntry, 'id'>> & {
  /** When true, the reducer removes sheetLengthMm + sheetWidthMm from the entry (atomic with any other patch fields). */
  clearSheetStock?: true;
  /** When true, the reducer removes hatchAngleDeg + hatchSpacingMm from the entry (atomic with any other patch fields). */
  clearHatch?: true;
};
```

- [ ] **Step 4: Fix `revert()` at `EditMaterialCommand.ts:36-42`**

Replace:

```typescript
  async revert(): Promise<void> {
    if (this.prev) {
      const { id: _id, ...rest } = this.prev;
      useAppStore.getState().updateMaterial(this.id, rest);
      this.prev = null;
    }
  }
```

with:

```typescript
  async revert(): Promise<void> {
    if (this.prev) {
      const { id: _id, ...rest } = this.prev;
      // The spread-merge reducer can't REMOVE keys absent from `rest`. If prev
      // is missing either side of the hatch pair, emit clearHatch so the merge
      // doesn't leak newly-added hatch keys from the post-apply state. The
      // both-or-neither invariant means a partial pair shouldn't occur in normal
      // operation, but the defensive `||` keeps us safe under legacy data too.
      const prevLacksHatchPair = this.prev.hatchAngleDeg === undefined
        || this.prev.hatchSpacingMm === undefined;
      const patch = prevLacksHatchPair
        ? { ...rest, clearHatch: true as const }
        : rest;
      useAppStore.getState().updateMaterial(this.id, patch);
      this.prev = null;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/EditMaterialCommand.hatch.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the full app suite**

Run: `pnpm --filter app exec vitest run`
Expected: all green. The existing `material-commands.spec.ts` must remain green.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/commands/EditMaterialCommand.ts packages/app/src/commands/__tests__/EditMaterialCommand.hatch.spec.ts
git commit -m "feat(commands): EditMaterialCommand revert emits clearHatch when prev lacked hatch pair"
```

---

### Task 3: `MaterialRegistryEditor` — columns, inputs, validation, submit branching

**Files:**
- Modify: `packages/app/src/shell/MaterialRegistryEditor.tsx`
- Test: `packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx` (create)

- [ ] **Step 1: Write the failing test file**

Note: do NOT import any `@testing-library/jest-dom` subpath — matchers are registered globally by `packages/app/src/test-setup.ts`. Existing editor tests follow this convention.

```typescript
// packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { MaterialRegistryEditor } from '../MaterialRegistryEditor';
import { useAppStore } from '../../store/useAppStore';

function seedPartWithMaterial(opts: {
  hatchAngleDeg?: number;
  hatchSpacingMm?: number;
} = {}): void {
  const mat: Record<string, unknown> = {
    id: 'm1', name: 'Wood', defaultThickness: 18, color: '#aabbcc',
  };
  if (opts.hatchAngleDeg !== undefined) mat.hatchAngleDeg = opts.hatchAngleDeg;
  if (opts.hatchSpacingMm !== undefined) mat.hatchSpacingMm = opts.hatchSpacingMm;

  const part = {
    id: 'p', name: 'P', units: 'mm' as const, parameters: {}, properties: {},
    featureTree: [], materials: [mat], hardware: [],
  };
  useAppStore.setState({
    activePart: part,
    activeAssembly: null,
    activeDocument: { kind: 'part', document: part },
  } as never);
}

describe('MaterialRegistryEditor — hatch angle/spacing UI', () => {
  let executeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ bus: { execute: executeSpy } } as never);
  });

  it('renders Hatch angle (°) and Hatch spacing (mm) column headers', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    expect(screen.getByRole('columnheader', { name: /Hatch angle/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Hatch spacing/i })).toBeInTheDocument();
  });

  it('read-only row shows hatch values when set', () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    const row = screen.getByTestId('material-row-m1');
    expect(within(row).getByText('30')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('read-only row shows blank cells when hatch absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    const tds = within(screen.getByTestId('material-row-m1')).getAllByRole('cell');
    // Columns: Name, Thickness, Color, Sheet L, Sheet W, Hatch angle, Hatch spacing, Actions
    expect(tds[5]?.textContent ?? '').toBe('');
    expect(tds[6]?.textContent ?? '').toBe('');
  });

  it('entering edit mode prefills hatch inputs from the material', () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    expect((screen.getByLabelText(/Edit hatch angle/i) as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText(/Edit hatch spacing/i) as HTMLInputElement).value).toBe('2');
  });

  it('entering edit mode prefills empty strings when hatch fields absent', () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    expect((screen.getByLabelText(/Edit hatch angle/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/Edit hatch spacing/i) as HTMLInputElement).value).toBe('');
  });

  it('half-pair (angle set, spacing empty) shows error and blocks save', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '30' } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/both Hatch angle and Hatch spacing/i);
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('out-of-range angle (200) shows error', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '2' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/angle must be in \[0, 180\)/i);
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('non-positive spacing (0) shows error', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '0' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/spacing must be > 0/i);
    });
  });

  it('both-set valid submit dispatches EditMaterialCommand with numeric hatch fields', async () => {
    seedPartWithMaterial();
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '2' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { id: string; patch: Record<string, unknown> };
    expect(cmd.id).toBe('m1');
    expect(cmd.patch.hatchAngleDeg).toBe(20);
    expect(cmd.patch.hatchSpacingMm).toBe(2);
    expect(cmd.patch.clearHatch).toBeUndefined();
  });

  it('both-empty submit (starting from hatch set) dispatches with clearHatch', async () => {
    seedPartWithMaterial({ hatchAngleDeg: 30, hatchSpacingMm: 2 });
    render(<MaterialRegistryEditor />);
    fireEvent.mouseEnter(screen.getByTestId('material-row-m1'));
    fireEvent.click(screen.getByRole('button', { name: /Edit Wood/i }));
    fireEvent.change(screen.getByLabelText(/Edit hatch angle/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Edit hatch spacing/i), { target: { value: '' } });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(executeSpy).toHaveBeenCalledTimes(1));
    const cmd = executeSpy.mock.calls[0]![0] as { id: string; patch: Record<string, unknown> };
    expect(cmd.patch.clearHatch).toBe(true);
    expect(cmd.patch.hatchAngleDeg).toBeUndefined();
    expect(cmd.patch.hatchSpacingMm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter app exec vitest run src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx`
Expected: all 10 tests FAIL — headers don't exist, inputs aren't rendered, validation doesn't run, submit lacks hatch fields.

- [ ] **Step 3a: Add `validateHatchPattern` after `validateSheetStock`**

In `packages/app/src/shell/MaterialRegistryEditor.tsx`, immediately after the `validateSheetStock` function (around line 84), add:

```typescript
function validateHatchPattern(angleStr: string, spacingStr: string): string | null {
  const aEmpty = angleStr.trim() === '';
  const sEmpty = spacingStr.trim() === '';
  if (aEmpty && sEmpty) return null;
  if (aEmpty || sEmpty) return 'Set both Hatch angle and Hatch spacing, or leave both empty.';
  const a = Number(angleStr), s = Number(spacingStr);
  if (!Number.isFinite(a) || !Number.isFinite(s)) return 'Hatch angle/spacing must be numbers.';
  if (a < 0 || a >= 180) return 'Hatch angle must be in [0, 180).';
  if (s <= 0) return 'Hatch spacing must be > 0.';
  return null;
}
```

- [ ] **Step 3b: Extend the `RowEditState.edit` variant**

In the `RowEditState` type (around lines 86-89), update the `edit` variant to:

```typescript
type RowEditState =
  | { mode: 'idle' }
  | { mode: 'edit'; id: string; name: string; defaultThickness: string; color: string; sheetLengthMm: string; sheetWidthMm: string; hatchAngleDeg: string; hatchSpacingMm: string; error: string | null }
  | { mode: 'confirmDelete'; id: string; error: string | null };
```

- [ ] **Step 3c: Add two `<th>` after Sheet W (around line 202)**

In the table header, between the existing Sheet W `<th>` and Actions `<th>`, insert:

```typescript
            <th style={{ ...cellStyle, textAlign: 'left' }}>Hatch angle (°)</th>
            <th style={{ ...cellStyle, textAlign: 'left' }}>Hatch spacing (mm)</th>
```

- [ ] **Step 3d: Update existing Sheet L/W `onChange` to recompute the combined error**

The existing handler on Sheet L (around line 247-250) is:

```typescript
                      onChange={(e) => setRowState({
                        ...rowState, sheetLengthMm: e.target.value,
                        error: validateSheetStock(e.target.value, rowState.sheetWidthMm),
                      })}
```

Change it to combine with hatch validation (so editing sheet fields doesn't mask an active hatch error):

```typescript
                      onChange={(e) => setRowState({
                        ...rowState, sheetLengthMm: e.target.value,
                        error: validateSheetStock(e.target.value, rowState.sheetWidthMm)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm),
                      })}
```

Apply the mirror change to the Sheet W input around line 260-263:

```typescript
                      onChange={(e) => setRowState({
                        ...rowState, sheetWidthMm: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, e.target.value)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm),
                      })}
```

- [ ] **Step 3e: Add two new edit cells after the Sheet W edit cell, before the actions cell**

In the EDIT row JSX (after the Sheet W `<td>...</td>` closing around line 266, before the actions `<td>`), insert:

```typescript
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit hatch angle"
                      type="text"
                      inputMode="numeric"
                      value={rowState.hatchAngleDeg}
                      onChange={(e) => setRowState({
                        ...rowState, hatchAngleDeg: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm)
                            ?? validateHatchPattern(e.target.value, rowState.hatchSpacingMm),
                      })}
                      style={inputStyle}
                    />
                  </td>
                  <td style={cellStyle}>
                    <input
                      aria-label="Edit hatch spacing"
                      type="text"
                      inputMode="numeric"
                      value={rowState.hatchSpacingMm}
                      onChange={(e) => setRowState({
                        ...rowState, hatchSpacingMm: e.target.value,
                        error: validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm)
                            ?? validateHatchPattern(rowState.hatchAngleDeg, e.target.value),
                      })}
                      style={inputStyle}
                    />
                  </td>
```

- [ ] **Step 3f: Add two read-only cells in the non-edit row (after Sheet W cell, before actions cell, around lines 320-321)**

In the non-edit row JSX, between the Sheet W `<td>` (`<td style={cellStyle}>{m.sheetWidthMm ?? ''}</td>`) and the actions `<td>`, insert:

```typescript
                <td style={cellStyle}>{m.hatchAngleDeg ?? ''}</td>
                <td style={cellStyle}>{m.hatchSpacingMm ?? ''}</td>
```

- [ ] **Step 3g: Extend Edit-button onClick to seed hatch strings (around lines 329-338)**

Replace:

```typescript
                        onClick={() => setRowState({
                          mode: 'edit',
                          id: m.id,
                          name: m.name,
                          defaultThickness: String(m.defaultThickness),
                          color: m.color,
                          sheetLengthMm: m.sheetLengthMm !== undefined ? String(m.sheetLengthMm) : '',
                          sheetWidthMm: m.sheetWidthMm !== undefined ? String(m.sheetWidthMm) : '',
                          error: null,
                        })}
```

with:

```typescript
                        onClick={() => setRowState({
                          mode: 'edit',
                          id: m.id,
                          name: m.name,
                          defaultThickness: String(m.defaultThickness),
                          color: m.color,
                          sheetLengthMm: m.sheetLengthMm !== undefined ? String(m.sheetLengthMm) : '',
                          sheetWidthMm: m.sheetWidthMm !== undefined ? String(m.sheetWidthMm) : '',
                          hatchAngleDeg: m.hatchAngleDeg !== undefined ? String(m.hatchAngleDeg) : '',
                          hatchSpacingMm: m.hatchSpacingMm !== undefined ? String(m.hatchSpacingMm) : '',
                          error: null,
                        })}
```

- [ ] **Step 3h: Rewrite `onEditSubmit` to validate hatch and branch the patch**

Replace the existing `onEditSubmit` (around lines 147-180) wholesale with:

```typescript
  const onEditSubmit = async () => {
    if (rowState.mode !== 'edit') return;
    const name = rowState.name.trim();
    if (!name) {
      setRowState({ ...rowState, error: 'Name is required' });
      return;
    }
    const thicknessNum = Number(rowState.defaultThickness);
    if (!Number.isFinite(thicknessNum) || thicknessNum <= 0) {
      setRowState({ ...rowState, error: 'Default thickness must be a positive number' });
      return;
    }
    const sheetErr = validateSheetStock(rowState.sheetLengthMm, rowState.sheetWidthMm);
    if (sheetErr) {
      setRowState({ ...rowState, error: sheetErr });
      return;
    }
    const hatchErr = validateHatchPattern(rowState.hatchAngleDeg, rowState.hatchSpacingMm);
    if (hatchErr) {
      setRowState({ ...rowState, error: hatchErr });
      return;
    }
    const lEmpty = rowState.sheetLengthMm.trim() === '';
    const wEmpty = rowState.sheetWidthMm.trim() === '';
    const hAEmpty = rowState.hatchAngleDeg.trim() === '';
    const hSEmpty = rowState.hatchSpacingMm.trim() === '';

    const sheetPart: Partial<EditMaterialPatch> = (!lEmpty && !wEmpty)
      ? { sheetLengthMm: Number(rowState.sheetLengthMm), sheetWidthMm: Number(rowState.sheetWidthMm) }
      : { clearSheetStock: true };
    const hatchPart: Partial<EditMaterialPatch> = (!hAEmpty && !hSEmpty)
      ? { hatchAngleDeg: Number(rowState.hatchAngleDeg), hatchSpacingMm: Number(rowState.hatchSpacingMm) }
      : { clearHatch: true };

    const patch: EditMaterialPatch = {
      name,
      defaultThickness: thicknessNum,
      color: rowState.color,
      ...sheetPart,
      ...hatchPart,
    };
    try {
      await bus.execute(new EditMaterialCommand(rowState.id, patch));
      setRowState({ mode: 'idle' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith('DUPLICATE_NAME')) {
        setRowState({ ...rowState, error: `A material named "${name}" already exists` });
      } else {
        setRowState({ ...rowState, error: msg });
      }
    }
  };
```

- [ ] **Step 3i: Update `colSpan` in the confirm-delete row (around line 281) and empty-state row (around line 358)**

Both currently use `colSpan={6}`. Change both to `colSpan={8}` (we added 2 columns).

- [ ] **Step 4: Run the new test file to verify all 10 pass**

Run: `pnpm --filter app exec vitest run src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx`
Expected: all 10 tests PASS.

- [ ] **Step 5: Run the full app suite**

Run: `pnpm --filter app exec vitest run`
Expected: all green (1872 + 4 + 3 + 10 = 1889). The existing `MaterialRegistryEditor` smoke + sheet-stock tests must remain green.

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: 0 errors (16-warnings baseline).

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/shell/MaterialRegistryEditor.tsx packages/app/src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx
git commit -m "feat(material-editor): editable hatch angle + spacing per material"
```

---

### Task 4: `hatchLookup` part-source fallback in section commands

**Files:**
- Modify: `packages/app/src/commands/AddSectionViewCommand.ts:138-140` AND `:295-297`
- Modify: `packages/app/src/drawing/regenerateSectionView.ts:138-140`
- Test: `packages/app/src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts` (create)

The kernel's `cutBySectionPlane.ts` stamps `materialId: ''` on every face tag for single-part section cuts (line 304 and friends). The assembly cut path (`cutLeavesBySectionPlane`, lines 392/443) rewrites this with the component part's `materials[0].id`, so assembly works. For part-source we add the symmetric fallback: when `materialId === ''`, use `materials[0]` as the implicit "primary material" — matching how `colorForFace` already uses `state.activePart?.materials?.[0]?.color`.

- [ ] **Step 1: Write the failing test (pure function over the lookup behavior)**

```typescript
// packages/app/src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts
import { describe, it, expect } from 'vitest';
import { getHatchSpec, type MaterialEntry } from '@zilventor/shared';

/**
 * The hatchLookup factory we expect AddSectionViewCommand to use.
 * This test pins the BEHAVIOR; the production code in both AddSectionViewCommand
 * sites and regenerateSectionView must match this shape.
 */
function makeHatchLookup(materials: readonly MaterialEntry[]) {
  return (materialId: string) => {
    const mat = materialId
      ? materials.find((m) => m.id === materialId)
      : materials[0];
    return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
  };
}

describe('hatchLookup — part-source fallback to materials[0]', () => {
  const mats: MaterialEntry[] = [
    { id: 'wood', name: 'Wood', defaultThickness: 18, color: '#aabbcc', hatchAngleDeg: 20, hatchSpacingMm: 2 },
    { id: 'steel', name: 'Steel', defaultThickness: 3,  color: '#999999', hatchAngleDeg: 60, hatchSpacingMm: 4 },
  ];

  it('non-empty materialId resolves to that material (no fallback)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('steel')).toEqual({ angleDeg: 60, spacingMm: 4 });
    expect(lookup('wood')).toEqual({ angleDeg: 20, spacingMm: 2 });
  });

  it('empty materialId falls back to materials[0] (single-part case)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('')).toEqual({ angleDeg: 20, spacingMm: 2 });
  });

  it('empty materialId with NO materials returns default 45/3', () => {
    const lookup = makeHatchLookup([]);
    expect(lookup('')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });

  it('unknown materialId returns default 45/3 (not fallback)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('does-not-exist')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });

  it('materials[0] without hatch fields returns default 45/3', () => {
    const lookup = makeHatchLookup([
      { id: 'bare', name: 'Bare', defaultThickness: 18, color: '#aabbcc' },
    ]);
    expect(lookup('')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter app exec vitest run src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts`
Expected: PASS. (This test is over a local helper that already encodes the desired behavior — it serves as the spec.) Then we mirror this exact pattern into the three production sites; if any drifts, an integration test would catch it. The teeth come from the e2e in Task 5.

Note: the test does not import production code yet — it pins the shape that production must match. Run it green from the start.

- [ ] **Step 3: Apply the fallback at `AddSectionViewCommand.ts:138-140`**

Replace:

```typescript
    const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
      const mat = materials.find((m) => m.id === materialId);
      return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
    };
```

with:

```typescript
    const hatchLookup = (materialId: string): { angleDeg: number; spacingMm: number } => {
      // Empty materialId is the single-part case (kernel stamps '' on every faceTag for non-assembly cuts).
      // Fall back to materials[0] as the implicit "primary material" — symmetric with colorForFace's part-source fallback.
      const mat = materialId
        ? materials.find((m) => m.id === materialId)
        : materials[0];
      return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
    };
```

- [ ] **Step 4: Apply the same fallback at `AddSectionViewCommand.ts:295-297` (stepped section path)**

Apply the exact same edit at the second hatchLookup definition (around line 295). Use the same comment.

- [ ] **Step 5: Apply the same fallback at `regenerateSectionView.ts:138-140`**

Apply the same edit at the third hatchLookup definition. Use the same comment.

- [ ] **Step 6: Re-run unit gate**

Run: `pnpm --filter app exec vitest run`
Expected: all green. No existing tests should break — the change only affects the empty-string case, which previously returned default 45/3 and now returns `materials[0]`-derived values (or still default if `materials[0]` lacks hatch fields). For existing tests that didn't set hatch on `materials[0]`, the result is unchanged.

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm -r typecheck && pnpm lint`
Expected: clean / 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/commands/AddSectionViewCommand.ts packages/app/src/drawing/regenerateSectionView.ts packages/app/src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts
git commit -m "feat(section): hatchLookup falls back to materials[0] for part-source sections

Symmetric with colorForFace's part-source fallback. Single-part section cuts
leave faceTags' materialId='', so the existing materials.find() always missed
and returned default 45°/3mm; with the fallback, the material's hatch settings
take effect for single-part sections too."
```

---

### Task 5: Real-environment e2e — set hatch, project section, assert geometry + persistence

**Files:**
- Create: `tests/e2e/drawing/material-hatch-pattern.spec.ts`

CLAUDE.md §6 gate. Single-part flow that exercises the new `materials[0]` fallback wired in Task 4.

- [ ] **Step 1: Write the e2e spec**

```typescript
// tests/e2e/drawing/material-hatch-pattern.spec.ts
/**
 * T-material-hatch-pattern — Editable per-material hatch angle/spacing, end-to-end.
 *
 * Flow:
 *   1. Build a 30×30×20 part.
 *   2. AddMaterialCommand (Wood, #aabbcc, 18mm) → materials[0] populated.
 *   3. EditMaterialCommand to set hatchAngleDeg=20, hatchSpacingMm=2.
 *   4. Create drawing + base view (front, 1:1, patch viewMatrix) + horizontal section view.
 *   5. Read hatchSegments; assert every segment's normalized line angle ≈ 20° (±2°), NOT ≈ 45°.
 *   6. Wait 700ms (OPFS autosave debounce = 500ms), reload, confirm persistence.
 *
 * Teeth: relies on Task 4's materials[0] fallback in hatchLookup. If the
 * fallback regresses, every segment stays at 45° and step 5 fails.
 */
import { test, expect } from '@playwright/test';
import { buildBox, waitForKernelReady } from '../helpers/buildBox';

// Normalize a directed segment angle (-180..180] into [0, 180) for line-direction comparison.
function normLineAngleDeg(p0: { x: number; y: number }, p1: { x: number; y: number }): number {
  const a = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  let n = a % 180;
  if (n < 0) n += 180;
  return n;
}

test('material-hatch-pattern: per-material angle/spacing override flows to part-source section hatch + persists', async ({ page }) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    console.log('BROWSER:', m.type(), t);
    if (m.type() === 'error') consoleErrors.push(t);
  });
  page.on('pageerror', (e) => {
    console.log('PAGEERROR:', e.message);
    consoleErrors.push(`PAGEERROR: ${e.message}`);
  });

  await page.goto('/');
  await waitForKernelReady(page);

  // Step 1: Build the box.
  await buildBox(page, { width: 30, height: 30, depth: 20 });

  // Steps 2 + 3: Add material, then edit hatch.
  const matInfo = await page.evaluate(async () => {
    const { AddMaterialCommand } = await import('/src/commands/AddMaterialCommand.ts');
    const { EditMaterialCommand } = await import('/src/commands/EditMaterialCommand.ts');

    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activePart: { id: string; materials: Array<{ id: string; hatchAngleDeg?: number; hatchSpacingMm?: number }> } | null;
          bus: { execute(c: unknown): Promise<unknown> };
        };
      };
    }).__zilventorStore;

    const sBefore = store.getState();
    if (!sBefore.activePart) throw new Error('mhp: no active part');
    const bus = sBefore.bus;

    await bus.execute(new AddMaterialCommand({ name: 'WoodHatch', defaultThickness: 18, color: '#aabbcc' }));
    const sAfterAdd = store.getState();
    const newMat = sAfterAdd.activePart!.materials.find((m) => m.id.startsWith('mat-'));
    if (!newMat) throw new Error('mhp: AddMaterial did not produce a material with id starting mat-');

    await bus.execute(new EditMaterialCommand(newMat.id, {
      name: 'WoodHatch', defaultThickness: 18, color: '#aabbcc',
      hatchAngleDeg: 20, hatchSpacingMm: 2,
      clearSheetStock: true,
    }));

    const sAfterEdit = store.getState();
    const edited = sAfterEdit.activePart!.materials.find((m) => m.id === newMat.id)!;
    return { materialId: edited.id, angle: edited.hatchAngleDeg, spacing: edited.hatchSpacingMm };
  });

  console.log('[mhp] material after edit:', matInfo);
  expect(matInfo.angle, 'hatchAngleDeg must be 20 after Edit').toBe(20);
  expect(matInfo.spacing, 'hatchSpacingMm must be 2 after Edit').toBe(2);

  // Steps 4: Create drawing + base view (with viewMatrix patch) + section view.
  const { sheetId, sectionViewId } = await page.evaluate(async () => {
    const store = (window as unknown as {
      __zilventorStore: {
        getState(): {
          activeDocument: { kind: string; document: { id: string; sheets: Array<{ id: string; views: Array<{ id: string; kind: string }> }> } } | null;
          activePart: { id: string } | null;
          activeDrawingSourcePartId: string | null;
          kernel: {
            execute(id: string): Promise<{ ok: boolean }>;
            getProjectorInput(args: { kind: string; partId: string }): Promise<{ bbox: readonly number[] } | null>;
          } | null;
        };
        setState(p: unknown): void;
      };
    }).__zilventorStore;

    const s0 = store.getState();
    if (!s0.activePart || !s0.kernel) throw new Error('mhp: kernel or activePart missing');
    await s0.kernel.execute(s0.activePart.id);

    const { CreateDrawingCommand } = await import('/src/commands/CreateDrawingCommand.ts');
    await new CreateDrawingCommand({ sourcePath: 'dummy.zipt', sourceKind: 'part' }).apply();

    const s1 = store.getState();
    const drawing = s1.activeDocument!.document;
    const sheetId = drawing.sheets[0]!.id;

    const { AddBaseViewCommand } = await import('/src/commands/AddBaseViewCommand.ts');
    await new AddBaseViewCommand({
      sheetId,
      positionMm: { x: 80, y: 80 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
    }).apply();

    const s2 = store.getState();
    const baseView = s2.activeDocument!.document.sheets.find((sh) => sh.id === sheetId)!.views.find((v) => v.kind === 'base')!;

    // Patch base view with viewMatrix (required by AddSectionViewCommand).
    const partKernelId = s2.activeDrawingSourcePartId ?? s2.activePart!.id;
    const input = await s2.kernel!.getProjectorInput({ kind: 'part', partId: partKernelId });
    if (!input) throw new Error('mhp: getProjectorInput null');
    const [minX, minY, minZ, maxX, maxY, maxZ] = input.bbox;
    const cx = ((minX as number) + (maxX as number)) / 2;
    const cy = ((minY as number) + (maxY as number)) / 2;
    const cz = ((minZ as number) + (maxZ as number)) / 2;
    const vm = [1, 0, 0, -cx, 0, 1, 0, -cy, 0, 0, 1, -cz, 0, 0, 0, 1];

    const cDoc = store.getState().activeDocument!.document as { sheets: Array<{ id: string; views: Array<Record<string, unknown>> }> };
    const patched = {
      ...cDoc,
      sheets: cDoc.sheets.map((sh) =>
        sh.id !== sheetId ? sh : {
          ...sh,
          views: sh.views.map((v) => (v as { id: string }).id !== baseView.id ? v : { ...v, viewMatrix: vm }),
        }
      ),
    };
    store.setState({ activeDocument: { kind: 'drawing', document: patched }, activeDrawing: patched } as never);

    const { AddSectionViewCommand } = await import('/src/commands/AddSectionViewCommand.ts');
    await new AddSectionViewCommand({
      drawingId: (store.getState().activeDocument!.document as { id: string }).id,
      sheetId,
      parentViewId: baseView.id,
      p0: { x: -20, y: 0 },
      p1: { x: 20, y: 0 },
      arrowDirection: 1 as -1 | 1,
      dropAt: { x: 200, y: 80 },
      mode: 'full',
    }).apply();

    const s3 = store.getState();
    const sectionView = s3.activeDocument!.document.sheets.find((sh) => sh.id === sheetId)!.views.find((v) => v.kind === 'section')!;
    return { sheetId, sectionViewId: sectionView.id };
  });

  // Step 5: Read hatchSegments and assert angles ≈ 20°.
  const hatchSegs = await page.evaluate(({ shId, svId }: { shId: string; svId: string }) => {
    const doc = (window as unknown as {
      __zilventorStore: { getState(): { activeDocument: { document: { sheets: Array<{ id: string; views: Array<{ id: string; kind: string; hatchSegments?: Array<{ p0: { x: number; y: number }; p1: { x: number; y: number } }> }> }> } } } };
    }).__zilventorStore.getState().activeDocument!.document;
    const sheet = doc.sheets.find((s) => s.id === shId)!;
    const sv = sheet.views.find((v) => v.id === svId)!;
    return (sv.hatchSegments ?? []).map((seg) => ({ p0: seg.p0, p1: seg.p1 }));
  }, { shId: sheetId, svId: sectionViewId });

  console.log('[mhp] hatchSegment count:', hatchSegs.length);
  expect(hatchSegs.length, 'expected ≥1 hatch segment in section view').toBeGreaterThan(0);

  const normAngles = hatchSegs.map((s) => normLineAngleDeg(s.p0, s.p1));
  console.log('[mhp] normalized angles (first 5):', normAngles.slice(0, 5));

  const TOLERANCE = 2;
  for (const a of normAngles) {
    expect(Math.abs(a - 20), `segment angle ${a} not within ${TOLERANCE}° of 20°`).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(a - 45), `segment angle ${a} unexpectedly close to default 45° — fallback regression`).toBeGreaterThan(5);
  }

  // Step 6: Persistence across reload.
  // Autosave debounce is 500ms; wait a margin before reloading.
  await page.waitForTimeout(700);
  await page.reload();
  await waitForKernelReady(page);

  const persistedMat = await page.evaluate(({ matId }: { matId: string }) => {
    const s = (window as unknown as {
      __zilventorStore: { getState(): { activePart: { materials: Array<{ id: string; hatchAngleDeg?: number; hatchSpacingMm?: number }> } | null } };
    }).__zilventorStore.getState();
    if (!s.activePart) return null;
    return s.activePart.materials.find((m) => m.id === matId) ?? null;
  }, { matId: matInfo.materialId });

  console.log('[mhp] material after reload:', persistedMat);
  expect(persistedMat, 'material must survive reload').not.toBeNull();
  expect(persistedMat!.hatchAngleDeg, 'hatchAngleDeg must survive reload').toBe(20);
  expect(persistedMat!.hatchSpacingMm, 'hatchSpacingMm must survive reload').toBe(2);

  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors:\n${consoleErrors.join('\n')}`);
  }
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e -- tests/e2e/drawing/material-hatch-pattern.spec.ts --project=chromium`
Expected: PASS. Read `BROWSER:` lines if it fails — that's the load-bearing diagnostic per [[feedback_drive_ui_mid_flight]].

- [ ] **Step 3: Teeth verification (BEFORE commit; do not commit the broken state)**

Verify the test would FAIL if Task 4 regressed. Temporarily revert ONE of the three `hatchLookup` sites back to the old `materials.find((m) => m.id === materialId)` (without the fallback). Re-run the e2e — it should FAIL on the angle assertion (`segment angle ~45 not within 2° of 20°`). Restore the change. This proves the fallback is what's making the test pass, not pre-existing behavior.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/drawing/material-hatch-pattern.spec.ts
git commit -m "test(e2e): material hatch pattern — single-part section, 20°/2mm + reload-persists"
```

---

## Self-Review

(Plan author — ran before handing off.)

**1. Spec coverage:**
- "Editable Hatch angle/spacing in edit-row form" → Task 3.
- "Both-or-neither pair + clearHatch flag" → Tasks 1, 2, 3.
- "`updateMaterial` strips both keys on `clearHatch`" → Task 1.
- "`EditMaterialCommand.revert` emits `clearHatch` when prev lacked the pair" → Task 2.
- "Validation: angle in [0,180), spacing > 0" → Task 3 (validateHatchPattern).
- "hatchLookup `materials[0]` fallback for part-source" → Task 4.
- "Real-env e2e (set 20°/2mm, project section, assert angle, reload-persists)" → Task 5.
- "No manifest bump, no kernel change, no renderer change, no AddMaterialCommand change" → enforced by the "Files explicitly NOT touched" section.

**2. Placeholder scan:** No TBDs, no "TODO", no "handle edge cases" hand-waves. Every code step has full code.

**3. Type consistency:** `clearHatch` is `clearHatch?: true` in three places (store interface line 283, `EditMaterialPatch`, reducer destructure) — same literal-true type everywhere. `hatchAngleDeg`/`hatchSpacingMm` are always `number` in patches / `string` in `RowEditState`. `EditMaterialCommand` constructor unchanged. `hatchLookup` signature `(materialId: string) => { angleDeg: number; spacingMm: number }` unchanged at all three sites.

**4. Test seed shape:** All test seeds use the real `PartDocument` shape — `{id, name, units, parameters, properties, featureTree, materials, hardware}` (verified against `packages/kernel/src/adapter/PartDocument.ts:44-63`). No phantom `updateLog`/`parameterCascade`.

**5. jest-dom:** No test file imports any `@testing-library/jest-dom` subpath; matchers come from the global `test-setup.ts` registration.

---

## Verification gates (all must pass before merge)

- `pnpm --filter app exec vitest run src/store/__tests__/updateMaterial-clearHatch.spec.ts` — 4 PASS
- `pnpm --filter app exec vitest run src/commands/__tests__/EditMaterialCommand.hatch.spec.ts` — 3 PASS
- `pnpm --filter app exec vitest run src/shell/__tests__/MaterialRegistryEditor.hatch.spec.tsx` — 10 PASS
- `pnpm --filter app exec vitest run src/commands/__tests__/AddSectionViewCommand.hatchLookup.spec.ts` — 5 PASS
- `pnpm -r test:unit` — 2994 + 22 = **3016** total PASS
- `pnpm -r typecheck` — clean
- `pnpm lint` — 0 errors (16-warnings baseline)
- `pnpm test:e2e -- tests/e2e/drawing/material-hatch-pattern.spec.ts --project=chromium` — PASS including reload-persistence assertion

After all gates pass, hand off to `superpowers:finishing-a-development-branch` (FF merge, push, worktree cleanup, rewrite `next_session_resume.md`, write `project_material_hatch_pattern_feature.md`).
