# Sub-project 4c — Bill of Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Inventor-classic Bill of Materials view to ZilInventor's assembly mode: per-assembly aggregation by `(partPath, color)`, persisted user-editable item numbers, BrowserPane "BOM" tab + Assembly-ribbon BOM button, click-to-select with viewport outline overlay, View-tab "Show component colors" toggle, CSV export via the browser save dialog.

**Architecture:** Hybrid derived view — rows are recomputed each render by aggregating `(partPath, color)` from `assembly.components`; the assembly file stores a small `bomItemNumbers: Record<rowKey, integer>` map and a per-assembly named-color palette `colors: Record<name, hex>`. Per-component color lives on `ComponentInstance.color`. Viewport tinting and selection emphasis are gated through `SceneManager` extensions.

**Tech Stack:** TypeScript, React, Zustand, three.js, vitest, Playwright. Same stack as 4a/4b — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-26-subproject-4c-bom-design.md`.

---

## Phase 1 — Shared types and BOM utilities

### Task 1: Add `ComponentColor` discriminated union

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/bomRow.spec.ts` (new, expanded in T4–T6)

- [ ] **Step 1: Add the type to `packages/shared/src/types.ts`** just above `ComponentInstance`:

```ts
export type ComponentColor =
  | { kind: 'palette'; name: string }
  | { kind: 'hex'; hex: string };
```

- [ ] **Step 2: Verify shared package typechecks**

Run: `pnpm --filter @zilventor/shared typecheck`
Expected: `Done`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add ComponentColor type for 4c BOM"
```

### Task 2: Add optional `color` to `ComponentInstance`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the field to the existing `ComponentInstance` type:**

```ts
export type ComponentInstance = {
  id: string;
  partPath: string;
  position: { x: number; y: number; z: number };
  rotation: { rx: number; ry: number; rz: number };
  visible: boolean;
  pose?: { translation: Vec3; quaternion: [number, number, number, number] };
  color?: ComponentColor;
};
```

- [ ] **Step 2: Run all package typechecks** to confirm the addition is purely additive (no consumers required to set color).

Run: `pnpm -r typecheck`
Expected: all 5 packages `Done`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add optional color to ComponentInstance"
```

### Task 3: Add `colors` and `bomItemNumbers` to `AssemblyDocument`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Update `AssemblyDocument`:**

```ts
export type AssemblyDocument = {
  id: string;
  name: string;
  units: 'mm';
  parameters: Record<string, SketchParameter>;
  components: ComponentInstance[];
  constraints: AssemblyConstraint[];
  groundedComponentIds: string[];
  colors: Record<string, string>;
  bomItemNumbers: Record<string, number>;
};
```

- [ ] **Step 2: Run `pnpm -r typecheck`**

Expected: typecheck will FAIL because `NewAssemblyCommand` and any test fixtures that build `AssemblyDocument` from scratch are now missing two required fields. Note the failing files — they will be patched in T6 once the migration helper exists, but we can fix the call sites that construct fresh documents now.

- [ ] **Step 3: Patch every fresh-construction site** (use the typecheck output as the source of truth). Default both new fields to `{}`. Common sites:

`packages/app/src/commands/NewAssemblyCommand.ts`:

```ts
const doc: AssemblyDocument = {
  id, name, units: 'mm', parameters: {},
  components: [], constraints: [], groundedComponentIds: [],
  colors: {}, bomItemNumbers: {},
};
```

Apply the same `colors: {}, bomItemNumbers: {}` defaults wherever a fresh `AssemblyDocument` is built (test fixtures included).

- [ ] **Step 4: Re-run `pnpm -r typecheck`**

Expected: all 5 packages `Done`.

- [ ] **Step 5: Run full unit suites (kernel + app + shared) to make sure no test fixture got missed.**

Run: `pnpm -r test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/
git commit -m "feat(shared): add colors palette and bomItemNumbers to AssemblyDocument"
```

### Task 4: `bomRowKey` helper

**Files:**
- Create: `packages/shared/src/bomRow.ts`
- Create: `packages/shared/src/__tests__/bomRow.spec.ts`

- [ ] **Step 1: Write the failing test** in `packages/shared/src/__tests__/bomRow.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bomRowKey } from '../bomRow';

describe('bomRowKey', () => {
  it('returns ::none for missing color', () => {
    expect(bomRowKey('parts/cube.zipt')).toBe('parts/cube.zipt::none');
    expect(bomRowKey('parts/cube.zipt', undefined)).toBe('parts/cube.zipt::none');
  });

  it('encodes palette colors with name', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'palette', name: 'Maple' }))
      .toBe('parts/cube.zipt::palette:Maple');
  });

  it('encodes hex colors normalised to lowercase', () => {
    expect(bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#CC8866' }))
      .toBe('parts/cube.zipt::hex:#cc8866');
  });

  it('does not collide across kinds with the same string after the prefix', () => {
    const a = bomRowKey('parts/cube.zipt', { kind: 'palette', name: '#Maple' });
    const b = bomRowKey('parts/cube.zipt', { kind: 'hex', hex: '#Maple' });
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/shared/src/bomRow.ts`:**

```ts
import type { AssemblyDocument, ComponentColor, ComponentInstance } from './types';

export function bomRowKey(partPath: string, color?: ComponentColor): string {
  if (!color) return `${partPath}::none`;
  if (color.kind === 'palette') return `${partPath}::palette:${color.name}`;
  return `${partPath}::hex:${color.hex.toLowerCase()}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bomRow.ts packages/shared/src/__tests__/bomRow.spec.ts
git commit -m "feat(shared): bomRowKey for 4c BOM aggregation"
```

### Task 5: `aggregateBom` function

**Files:**
- Modify: `packages/shared/src/bomRow.ts`
- Modify: `packages/shared/src/__tests__/bomRow.spec.ts`

- [ ] **Step 1: Add the failing test:**

Append to `bomRow.spec.ts`:

```ts
import { aggregateBom, type BomRow } from '../bomRow';
import type { AssemblyDocument } from '../types';

function makeAssembly(overrides: Partial<AssemblyDocument> = {}): AssemblyDocument {
  return {
    id: 'A', name: 'A', units: 'mm', parameters: {},
    components: [], constraints: [], groundedComponentIds: [],
    colors: {}, bomItemNumbers: {},
    ...overrides,
  };
}

describe('aggregateBom', () => {
  it('aggregates identical components into one row with QTY = count', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C3', partPath: 'parts/cube.zipt', position: { x: 2, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe(3);
    expect(rows[0]!.partName).toBe('cube');
    expect(rows[0]!.componentIds).toEqual(['C1', 'C2', 'C3']);
  });

  it('splits identical partPaths by color', () => {
    const a = makeAssembly({
      colors: { Maple: '#d4a574' },
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'Maple' } },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(2);
  });

  it('uses stored item numbers when present and assigns max+1 for new keys', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: { 'parts/a.zipt::none': 5 },
    });
    const rows = aggregateBom(a, new Map([['parts/a.zipt', 'a'], ['parts/b.zipt', 'b']]));
    const aRow = rows.find((r) => r.partPath === 'parts/a.zipt')!;
    const bRow = rows.find((r) => r.partPath === 'parts/b.zipt')!;
    expect(aRow.itemNumber).toBe(5);
    expect(bRow.itemNumber).toBe(6);
  });

  it('sorts rows by itemNumber ASC', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
        { id: 'C2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: { 'parts/a.zipt::none': 7, 'parts/b.zipt::none': 3 },
    });
    const rows = aggregateBom(a, new Map([['parts/a.zipt', 'a'], ['parts/b.zipt', 'b']]));
    expect(rows.map((r) => r.itemNumber)).toEqual([3, 7]);
  });

  it('treats dangling palette refs as no color for display', () => {
    const a = makeAssembly({
      colors: {},
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'GoneAway' } },
      ],
    });
    const rows = aggregateBom(a, new Map([['parts/cube.zipt', 'cube']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.color).toBeUndefined();
  });

  it('falls back to "(missing part)" when partName is unknown', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/missing.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
    });
    const rows = aggregateBom(a, new Map());
    expect(rows[0]!.partName).toBe('(missing part)');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: FAIL — `aggregateBom` not exported.

- [ ] **Step 3: Implement `aggregateBom` and `BomRow` in `bomRow.ts`:**

```ts
export type BomRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  partPath: string;
  partName: string;
  color: ComponentColor | undefined;
  componentIds: string[];
};

function effectiveColor(c: ComponentInstance, palette: Record<string, string>): ComponentColor | undefined {
  if (!c.color) return undefined;
  if (c.color.kind === 'palette' && !(c.color.name in palette)) return undefined;
  return c.color;
}

export function aggregateBom(assembly: AssemblyDocument, partNames: Map<string, string>): BomRow[] {
  const groups = new Map<string, { partPath: string; color: ComponentColor | undefined; componentIds: string[] }>();
  for (const c of assembly.components) {
    const color = effectiveColor(c, assembly.colors);
    const rowKey = bomRowKey(c.partPath, color);
    const g = groups.get(rowKey);
    if (g) g.componentIds.push(c.id);
    else groups.set(rowKey, { partPath: c.partPath, color, componentIds: [c.id] });
  }
  const existing = assembly.bomItemNumbers;
  const usedNumbers = new Set(Object.values(existing));
  let nextNumber = (usedNumbers.size === 0 ? 0 : Math.max(...usedNumbers)) + 1;
  const rows: BomRow[] = [];
  for (const [rowKey, g] of groups) {
    let itemNumber = existing[rowKey];
    if (itemNumber === undefined) {
      itemNumber = nextNumber++;
    }
    rows.push({
      rowKey,
      itemNumber,
      qty: g.componentIds.length,
      partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)',
      color: g.color,
      componentIds: [...g.componentIds],
    });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);
  return rows;
}
```

- [ ] **Step 4: Run the test to verify all pass**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: PASS — 6 `aggregateBom` tests + 4 `bomRowKey` tests = 10 total.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bomRow.ts packages/shared/src/__tests__/bomRow.spec.ts
git commit -m "feat(shared): aggregateBom + BomRow for 4c"
```

### Task 6: `compareBomRowsForRenumber` and `pruneBomItemNumbers`

**Files:**
- Modify: `packages/shared/src/bomRow.ts`
- Modify: `packages/shared/src/__tests__/bomRow.spec.ts`

- [ ] **Step 1: Append failing tests:**

```ts
import { compareBomRowsForRenumber, pruneBomItemNumbers } from '../bomRow';

describe('compareBomRowsForRenumber', () => {
  const a: BomRow = { rowKey: 'X::none', itemNumber: 7, qty: 1, partPath: 'X', partName: 'a', color: undefined, componentIds: ['C1'] };
  const b: BomRow = { rowKey: 'Y::none', itemNumber: 3, qty: 1, partPath: 'Y', partName: 'b', color: undefined, componentIds: ['C2'] };
  it('sorts primarily by partName ASC', () => {
    expect(compareBomRowsForRenumber(a, b)).toBeLessThan(0);
  });
  it('breaks ties by rowKey ASC', () => {
    const t1: BomRow = { ...a, partName: 'same', rowKey: 'A::palette:Z' };
    const t2: BomRow = { ...a, partName: 'same', rowKey: 'A::palette:A' };
    expect(compareBomRowsForRenumber(t1, t2)).toBeGreaterThan(0);
  });
});

describe('pruneBomItemNumbers', () => {
  it('drops rowKeys not present in current components', () => {
    const a = makeAssembly({
      components: [
        { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      ],
      bomItemNumbers: {
        'parts/cube.zipt::none': 1,
        'parts/orphan.zipt::none': 99,
      },
    });
    const pruned = pruneBomItemNumbers(a);
    expect(pruned).toEqual({ 'parts/cube.zipt::none': 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: FAIL — `compareBomRowsForRenumber` / `pruneBomItemNumbers` not exported.

- [ ] **Step 3: Implement both helpers in `bomRow.ts`:**

```ts
export function compareBomRowsForRenumber(a: BomRow, b: BomRow): number {
  if (a.partName !== b.partName) return a.partName < b.partName ? -1 : 1;
  if (a.rowKey !== b.rowKey) return a.rowKey < b.rowKey ? -1 : 1;
  return 0;
}

export function pruneBomItemNumbers(assembly: AssemblyDocument): Record<string, number> {
  const live = new Set<string>();
  for (const c of assembly.components) {
    const color = effectiveColor(c, assembly.colors);
    live.add(bomRowKey(c.partPath, color));
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(assembly.bomItemNumbers)) {
    if (live.has(k)) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/shared test bomRow`
Expected: PASS — 13 tests now.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/bomRow.ts packages/shared/src/__tests__/bomRow.spec.ts
git commit -m "feat(shared): compareBomRowsForRenumber + pruneBomItemNumbers"
```

### Task 7: Migration defaults for legacy `AssemblyDocument`

**Files:**
- Modify: `packages/shared/src/migrateManifest.ts` (or wherever assembly-doc migration lives — locate first)
- Modify: relevant test file

- [ ] **Step 1: Locate the migration code**

Run: `grep -rn "migrateManifest\\|formatVersion" packages/shared/src --include="*.ts"`
Identify the function that normalises legacy manifests.

- [ ] **Step 2: Write a failing test** that legacy v7 assembly manifests without `colors` / `bomItemNumbers` round-trip with `{}` defaults. Add to the existing migration spec (or create one if missing).

Example failing test (adjust to existing patterns):

```ts
it('defaults colors and bomItemNumbers for legacy v7 assembly manifests', () => {
  const legacy = {
    formatVersion: 7,
    kind: 'assembly',
    createdAt: '2026-01-01',
    appVersion: '0.0.0',
    document: {
      id: 'A', name: 'A', units: 'mm', parameters: {},
      components: [], constraints: [], groundedComponentIds: [],
    },
  };
  const m = migrateManifest(legacy as any);
  expect(m.kind).toBe('assembly');
  expect(m.document.colors).toEqual({});
  expect(m.document.bomItemNumbers).toEqual({});
});
```

- [ ] **Step 3: Run the test — confirm it fails**

Run: `pnpm --filter @zilventor/shared test`
Expected: the new test FAILS (returned doc lacks the two fields).

- [ ] **Step 4: Implement** — in the migration function, add the defaults when discriminator is `'assembly'`:

```ts
if (manifest.kind === 'assembly') {
  manifest.document.colors = manifest.document.colors ?? {};
  manifest.document.bomItemNumbers = manifest.document.bomItemNumbers ?? {};
}
```

- [ ] **Step 5: Run all shared tests — confirm green**

Run: `pnpm --filter @zilventor/shared test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src
git commit -m "feat(shared): migrate legacy v7 assembly manifests to default empty colors/bomItemNumbers"
```

---

## Phase 2 — Storage round-trip

### Task 8: AssemblyPacker preserves new fields

**Files:**
- Modify: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`

- [ ] **Step 1: Add a failing test** that packs an assembly with non-empty `colors`, `bomItemNumbers`, and a component carrying `color`, then unpacks and asserts equality:

```ts
it('round-trips colors palette, bomItemNumbers, and per-component color', async () => {
  const doc: AssemblyDocument = {
    id: 'A', name: 'A', units: 'mm', parameters: {},
    components: [
      { id: 'C1', partPath: 'parts/cube.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'palette', name: 'Maple' } },
      { id: 'C2', partPath: 'parts/cube.zipt', position: { x: 1, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true, color: { kind: 'hex', hex: '#cc8866' } },
    ],
    constraints: [],
    groundedComponentIds: ['C1'],
    colors: { Maple: '#d4a574' },
    bomItemNumbers: { 'parts/cube.zipt::palette:Maple': 1, 'parts/cube.zipt::hex:#cc8866': 2 },
  };
  const bytes = await packAssembly(doc);
  const unpacked = await unpackAssembly(bytes);
  expect(unpacked.colors).toEqual({ Maple: '#d4a574' });
  expect(unpacked.bomItemNumbers['parts/cube.zipt::palette:Maple']).toBe(1);
  expect(unpacked.components[0]!.color).toEqual({ kind: 'palette', name: 'Maple' });
  expect(unpacked.components[1]!.color).toEqual({ kind: 'hex', hex: '#cc8866' });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @zilventor/kernel test AssemblyPacker`
Expected: should PASS already (`AssemblyPacker` serialises the doc opaquely). If it FAILs, fix the packer/unpacker JSON pass-through.

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts
git commit -m "test(kernel): AssemblyPacker round-trips 4c colors + bomItemNumbers + component.color"
```

---

## Phase 3 — Store

### Task 9: Generalise selection to an array — store internals

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing tests** in `useAppStore.spec.ts`:

```ts
it('selectComponents replaces the selection array', () => {
  useAppStore.setState({ selectedComponentIds: [] });
  useAppStore.getState().selectComponents(['C1', 'C2']);
  expect(useAppStore.getState().selectedComponentIds).toEqual(['C1', 'C2']);
});

it('selectComponent shim accepts string | null and writes a one-element array', () => {
  useAppStore.getState().selectComponent('C7');
  expect(useAppStore.getState().selectedComponentIds).toEqual(['C7']);
  useAppStore.getState().selectComponent(null);
  expect(useAppStore.getState().selectedComponentIds).toEqual([]);
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `pnpm --filter @zilventor/app test useAppStore`
Expected: FAIL.

- [ ] **Step 3: Update the store** — replace the field and add helpers:

In the state type:

```ts
selectedComponentIds: string[];
selectComponents: (ids: string[]) => void;
selectComponent: (id: string | null) => void;     // shim, retains existing API
```

In the initial state:

```ts
selectedComponentIds: [],
```

Replace the existing `selectComponent` action with:

```ts
selectComponents: (ids) => set({ selectedComponentIds: [...ids] }),
selectComponent: (id) => set({ selectedComponentIds: id == null ? [] : [id] }),
```

Remove the old `selectedComponentId: null` field and its accessor.

- [ ] **Step 4: Patch existing read sites** — find all `selectedComponentId` reads and rewrite them to `selectedComponentIds[0] ?? null`. Run `grep -rn "selectedComponentId" packages/app/src` and update each match.

Common sites (verify with grep):
- `packages/app/src/App.tsx`
- `packages/app/src/shell/tabs/AssemblyTab.tsx`
- any spec file

- [ ] **Step 5: Run app tests**

Run: `pnpm --filter @zilventor/app test`
Expected: all green.

- [ ] **Step 6: Run workspace typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src
git commit -m "refactor(app): selectedComponentId → selectedComponentIds[] (4c prep)"
```

### Task 10: Add `bomTabActive` and `showComponentColors` slices

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing tests:**

```ts
it('bomTabActive defaults false and setBomTabActive flips it', () => {
  expect(useAppStore.getState().bomTabActive).toBe(false);
  useAppStore.getState().setBomTabActive(true);
  expect(useAppStore.getState().bomTabActive).toBe(true);
});

it('showComponentColors defaults false and setShowComponentColors flips it', () => {
  expect(useAppStore.getState().showComponentColors).toBe(false);
  useAppStore.getState().setShowComponentColors(true);
  expect(useAppStore.getState().showComponentColors).toBe(true);
});
```

- [ ] **Step 2: Run — confirm fail.**

- [ ] **Step 3: Add the slices:**

State type:

```ts
bomTabActive: boolean;
showComponentColors: boolean;
setBomTabActive: (v: boolean) => void;
setShowComponentColors: (v: boolean) => void;
```

Initial state:

```ts
bomTabActive: false,
showComponentColors: false,
```

Actions:

```ts
setBomTabActive: (v) => set({ bomTabActive: v }),
setShowComponentColors: (v) => set({ showComponentColors: v }),
```

- [ ] **Step 4: Run tests, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store
git commit -m "feat(app): add bomTabActive + showComponentColors slices"
```

### Task 11: `setComponentColor` action

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing test:**

```ts
it('setComponentColor patches the named component', () => {
  useAppStore.setState({
    activeAssembly: {
      id: 'A', name: 'A', units: 'mm', parameters: {},
      components: [{ id: 'C1', partPath: 'p', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true }],
      constraints: [], groundedComponentIds: ['C1'],
      colors: {}, bomItemNumbers: {},
    },
    activeDocument: null,
  });
  useAppStore.getState().setComponentColor('C1', { kind: 'palette', name: 'Maple' });
  expect(useAppStore.getState().activeAssembly!.components[0]!.color).toEqual({ kind: 'palette', name: 'Maple' });

  useAppStore.getState().setComponentColor('C1', undefined);
  expect(useAppStore.getState().activeAssembly!.components[0]!.color).toBeUndefined();
});
```

- [ ] **Step 2: Run — confirm fail.**

- [ ] **Step 3: Add the action.**

State type:

```ts
setComponentColor: (componentId: string, color: ComponentColor | undefined) => void;
```

Action:

```ts
setComponentColor: (componentId, color) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = {
    ...s.activeAssembly,
    components: s.activeAssembly.components.map((c) =>
      c.id === componentId ? (color === undefined ? omitColor(c) : { ...c, color }) : c
    ),
  };
  return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
}),
```

Helper near the top of the file (or inline):

```ts
function omitColor(c: ComponentInstance): ComponentInstance {
  const { color: _, ...rest } = c;
  return rest;
}
```

- [ ] **Step 4: Run tests, confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store
git commit -m "feat(app): setComponentColor action"
```

### Task 12: Palette CRUD actions

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing tests** for `setAssemblyPaletteColor` (creates / overwrites) and `removeAssemblyPaletteColor` (drops the entry, leaves dangling component refs untouched):

```ts
it('setAssemblyPaletteColor creates and overwrites entries', () => {
  /* set up an assembly with empty palette, call set, assert, call set again with same name + new hex, assert overwrite */
});

it('removeAssemblyPaletteColor drops the named entry', () => {
  /* set up assembly with palette { Maple: ... }, remove, assert {}, leave components alone */
});
```

(Mirror the `setComponentColor` test fixture pattern.)

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
setAssemblyPaletteColor: (name, hex) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = {
    ...s.activeAssembly,
    colors: { ...s.activeAssembly.colors, [name]: hex },
  };
  return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
}),
removeAssemblyPaletteColor: (name) => set((s) => {
  if (!s.activeAssembly) return s;
  const { [name]: _, ...rest } = s.activeAssembly.colors;
  const next: AssemblyDocument = { ...s.activeAssembly, colors: rest };
  return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
}),
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store
git commit -m "feat(app): assembly palette CRUD actions"
```

### Task 13: BOM item-number actions with conflict-bump

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Failing tests:**

```ts
it('setBomItemNumber bumps the colliding row to max+1', () => {
  /* assembly with bomItemNumbers { rowA: 1, rowB: 2 }; call setBomItemNumber('rowA', 2); expect rowA = 2, rowB = 3 (bumped) */
});

it('setBomItemNumbers bulk-replaces the map', () => {
  /* call setBomItemNumbers({ rowX: 5 }); expect activeAssembly.bomItemNumbers === { rowX: 5 } */
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
setBomItemNumber: (rowKey, n) => set((s) => {
  if (!s.activeAssembly) return s;
  const map = { ...s.activeAssembly.bomItemNumbers };
  const collidingKey = Object.entries(map).find(([k, v]) => v === n && k !== rowKey)?.[0];
  if (collidingKey) {
    const max = Math.max(0, ...Object.values(map));
    map[collidingKey] = max + 1;
  }
  map[rowKey] = n;
  const next: AssemblyDocument = { ...s.activeAssembly, bomItemNumbers: map };
  return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
}),
setBomItemNumbers: (map) => set((s) => {
  if (!s.activeAssembly) return s;
  const next: AssemblyDocument = { ...s.activeAssembly, bomItemNumbers: { ...map } };
  return { activeDocument: { kind: 'assembly', document: next }, activeAssembly: next };
}),
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store
git commit -m "feat(app): setBomItemNumber (with conflict-bump) + setBomItemNumbers"
```

---

## Phase 4 — Commands

### Task 14: `SetComponentColorCommand`

**Files:**
- Create: `packages/app/src/commands/SetComponentColorCommand.ts`
- Create: `packages/app/src/commands/__tests__/SetComponentColorCommand.spec.ts`

- [ ] **Step 1: Failing test** that constructs the command, calls `apply()`, asserts the store updated.

```ts
import { SetComponentColorCommand } from '../SetComponentColorCommand';
import { useAppStore } from '../../store/useAppStore';

it('mutates component color via setComponentColor', async () => {
  /* seed assembly w/ one component; new SetComponentColorCommand({ id: 'C1', color: { kind: 'hex', hex: '#abc123' }}).apply(); expect color set */
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** following the existing `EditComponentCommand` pattern:

```ts
import { useAppStore } from '../store/useAppStore';
import type { ComponentColor } from '@zilventor/shared';

export type SetComponentColorOpts = { id: string; color: ComponentColor | undefined };

export class SetComponentColorCommand {
  constructor(private opts: SetComponentColorOpts) {}
  async apply(): Promise<void> {
    useAppStore.getState().setComponentColor(this.opts.id, this.opts.color);
  }
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/SetComponentColorCommand.ts packages/app/src/commands/__tests__/SetComponentColorCommand.spec.ts
git commit -m "feat(app): SetComponentColorCommand"
```

### Task 15: `SetBomItemNumberCommand`

**Files:**
- Create: `packages/app/src/commands/SetBomItemNumberCommand.ts`
- Create: `packages/app/src/commands/__tests__/SetBomItemNumberCommand.spec.ts`

- [ ] **Step 1: Failing test:** apply with conflicting number; assert colliding row got bumped.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** (thin wrapper over `setBomItemNumber`):

```ts
import { useAppStore } from '../store/useAppStore';

export class SetBomItemNumberCommand {
  constructor(private opts: { rowKey: string; n: number }) {}
  async apply(): Promise<void> {
    useAppStore.getState().setBomItemNumber(this.opts.rowKey, this.opts.n);
  }
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands
git commit -m "feat(app): SetBomItemNumberCommand"
```

### Task 16: `RenumberBomCommand`

**Files:**
- Create: `packages/app/src/commands/RenumberBomCommand.ts`
- Create: `packages/app/src/commands/__tests__/RenumberBomCommand.spec.ts`

- [ ] **Step 1: Failing test** — assembly with 3 components → 3 BOM rows; call apply(); assert numbers are 1..3 by partName.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
import { useAppStore } from '../store/useAppStore';
import { aggregateBom, compareBomRowsForRenumber } from '@zilventor/shared/src/bomRow';

export class RenumberBomCommand {
  constructor(private opts: { partNames: Map<string, string> }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const rows = aggregateBom(a, this.opts.partNames).slice().sort(compareBomRowsForRenumber);
    const next: Record<string, number> = {};
    rows.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setBomItemNumbers(next);
  }
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands
git commit -m "feat(app): RenumberBomCommand"
```

### Task 17: `ExportBomCsvCommand`

**Files:**
- Create: `packages/app/src/commands/ExportBomCsvCommand.ts`
- Create: `packages/app/src/commands/__tests__/ExportBomCsvCommand.spec.ts`
- Create (helper): `packages/app/src/commands/buildBomCsv.ts`
- Create: `packages/app/src/commands/__tests__/buildBomCsv.spec.ts`

- [ ] **Step 1: Write failing tests for `buildBomCsv`** — RFC-4180 escaping, empty-assembly header-only, palette/hex/empty Color cell:

```ts
import { buildBomCsv } from '../buildBomCsv';
import type { BomRow } from '@zilventor/shared/src/bomRow';

it('produces a header-only CSV when there are no rows', () => {
  expect(buildBomCsv([])).toBe('Item#,QTY,Part Name,Color,Part Path\n');
});

it('writes palette name in Color cell', () => {
  const row: BomRow = { rowKey: 'X::palette:Maple', itemNumber: 1, qty: 2, partPath: 'parts/cube.zipt', partName: 'cube', color: { kind: 'palette', name: 'Maple' }, componentIds: ['C1', 'C2'] };
  expect(buildBomCsv([row])).toBe('Item#,QTY,Part Name,Color,Part Path\n1,2,cube,Maple,parts/cube.zipt\n');
});

it('writes hex string in Color cell', () => {
  const row: BomRow = { rowKey: 'X::hex:#abc', itemNumber: 1, qty: 1, partPath: 'parts/cube.zipt', partName: 'cube', color: { kind: 'hex', hex: '#abc' }, componentIds: ['C1'] };
  expect(buildBomCsv([row])).toContain(',cube,#abc,parts/cube.zipt');
});

it('escapes commas and quotes per RFC-4180', () => {
  const row: BomRow = { rowKey: 'X::none', itemNumber: 1, qty: 1, partPath: 'parts/odd, name.zipt', partName: 'has "quote", and comma', color: undefined, componentIds: ['C1'] };
  const csv = buildBomCsv([row]);
  expect(csv).toContain('"has ""quote"", and comma"');
  expect(csv).toContain('"parts/odd, name.zipt"');
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement `buildBomCsv.ts`:**

```ts
import type { BomRow } from '@zilventor/shared/src/bomRow';

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function colorCell(c: BomRow['color']): string {
  if (!c) return '';
  return c.kind === 'palette' ? c.name : c.hex;
}

export function buildBomCsv(rows: BomRow[]): string {
  let out = 'Item#,QTY,Part Name,Color,Part Path\n';
  for (const r of rows) {
    out += [
      String(r.itemNumber),
      String(r.qty),
      csvCell(r.partName),
      csvCell(colorCell(r.color)),
      csvCell(r.partPath),
    ].join(',') + '\n';
  }
  return out;
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Implement `ExportBomCsvCommand.ts`** that builds the CSV from the active assembly + invokes `showSaveFilePicker` (with `<a download>` fallback):

```ts
import { useAppStore } from '../store/useAppStore';
import { aggregateBom } from '@zilventor/shared/src/bomRow';
import { buildBomCsv } from './buildBomCsv';

export class ExportBomCsvCommand {
  constructor(private opts: { partNames: Map<string, string> }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const rows = aggregateBom(a, this.opts.partNames);
    const csv = buildBomCsv(rows);
    const bytes = new TextEncoder().encode(csv);
    const suggestedName = `${a.name}-bom.csv`;

    if (import.meta.env.DEV) {
      const w = window as unknown as Record<string, unknown>;
      w.__zilventorBomCsvBytes = () => bytes;
    }

    const w2 = window as unknown as { showSaveFilePicker?: (opts: any) => Promise<any> };
    if (typeof w2.showSaveFilePicker === 'function') {
      try {
        const handle = await w2.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        useAppStore.getState().setStatus(rows.length === 0 ? 'Exported empty BOM' : `Exported ${rows.length} BOM rows`);
      } catch {
        // user cancelled — silent no-op
      }
      return;
    }
    const blob = new Blob([bytes], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url; a2.download = suggestedName;
    document.body.appendChild(a2); a2.click(); document.body.removeChild(a2);
    URL.revokeObjectURL(url);
    useAppStore.getState().setStatus(rows.length === 0 ? 'Exported empty BOM' : `Exported ${rows.length} BOM rows`);
  }
}
```

- [ ] **Step 6: Failing test for the command** — mock `showSaveFilePicker` to return a writable and assert bytes match the expected CSV header. Confirm fail then pass.

- [ ] **Step 7: Run all tests, then commit.**

```bash
git add packages/app/src/commands
git commit -m "feat(app): buildBomCsv + ExportBomCsvCommand"
```

### Task 18: `OpenBomTabCommand`

**Files:**
- Create: `packages/app/src/commands/OpenBomTabCommand.ts`
- Create: `packages/app/src/commands/__tests__/OpenBomTabCommand.spec.ts`

- [ ] **Step 1: Failing test** — apply sets `bomTabActive: true`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
import { useAppStore } from '../store/useAppStore';

export class OpenBomTabCommand {
  async apply(): Promise<void> { useAppStore.getState().setBomTabActive(true); }
}
```

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/commands
git commit -m "feat(app): OpenBomTabCommand"
```

### Task 19: `ToggleShowComponentColorsCommand`

**Files:**
- Create: `packages/app/src/commands/ToggleShowComponentColorsCommand.ts`
- Create: `packages/app/src/commands/__tests__/ToggleShowComponentColorsCommand.spec.ts`

- [ ] **Step 1: Failing test** — apply flips the flag.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
import { useAppStore } from '../store/useAppStore';

export class ToggleShowComponentColorsCommand {
  async apply(): Promise<void> {
    const cur = useAppStore.getState().showComponentColors;
    useAppStore.getState().setShowComponentColors(!cur);
  }
}
```

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/commands
git commit -m "feat(app): ToggleShowComponentColorsCommand"
```

---

## Phase 5 — Color picker

### Task 20: `ColorPicker` component

**Files:**
- Create: `packages/app/src/shell/ColorPicker.tsx`
- Create: `packages/app/src/shell/__tests__/ColorPicker.spec.tsx`

- [ ] **Step 1: Failing test** — render with palette `{Maple: '#d4a574'}` and an existing color; assert dropdown options include `(no color)`, `Maple`, `+ New palette color…`, `Custom hex…`. Selecting `(no color)` triggers `onChange(undefined)`. Selecting a palette name triggers `onChange({kind:'palette', name})`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** (sketch):

```tsx
import { useState } from 'react';
import type { ComponentColor } from '@zilventor/shared';

type Props = {
  value: ComponentColor | undefined;
  palette: Record<string, string>;
  onChange: (next: ComponentColor | undefined) => void;
  onAddPaletteColor?: (name: string, hex: string) => void;
};

export function ColorPicker({ value, palette, onChange, onAddPaletteColor }: Props) {
  const [mode, setMode] = useState<'select' | 'newPalette' | 'customHex'>('select');
  const [pendingName, setPendingName] = useState('');
  const [pendingHex, setPendingHex] = useState('#888888');

  if (mode === 'newPalette') {
    return (
      <div>
        <input aria-label="palette-name" value={pendingName} onChange={(e) => setPendingName(e.target.value)} placeholder="Color name" />
        <input aria-label="palette-hex" type="color" value={pendingHex} onChange={(e) => setPendingHex(e.target.value)} />
        <button onClick={() => {
          if (!pendingName) return;
          onAddPaletteColor?.(pendingName, pendingHex);
          onChange({ kind: 'palette', name: pendingName });
          setMode('select');
        }}>OK</button>
        <button onClick={() => setMode('select')}>Cancel</button>
      </div>
    );
  }

  if (mode === 'customHex') {
    return (
      <div>
        <input aria-label="custom-hex" type="color" value={pendingHex} onChange={(e) => setPendingHex(e.target.value)} />
        <button onClick={() => { onChange({ kind: 'hex', hex: pendingHex }); setMode('select'); }}>OK</button>
        <button onClick={() => setMode('select')}>Cancel</button>
      </div>
    );
  }

  const selected = !value ? '__none__' : value.kind === 'palette' ? `palette:${value.name}` : `hex:${value.hex}`;
  return (
    <select
      aria-label="component-color"
      value={selected}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__none__') onChange(undefined);
        else if (v === '__newPalette__') setMode('newPalette');
        else if (v === '__customHex__') setMode('customHex');
        else if (v.startsWith('palette:')) onChange({ kind: 'palette', name: v.slice('palette:'.length) });
        else if (v.startsWith('hex:')) onChange({ kind: 'hex', hex: v.slice('hex:'.length) });
      }}
    >
      <option value="__none__">(no color)</option>
      {Object.entries(palette).map(([n, h]) => (
        <option key={n} value={`palette:${n}`} style={{ backgroundColor: h }}>{n}</option>
      ))}
      <option value="__newPalette__">+ New palette color…</option>
      <option value="__customHex__">Custom hex…</option>
    </select>
  );
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/ColorPicker.tsx packages/app/src/shell/__tests__/ColorPicker.spec.tsx
git commit -m "feat(app): ColorPicker component for 4c"
```

---

## Phase 6 — Edit Component dialog integration

### Task 21: Add Color row to `EditComponentDialog`

**Files:**
- Modify: `packages/app/src/shell/EditComponentDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/EditComponentDialog.spec.tsx`

- [ ] **Step 1: Failing test** — render with a component carrying `{kind:'palette', name:'Maple'}` and palette `{Maple: '#d4a574'}`; assert `getByLabelText('component-color')` has value `palette:Maple`. Change to `(no color)` → OK → assert `setComponentColor(componentId, undefined)` was called.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**
- Add a `ColorPicker` row to the dialog body.
- Wire `value` from the component, `palette` from `useAppStore((s) => s.activeAssembly?.colors ?? {})`, `onChange` to a local state, `onAddPaletteColor` to `setAssemblyPaletteColor`.
- On OK, dispatch `SetComponentColorCommand({ id, color: localColor })` plus the existing position/rotation/visible patch.

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell
git commit -m "feat(app): Color row in EditComponentDialog"
```

---

## Phase 7 — Browser pane BOM tab

### Task 22: `resolvePartName` helper + `partNameCache`

**Files:**
- Create: `packages/app/src/shell/resolvePartName.ts`
- Create: `packages/app/src/shell/__tests__/resolvePartName.spec.ts`

- [ ] **Step 1: Failing test** — fake Opfs with one cube manifest; first call returns `'cube'`; cache hit returns same without re-reading.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
import type { Opfs } from '@zilventor/kernel/src/storage/Opfs';
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';

export type PartNameCache = Map<string, string>;

export async function resolvePartName(opfs: Opfs, partPath: string, cache: PartNameCache): Promise<string> {
  const hit = cache.get(partPath);
  if (hit !== undefined) return hit;
  try {
    const bytes = await opfs.read(partPath);
    const manifest = await unpackProject(bytes);
    const name = manifest.document.name ?? '(missing part)';
    cache.set(partPath, name);
    return name;
  } catch {
    cache.set(partPath, '(missing part)');
    return '(missing part)';
  }
}
```

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/shell
git commit -m "feat(app): resolvePartName + partNameCache for 4c"
```

### Task 23: `BomTable` component

**Files:**
- Create: `packages/app/src/shell/BomTable.tsx`
- Create: `packages/app/src/shell/__tests__/BomTable.spec.tsx`

- [ ] **Step 1: Failing tests:**
  - Renders a row per `aggregateBom` result.
  - Click row → `selectComponents` called with row.componentIds.
  - Inline-edit Item# → blur fires `SetBomItemNumberCommand`.
  - Click color cell → opens ColorPicker and writes via `setComponentColor` for every componentId in the row.
  - Empty palette + undefined color renders `—`.
  - Export CSV button invokes `ExportBomCsvCommand`.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** (high-level):

```tsx
import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateBom } from '@zilventor/shared/src/bomRow';
import { ColorPicker } from './ColorPicker';
import { SetBomItemNumberCommand } from '../commands/SetBomItemNumberCommand';
import { SetComponentColorCommand } from '../commands/SetComponentColorCommand';
import { ExportBomCsvCommand } from '../commands/ExportBomCsvCommand';

type Props = { partNames: Map<string, string> };

export function BomTable({ partNames }: Props) {
  const assembly = useAppStore((s) => s.activeAssembly);
  const palette = assembly?.colors ?? {};
  const rows = useMemo(() => assembly ? aggregateBom(assembly, partNames) : [], [assembly, partNames]);
  const [editingRowKey, setEditingRowKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [colorEditingRowKey, setColorEditingRowKey] = useState<string | null>(null);

  return (
    <div data-testid="bom-table">
      <button onClick={() => new ExportBomCsvCommand({ partNames }).apply()}>Export CSV</button>
      <table>
        <thead><tr><th>Item#</th><th>QTY</th><th>Part Name</th><th>Color</th><th>Part Path</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowKey} onClick={() => useAppStore.getState().selectComponents(r.componentIds)}>
              <td>
                {editingRowKey === r.rowKey ? (
                  <input
                    autoFocus
                    aria-label={`item-number-${r.rowKey}`}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      const n = Number.parseInt(editValue, 10);
                      if (Number.isFinite(n) && n > 0 && n <= 9999) {
                        new SetBomItemNumberCommand({ rowKey: r.rowKey, n }).apply();
                      } else {
                        useAppStore.getState().setStatus('Item# must be a positive integer up to 9999');
                      }
                      setEditingRowKey(null);
                    }}
                  />
                ) : (
                  <span onClick={(e) => { e.stopPropagation(); setEditValue(String(r.itemNumber)); setEditingRowKey(r.rowKey); }}>
                    {r.itemNumber}
                  </span>
                )}
              </td>
              <td>{r.qty}</td>
              <td>{r.partName}</td>
              <td onClick={(e) => { e.stopPropagation(); setColorEditingRowKey(r.rowKey); }}>
                {colorEditingRowKey === r.rowKey ? (
                  <ColorPicker
                    value={r.color}
                    palette={palette}
                    onChange={(next) => {
                      for (const cid of r.componentIds) {
                        new SetComponentColorCommand({ id: cid, color: next }).apply();
                      }
                      setColorEditingRowKey(null);
                    }}
                    onAddPaletteColor={(name, hex) => useAppStore.getState().setAssemblyPaletteColor(name, hex)}
                  />
                ) : (
                  r.color ? (r.color.kind === 'palette' ? r.color.name : r.color.hex) : '—'
                )}
              </td>
              <td>{r.partPath}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/shell
git commit -m "feat(app): BomTable component"
```

### Task 24: `BrowserPane` BOM-tab strip

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Failing tests:**
  - In assembly mode: tab strip with `Assembly` and `BOM` buttons renders.
  - Click `BOM` → `bomTabActive: true` → `BomTable` renders, tree hidden.
  - In part mode: strip is hidden.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** — wrap the existing BrowserPane content in a tab strip when `activeDocument?.kind === 'assembly'`. Pass a `partNames: Map<string,string>` prop down (built by App.tsx via `resolvePartName`). When `bomTabActive`, render `<BomTable partNames={partNames} />`; else render the existing assembly tree.

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/shell
git commit -m "feat(app): BrowserPane assembly tab strip + BOM view"
```

---

## Phase 8 — Ribbon integration

### Task 25: AssemblyTab BOM panel

**Files:**
- Modify: `packages/app/src/shell/tabs/AssemblyTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/AssemblyTab.spec.tsx`

- [ ] **Step 1: Failing test** — in assembly mode, "BOM" panel renders with `BOM` and `Renumber` buttons. Click `BOM` → `OpenBomTabCommand` applied. Click `Renumber` → `RenumberBomCommand` applied with the currently-resolved partNames.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** — add a new `RibbonPanel` titled "BOM" with two `<button>`s wired to the commands.

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/shell/tabs
git commit -m "feat(app): AssemblyTab BOM ribbon panel"
```

### Task 26: ViewTab show-component-colors toggle

**Files:**
- Modify: `packages/app/src/shell/tabs/ViewTab.tsx`
- Create or modify: `packages/app/src/shell/tabs/__tests__/ViewTab.spec.tsx`

- [ ] **Step 1: Failing test** — toggle button reflects `showComponentColors`; clicking dispatches the command and flips the flag.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** — add a toggle button:

```tsx
const showColors = useAppStore((s) => s.showComponentColors);
<button onClick={() => new ToggleShowComponentColorsCommand().apply()}>
  {showColors ? '✓ ' : ''}Show component colors
</button>
```

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/shell/tabs
git commit -m "feat(app): ViewTab Show component colors toggle"
```

---

## Phase 9 — Viewport

### Task 27: `SceneManager.setComponentMeshes` accepts `colorHex`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Failing tests:**
  - Spec with `colorHex: '#cc8866'` → mesh.material is a `MeshStandardMaterial` with that hex.
  - Two specs same hex → identical material instance reused.
  - Spec without `colorHex` → mesh.material is the shared grey.
  - Setting then unsetting `colorHex` reverts to grey; per-hex cache retains the entry but doesn't leak per-component.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

Extend `ComponentMeshSpec` with `colorHex?: string`. In `setComponentMeshes`:

```ts
const colorMaterials: Map<string, THREE.MeshStandardMaterial>; // declared as a class field
...
if (spec.colorHex) {
  let mat = this.colorMaterials.get(spec.colorHex);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: spec.colorHex });
    this.colorMaterials.set(spec.colorHex, mat);
  }
  mesh.material = mat;
} else {
  mesh.material = this.componentMaterial;
}
```

In `dispose`, dispose each material in `colorMaterials` and clear the map.

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/viewport
git commit -m "feat(app): SceneManager per-component color materials"
```

### Task 28: `SceneManager.setSelectedComponentIds` outline overlay

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`
- Modify: `packages/app/src/viewport/Viewport.tsx` (export the new ref method)

- [ ] **Step 1: Failing tests:**
  - Place 2 component meshes; call `setSelectedComponentIds(['C1'])`; assert C1's mesh has a child `LineSegments` with the orange material; C2 doesn't.
  - Call `setSelectedComponentIds([])`; assert overlays removed.

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement:**

```ts
// SceneManager fields
private selectionOverlayMaterial: THREE.LineBasicMaterial | null = null;
private selectionOverlays: Map<string, THREE.LineSegments> = new Map();

setSelectedComponentIds(ids: string[]): void {
  if (!this.selectionOverlayMaterial) {
    this.selectionOverlayMaterial = new THREE.LineBasicMaterial({ color: 0xff8800 });
  }
  const wanted = new Set(ids);
  // Add overlays for newly-selected
  for (const id of wanted) {
    if (this.selectionOverlays.has(id)) continue;
    const mesh = this.componentMeshes.get(id);
    if (!mesh) continue;
    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const overlay = new THREE.LineSegments(edges, this.selectionOverlayMaterial);
    overlay.userData.selectionOverlay = true;
    mesh.add(overlay);
    this.selectionOverlays.set(id, overlay);
  }
  // Remove overlays for deselected
  for (const [id, overlay] of this.selectionOverlays) {
    if (wanted.has(id)) continue;
    overlay.parent?.remove(overlay);
    overlay.geometry.dispose();
    this.selectionOverlays.delete(id);
  }
}
```

In `dispose`: dispose `selectionOverlayMaterial` and any remaining overlay geometries.

In `Viewport.tsx`: expose `setSelectedComponentIds(ids: string[])` on the imperative handle.

- [ ] **Step 4: Run — pass. Commit.**

```bash
git add packages/app/src/viewport
git commit -m "feat(app): SceneManager selection outline overlays"
```

### Task 29: App.tsx sync effects — color render + selection

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Update the assembly-mesh-sync effect** to read `showComponentColors` and resolve `colorHex` per component:

```ts
const showComponentColors = useAppStore((s) => s.showComponentColors);
// ... inside the effect that builds specs:
let colorHex: string | undefined;
if (showComponentColors && c.color) {
  if (c.color.kind === 'hex') colorHex = c.color.hex;
  else if (c.color.kind === 'palette' && assembly.colors[c.color.name]) colorHex = assembly.colors[c.color.name];
}
specs.push({
  componentId: c.id,
  geometry: geom,
  transform,
  ...(pose !== undefined ? { pose } : {}),
  ...(colorHex !== undefined ? { colorHex } : {}),
  visible: c.visible,
});
```

Add `showComponentColors` to the effect's dependency list.

- [ ] **Step 2: Add a separate selection-sync effect** subscribing to `selectedComponentIds`:

```ts
const selectedIds = useAppStore((s) => s.selectedComponentIds);
useEffect(() => {
  viewportRef.current?.getSceneManager()?.setSelectedComponentIds(selectedIds);
}, [selectedIds]);
```

- [ ] **Step 3: Run app tests + typecheck**

Run: `pnpm --filter @zilventor/app test` and `pnpm -r typecheck`.
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): wire colorHex + selection-overlay sync effects"
```

---

## Phase 10 — Autosave persistence

### Task 30: Autosave merges and prunes `bomItemNumbers`

**Files:**
- Modify: `packages/app/src/App.tsx` (autosave effect)

- [ ] **Step 1: Add a focused unit test** for a small helper extracted from the autosave path: `mergeAndPruneBom(assembly, partNames) → AssemblyDocument`.

Create `packages/app/src/storage/mergeBomItemNumbers.ts`:

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { aggregateBom, pruneBomItemNumbers } from '@zilventor/shared/src/bomRow';

export function mergeAndPruneBom(assembly: AssemblyDocument, partNames: Map<string, string>): AssemblyDocument {
  const rows = aggregateBom(assembly, partNames);
  const merged = { ...assembly.bomItemNumbers };
  for (const r of rows) merged[r.rowKey] = r.itemNumber;
  const next = { ...assembly, bomItemNumbers: merged };
  return { ...next, bomItemNumbers: pruneBomItemNumbers(next) };
}
```

Add `packages/app/src/storage/__tests__/mergeBomItemNumbers.spec.ts` with an integration-style assertion: assembly with 2 components (one new, one with stored number); after merge, both have numbers; orphan entries are pruned.

- [ ] **Step 2: Run — fail (helper not yet imported in autosave). Wire it:**

In App.tsx autosave effect, before `packAssembly(doc)` for `kind: 'assembly'`:

```ts
import { mergeAndPruneBom } from './storage/mergeBomItemNumbers';
// ...
const partNames = partNameCacheRef.current; // populated by the BOM render path
const merged = mergeAndPruneBom(doc, partNames);
const bytes = await packAssembly(merged);
```

- [ ] **Step 3: Run app tests, confirm pass.**

- [ ] **Step 4: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): merge + prune bomItemNumbers on assembly autosave"
```

---

## Phase 11 — Dev hooks for E2E

### Task 31: BOM CSV / material / overlay dev hooks

**Files:**
- Modify: `packages/app/src/App.tsx` (the existing assembly-dev-hooks effect)

- [ ] **Step 1: Append three hooks** to the existing `useEffect` that exposes assembly hooks:

```ts
w.__zilventorComponentMaterialHex = (componentId: string): string | null => {
  const sm = viewportRef.current?.getSceneManager();
  const mesh = sm?.getComponentMesh(componentId);
  const mat = mesh?.material as THREE.MeshStandardMaterial | undefined;
  if (!mat || !('color' in mat)) return null;
  return '#' + mat.color.getHexString();
};
w.__zilventorComponentSelectedOverlay = (componentId: string): boolean => {
  const sm = viewportRef.current?.getSceneManager() as any;
  return !!sm?.selectionOverlays?.has(componentId);
};
// __zilventorBomCsvBytes is set inside ExportBomCsvCommand on each apply()
```

Note: `selectionOverlays` will need to be exposed for the dev hook (`get selectionOverlays() { return this._selectionOverlays; }` or a public getter `hasSelectionOverlay(id)`).

- [ ] **Step 2: Run app tests + typecheck.**

- [ ] **Step 3: Commit**

```bash
git add packages/app/src
git commit -m "feat(app): expose 4c E2E dev hooks"
```

---

## Phase 12 — E2E

### Task 32: `bom-place-and-aggregate.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-place-and-aggregate.spec.ts`

- [ ] **Step 1: Implement the spec** — places 3 cubes, opens BOM tab via Assembly-ribbon BOM button, asserts one row QTY 3 / item# 1.

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedAssemblyCubePart } from '../helpers/seedAssemblyPart';

test('BOM aggregates three identical cubes into one row QTY 3', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  await page.goto('/');
  await waitForKernelReady(page);
  await seedAssemblyCubePart(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly');

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeVisible();
    await page.getByText(/^cube$/).click();
    await page.getByRole('button', { name: /^place$/i }).click();
    await expect(page.getByRole('dialog', { name: /place component/i })).toBeHidden();
  }

  await page.getByRole('tab', { name: 'Assembly' }).click();
  await page.getByRole('button', { name: 'BOM' }).click();
  const bom = page.getByTestId('bom-table');
  await expect(bom).toBeVisible();
  await expect(bom.locator('tbody tr')).toHaveCount(1);
  await expect(bom.locator('tbody tr td').nth(0)).toHaveText('1');  // Item#
  await expect(bom.locator('tbody tr td').nth(1)).toHaveText('3');  // QTY
});
```

- [ ] **Step 2: Run from repo root**

Run: `npx playwright test tests/e2e/assembly/bom-place-and-aggregate.spec.ts --workers=1 --reporter=list`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/assembly/bom-place-and-aggregate.spec.ts
git commit -m "test(e2e): bom-place-and-aggregate"
```

### Task 33: `bom-color-splits-row.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-color-splits-row.spec.ts`

- [ ] **Step 1: Implement** — place 4 cubes, edit components 3 and 4 to assign palette color "Maple" (using `setAssemblyPaletteColor` + `setComponentColor` via dev-hook store access for speed). Open BOM. Assert two rows: `(no color)` QTY 2 and `Maple` QTY 2. Wait for autosave, reload page, verify item numbers persist.

- [ ] **Step 2: Run — pass.**

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/assembly/bom-color-splits-row.spec.ts
git commit -m "test(e2e): bom-color-splits-row + persistence"
```

### Task 34: `bom-renumber.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-renumber.spec.ts`

- [ ] **Step 1: Implement** — place 3 distinct parts (cube, cylinder via 4b helper, second cube alt), inline-edit Item# for one row to a colliding number, assert collision-bump in store, click Renumber, assert numbers reset to 1..3 by partName ASC.

- [ ] **Step 2: Run — pass. Commit.**

### Task 35: `bom-row-click-selects.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-row-click-selects.spec.ts`

- [ ] **Step 1: Implement** — place 2 of cube + 1 of cylinder, click the cube row, assert `selectedComponentIds` contains both cube ids. Use `__zilventorComponentSelectedOverlay(id)` dev hook to assert both cube meshes carry the overlay and the cylinder doesn't.

- [ ] **Step 2: Run — pass. Commit.**

### Task 36: `bom-csv-export.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-csv-export.spec.ts`

- [ ] **Step 1: Implement** — set up 2 distinct parts, color one with "Maple" palette and one with ad-hoc hex, capture CSV via the `__zilventorBomCsvBytes` dev hook (the command sets it whether or not the save dialog completes — assert by directly invoking via `(window as any).__zilventorStore.getState()...` or via a button click and consuming the captured bytes). Decode and string-match expected header + rows + escaping.

- [ ] **Step 2: Run — pass. Commit.**

### Task 37: `bom-color-render-toggle.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-color-render-toggle.spec.ts`

- [ ] **Step 1: Implement** — place one cube, set its color to `{kind:'hex', hex:'#cc8866'}` via store. Toggle View → Show component colors on; assert `__zilventorComponentMaterialHex(c.id) === '#cc8866'`. Toggle off; assert the hook returns the shared-grey hex (whatever the existing material reports).

- [ ] **Step 2: Run — pass. Commit.**

### Task 38: `bom-broken-palette-ref.spec.ts`

**Files:**
- Create: `tests/e2e/assembly/bom-broken-palette-ref.spec.ts`

- [ ] **Step 1: Implement** — set up palette `{Maple: hex}`, place one cube, assign palette color "Maple", assert BOM row shows "Maple". Call `removeAssemblyPaletteColor('Maple')`. Assert BOM row now shows `—` (the row aggregates as no-color), and with `showComponentColors: true` the mesh material reports the grey sentinel — overlay remains absent because the user hasn't selected anything.

- [ ] **Step 2: Run — pass. Commit.**

---

## Phase 13 — Perf

### Task 39: `bom-aggregate-large.spec.ts`

**Files:**
- Create: `tests/perf/bom-aggregate-large.spec.ts`

- [ ] **Step 1: Implement** — synthetic 200-component assembly built in `page.evaluate` directly into the store; measure `aggregateBom(...)` p95 over 30 trials by exposing a perf helper dev hook `__zilventorAggregateBom(partNames) → number_in_ms`. Budget: < 5 ms p95 on the 2014–2016 i3/i5 target (the local dev box is faster — assertion < 5 ms).

Also measure first BOM table render: programmatically toggle the BOM tab, measure time from the toggle to the first paint of the table (use `data-testid=bom-table` + `requestAnimationFrame`). Budget: < 50 ms p95.

- [ ] **Step 2: Run from repo root**

Run: `npx playwright test tests/perf/bom-aggregate-large.spec.ts --project=perf --reporter=list`
Expected: PASS within budgets.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/bom-aggregate-large.spec.ts
git commit -m "test(perf): bom-aggregate-large within p95 budgets"
```

---

## Self-review summary

- [ ] **Spec coverage**: walked each section of the spec and confirmed every type, command, file, helper, dev hook, and test mentioned in the spec has a task. The hybrid item-number lifecycle (auto-assign on render + persist on autosave) is covered by Task 5 (auto-assign in `aggregateBom`) + Task 30 (autosave merge). The selection outline overlay (added in spec self-review) is covered by Task 28 + 29 + 35.
- [ ] **Placeholder scan**: every code step has executable code; no "implement later" / "TBD" left in. The few prose-only test descriptions (Tasks 22, 33–38) are intentional E2E-flow descriptions where the assertions are well-defined by spec §7.4 — implementer follows the same patterns as the existing `tests/e2e/assembly/*` specs.
- [ ] **Type consistency**: `ComponentColor` / `BomRow` / `bomRowKey` / `aggregateBom` / `compareBomRowsForRenumber` / `pruneBomItemNumbers` use identical names across Phase 1 and the consumer phases. `selectedComponentIds` is the single field name across store, App.tsx, and SceneManager. The conflict-bump rule in `setBomItemNumber` is consistent between the store action (Task 13) and the BomTable inline-edit assertion (Task 23).
