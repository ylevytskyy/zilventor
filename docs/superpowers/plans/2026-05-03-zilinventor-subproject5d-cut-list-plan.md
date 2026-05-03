# Sub-project 5d — Cut List tab + CSV export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a recursive Cut List view to ZilInventor's assembly mode that walks the active assembly's nested tree, collects every leaf part whose feature-tree base is a `PanelFeature`, aggregates by `(L, W, T, materialId, grain)` (with grain-aware L/W normalization), and exports a 3-section CSV (panel rows + edge-band totals + non-panel exclusion footer). Adds a BrowserPane third tab + Furniture-ribbon panel + persisted user-editable item numbers + click-to-select with the existing orange overlay.

**Architecture:** Mirrors the 4c BOM tab + 4d recursive walker shape. A new pure aggregator `aggregateCutListRecursive` walks the existing `SubAssemblyCache`, consumes a `Map<partPath, PanelSpec | null>` populated by a new `resolvePanelSpec` (sibling to `resolvePartInfo`), resolves materials against the active assembly's registry, and emits a `CutListResult { rows, bandTotals, excluded }`. Rendered by a new `CutListTable.tsx`. Item numbers persist in `AssemblyDocument.cutListItemNumbers` (separate map from `bomItemNumbers`). Manifest format v10 → v11 (additive only). Autosave merges/prunes the map under a cache-completeness guard so stored numbers aren't erased when the cut-list tab hasn't been opened.

**Tech Stack:** TypeScript / pnpm workspace; React + Zustand UI; three.js viewport (no new viewport code — selection reuses the 4c orange overlay); OCCT (`opencascade.js`) kernel via Comlink RPC; Vitest unit + integration; Playwright e2e + perf. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-03-subproject-5d-cut-list-design.md`

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Shared types, utilities, and migration

### Task 1: Add `cutListItemNumbers` to `AssemblyDocument`

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Add the field to `AssemblyDocument`**

Open `packages/shared/src/types.ts`. Find the existing `AssemblyDocument` type (it carries `bomItemNumbers: Record<string, number>`). Add the new field directly below it:

```ts
  cutListItemNumbers: Record<string, number>;
```

- [ ] **Step 2: Run `pnpm -r typecheck`**

Expected: typecheck FAILS in any place that constructs an `AssemblyDocument` literal without this field. Likely sites: `NewAssemblyCommand.ts`, `AssemblyPacker.ts` defaulting code, fixtures in `__tests__`.

- [ ] **Step 3: Patch every fresh-construction site** to default `cutListItemNumbers: {}`. Use the typecheck output as the source of truth. Use grep_search if needed: `pattern="bomItemNumbers: \\{\\}"` to find sibling defaults and add the new field beside each.

- [ ] **Step 4: Re-run `pnpm -r typecheck`**

Expected: all 5 packages `Done`.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/app/src packages/kernel/src
git commit -m "feat(shared): add cutListItemNumbers to AssemblyDocument

Mirrors bomItemNumbers shape for sub-project 5d. Defaults to
{} on every fresh-construction site.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2: Add `PanelSpec` type and `resolvePanelSpecFromFeature`

**Files:**
- Modify: `packages/shared/src/panel-feature.ts`
- Modify: `packages/shared/src/__tests__/panel-feature.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append these test blocks to `packages/shared/src/__tests__/panel-feature.spec.ts`:

```ts
import { resolvePanelSpecFromFeature, type PanelFeature } from '../panel-feature';
import type { SketchParameter } from '../parameters';

describe('resolvePanelSpecFromFeature', () => {
  const baseFeature: PanelFeature = {
    kind: 'panel',
    id: 'pf1',
    length: { kind: 'literal', value: 600 },
    width: { kind: 'literal', value: 400 },
    thickness: { kind: 'literal', value: 18 },
    thicknessFromMaterial: false,
    materialId: 'm-birch',
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
  };

  it('resolves literal L/W/T into a PanelSpec', () => {
    const spec = resolvePanelSpecFromFeature(baseFeature, {});
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(600);
    expect(spec!.width).toBe(400);
    expect(spec!.thickness).toBe(18);
    expect(spec!.materialId).toBe('m-birch');
    expect(spec!.grain).toBe('length');
  });

  it('resolves param-ref L against parameters map', () => {
    const params: Record<string, SketchParameter> = {
      panelL: { name: 'panelL', expression: '700', value: 700, unit: 'mm' },
    };
    const f: PanelFeature = { ...baseFeature, length: { kind: 'param', paramName: 'panelL' } };
    const spec = resolvePanelSpecFromFeature(f, params);
    expect(spec!.length).toBe(700);
  });

  it('returns null on broken param ref', () => {
    const f: PanelFeature = { ...baseFeature, length: { kind: 'param', paramName: 'doesNotExist' } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('returns null on non-positive resolved length', () => {
    const f: PanelFeature = { ...baseFeature, length: { kind: 'literal', value: 0 } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('returns null on NaN resolved width', () => {
    const f: PanelFeature = { ...baseFeature, width: { kind: 'literal', value: Number.NaN } };
    expect(resolvePanelSpecFromFeature(f, {})).toBeNull();
  });

  it('preserves edgeBand materialIds in the spec', () => {
    const f: PanelFeature = {
      ...baseFeature,
      edgeBands: {
        front: { materialId: 'm-pvc' },
        back: null,
        left: { materialId: 'm-pvc' },
        right: null,
      },
    };
    const spec = resolvePanelSpecFromFeature(f, {})!;
    expect(spec.edgeBands.front).toEqual({ materialId: 'm-pvc' });
    expect(spec.edgeBands.back).toBeNull();
    expect(spec.edgeBands.left).toEqual({ materialId: 'm-pvc' });
    expect(spec.edgeBands.right).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/shared test src/__tests__/panel-feature.spec.ts`
Expected: FAIL — `resolvePanelSpecFromFeature is not exported`.

- [ ] **Step 3: Implement the type and function**

Append to `packages/shared/src/panel-feature.ts`:

```ts
import type { SketchParameter } from './parameters';

export interface PanelSpec {
  readonly length: number;
  readonly width: number;
  readonly thickness: number;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: { readonly materialId: MaterialId } | null };
}

function resolveDim(
  v: { kind: 'literal'; value: number } | { kind: 'param'; paramName: string },
  parameters: Record<string, SketchParameter>,
): number | null {
  if (v.kind === 'literal') {
    return Number.isFinite(v.value) && v.value > 0 ? v.value : null;
  }
  const p = parameters[v.paramName];
  if (!p) return null;
  return Number.isFinite(p.value) && p.value > 0 ? p.value : null;
}

export function resolvePanelSpecFromFeature(
  feature: PanelFeature,
  parameters: Record<string, SketchParameter>,
): PanelSpec | null {
  const length = resolveDim(feature.length, parameters);
  const width = resolveDim(feature.width, parameters);
  const thickness = resolveDim(feature.thickness, parameters);
  if (length === null || width === null || thickness === null) return null;
  return {
    length,
    width,
    thickness,
    materialId: feature.materialId,
    grain: feature.grain,
    edgeBands: {
      front: feature.edgeBands.front ? { materialId: feature.edgeBands.front.materialId } : null,
      back: feature.edgeBands.back ? { materialId: feature.edgeBands.back.materialId } : null,
      left: feature.edgeBands.left ? { materialId: feature.edgeBands.left.materialId } : null,
      right: feature.edgeBands.right ? { materialId: feature.edgeBands.right.materialId } : null,
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/shared test src/__tests__/panel-feature.spec.ts`
Expected: PASS — all 6 new cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/panel-feature.ts packages/shared/src/__tests__/panel-feature.spec.ts
git commit -m "feat(shared): PanelSpec type + resolvePanelSpecFromFeature

Pure helper that resolves a PanelFeature's ParamOrLiteral
dimensions against a parameters map. Returns null on broken
param refs or non-positive/NaN values.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3: Create `cutListRow.ts` with row types, `cutListRowKey`, and `normalizeLW`

**Files:**
- Create: `packages/shared/src/cutListRow.ts`
- Create: `packages/shared/src/__tests__/cutListRow.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/src/__tests__/cutListRow.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cutListRowKey, normalizeLW } from '../cutListRow';
import type { PanelSpec } from '../panel-feature';

const baseSpec = (overrides: Partial<PanelSpec> = {}): PanelSpec => ({
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

describe('normalizeLW', () => {
  it('preserves L/W when grain = length', () => {
    expect(normalizeLW(baseSpec({ grain: 'length', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('preserves L/W when grain = width', () => {
    expect(normalizeLW(baseSpec({ grain: 'width', length: 400, width: 600 }))).toEqual({ L: 400, W: 600 });
  });

  it('swaps so L >= W when grain = none', () => {
    expect(normalizeLW(baseSpec({ grain: 'none', length: 400, width: 600 }))).toEqual({ L: 600, W: 400 });
    expect(normalizeLW(baseSpec({ grain: 'none', length: 600, width: 400 }))).toEqual({ L: 600, W: 400 });
  });
});

describe('cutListRowKey', () => {
  it('produces identical keys for identical (L,W,T,M,G)', () => {
    const a = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(a).toBe(b);
  });

  it('different thickness yields different keys', () => {
    const a = cutListRowKey(baseSpec({ thickness: 18 }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ thickness: 19 }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different grain yields different keys', () => {
    const a = cutListRowKey(baseSpec({ grain: 'length' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ grain: 'width' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('different materialId yields different keys', () => {
    const a = cutListRowKey(baseSpec({ materialId: 'm-birch' }), { L: 600, W: 400 });
    const b = cutListRowKey(baseSpec({ materialId: 'm-oak' }), { L: 600, W: 400 });
    expect(a).not.toBe(b);
  });

  it('key shape is disjoint from bomRowKey', () => {
    const cut = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    expect(cut.startsWith('L=')).toBe(true);
    expect(cut.includes('::')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: FAIL — `Cannot find module '../cutListRow'`.

- [ ] **Step 3: Implement `cutListRow.ts`**

Create `packages/shared/src/cutListRow.ts`:

```ts
import type { GrainDirection, PanelSpec, PanelEdgeKey } from './panel-feature';
import type { MaterialId } from './material';
import type { AssemblyDocument } from './types';

export function normalizeLW(spec: PanelSpec): { L: number; W: number } {
  if (spec.grain !== 'none') return { L: spec.length, W: spec.width };
  return { L: Math.max(spec.length, spec.width), W: Math.min(spec.length, spec.width) };
}

export function cutListRowKey(spec: PanelSpec, normalized: { L: number; W: number }): string {
  return [
    `L=${normalized.L}`,
    `W=${normalized.W}`,
    `T=${spec.thickness}`,
    `M=${spec.materialId}`,
    `G=${spec.grain}`,
  ].join('|');
}

export type CutListEdgeBandCell =
  | { materialId: MaterialId; materialName: string }
  | null;

export type CutListRow = {
  rowKey: string;
  itemNumber: number;
  qty: number;
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  materialName: string;
  grain: GrainDirection;
  edgeBands: { [K in PanelEdgeKey]: CutListEdgeBandCell };
  partPath: string;
  partName: string;
  componentPathKeys: string[];
};

export type EdgeBandTotal = {
  materialId: MaterialId;
  materialName: string;
  totalLengthMm: number;
};

export type CutListExclusion = {
  componentCount: number;
  partCount: number;
};

export type CutListResult = {
  rows: CutListRow[];
  bandTotals: EdgeBandTotal[];
  excluded: CutListExclusion;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cutListRow.ts packages/shared/src/__tests__/cutListRow.spec.ts
git commit -m "feat(shared): cutListRow types + cutListRowKey + normalizeLW

Pure data shapes for sub-project 5d. cutListRowKey is
disjoint from bomRowKey by leading 'L='. normalizeLW swaps
L/W only when grain = none.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: Implement `aggregateCutListLocal` (single-doc helper)

**Files:**
- Modify: `packages/shared/src/cutListRow.ts`
- Modify: `packages/shared/src/__tests__/cutListRow.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/__tests__/cutListRow.spec.ts`:

```ts
import { aggregateCutListLocal } from '../cutListRow';
import type { ComponentInstance, AssemblyDocument } from '../types';
import type { MaterialEntry } from '../material';

describe('aggregateCutListLocal', () => {
  const materials: MaterialEntry[] = [
    { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
    { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
  ];

  const cmp = (id: string, partPath: string): ComponentInstance => ({
    id,
    partPath,
    position: { x: 0, y: 0, z: 0 },
    rotation: { rx: 0, ry: 0, rz: 0 },
    visible: true,
  });

  const emptyAsm = (components: ComponentInstance[] = []): AssemblyDocument => ({
    id: 'a1',
    name: 'A',
    units: 'mm',
    parameters: {},
    components,
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
  } as unknown as AssemblyDocument);

  const specs = (entries: Array<[string, PanelSpec | null]>): Map<string, PanelSpec | null> => new Map(entries);

  it('groups two identical-spec panels into one row of QTY 2', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec()]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qty).toBe(2);
    expect(result.rows[0].materialName).toBe('Birch 18mm');
    expect(result.excluded).toEqual({ componentCount: 0, partCount: 0 });
  });

  it('splits rows by spec dimensions', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/b.zipt', baseSpec({ length: 800 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(2);
  });

  it('counts non-panel parts as exclusions', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/x.zipt'), cmp('c3', 'p/x.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/x.zipt', null],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.excluded).toEqual({ componentCount: 2, partCount: 1 });
  });

  it('grain=none with swapped L/W merges to one row', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec({ grain: 'none', length: 600, width: 400 })],
      ['p/b.zipt', baseSpec({ grain: 'none', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qty).toBe(2);
    expect(result.rows[0].length).toBe(600);
    expect(result.rows[0].width).toBe(400);
  });

  it('grain=length with swapped L/W stays as two rows', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec({ grain: 'length', length: 600, width: 400 })],
      ['p/b.zipt', baseSpec({ grain: 'length', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows).toHaveLength(2);
  });

  it('broken material yields (missing material) and still emits the row', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({ materialId: 'm-ghost' })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.rows[0].materialName).toBe('(missing material)');
  });

  it('computes band totals: front+back use length, left+right use width, weighted by qty', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/a.zipt'), cmp('c3', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({
      length: 600,
      width: 400,
      edgeBands: {
        front: { materialId: 'm-pvc' },
        back: { materialId: 'm-pvc' },
        left: null,
        right: null,
      },
    })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.bandTotals).toHaveLength(1);
    expect(result.bandTotals[0].materialName).toBe('PVC 1mm white');
    expect(result.bandTotals[0].totalLengthMm).toBe(600 * 2 * 3); // front+back × qty=3
  });

  it('left/right band uses width', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt')]);
    const map = specs([['p/a.zipt', baseSpec({
      length: 600,
      width: 400,
      edgeBands: {
        front: null,
        back: null,
        left: { materialId: 'm-pvc' },
        right: { materialId: 'm-pvc' },
      },
    })]]);
    const result = aggregateCutListLocal(asm, map, materials);
    expect(result.bandTotals[0].totalLengthMm).toBe(400 * 2);
  });

  it('reuses stored item numbers and assigns max+1 for new rows', () => {
    const asm = emptyAsm([cmp('c1', 'p/a.zipt'), cmp('c2', 'p/b.zipt')]);
    const map = specs([
      ['p/a.zipt', baseSpec()],
      ['p/b.zipt', baseSpec({ length: 800 })],
    ]);
    const knownKey = cutListRowKey(baseSpec(), { L: 600, W: 400 });
    asm.cutListItemNumbers = { [knownKey]: 7 };
    const result = aggregateCutListLocal(asm, map, materials);
    const knownRow = result.rows.find(r => r.rowKey === knownKey);
    const newRow = result.rows.find(r => r.rowKey !== knownKey);
    expect(knownRow!.itemNumber).toBe(7);
    expect(newRow!.itemNumber).toBe(8);
  });

  it('empty assembly returns empty result', () => {
    const result = aggregateCutListLocal(emptyAsm(), specs([]), materials);
    expect(result).toEqual({
      rows: [],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: FAIL — `aggregateCutListLocal is not exported`.

- [ ] **Step 3: Implement `aggregateCutListLocal`**

Append to `packages/shared/src/cutListRow.ts`:

```ts
import type { MaterialRegistry } from './material';
import type { ComponentInstance } from './types';

type GroupAcc = {
  spec: PanelSpec;
  normalized: { L: number; W: number };
  componentIds: string[];
  partPath: string;
};

function materialName(id: MaterialId, materials: MaterialRegistry): string {
  const found = materials.find((m) => m.id === id);
  return found ? found.name : '(missing material)';
}

function makeBandCell(
  band: { materialId: MaterialId } | null,
  materials: MaterialRegistry,
): CutListEdgeBandCell {
  if (!band) return null;
  return { materialId: band.materialId, materialName: materialName(band.materialId, materials) };
}

export function aggregateCutListLocal(
  assembly: { components: ComponentInstance[]; cutListItemNumbers: Record<string, number> },
  panelSpecs: Map<string, PanelSpec | null>,
  materials: MaterialRegistry,
  partNames: Map<string, string> = new Map(),
): CutListResult {
  const groups = new Map<string, GroupAcc>();
  let nonPanelComponentCount = 0;
  const nonPanelPaths = new Set<string>();

  for (const c of assembly.components) {
    const spec = panelSpecs.get(c.partPath);
    if (!spec) {
      nonPanelComponentCount++;
      nonPanelPaths.add(c.partPath);
      continue;
    }
    const normalized = normalizeLW(spec);
    const key = cutListRowKey(spec, normalized);
    const existing = groups.get(key);
    if (existing) {
      existing.componentIds.push(c.id);
    } else {
      groups.set(key, {
        spec,
        normalized,
        componentIds: [c.id],
        partPath: c.partPath,
      });
    }
  }

  const stored = assembly.cutListItemNumbers;
  const usedNumbers = new Set(Object.values(stored));
  let nextNumber = (usedNumbers.size === 0 ? 0 : Math.max(...usedNumbers)) + 1;

  const rows: CutListRow[] = [];
  for (const [key, g] of groups) {
    let itemNumber = stored[key];
    if (itemNumber === undefined) itemNumber = nextNumber++;
    rows.push({
      rowKey: key,
      itemNumber,
      qty: g.componentIds.length,
      length: g.normalized.L,
      width: g.normalized.W,
      thickness: g.spec.thickness,
      materialId: g.spec.materialId,
      materialName: materialName(g.spec.materialId, materials),
      grain: g.spec.grain,
      edgeBands: {
        front: makeBandCell(g.spec.edgeBands.front, materials),
        back: makeBandCell(g.spec.edgeBands.back, materials),
        left: makeBandCell(g.spec.edgeBands.left, materials),
        right: makeBandCell(g.spec.edgeBands.right, materials),
      },
      partPath: g.partPath,
      partName: partNames.get(g.partPath) ?? '(missing part)',
      componentPathKeys: [...g.componentIds],
    });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);

  // Edge-band totals: per band material, accumulate Σ(perEdgeLength × QTY).
  const bandAcc = new Map<MaterialId, { name: string; total: number }>();
  for (const r of rows) {
    for (const edgeKey of ['front', 'back', 'left', 'right'] as const) {
      const cell = r.edgeBands[edgeKey];
      if (!cell) continue;
      const perEdgeLen = edgeKey === 'front' || edgeKey === 'back' ? r.length : r.width;
      const acc = bandAcc.get(cell.materialId);
      if (acc) acc.total += perEdgeLen * r.qty;
      else bandAcc.set(cell.materialId, { name: cell.materialName, total: perEdgeLen * r.qty });
    }
  }
  const bandTotals: EdgeBandTotal[] = Array.from(bandAcc.entries()).map(([materialId, v]) => ({
    materialId,
    materialName: v.name,
    totalLengthMm: v.total,
  }));
  bandTotals.sort((a, b) => a.materialName.localeCompare(b.materialName));

  return {
    rows,
    bandTotals,
    excluded: { componentCount: nonPanelComponentCount, partCount: nonPanelPaths.size },
  };
}
```

You may need to import `baseSpec` helper into the test file. The test file already declares `baseSpec` at the top of the `cutListRowKey` describe block — pull it up to module scope (above the first `describe`) so all describes can use it. Adjust accordingly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: PASS — all aggregator cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cutListRow.ts packages/shared/src/__tests__/cutListRow.spec.ts
git commit -m "feat(shared): aggregateCutListLocal pure aggregator

Single-document version. Handles grouping, normalization,
broken material refs, band totals math, and item-number
assignment. Recursive walker (4d-style) lands in a follow-up
task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5: Add `compareCutListRowsForRenumber` and `pruneCutListItemNumbers`

**Files:**
- Modify: `packages/shared/src/cutListRow.ts`
- Modify: `packages/shared/src/__tests__/cutListRow.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `cutListRow.spec.ts`:

```ts
import { compareCutListRowsForRenumber, pruneCutListItemNumbers } from '../cutListRow';

describe('compareCutListRowsForRenumber', () => {
  const row = (overrides: Partial<CutListRow>): CutListRow => ({
    rowKey: 'k',
    itemNumber: 1,
    qty: 1,
    length: 600,
    width: 400,
    thickness: 18,
    materialId: 'm',
    materialName: 'Birch',
    grain: 'length',
    edgeBands: { front: null, back: null, left: null, right: null },
    partPath: 'p',
    partName: 'P',
    componentPathKeys: [],
    ...overrides,
  });

  it('sorts by materialName ASC primarily', () => {
    const a = row({ materialName: 'Birch' });
    const b = row({ materialName: 'Oak' });
    expect(compareCutListRowsForRenumber(a, b)).toBeLessThan(0);
  });

  it('then by length DESC', () => {
    const a = row({ materialName: 'X', length: 600 });
    const b = row({ materialName: 'X', length: 800 });
    expect(compareCutListRowsForRenumber(a, b)).toBeGreaterThan(0);
  });

  it('then by width DESC', () => {
    const a = row({ materialName: 'X', length: 600, width: 400 });
    const b = row({ materialName: 'X', length: 600, width: 500 });
    expect(compareCutListRowsForRenumber(a, b)).toBeGreaterThan(0);
  });

  it('then by rowKey ASC for ties', () => {
    const a = row({ materialName: 'X', length: 600, width: 400, rowKey: 'a' });
    const b = row({ materialName: 'X', length: 600, width: 400, rowKey: 'b' });
    expect(compareCutListRowsForRenumber(a, b)).toBeLessThan(0);
  });
});

describe('pruneCutListItemNumbers', () => {
  it('keeps live keys and drops orphans', () => {
    const stored = { 'k-live': 1, 'k-dead': 5 };
    expect(pruneCutListItemNumbers(['k-live'], stored)).toEqual({ 'k-live': 1 });
  });

  it('returns empty object when no live keys', () => {
    expect(pruneCutListItemNumbers([], { 'k': 1 })).toEqual({});
  });

  it('preserves all live keys', () => {
    const stored = { a: 1, b: 2, c: 3 };
    expect(pruneCutListItemNumbers(['a', 'b', 'c'], stored)).toEqual(stored);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: FAIL on the new exports.

- [ ] **Step 3: Implement both helpers**

Append to `packages/shared/src/cutListRow.ts`:

```ts
export function compareCutListRowsForRenumber(a: CutListRow, b: CutListRow): number {
  if (a.materialName !== b.materialName) return a.materialName.localeCompare(b.materialName);
  if (a.length !== b.length) return b.length - a.length;
  if (a.width !== b.width) return b.width - a.width;
  if (a.rowKey !== b.rowKey) return a.rowKey < b.rowKey ? -1 : 1;
  return 0;
}

export function pruneCutListItemNumbers(
  liveKeys: readonly string[],
  stored: Record<string, number>,
): Record<string, number> {
  const live = new Set(liveKeys);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (live.has(k)) out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/shared test src/__tests__/cutListRow.spec.ts`
Expected: PASS — all comparator + prune cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/cutListRow.ts packages/shared/src/__tests__/cutListRow.spec.ts
git commit -m "feat(shared): cut-list comparator + prune helpers

Sort order for Renumber: materialName ASC, length DESC,
width DESC, rowKey ASC for ties. Prune drops orphan keys
not in the live row-key set.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6: Manifest migration v10 → v11

**Files:**
- Create: `packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts`
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write the failing migration test**

Create `packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateManifestToCurrent } from '../fileFormat';

describe('migrateManifest v10 → v11', () => {
  it('adds cutListItemNumbers: {} to assembly manifests missing the field', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'assembly',
      document: {
        id: 'a1',
        name: 'A',
        units: 'mm',
        parameters: {},
        components: [],
        constraints: [],
        groundedComponentPaths: [],
        colors: {},
        bomItemNumbers: {},
        colorOverrides: {},
        materials: [],
      },
    };
    const m = migrateManifestToCurrent(v10);
    expect(m.formatVersion).toBe(11);
    const doc = m.document as { cutListItemNumbers: unknown };
    expect(doc.cutListItemNumbers).toEqual({});
  });

  it('preserves existing cutListItemNumbers if already present (idempotent)', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'assembly',
      document: {
        id: 'a1',
        cutListItemNumbers: { 'k1': 7 },
      },
    } as any;
    const m = migrateManifestToCurrent(v10);
    expect((m.document as any).cutListItemNumbers).toEqual({ 'k1': 7 });
  });

  it('passes part manifests through (only formatVersion bumps)', () => {
    const v10 = {
      formatVersion: 10,
      kind: 'part',
      document: { id: 'p1', materials: [] },
    };
    const m = migrateManifestToCurrent(v10);
    expect(m.formatVersion).toBe(11);
    expect((m.document as any).cutListItemNumbers).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/shared test src/__tests__/migrateManifest-v10-to-v11.spec.ts`
Expected: FAIL — `formatVersion` stays 10 (no migration registered).

- [ ] **Step 3: Add the v10→v11 migration and bump CURRENT_FORMAT_VERSION**

Edit `packages/shared/src/fileFormat.ts`:

1. Change line 3: `export const CURRENT_FORMAT_VERSION = 11 as const;`
2. After the `9: (mIn) => { ... }` migration block (currently the last entry inside `migrations`), add:

```ts
  // v10 → v11: additive — add `cutListItemNumbers: {}` to assembly-kind
  // documents (sub-project 5d). Empty default; populated by user inline
  // edits + Renumber + autosave merge path.
  10: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: { cutListItemNumbers?: unknown } };
    if (anyM.kind === 'assembly' && anyM.document && anyM.document.cutListItemNumbers == null) {
      anyM.document.cutListItemNumbers = {};
    }
    return { ...m, formatVersion: 11 };
  },
```

3. Update the `normalizeKind` function to also recognise v11 (find the line `if (m.formatVersion === 10 && ...)` and broaden to `if ((m.formatVersion === 10 || m.formatVersion === 11) && ...)`).

- [ ] **Step 4: Run the migration spec**

Run: `pnpm --filter @zilventor/shared test src/__tests__/migrateManifest-v10-to-v11.spec.ts`
Expected: PASS — all 3 cases green.

- [ ] **Step 5: Update `fileFormat.spec.ts` baseline**

Open `packages/shared/src/__tests__/fileFormat.spec.ts`. Find any assertions on `CURRENT_FORMAT_VERSION === 10` or migrations terminating at v10 and update to v11. Add a small smoke case: a fresh empty assembly manifest at v10 migrates to v11 with `cutListItemNumbers: {}`.

- [ ] **Step 6: Run the full shared test suite**

Run: `pnpm --filter @zilventor/shared test`
Expected: PASS — all shared specs green.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v10-to-v11.spec.ts packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): manifest v10 → v11 (additive cutListItemNumbers)

Bump CURRENT_FORMAT_VERSION to 11. v10→v11 migrator adds
cutListItemNumbers: {} to assembly-kind documents; part
manifests pass through. Idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 7: Re-export new symbols from `packages/shared/src/index.ts`

**Files:**
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the new re-exports**

Open `packages/shared/src/index.ts`. Find the existing `bomRow` re-export block (`export * from './bomRow';` or similar). Add a sibling line:

```ts
export * from './cutListRow';
```

If `panel-feature` already re-exports the previous `PanelFeature` types, ensure the new `PanelSpec` and `resolvePanelSpecFromFeature` flow through. If not, add:

```ts
export * from './panel-feature';
```

(only if the file doesn't already do this — check first to avoid duplicate exports).

- [ ] **Step 2: Run `pnpm -r typecheck`**

Expected: all 5 packages `Done`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): re-export cutListRow types and PanelSpec

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Kernel storage round-trip

### Task 8: `AssemblyPacker` round-trips `cutListItemNumbers`

**Files:**
- Modify: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`
- Modify: `packages/kernel/src/storage/AssemblyPacker.ts` (only if the packer drops unknown fields)

- [ ] **Step 1: Write the failing test**

Append to `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`:

```ts
describe('cutListItemNumbers round-trip (5d)', () => {
  it('preserves cutListItemNumbers across pack/unpack', async () => {
    const original = makeMinimalAssembly();
    original.cutListItemNumbers = { 'L=600|W=400|T=18|M=m1|G=length': 3 };
    const bytes = await packAssembly(original);
    const restored = await unpackAssembly(bytes);
    expect(restored.cutListItemNumbers).toEqual(original.cutListItemNumbers);
  });

  it('defaults to {} when missing in legacy manifest', async () => {
    const original = makeMinimalAssembly();
    delete (original as Partial<typeof original>).cutListItemNumbers;
    const bytes = await packAssembly(original);
    const restored = await unpackAssembly(bytes);
    expect(restored.cutListItemNumbers).toEqual({});
  });
});
```

(Use the spec file's existing `makeMinimalAssembly` helper — search for it in the file and reuse the existing pattern.)

- [ ] **Step 2: Run the test to verify it passes (or fails)**

Run: `pnpm --filter @zilventor/kernel test src/storage/__tests__/AssemblyPacker.spec.ts`
Expected: usually PASS (the packer stores the document opaquely via `JSON.stringify`). If it FAILS, the packer is dropping unknown fields explicitly — open `packages/kernel/src/storage/AssemblyPacker.ts` and add `cutListItemNumbers: doc.cutListItemNumbers ?? {}` to the pack-side serialization (and to the unpack-side default).

- [ ] **Step 3: Run the full kernel storage suite**

Run: `pnpm --filter @zilventor/kernel test src/storage`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts packages/kernel/src/storage/AssemblyPacker.ts
git commit -m "test(kernel): AssemblyPacker round-trips cutListItemNumbers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — App walker (recursive aggregator)

### Task 9: Implement `aggregateCutListRecursive`

**Files:**
- Create: `packages/app/src/assembly/walkers/aggregateCutListRecursive.ts`
- Create: `packages/app/src/assembly/walkers/__tests__/aggregateCutListRecursive.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/assembly/walkers/__tests__/aggregateCutListRecursive.spec.ts`. Model it on `aggregateBomRecursive.spec.ts` — open that file first and copy the imports + the `SubAssemblyCache` stub helper. Then add:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateCutListRecursive } from '../aggregateCutListRecursive';
import type { AssemblyDocument, ComponentInstance } from '@zilventor/shared';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { MaterialEntry } from '@zilventor/shared/src/material';

const MAT: MaterialEntry[] = [
  { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
];

const SPEC = (overrides: Partial<PanelSpec> = {}): PanelSpec => ({
  length: 600,
  width: 400,
  thickness: 18,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...overrides,
});

const cmp = (id: string, partPath: string): ComponentInstance => ({
  id, partPath,
  position: { x: 0, y: 0, z: 0 },
  rotation: { rx: 0, ry: 0, rz: 0 },
  visible: true,
});

const asm = (id: string, components: ComponentInstance[]): AssemblyDocument => ({
  id, name: id, units: 'mm',
  parameters: {}, components, constraints: [],
  groundedComponentPaths: [],
  colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
  colorOverrides: {},
} as unknown as AssemblyDocument);

const cacheOf = (entries: Array<[string, AssemblyDocument]>) => ({
  get: (path: string) => {
    const found = entries.find(([p]) => p === path);
    return found ? { kind: 'ok' as const, doc: found[1] } : undefined;
  },
});

const partInfoOf = (entries: Array<[string, string]>) =>
  new Map(entries.map(([k, v]) => [k, { name: v }]));

describe('aggregateCutListRecursive', () => {
  it('flat assembly: 2 panels (1 pair, 1 distinct) + 1 non-panel', () => {
    const a = asm('a', [
      cmp('c1', 'p/a.zipt'),
      cmp('c2', 'p/a.zipt'),
      cmp('c3', 'p/b.zipt'),
      cmp('c4', 'p/x.zipt'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC()],
      ['p/b.zipt', SPEC({ length: 800 })],
      ['p/x.zipt', null],
    ]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.length === 600)!.qty).toBe(2);
    expect(result.rows.find(r => r.length === 800)!.qty).toBe(1);
    expect(result.excluded).toEqual({ componentCount: 1, partCount: 1 });
  });

  it('two-level recursion: outer with 2 inner instances; inner has 2 panels', () => {
    const inner = asm('inner', [cmp('p1', 'p/a.zipt'), cmp('p2', 'p/b.zipt')]);
    const outer = asm('outer', [
      cmp('s1', 'sub/inner.ziasm'),
      cmp('s2', 'sub/inner.ziasm'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC()],
      ['p/b.zipt', SPEC({ length: 800 })],
    ]);
    const result = aggregateCutListRecursive(
      outer,
      cacheOf([['sub/inner.ziasm', inner]]),
      specs,
      MAT,
      partInfoOf([]),
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.length === 600)!.qty).toBe(2);
    expect(result.rows.find(r => r.length === 800)!.qty).toBe(2);
  });

  it('three-level recursion: componentPathKeys carries the full path', () => {
    const leaf = asm('leaf', [cmp('p1', 'p/a.zipt')]);
    const mid = asm('mid', [cmp('m1', 'sub/leaf.ziasm')]);
    const top = asm('top', [cmp('t1', 'sub/mid.ziasm')]);
    const specs = new Map<string, PanelSpec | null>([['p/a.zipt', SPEC()]]);
    const result = aggregateCutListRecursive(
      top,
      cacheOf([['sub/mid.ziasm', mid], ['sub/leaf.ziasm', leaf]]),
      specs, MAT, partInfoOf([]),
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].componentPathKeys).toHaveLength(1);
    expect(result.rows[0].componentPathKeys[0]).toContain('t1');
    expect(result.rows[0].componentPathKeys[0]).toContain('m1');
    expect(result.rows[0].componentPathKeys[0]).toContain('p1');
  });

  it('mixed grain: grain=none with swapped L/W merges; grain=length does not', () => {
    const a = asm('a', [
      cmp('c1', 'p/a.zipt'),
      cmp('c2', 'p/b.zipt'),
      cmp('c3', 'p/c.zipt'),
      cmp('c4', 'p/d.zipt'),
    ]);
    const specs = new Map<string, PanelSpec | null>([
      ['p/a.zipt', SPEC({ grain: 'none', length: 600, width: 400 })],
      ['p/b.zipt', SPEC({ grain: 'none', length: 400, width: 600 })],
      ['p/c.zipt', SPEC({ grain: 'length', length: 600, width: 400 })],
      ['p/d.zipt', SPEC({ grain: 'length', length: 400, width: 600 })],
    ]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(3); // grain=none merges 2 into 1; grain=length stays 2
  });

  it('broken material: row emits with (missing material)', () => {
    const a = asm('a', [cmp('c1', 'p/a.zipt')]);
    const specs = new Map<string, PanelSpec | null>([['p/a.zipt', SPEC({ materialId: 'm-ghost' })]]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows[0].materialName).toBe('(missing material)');
  });

  it('all non-panel: zero rows + accurate exclusion counts', () => {
    const a = asm('a', [cmp('c1', 'p/x.zipt'), cmp('c2', 'p/x.zipt'), cmp('c3', 'p/y.zipt')]);
    const specs = new Map<string, PanelSpec | null>([['p/x.zipt', null], ['p/y.zipt', null]]);
    const result = aggregateCutListRecursive(a, cacheOf([]), specs, MAT, partInfoOf([]));
    expect(result.rows).toHaveLength(0);
    expect(result.excluded).toEqual({ componentCount: 3, partCount: 2 });
  });

  it('empty assembly returns empty result', () => {
    const result = aggregateCutListRecursive(asm('a', []), cacheOf([]), new Map(), MAT, partInfoOf([]));
    expect(result).toEqual({
      rows: [],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/assembly/walkers/__tests__/aggregateCutListRecursive.spec.ts`
Expected: FAIL — `Cannot find module '../aggregateCutListRecursive'`.

- [ ] **Step 3: Implement the recursive walker**

Create `packages/app/src/assembly/walkers/aggregateCutListRecursive.ts`:

```ts
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import type { MaterialRegistry, MaterialId } from '@zilventor/shared/src/material';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';
import {
  cutListRowKey, normalizeLW,
  type CutListEdgeBandCell, type CutListResult, type CutListRow, type EdgeBandTotal,
} from '@zilventor/shared/src/cutListRow';
import { pathKey } from '@zilventor/shared';
import type { SubAssemblyCache } from '../SubAssemblyCache';

type GroupAcc = {
  spec: PanelSpec;
  normalized: { L: number; W: number };
  componentPathKeys: string[];
  partPath: string;
};

function materialName(id: MaterialId, materials: MaterialRegistry): string {
  return materials.find((m) => m.id === id)?.name ?? '(missing material)';
}

function bandCell(b: { materialId: MaterialId } | null, materials: MaterialRegistry): CutListEdgeBandCell {
  return b ? { materialId: b.materialId, materialName: materialName(b.materialId, materials) } : null;
}

export function aggregateCutListRecursive(
  activeDoc: AssemblyDocument,
  cache: Pick<SubAssemblyCache, 'get'>,
  panelSpecs: Map<string, PanelSpec | null>,
  materials: MaterialRegistry,
  partInfo: Map<string, PartInfo>,
): CutListResult {
  const groups = new Map<string, GroupAcc>();
  let nonPanelComponentCount = 0;
  const nonPanelPaths = new Set<string>();

  function walk(doc: AssemblyDocument, prefix: string[]): void {
    for (const c of doc.components) {
      const path = [...prefix, c.id];
      if (c.partPath.endsWith('.ziasm')) {
        const e = cache.get(c.partPath);
        if (e && e.kind === 'ok') walk(e.doc, path);
        continue;
      }
      const spec = panelSpecs.get(c.partPath);
      if (!spec) {
        nonPanelComponentCount++;
        nonPanelPaths.add(c.partPath);
        continue;
      }
      const normalized = normalizeLW(spec);
      const key = cutListRowKey(spec, normalized);
      const existing = groups.get(key);
      if (existing) {
        existing.componentPathKeys.push(pathKey(path));
      } else {
        groups.set(key, {
          spec, normalized,
          componentPathKeys: [pathKey(path)],
          partPath: c.partPath,
        });
      }
    }
  }
  walk(activeDoc, []);

  const stored = activeDoc.cutListItemNumbers;
  const used = new Set(Object.values(stored));
  let nextNumber = (used.size === 0 ? 0 : Math.max(...used)) + 1;

  const rows: CutListRow[] = [];
  for (const [key, g] of groups) {
    let n = stored[key];
    if (n === undefined) n = nextNumber++;
    const info = partInfo.get(g.partPath);
    rows.push({
      rowKey: key,
      itemNumber: n,
      qty: g.componentPathKeys.length,
      length: g.normalized.L,
      width: g.normalized.W,
      thickness: g.spec.thickness,
      materialId: g.spec.materialId,
      materialName: materialName(g.spec.materialId, materials),
      grain: g.spec.grain,
      edgeBands: {
        front: bandCell(g.spec.edgeBands.front, materials),
        back: bandCell(g.spec.edgeBands.back, materials),
        left: bandCell(g.spec.edgeBands.left, materials),
        right: bandCell(g.spec.edgeBands.right, materials),
      },
      partPath: g.partPath,
      partName: info?.name ?? '(missing part)',
      componentPathKeys: [...g.componentPathKeys],
    });
  }
  rows.sort((a, b) => a.itemNumber - b.itemNumber);

  const bandAcc = new Map<MaterialId, { name: string; total: number }>();
  for (const r of rows) {
    for (const edgeKey of ['front', 'back', 'left', 'right'] as const) {
      const cell = r.edgeBands[edgeKey];
      if (!cell) continue;
      const perEdgeLen = edgeKey === 'front' || edgeKey === 'back' ? r.length : r.width;
      const acc = bandAcc.get(cell.materialId);
      if (acc) acc.total += perEdgeLen * r.qty;
      else bandAcc.set(cell.materialId, { name: cell.materialName, total: perEdgeLen * r.qty });
    }
  }
  const bandTotals: EdgeBandTotal[] = Array.from(bandAcc.entries()).map(([materialId, v]) => ({
    materialId, materialName: v.name, totalLengthMm: v.total,
  }));
  bandTotals.sort((a, b) => a.materialName.localeCompare(b.materialName));

  return {
    rows,
    bandTotals,
    excluded: { componentCount: nonPanelComponentCount, partCount: nonPanelPaths.size },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/assembly/walkers/__tests__/aggregateCutListRecursive.spec.ts`
Expected: PASS — all recursive cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/walkers/aggregateCutListRecursive.ts packages/app/src/assembly/walkers/__tests__/aggregateCutListRecursive.spec.ts
git commit -m "feat(app): aggregateCutListRecursive walker

Mirrors aggregateBomRecursive shape. Walks SubAssemblyCache
DFS, emits CutListResult { rows, bandTotals, excluded }.
Tracks non-panel components separately so the table can
report what was filtered out.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — App resolvers (panel-spec OPFS reader)

### Task 10: Implement `resolvePanelSpec`

**Files:**
- Create: `packages/app/src/shell/resolvePanelSpec.ts`
- Create: `packages/app/src/shell/__tests__/resolvePanelSpec.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/shell/__tests__/resolvePanelSpec.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { resolvePanelSpec, type PanelSpecCache } from '../resolvePanelSpec';

// Build an in-memory OPFS shim. Real Opfs has read(path): Promise<Uint8Array>.
function makeOpfs(files: Record<string, Uint8Array>): { read: (p: string) => Promise<Uint8Array> } {
  return { read: (p) => files[p] ? Promise.resolve(files[p]) : Promise.reject(new Error('ENOENT')) };
}

// Helper: pack a manifest into the same .zipt bytes shape unpackProject expects.
// Use the kernel's packProject for fidelity. Import lazily to avoid heavy bootstrap.
async function packPart(manifest: object): Promise<Uint8Array> {
  const { packProject } = await import('@zilventor/kernel/src/storage/ProjectPacker');
  return packProject({ manifest } as Parameters<typeof packProject>[0]);
}

describe('resolvePanelSpec', () => {
  it('returns null for non-panel parts (no PanelFeature at index 0)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [] },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).toBeNull();
    expect(cache.get('p/a.zipt')).toBeNull();
  });

  it('returns a PanelSpec for a part whose feature[0] is a PanelFeature', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: {
        id: 'p1', name: 'P', units: 'mm', parameters: {},
        featureTree: [{
          kind: 'panel', id: 'pf1',
          length: { kind: 'literal', value: 600 },
          width: { kind: 'literal', value: 400 },
          thickness: { kind: 'literal', value: 18 },
          thicknessFromMaterial: false,
          materialId: 'm-birch', grain: 'length',
          edgeBands: { front: null, back: null, left: null, right: null },
        }],
        properties: {}, materials: [],
      },
    });
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({ 'p/a.zipt': bytes });
    const spec = await resolvePanelSpec(opfs, 'p/a.zipt', cache);
    expect(spec).not.toBeNull();
    expect(spec!.length).toBe(600);
    expect(spec!.materialId).toBe('m-birch');
  });

  it('caches subsequent reads (only one OPFS hit)', async () => {
    const bytes = await packPart({
      formatVersion: 11, kind: 'part',
      document: { id: 'p1', name: 'P', units: 'mm', parameters: {}, featureTree: [], properties: {}, materials: [] },
    });
    const read = vi.fn().mockResolvedValue(bytes);
    const cache: PanelSpecCache = new Map();
    await resolvePanelSpec({ read }, 'p/a.zipt', cache);
    await resolvePanelSpec({ read }, 'p/a.zipt', cache);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('returns null and caches null on read error', async () => {
    const cache: PanelSpecCache = new Map();
    const opfs = makeOpfs({}); // empty FS
    const spec = await resolvePanelSpec(opfs, 'p/missing.zipt', cache);
    expect(spec).toBeNull();
    expect(cache.has('p/missing.zipt')).toBe(true);
    expect(cache.get('p/missing.zipt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/resolvePanelSpec.spec.ts`
Expected: FAIL — `Cannot find module '../resolvePanelSpec'`.

- [ ] **Step 3: Implement `resolvePanelSpec`**

Create `packages/app/src/shell/resolvePanelSpec.ts`:

```ts
import { unpackProject } from '@zilventor/kernel/src/storage/ProjectPacker';
import { isPanelFeature, resolvePanelSpecFromFeature, type PanelSpec } from '@zilventor/shared/src/panel-feature';
import type { SketchParameter } from '@zilventor/shared';

export type PanelSpecCache = Map<string, PanelSpec | null>;

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function resolvePanelSpec(
  opfs: OpfsLike,
  partPath: string,
  cache: PanelSpecCache,
): Promise<PanelSpec | null> {
  if (cache.has(partPath)) return cache.get(partPath)!;
  try {
    const bytes = await opfs.read(partPath);
    const project = await unpackProject(bytes);
    const manifest = project.manifest as {
      document?: {
        featureTree?: unknown[];
        parameters?: Record<string, SketchParameter>;
      };
    } | null;
    const tree = manifest?.document?.featureTree ?? [];
    // Find the panel feature anywhere in featureTree (5a guarantees index 0 if present).
    const first = tree[0];
    if (!isPanelFeature(first)) {
      cache.set(partPath, null);
      return null;
    }
    const params = manifest?.document?.parameters ?? {};
    const spec = resolvePanelSpecFromFeature(first, params);
    cache.set(partPath, spec);
    return spec;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`panelSpec resolve failed for ${partPath}:`, err);
    cache.set(partPath, null);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/resolvePanelSpec.spec.ts`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/resolvePanelSpec.ts packages/app/src/shell/__tests__/resolvePanelSpec.spec.ts
git commit -m "feat(app): resolvePanelSpec OPFS reader

Sibling to resolvePartInfo. Reads a part manifest, finds
featureTree[0], returns PanelSpec | null. Cache stores null
for non-panel parts so the next lookup is O(1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 11: Implement `loadCutListInputs` effect helper

**Files:**
- Create: `packages/app/src/shell/loadCutListInputs.ts`
- Create: `packages/app/src/shell/__tests__/loadCutListInputs.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/shell/__tests__/loadCutListInputs.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadCutListInputs } from '../loadCutListInputs';
import type { PanelSpecCache } from '../resolvePanelSpec';

vi.mock('../resolvePanelSpec', () => ({
  resolvePanelSpec: vi.fn(async (_opfs, partPath: string, cache: PanelSpecCache) => {
    const v = partPath === 'p/a.zipt' ? { length: 600, width: 400, thickness: 18, materialId: 'm', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null } } : null;
    cache.set(partPath, v as never);
    return v as never;
  }),
}));

describe('loadCutListInputs', () => {
  it('resolves panel specs for every unique leaf partPath', async () => {
    const opfs = { read: vi.fn() };
    const cache: PanelSpecCache = new Map();
    const map = await loadCutListInputs(opfs, ['p/a.zipt', 'p/b.zipt', 'p/a.zipt'], cache);
    expect(map.size).toBe(2);
    expect(map.get('p/a.zipt')).not.toBeNull();
    expect(map.get('p/b.zipt')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/loadCutListInputs.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `loadCutListInputs`**

Create `packages/app/src/shell/loadCutListInputs.ts`:

```ts
import { resolvePanelSpec, type PanelSpecCache } from './resolvePanelSpec';
import type { PanelSpec } from '@zilventor/shared/src/panel-feature';

type OpfsLike = { read: (path: string) => Promise<Uint8Array> };

export async function loadCutListInputs(
  opfs: OpfsLike,
  leafPartPaths: readonly string[],
  cache: PanelSpecCache,
): Promise<Map<string, PanelSpec | null>> {
  const unique = Array.from(new Set(leafPartPaths));
  const results = await Promise.all(unique.map((p) => resolvePanelSpec(opfs, p, cache)));
  const out = new Map<string, PanelSpec | null>();
  unique.forEach((p, i) => out.set(p, results[i]));
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/loadCutListInputs.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/loadCutListInputs.ts packages/app/src/shell/__tests__/loadCutListInputs.spec.ts
git commit -m "feat(app): loadCutListInputs effect helper

Parallel resolves panel specs for a list of unique leaf
partPaths. Returns the populated Map ready to feed
aggregateCutListRecursive.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — Store

### Task 12: Add `cutListTabActive` flag and setter

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/app/src/store/__tests__/useAppStore.spec.ts`:

```ts
describe('cutListTabActive (5d)', () => {
  it('defaults to false', () => {
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });

  it('setCutListTabActive updates the flag', () => {
    useAppStore.getState().setCutListTabActive(true);
    expect(useAppStore.getState().cutListTabActive).toBe(true);
    useAppStore.getState().setCutListTabActive(false);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/store/__tests__/useAppStore.spec.ts -t cutListTabActive`
Expected: FAIL.

- [ ] **Step 3: Add the flag + setter to the store**

Open `packages/app/src/store/useAppStore.ts`. Find the line `bomTabActive: boolean;` (around line 183) and add directly after:

```ts
  cutListTabActive: boolean;
```

Find the line `setBomTabActive: (v: boolean) => void;` (around line 196) and add directly after:

```ts
  setCutListTabActive: (v: boolean) => void;
```

Find the initial-state line `bomTabActive: false,` (around line 440) and add directly after:

```ts
  cutListTabActive: false,
```

Find the action `setBomTabActive: (v) => set({ bomTabActive: v }),` (around line 457) and add directly after:

```ts
  setCutListTabActive: (v) => set({ cutListTabActive: v }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/app test src/store/__tests__/useAppStore.spec.ts -t cutListTabActive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(store): add cutListTabActive flag + setter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 13: Add `setCutListItemNumber` (with conflict-bump) and `setCutListItemNumbers`

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to `useAppStore.spec.ts`:

```ts
describe('cutListItemNumbers (5d)', () => {
  // Helper assumed available in this spec file: makeAssemblyAndActivate(...)
  // — search the file for the existing pattern used by setBomItemNumber tests.

  it('setCutListItemNumber stores a value for a new key', () => {
    makeAssemblyAndActivate();
    useAppStore.getState().setCutListItemNumber('k1', 3);
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({ k1: 3 });
  });

  it('setCutListItemNumber bumps a colliding key to max+1', () => {
    makeAssemblyAndActivate();
    useAppStore.getState().setCutListItemNumbers({ k1: 1, k2: 2 });
    useAppStore.getState().setCutListItemNumber('k2', 1);
    const m = useAppStore.getState().activeAssembly!.cutListItemNumbers;
    expect(m.k2).toBe(1);
    expect(m.k1).toBe(3); // bumped to max+1 (max was 2)
  });

  it('setCutListItemNumbers replaces the whole map', () => {
    makeAssemblyAndActivate();
    useAppStore.getState().setCutListItemNumbers({ a: 1, b: 2, c: 3 });
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({ a: 1, b: 2, c: 3 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/store/__tests__/useAppStore.spec.ts -t cutListItemNumbers`
Expected: FAIL — `setCutListItemNumber` undefined.

- [ ] **Step 3: Implement the actions**

In `packages/app/src/store/useAppStore.ts`, find the type lines (around 214-215):

```ts
  setBomItemNumber(rowKey: string, n: number): void;
  setBomItemNumbers(map: Record<string, number>): void;
```

Add directly after:

```ts
  setCutListItemNumber(rowKey: string, n: number): void;
  setCutListItemNumbers(map: Record<string, number>): void;
```

Find the action implementations (around line 632 `setBomItemNumber: (rowKey, n) => set((s) => {`). Read that block in full to learn the existing conflict-bump shape. Add a sibling block immediately below `setBomItemNumbers`'s closing `}),`:

```ts
  setCutListItemNumber: (rowKey, n) => set((s) => {
    if (!s.activeAssembly) return {};
    const current = s.activeAssembly.cutListItemNumbers;
    const colliding = Object.entries(current).find(([k, v]) => k !== rowKey && v === n);
    const next: Record<string, number> = { ...current, [rowKey]: n };
    if (colliding) {
      const used = Object.values(next);
      const bumped = (used.length === 0 ? 0 : Math.max(...used)) + 1;
      next[colliding[0]] = bumped;
    }
    return { activeAssembly: { ...s.activeAssembly, cutListItemNumbers: next } };
  }),
  setCutListItemNumbers: (map) => set((s) => {
    if (!s.activeAssembly) return {};
    return { activeAssembly: { ...s.activeAssembly, cutListItemNumbers: { ...map } } };
  }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/store/__tests__/useAppStore.spec.ts -t cutListItemNumbers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(store): setCutListItemNumber (conflict-bump) + bulk setter

Mirrors setBomItemNumber semantics. Single deterministic
bump on collision: colliding row gets max(values)+1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Commands

### Task 14: `OpenCutListTabCommand` + extend `OpenBomTabCommand` for mutual exclusion

**Files:**
- Create: `packages/app/src/commands/OpenCutListTabCommand.ts`
- Create: `packages/app/src/commands/__tests__/OpenCutListTabCommand.spec.ts`
- Modify: `packages/app/src/commands/OpenBomTabCommand.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/commands/__tests__/OpenCutListTabCommand.spec.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenCutListTabCommand } from '../OpenCutListTabCommand';
import { OpenBomTabCommand } from '../OpenBomTabCommand';

describe('OpenCutListTabCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ bomTabActive: false, cutListTabActive: false });
  });

  it('sets cutListTabActive: true and bomTabActive: false', async () => {
    useAppStore.getState().setBomTabActive(true);
    await new OpenCutListTabCommand().apply();
    expect(useAppStore.getState().cutListTabActive).toBe(true);
    expect(useAppStore.getState().bomTabActive).toBe(false);
  });
});

describe('OpenBomTabCommand mutual exclusion', () => {
  beforeEach(() => {
    useAppStore.setState({ bomTabActive: false, cutListTabActive: false });
  });

  it('clears cutListTabActive when opening BOM', async () => {
    useAppStore.getState().setCutListTabActive(true);
    await new OpenBomTabCommand().apply();
    expect(useAppStore.getState().bomTabActive).toBe(true);
    expect(useAppStore.getState().cutListTabActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/OpenCutListTabCommand.spec.ts`
Expected: FAIL — module missing + OpenBomTabCommand doesn't yet clear the cut-list flag.

- [ ] **Step 3: Implement `OpenCutListTabCommand`**

Create `packages/app/src/commands/OpenCutListTabCommand.ts`:

```ts
import { useAppStore } from '../store/useAppStore';

export class OpenCutListTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setCutListTabActive(true);
    s.setBomTabActive(false);
  }
}
```

- [ ] **Step 4: Extend `OpenBomTabCommand`**

Replace the body of `packages/app/src/commands/OpenBomTabCommand.ts` with:

```ts
import { useAppStore } from '../store/useAppStore';

export class OpenBomTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setBomTabActive(true);
    s.setCutListTabActive(false);
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/OpenCutListTabCommand.spec.ts`
Expected: PASS — both describes green.

- [ ] **Step 6: Run the existing OpenBomTabCommand spec to make sure it still passes**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__ -t Bom` (covers the BOM tab + renumber + bom item-number specs).
Expected: PASS — no regression.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/commands/OpenCutListTabCommand.ts packages/app/src/commands/OpenBomTabCommand.ts packages/app/src/commands/__tests__/OpenCutListTabCommand.spec.ts
git commit -m "feat(commands): OpenCutListTabCommand + mutual-exclusion w/ BOM

Each open command sets its own flag true and the other's
flag false, enforcing single-active-tab invariant outside
the store.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 15: `SetCutListItemNumberCommand`

**Files:**
- Create: `packages/app/src/commands/SetCutListItemNumberCommand.ts`
- Create: `packages/app/src/commands/__tests__/SetCutListItemNumberCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/commands/__tests__/SetCutListItemNumberCommand.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SetCutListItemNumberCommand } from '../SetCutListItemNumberCommand';
import { useAppStore } from '../../store/useAppStore';

describe('SetCutListItemNumberCommand', () => {
  it('writes through to setCutListItemNumber', async () => {
    // Use the same makeAssemblyAndActivate helper used by sibling specs.
    makeAssemblyAndActivate();
    await new SetCutListItemNumberCommand({ rowKey: 'k1', n: 7 }).apply();
    expect(useAppStore.getState().activeAssembly!.cutListItemNumbers.k1).toBe(7);
  });
});
```

(Use the same import for `makeAssemblyAndActivate` as the existing `SetBomItemNumberCommand.spec.ts` — copy the import line from there.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/SetCutListItemNumberCommand.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the command**

Create `packages/app/src/commands/SetCutListItemNumberCommand.ts`:

```ts
import { useAppStore } from '../store/useAppStore';

export class SetCutListItemNumberCommand {
  constructor(private opts: { rowKey: string; n: number }) {}
  async apply(): Promise<void> {
    useAppStore.getState().setCutListItemNumber(this.opts.rowKey, this.opts.n);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/SetCutListItemNumberCommand.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/SetCutListItemNumberCommand.ts packages/app/src/commands/__tests__/SetCutListItemNumberCommand.spec.ts
git commit -m "feat(commands): SetCutListItemNumberCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 16: `RenumberCutListCommand`

**Files:**
- Create: `packages/app/src/commands/RenumberCutListCommand.ts`
- Create: `packages/app/src/commands/__tests__/RenumberCutListCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/commands/__tests__/RenumberCutListCommand.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RenumberCutListCommand } from '../RenumberCutListCommand';
import { useAppStore } from '../../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

describe('RenumberCutListCommand', () => {
  it('writes 1..N keyed by sort-order rowKeys', async () => {
    makeAssemblyAndActivate();
    const result: CutListResult = {
      rows: [
        { rowKey: 'k-oak', itemNumber: 99, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm-oak', materialName: 'Oak', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
        { rowKey: 'k-birch-large', itemNumber: 99, qty: 1, length: 800, width: 400, thickness: 18, materialId: 'm-birch', materialName: 'Birch', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
        { rowKey: 'k-birch-small', itemNumber: 99, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm-birch', materialName: 'Birch', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
      ],
      bandTotals: [],
      excluded: { componentCount: 0, partCount: 0 },
    };
    await new RenumberCutListCommand({ result }).apply();
    const m = useAppStore.getState().activeAssembly!.cutListItemNumbers;
    // Sort: materialName ASC (Birch < Oak), then length DESC.
    expect(m['k-birch-large']).toBe(1);
    expect(m['k-birch-small']).toBe(2);
    expect(m['k-oak']).toBe(3);
  });

  it('no-ops when activeAssembly is null', async () => {
    useAppStore.setState({ activeAssembly: null });
    await new RenumberCutListCommand({ result: { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } } }).apply();
    expect(useAppStore.getState().activeAssembly).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/RenumberCutListCommand.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the command**

Create `packages/app/src/commands/RenumberCutListCommand.ts`:

```ts
import { useAppStore } from '../store/useAppStore';
import { compareCutListRowsForRenumber, type CutListResult } from '@zilventor/shared/src/cutListRow';

export class RenumberCutListCommand {
  constructor(private opts: { result: CutListResult }) {}
  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    const sorted = [...this.opts.result.rows].sort(compareCutListRowsForRenumber);
    const next: Record<string, number> = {};
    sorted.forEach((r, i) => { next[r.rowKey] = i + 1; });
    useAppStore.getState().setCutListItemNumbers(next);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/RenumberCutListCommand.spec.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/RenumberCutListCommand.ts packages/app/src/commands/__tests__/RenumberCutListCommand.spec.ts
git commit -m "feat(commands): RenumberCutListCommand

Sorts rows via compareCutListRowsForRenumber, writes 1..N
to setCutListItemNumbers. Constructor takes the
CutListResult directly (4c-style: caller passes the data
the command needs).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 17: `buildCutListCsv` pure helper

**Files:**
- Create: `packages/app/src/commands/buildCutListCsv.ts`
- Create: `packages/app/src/commands/__tests__/buildCutListCsv.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/src/commands/__tests__/buildCutListCsv.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCutListCsv } from '../buildCutListCsv';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const empty: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

describe('buildCutListCsv', () => {
  it('emits headers + exclusion line for an empty result', () => {
    const csv = buildCutListCsv(empty);
    expect(csv).toContain('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
    expect(csv).toContain('Edge Band Material,Total Length (mm),Total Length (m)');
    expect(csv).toContain('Excluded from cut list,0 components,0 distinct parts');
  });

  it('emits a panel-rows section + band-totals + exclusion footer', () => {
    const result: CutListResult = {
      rows: [{
        rowKey: 'k1', itemNumber: 1, qty: 3,
        length: 600, width: 400, thickness: 18,
        materialId: 'm-birch', materialName: 'Birch 18mm',
        grain: 'length',
        edgeBands: {
          front: { materialId: 'm-pvc', materialName: 'PVC 1mm white' },
          back: null, left: null,
          right: { materialId: 'm-pvc', materialName: 'PVC 1mm white' },
        },
        partPath: 'parts/side.zipt', partName: 'Side',
        componentPathKeys: [],
      }],
      bandTotals: [{ materialId: 'm-pvc', materialName: 'PVC 1mm white', totalLengthMm: 3000 }],
      excluded: { componentCount: 5, partCount: 2 },
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain('1,3,Birch 18mm,600,400,18,length,PVC 1mm white,,,PVC 1mm white,Side,parts/side.zipt');
    expect(csv).toContain('PVC 1mm white,3000,3.000');
    expect(csv).toContain('Excluded from cut list,5 components,2 distinct parts');
  });

  it('RFC-4180 quotes cells containing commas, quotes, or newlines', () => {
    const result: CutListResult = {
      ...empty,
      rows: [{
        rowKey: 'k', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
        materialId: 'm', materialName: 'Comma, name',
        grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p', partName: 'Quoted "X"',
        componentPathKeys: [],
      }],
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain('"Comma, name"');
    expect(csv).toContain('"Quoted ""X"""');
  });

  it('serialises numeric columns without trailing zeros', () => {
    const result: CutListResult = {
      ...empty,
      rows: [{
        rowKey: 'k', itemNumber: 1, qty: 1,
        length: 600, width: 400.5, thickness: 18,
        materialId: 'm', materialName: 'M',
        grain: 'none',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p', partName: 'P',
        componentPathKeys: [],
      }],
    };
    const csv = buildCutListCsv(result);
    expect(csv).toContain(',600,400.5,18,');
  });

  it('formats band-totals m to 3 decimal places', () => {
    const result: CutListResult = {
      ...empty,
      bandTotals: [{ materialId: 'm', materialName: 'X', totalLengthMm: 3600 }],
    };
    expect(buildCutListCsv(result)).toContain('X,3600,3.600');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/buildCutListCsv.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `buildCutListCsv`**

Create `packages/app/src/commands/buildCutListCsv.ts`:

```ts
import type { CutListEdgeBandCell, CutListResult, CutListRow, EdgeBandTotal } from '@zilventor/shared/src/cutListRow';

function csvCell(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function num(n: number): string {
  // No thousands separator, no trailing zeros — Number.toString() already does this.
  return Number.isInteger(n) ? String(n) : String(n);
}

function bandLabel(c: CutListEdgeBandCell): string {
  return c ? c.materialName : '';
}

function rowLine(r: CutListRow): string {
  return [
    String(r.itemNumber),
    String(r.qty),
    csvCell(r.materialName),
    num(r.length),
    num(r.width),
    num(r.thickness),
    r.grain,
    csvCell(bandLabel(r.edgeBands.front)),
    csvCell(bandLabel(r.edgeBands.back)),
    csvCell(bandLabel(r.edgeBands.left)),
    csvCell(bandLabel(r.edgeBands.right)),
    csvCell(r.partName),
    csvCell(r.partPath),
  ].join(',');
}

function bandLine(b: EdgeBandTotal): string {
  const meters = (b.totalLengthMm / 1000).toFixed(3);
  return [csvCell(b.materialName), String(b.totalLengthMm), meters].join(',');
}

export function buildCutListCsv(result: CutListResult): string {
  const out: string[] = [];
  out.push('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  for (const r of result.rows) out.push(rowLine(r));
  out.push('');
  out.push('Edge Band Material,Total Length (mm),Total Length (m)');
  for (const b of result.bandTotals) out.push(bandLine(b));
  out.push('');
  out.push(
    `Excluded from cut list,${result.excluded.componentCount} components,${result.excluded.partCount} distinct parts`,
  );
  return out.join('\n') + '\n';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/buildCutListCsv.spec.ts`
Expected: PASS — all CSV cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/buildCutListCsv.ts packages/app/src/commands/__tests__/buildCutListCsv.spec.ts
git commit -m "feat(commands): buildCutListCsv pure helper

3-section CSV: panel rows / blank / edge-band totals / blank
/ exclusion footer. RFC-4180 quoting. Length-m to 3dp.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 18: `ExportCutListCsvCommand`

**Files:**
- Create: `packages/app/src/commands/ExportCutListCsvCommand.ts`
- Create: `packages/app/src/commands/__tests__/ExportCutListCsvCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/app/src/commands/ExportBomCsvCommand.ts` first (read it) — model the new file on it. Then create `packages/app/src/commands/__tests__/ExportCutListCsvCommand.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ExportCutListCsvCommand } from '../ExportCutListCsvCommand';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const empty: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

describe('ExportCutListCsvCommand', () => {
  it('captures CSV bytes via __zilventorCutListCsvBytes', async () => {
    // showSaveFilePicker not present in jsdom; falls back to <a download> path.
    const cmd = new ExportCutListCsvCommand({ result: empty, suggestedName: 'a-cutlist.csv' });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorCutListCsvBytes?: Uint8Array }).__zilventorCutListCsvBytes;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes!)).toContain('Item#,QTY,Material');
  });

  it('silent no-op when user cancels showSaveFilePicker', async () => {
    const aborted = Object.assign(new Error('AbortError'), { name: 'AbortError' });
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = vi.fn().mockRejectedValue(aborted);
    const cmd = new ExportCutListCsvCommand({ result: empty, suggestedName: 'a-cutlist.csv' });
    await expect(cmd.apply()).resolves.toBeUndefined();
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/ExportCutListCsvCommand.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the command**

Create `packages/app/src/commands/ExportCutListCsvCommand.ts` modelled on `ExportBomCsvCommand.ts` (read that file first to copy the showSaveFilePicker + `<a download>` fallback shape):

```ts
import { buildCutListCsv } from './buildCutListCsv';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __zilventorCutListCsvBytes: Uint8Array | undefined;
}

interface FsHandle {
  createWritable: () => Promise<{ write: (data: Uint8Array) => Promise<void>; close: () => Promise<void> }>;
}
type SaveFilePicker = (opts: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<FsHandle>;

export class ExportCutListCsvCommand {
  constructor(private opts: { result: CutListResult; suggestedName: string }) {}

  async apply(): Promise<void> {
    const csv = buildCutListCsv(this.opts.result);
    const bytes = new TextEncoder().encode(csv);
    (globalThis as unknown as { __zilventorCutListCsvBytes: Uint8Array | undefined }).__zilventorCutListCsvBytes = bytes;
    const picker = (globalThis as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (typeof picker === 'function') {
      try {
        const handle = await picker({
          suggestedName: this.opts.suggestedName,
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
        });
        const w = await handle.createWritable();
        await w.write(bytes);
        await w.close();
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === 'AbortError') return;
        // Fallthrough to <a download> on other errors only if document exists.
        if (typeof document === 'undefined') return;
        this.downloadFallback(bytes);
      }
      return;
    }
    if (typeof document !== 'undefined') this.downloadFallback(bytes);
  }

  private downloadFallback(bytes: Uint8Array): void {
    const blob = new Blob([bytes], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.opts.suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/ExportCutListCsvCommand.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/ExportCutListCsvCommand.ts packages/app/src/commands/__tests__/ExportCutListCsvCommand.spec.ts
git commit -m "feat(commands): ExportCutListCsvCommand

Mirrors ExportBomCsvCommand. Uses showSaveFilePicker when
present, falls back to <a download>. Captures bytes to
__zilventorCutListCsvBytes for E2E.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 7 — Shell UI

### Task 19: `CutListTable.tsx`

**Files:**
- Create: `packages/app/src/shell/CutListTable.tsx`
- Create: `packages/app/src/shell/__tests__/CutListTable.spec.tsx`

- [ ] **Step 1: Write the failing tests**

Read `packages/app/src/shell/BomTable.tsx` and `BomTable.spec.tsx` first to understand the established conventions (cell-stop-propagation, inline-edit shape, Tailwind classes). Then create `packages/app/src/shell/__tests__/CutListTable.spec.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CutListTable } from '../CutListTable';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const result: CutListResult = {
  rows: [
    {
      rowKey: 'k1', itemNumber: 1, qty: 3,
      length: 600, width: 400, thickness: 18,
      materialId: 'm-birch', materialName: 'Birch 18mm',
      grain: 'length',
      edgeBands: {
        front: { materialId: 'm-pvc', materialName: 'PVC 1mm white' },
        back: null, left: null, right: null,
      },
      partPath: 'parts/side.zipt', partName: 'Side',
      componentPathKeys: ['p1', 'p2', 'p3'],
    },
  ],
  bandTotals: [{ materialId: 'm-pvc', materialName: 'PVC 1mm white', totalLengthMm: 1800 }],
  excluded: { componentCount: 2, partCount: 1 },
};

describe('CutListTable', () => {
  it('renders panel rows from CutListResult', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('Birch 18mm')).toBeInTheDocument();
    expect(screen.getByText('PVC 1mm white')).toBeInTheDocument();
    expect(screen.getByText('Side')).toBeInTheDocument();
  });

  it('renders the band-totals subsection when non-empty', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('1800 mm')).toBeInTheDocument();
  });

  it('hides band-totals subsection when empty', () => {
    const r = { ...result, bandTotals: [] };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.queryByText(/Total Length/)).not.toBeInTheDocument();
  });

  it('renders the exclusion footer always', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText(/Excluded from cut list: 2 components/)).toBeInTheDocument();
  });

  it('shows "No panels" placeholder when rows is empty', () => {
    const r: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('No panels')).toBeInTheDocument();
  });

  it('row click calls onSelectRow with componentPathKeys', () => {
    const onSelectRow = vi.fn();
    render(<CutListTable result={result} onSelectRow={onSelectRow} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    fireEvent.click(screen.getByText('Birch 18mm'));
    expect(onSelectRow).toHaveBeenCalledWith(['p1', 'p2', 'p3']);
  });

  it('Item# inline edit calls onEditItemNumber on blur', () => {
    const onEditItemNumber = vi.fn();
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={onEditItemNumber} onExportCsv={() => {}} />);
    const cell = screen.getByLabelText('Item# 1');
    fireEvent.dblClick(cell);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onEditItemNumber).toHaveBeenCalledWith('k1', 7);
  });

  it('missing-material row carries aria-invalid="true"', () => {
    const r: CutListResult = {
      ...result,
      rows: [{ ...result.rows[0], materialName: '(missing material)' }],
    };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByText('(missing material)').closest('tr')).toHaveAttribute('aria-invalid', 'true');
  });

  it('Export CSV button is disabled when nothing to export', () => {
    const r: CutListResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
    render(<CutListTable result={r} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
  });

  it('Export CSV button is enabled when rows exist', () => {
    render(<CutListTable result={result} onSelectRow={() => {}} onEditItemNumber={() => {}} onExportCsv={() => {}} />);
    expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/CutListTable.spec.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `CutListTable.tsx`**

Create `packages/app/src/shell/CutListTable.tsx`:

```tsx
import { useState } from 'react';
import type { CutListResult, CutListRow } from '@zilventor/shared/src/cutListRow';

export type CutListTableProps = {
  result: CutListResult;
  onSelectRow: (componentPathKeys: string[]) => void;
  onEditItemNumber: (rowKey: string, n: number) => void;
  onExportCsv: () => void;
};

function bandLabel(cell: CutListRow['edgeBands']['front']): string {
  return cell ? cell.materialName : '';
}

function ItemNumberCell({
  row, onEditItemNumber,
}: { row: CutListRow; onEditItemNumber: CutListTableProps['onEditItemNumber'] }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(row.itemNumber));
  if (editing) {
    return (
      <td onClick={(e) => e.stopPropagation()} className="px-2 py-1 border-b">
        <input
          type="number"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            const n = Number(value);
            if (Number.isInteger(n) && n > 0) onEditItemNumber(row.rowKey, n);
            setEditing(false);
          }}
          className="w-16"
        />
      </td>
    );
  }
  return (
    <td
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={() => { setValue(String(row.itemNumber)); setEditing(true); }}
      aria-label={`Item# ${row.itemNumber}`}
      className="px-2 py-1 border-b cursor-text"
    >
      {row.itemNumber}
    </td>
  );
}

export function CutListTable({ result, onSelectRow, onEditItemNumber, onExportCsv }: CutListTableProps): JSX.Element {
  const canExport = result.rows.length > 0 || result.excluded.componentCount > 0;
  return (
    <div className="flex flex-col gap-3 p-2 text-xs">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onExportCsv}
          disabled={!canExport}
          className="px-2 py-1 rounded border bg-white disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>
      {result.rows.length === 0 ? (
        <div className="italic text-gray-500 px-2">No panels</div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-2 py-1 border-b">Item#</th>
              <th className="px-2 py-1 border-b">QTY</th>
              <th className="px-2 py-1 border-b">Material</th>
              <th className="px-2 py-1 border-b">L</th>
              <th className="px-2 py-1 border-b">W</th>
              <th className="px-2 py-1 border-b">T</th>
              <th className="px-2 py-1 border-b">Grain</th>
              <th className="px-2 py-1 border-b">Front</th>
              <th className="px-2 py-1 border-b">Back</th>
              <th className="px-2 py-1 border-b">Left</th>
              <th className="px-2 py-1 border-b">Right</th>
              <th className="px-2 py-1 border-b">Part Name</th>
              <th className="px-2 py-1 border-b">Part Path</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const broken = r.materialName === '(missing material)';
              return (
                <tr
                  key={r.rowKey}
                  data-cutlist-row
                  className={broken ? 'bg-yellow-50 hover:bg-yellow-100 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'}
                  aria-invalid={broken ? 'true' : undefined}
                  onClick={() => onSelectRow([...r.componentPathKeys])}
                >
                  <ItemNumberCell row={r} onEditItemNumber={onEditItemNumber} />
                  <td className="px-2 py-1 border-b">{r.qty}</td>
                  <td className="px-2 py-1 border-b">{r.materialName}</td>
                  <td className="px-2 py-1 border-b">{r.length}</td>
                  <td className="px-2 py-1 border-b">{r.width}</td>
                  <td className="px-2 py-1 border-b">{r.thickness}</td>
                  <td className="px-2 py-1 border-b">{r.grain}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.front)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.back)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.left)}</td>
                  <td className="px-2 py-1 border-b">{bandLabel(r.edgeBands.right)}</td>
                  <td className="px-2 py-1 border-b">{r.partName}</td>
                  <td className="px-2 py-1 border-b">{r.partPath}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {result.bandTotals.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Edge Band Totals</div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-2 py-1 border-b">Material</th>
                <th className="px-2 py-1 border-b">Total (mm)</th>
                <th className="px-2 py-1 border-b">Total (m)</th>
              </tr>
            </thead>
            <tbody>
              {result.bandTotals.map((b) => (
                <tr key={b.materialId}>
                  <td className="px-2 py-1 border-b">{b.materialName}</td>
                  <td className="px-2 py-1 border-b">{b.totalLengthMm} mm</td>
                  <td className="px-2 py-1 border-b">{(b.totalLengthMm / 1000).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-gray-600 italic">
        Excluded from cut list: {result.excluded.componentCount} components
        ({result.excluded.partCount} distinct parts)
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/CutListTable.spec.tsx`
Expected: PASS — all 10 cases green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/CutListTable.tsx packages/app/src/shell/__tests__/CutListTable.spec.tsx
git commit -m "feat(shell): CutListTable component

Renders panel-rows + band-totals + exclusion footer. Inline
Item# edit (number input, validates positive int). Row
click → onSelectRow(componentPathKeys). Cell-level
stopPropagation on Item# matches BomTable convention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 20: BrowserPane third tab

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Write the failing test**

Open `packages/app/src/shell/__tests__/BrowserPane.spec.tsx` and read the existing assembly-mode tab-strip tests (search for `aria-label="BOM tab"`). Add new cases:

```tsx
describe('BrowserPane Cut List tab (5d)', () => {
  it('renders Assembly | BOM | Cut List tabs in assembly mode', () => {
    seedAssemblyMode();
    render(<BrowserPane />);
    expect(screen.getByLabelText('Assembly tab')).toBeInTheDocument();
    expect(screen.getByLabelText('BOM tab')).toBeInTheDocument();
    expect(screen.getByLabelText('Cut List tab')).toBeInTheDocument();
  });

  it('clicking Cut List tab dispatches OpenCutListTabCommand', async () => {
    seedAssemblyMode();
    render(<BrowserPane />);
    fireEvent.click(screen.getByLabelText('Cut List tab'));
    await waitFor(() => {
      expect(useAppStore.getState().cutListTabActive).toBe(true);
      expect(useAppStore.getState().bomTabActive).toBe(false);
    });
  });

  it('shows the CutListTable when cutListTabActive is true', () => {
    seedAssemblyMode();
    useAppStore.getState().setCutListTabActive(true);
    render(<BrowserPane />);
    // Empty assembly → "No panels" placeholder rendered.
    expect(screen.getByText('No panels')).toBeInTheDocument();
  });
});
```

(`seedAssemblyMode` is the existing helper for the 4c BOM tests — reuse it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/BrowserPane.spec.tsx -t "Cut List"`
Expected: FAIL — third tab missing.

- [ ] **Step 3: Add the third tab**

Open `packages/app/src/shell/BrowserPane.tsx`. Find the existing tab strip JSX (look for `aria-label="BOM tab"`). Add a sibling button immediately after:

```tsx
<button
  type="button"
  aria-label="Cut List tab"
  onClick={() => void new OpenCutListTabCommand().apply()}
  className={`px-2 py-1 text-xs ${cutListTabActive ? 'bg-white border-b-2 border-blue-500' : 'bg-gray-100'}`}
>
  Cut List
</button>
```

Add the import at the top:

```ts
import { OpenCutListTabCommand } from '../commands/OpenCutListTabCommand';
import { CutListTable } from './CutListTable';
```

Subscribe to `cutListTabActive` from the store (mirror the `bomTabActive` subscription pattern used a few lines above).

Add the conditional rendering of `<CutListTable>` in the body of the BrowserPane, alongside the existing `bomTabActive ? <BomTable .../> : ...` pattern:

```tsx
{cutListTabActive
  ? <CutListTable
      result={cutListResult}
      onSelectRow={(ids) => useAppStore.getState().selectComponents(ids)}
      onEditItemNumber={(k, n) => void new SetCutListItemNumberCommand({ rowKey: k, n }).apply()}
      onExportCsv={() => void new ExportCutListCsvCommand({ result: cutListResult, suggestedName: `${activeAssemblyName}-cutlist.csv` }).apply()}
    />
  : bomTabActive
    ? <BomTable ... />
    : <AssemblyTree ... />}
```

`cutListResult` here is the lazily-computed `aggregateCutListRecursive(...)` output. For BrowserPane unit tests it's fine to compute it inline from the active assembly's `components` + the global `subAssemblyCacheRef.current` + the global `panelSpecCacheRef.current` + active assembly's `materials` + the `partInfoCacheRef.current` map. If those globals don't yet exist in BrowserPane, declare them as refs in the parent `App.tsx` (Task 21 + 22).

For now, in BrowserPane, accept these as props (or read from `App.tsx`-provided context). The simplest pattern is: BrowserPane imports the refs from `App.tsx` (search the file to see how it consumes other refs from App). Then inline:

```tsx
const cutListResult = useMemo(() => {
  if (!activeAssembly) return { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
  return aggregateCutListRecursive(
    activeAssembly,
    subAssemblyCacheRef.current,
    panelSpecCacheRef.current,
    activeAssembly.materials ?? [],
    partInfoCacheRef.current,
  );
}, [activeAssembly, /* triggers from cache version counters */]);
```

If the refs aren't already exposed to BrowserPane via App.tsx, return to this task after Task 22 (autosave wiring) which will surface them. For now, the tests can be written assuming the refs are available — the props or context wiring happens in Task 22.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/shell/__tests__/BrowserPane.spec.tsx`
Expected: PASS — old + new cases.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "feat(shell): BrowserPane Cut List tab + table mounting

Third tab in the assembly-mode strip. Mounts CutListTable
when cutListTabActive. Aggregates lazily via memo against
the App.tsx-owned caches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 21: FurnitureTab Cut List ribbon panel

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`
- Modify: `packages/app/src/shell/tabs/__tests__/FurnitureTab.spec.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/shell/tabs/__tests__/FurnitureTab.spec.tsx`:

```tsx
describe('FurnitureTab Cut List panel (5d)', () => {
  beforeEach(() => seedAssemblyMode());

  it('renders the Cut List ribbon panel with three buttons', () => {
    render(<FurnitureTab />);
    expect(screen.getByLabelText('Cut List panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cut List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renumber' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
  });

  it('clicking Cut List dispatches OpenCutListTabCommand', async () => {
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Cut List' }));
    await waitFor(() => expect(useAppStore.getState().cutListTabActive).toBe(true));
  });

  it('clicking Renumber dispatches RenumberCutListCommand', async () => {
    // Pre-seed an empty result; Renumber on empty is a no-op store write.
    render(<FurnitureTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Renumber' }));
    await waitFor(() => expect(useAppStore.getState().activeAssembly!.cutListItemNumbers).toEqual({}));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @zilventor/app test src/shell/tabs/__tests__/FurnitureTab.spec.tsx -t "Cut List"`
Expected: FAIL — panel doesn't exist.

- [ ] **Step 3: Add the panel**

Open `packages/app/src/shell/tabs/FurnitureTab.tsx`. Find the existing `Panel` ribbon panel block. Add a sibling block:

```tsx
<div aria-label="Cut List panel" className="...same wrapper classes as Panel panel...">
  <button
    type="button"
    onClick={() => void new OpenCutListTabCommand().apply()}
    className="..."
  >
    Cut List
  </button>
  <button
    type="button"
    onClick={() => void new RenumberCutListCommand({ result: getCurrentCutListResult() }).apply()}
    className="..."
  >
    Renumber
  </button>
  <button
    type="button"
    onClick={() => void new ExportCutListCsvCommand({
      result: getCurrentCutListResult(),
      suggestedName: `${activeAssemblyName}-cutlist.csv`,
    }).apply()}
    className="..."
  >
    Export CSV
  </button>
</div>
```

`getCurrentCutListResult()` is a small helper closure that reads the same App.tsx-owned refs that BrowserPane uses and runs `aggregateCutListRecursive`. To avoid duplicating that logic, lift it into a shared hook `useCutListResult()` in a new file `packages/app/src/shell/useCutListResult.ts`:

```ts
import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { aggregateCutListRecursive } from '../assembly/walkers/aggregateCutListRecursive';
// ...import the App.tsx refs (or pass them via context)
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

export function useCutListResult(): CutListResult {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  // Read refs from a shared context exposed by App.tsx; if not yet exposed,
  // expose them in Task 22.
  return useMemo(() => {
    if (!activeAssembly) return { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };
    return aggregateCutListRecursive(
      activeAssembly,
      subAssemblyCacheRef.current,
      panelSpecCacheRef.current,
      activeAssembly.materials ?? [],
      partInfoCacheRef.current,
    );
  }, [activeAssembly]);
}
```

Use this hook from both BrowserPane (replace the inline `useMemo`) and FurnitureTab. Refactor the BrowserPane hookup from Task 20 to consume the same hook.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @zilventor/app test src/shell/tabs/__tests__/FurnitureTab.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/tabs/__tests__/FurnitureTab.spec.tsx packages/app/src/shell/useCutListResult.ts packages/app/src/shell/BrowserPane.tsx
git commit -m "feat(shell): FurnitureTab Cut List ribbon panel + shared hook

useCutListResult() centralises the aggregator wiring;
BrowserPane and FurnitureTab both consume it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 8 — Autosave + cache invalidation

### Task 22: `mergeAndPruneCutList` helper + wire autosave with cache-completeness guard

**Files:**
- Create: `packages/app/src/storage/mergeCutListItemNumbers.ts`
- Create: `packages/app/src/storage/__tests__/mergeCutListItemNumbers.spec.ts`
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/storage/__tests__/mergeCutListItemNumbers.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeAndPruneCutList } from '../mergeCutListItemNumbers';
import type { AssemblyDocument } from '@zilventor/shared';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';

const baseResult = (): CutListResult => ({
  rows: [
    { rowKey: 'k-live', itemNumber: 4, qty: 1, length: 600, width: 400, thickness: 18, materialId: 'm', materialName: 'M', grain: 'length', edgeBands: { front: null, back: null, left: null, right: null }, partPath: 'p', partName: 'P', componentPathKeys: [] },
  ],
  bandTotals: [],
  excluded: { componentCount: 0, partCount: 0 },
});

const baseAsm = (): AssemblyDocument => ({
  id: 'a', name: 'A', units: 'mm',
  parameters: {}, components: [], constraints: [],
  groundedComponentPaths: [], colors: {},
  bomItemNumbers: {}, cutListItemNumbers: { 'k-live': 4, 'k-stale': 9 },
  colorOverrides: {},
} as unknown as AssemblyDocument);

describe('mergeAndPruneCutList', () => {
  it('merges resolved item numbers from the result', () => {
    const result = baseResult();
    result.rows[0].itemNumber = 5; // resolved value differs from stored
    const a = baseAsm();
    const out = mergeAndPruneCutList(a, result, { cacheComplete: true });
    expect(out.cutListItemNumbers['k-live']).toBe(5);
  });

  it('prunes orphan keys when cacheComplete=true', () => {
    const out = mergeAndPruneCutList(baseAsm(), baseResult(), { cacheComplete: true });
    expect(out.cutListItemNumbers).not.toHaveProperty('k-stale');
  });

  it('preserves orphan keys when cacheComplete=false (cache incomplete)', () => {
    const out = mergeAndPruneCutList(baseAsm(), baseResult(), { cacheComplete: false });
    expect(out.cutListItemNumbers['k-stale']).toBe(9);
  });

  it('does not mutate the input assembly', () => {
    const a = baseAsm();
    const before = { ...a.cutListItemNumbers };
    mergeAndPruneCutList(a, baseResult(), { cacheComplete: true });
    expect(a.cutListItemNumbers).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/storage/__tests__/mergeCutListItemNumbers.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `mergeAndPruneCutList`**

Create `packages/app/src/storage/mergeCutListItemNumbers.ts`:

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import { pruneCutListItemNumbers, type CutListResult } from '@zilventor/shared/src/cutListRow';

export function mergeAndPruneCutList(
  assembly: AssemblyDocument,
  result: CutListResult,
  opts: { cacheComplete: boolean },
): AssemblyDocument {
  const merged: Record<string, number> = { ...assembly.cutListItemNumbers };
  for (const r of result.rows) merged[r.rowKey] = r.itemNumber;
  const cutListItemNumbers = opts.cacheComplete
    ? pruneCutListItemNumbers(result.rows.map((r) => r.rowKey), merged)
    : merged;
  return { ...assembly, cutListItemNumbers };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @zilventor/app test src/storage/__tests__/mergeCutListItemNumbers.spec.ts`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Wire into the autosave path in `App.tsx`**

Open `packages/app/src/App.tsx`. Find the existing autosave effect (search for `mergeAndPruneBom` — that's where the 4c BOM merge happens). Right next to it, add the cut-list merge:

```ts
const leafPaths = getReferencedLeafPartPaths(assembly, subAssemblyCacheRef.current);
const cacheComplete = leafPaths.every((p) => panelSpecCacheRef.current.has(p));
const cutListResult = aggregateCutListRecursive(
  assembly,
  subAssemblyCacheRef.current,
  panelSpecCacheRef.current,
  assembly.materials ?? [],
  partInfoCacheRef.current,
);
const merged = mergeAndPruneCutList(assembly, cutListResult, { cacheComplete });
// merged is what gets packed (replace the existing pre-pack `assembly` variable
// or chain after the BOM merge so both maps are written in the same pack).
```

Also add the `panelSpecCacheRef` declaration alongside the existing `partInfoCacheRef` declaration earlier in `App.tsx`:

```ts
const panelSpecCacheRef = useRef<PanelSpecCache>(new Map());
```

And extend the existing cache invalidation hooks (search for `partInfoCacheRef.current.delete(`) to also call `panelSpecCacheRef.current.delete(partPath)` everywhere `partInfoCacheRef.current.delete(...)` is called. Same for the cache-clear paths (`partInfoCacheRef.current.clear()` → also `panelSpecCacheRef.current.clear()`).

Wire the `panelSpecCacheRef` through to BrowserPane / FurnitureTab via the existing prop/context pattern that App.tsx uses for `partInfoCacheRef` (search to confirm the pattern; likely props on `<BrowserPane />`).

- [ ] **Step 6: Run the app's full test suite**

Run: `pnpm --filter @zilventor/app test`
Expected: PASS — no regression in existing 4c/4d autosave tests.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/storage/mergeCutListItemNumbers.ts packages/app/src/storage/__tests__/mergeCutListItemNumbers.spec.ts packages/app/src/App.tsx packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/useCutListResult.ts
git commit -m "feat(app): autosave merges cutListItemNumbers w/ cache guard

mergeAndPruneCutList runs alongside the 4c BOM merge on
every autosave cycle. Prune is gated on
cacheComplete = every leaf partPath is in panelSpecCacheRef,
so stored item numbers aren't erased when the cut-list tab
hasn't been opened this session. panelSpecCacheRef shares
invalidation hooks with partInfoCacheRef.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 9 — E2E

Each E2E spec is its own task. They share the new `tests/e2e/helpers/seedAssemblyPanelPart.ts` helper introduced in Task 23.

### Task 23: Add `seedAssemblyPanelPart` helper

**Files:**
- Create: `tests/e2e/helpers/seedAssemblyPanelPart.ts`

- [ ] **Step 1: Read the existing helpers**

Open `tests/e2e/helpers/seedAssemblyPart.ts` and `tests/e2e/helpers/seedSubAssembly.ts`. Note the OPFS dev-hook entry points (typically `__zilventorOpfs*`) and the manifest shape.

- [ ] **Step 2: Implement the helper**

Create `tests/e2e/helpers/seedAssemblyPanelPart.ts`:

```ts
import type { Page } from '@playwright/test';

export type SeedPanelPartArgs = {
  partPath: string;
  partName?: string;
  length: number;
  width: number;
  thickness: number;
  materialId: string;
  grain?: 'length' | 'width' | 'none';
  edgeBands?: Partial<Record<'front' | 'back' | 'left' | 'right', { materialId: string } | null>>;
  // Materials registry to embed at the part level (will reconcile on placement).
  materials?: Array<{ id: string; name: string; defaultThickness: number; color: string }>;
};

export async function seedAssemblyPanelPart(page: Page, args: SeedPanelPartArgs): Promise<void> {
  await page.evaluate(async (a) => {
    const manifest = {
      formatVersion: 11,
      kind: 'part',
      document: {
        id: `part-${a.partPath}`,
        name: a.partName ?? a.partPath.split('/').pop()!.replace(/\.zipt$/, ''),
        units: 'mm',
        parameters: {},
        featureTree: [{
          kind: 'panel',
          id: 'pf1',
          length: { kind: 'literal', value: a.length },
          width: { kind: 'literal', value: a.width },
          thickness: { kind: 'literal', value: a.thickness },
          thicknessFromMaterial: false,
          materialId: a.materialId,
          grain: a.grain ?? 'length',
          edgeBands: {
            front: a.edgeBands?.front ?? null,
            back: a.edgeBands?.back ?? null,
            left: a.edgeBands?.left ?? null,
            right: a.edgeBands?.right ?? null,
          },
        }],
        properties: {},
        materials: a.materials ?? [],
      },
    };
    const w = window as unknown as {
      __zilventorWritePartManifest: (path: string, m: unknown) => Promise<void>;
    };
    await w.__zilventorWritePartManifest(a.partPath, manifest);
  }, args);
}
```

If `__zilventorWritePartManifest` doesn't already exist as a dev hook, add it in `App.tsx` under `import.meta.env.DEV` alongside the existing OPFS dev hooks. It should call `packProject` then `opfs.write(path, bytes)`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/helpers/seedAssemblyPanelPart.ts packages/app/src/App.tsx
git commit -m "feat(e2e): seedAssemblyPanelPart helper + writePartManifest dev hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 24: E2E `cut-list-place-and-aggregate.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-place-and-aggregate.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';
// reuse the existing `placeComponent` helper used by 5a furniture tests

test('cut-list aggregates 3 panels (2 identical, 1 distinct) into 2 rows', async ({ page }) => {
  await page.goto('/');
  // create a new assembly + open it
  await page.getByRole('button', { name: 'New Assembly' }).click();
  // seed two distinct .zipt panel parts
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/side.zipt',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/top.zipt',
    length: 800, width: 400, thickness: 18,
    materialId: 'm-birch',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  // place: 2× side.zipt, 1× top.zipt — use existing placeComponent helper or
  // a __zilventorPlaceComponent dev hook
  // ...
  // open Cut List tab
  await page.getByLabel('Cut List tab').click();
  await expect(page.getByText('Birch 18mm').first()).toBeVisible();
  // expect 2 data rows
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2);
  // QTY columns
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2');
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('1');
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm playwright test tests/e2e/furniture/cut-list-place-and-aggregate.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/furniture/cut-list-place-and-aggregate.spec.ts
git commit -m "test(e2e): T24 cut-list place & aggregate

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 25: E2E `cut-list-grain-normalization.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-grain-normalization.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

test('cut-list merges grain=none swapped L/W; keeps grain=length distinct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Assembly' }).click();
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/g0a.zipt', length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'none',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/g0b.zipt', length: 400, width: 600, thickness: 18,
    materialId: 'm-birch', grain: 'none',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  // place 1 of each
  // ... place helper ...

  await page.getByLabel('Cut List tab').click();
  let rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(1);
  // grain=none normalizes to L=600, W=400
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText('600');
  await expect(rows.nth(0).locator('td').nth(4)).toHaveText('400');
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2'); // qty merged

  // Now seed two grain=length parts with swapped L/W and place them.
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/glA.zipt', length: 600, width: 400, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/glB.zipt', length: 400, width: 600, thickness: 18,
    materialId: 'm-birch', grain: 'length',
    materials: [{ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' }],
  });
  // place 1 of each
  // ... place helper ...

  rows = page.locator('[data-cutlist-row]');
  // 1 (grain=none merged row) + 2 (grain=length distinct rows) = 3
  await expect(rows).toHaveCount(3);
});
```

- [ ] **Step 2: Run, then commit**

Same shape as T24.

### Task 26: E2E `cut-list-edge-band-totals.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-edge-band-totals.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

test('edge-band totals: 600x400 panel with PVC bands on Front+Back, qty 3 → 3600 mm', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Assembly' }).click();
  await seedAssemblyPanelPart(page, {
    partPath: 'parts/banded.zipt',
    length: 600, width: 400, thickness: 18,
    materialId: 'm-birch',
    edgeBands: {
      front: { materialId: 'm-pvc' },
      back: { materialId: 'm-pvc' },
    },
    materials: [
      { id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
      { id: 'm-pvc', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
    ],
  });
  // place 3
  // ... place helper ×3 ...

  await page.getByLabel('Cut List tab').click();
  await expect(page.getByText('Edge Band Totals')).toBeVisible();
  await expect(page.getByText('PVC 1mm white')).toBeVisible();
  await expect(page.getByText('3600 mm')).toBeVisible();
  await expect(page.getByText('3.600')).toBeVisible();
});
```

- [ ] **Step 2: Run, then commit**

### Task 27: E2E `cut-list-recursive.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-recursive.spec.ts`

- [ ] **Step 1: Implement the spec**

Use the existing `seedSubAssembly.ts` helper. Create an inner sub-assembly with 2 distinct panels, then place that sub-assembly twice in an outer assembly. Cut list should show 2 rows of QTY 2 each.

```ts
import { test, expect } from '@playwright/test';
// ... seed inner sub-assembly with 2 panels via seedAssemblyPanelPart + seedSubAssembly
// ... place inner.ziasm twice in outer assembly
test('recursive cut list rolls up panels across nested .ziasm', async ({ page }) => {
  // ... full setup ...
  await page.getByLabel('Cut List tab').click();
  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).locator('td').nth(1)).toHaveText('2');
  await expect(rows.nth(1).locator('td').nth(1)).toHaveText('2');
});
```

- [ ] **Step 2: Run, then commit**

### Task 28: E2E `cut-list-renumber.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-renumber.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
// ... seed two distinct panel parts, place 1 of each ...
test('cut-list renumber + inline edit + persist across reload', async ({ page }) => {
  // ... setup ...
  await page.getByLabel('Cut List tab').click();
  // double-click Item# of row 1, enter 7, blur
  const row1 = page.locator('[data-cutlist-row]').first();
  await row1.locator('td').first().dblclick();
  await page.locator('input[type="number"]').fill('7');
  await page.locator('input[type="number"]').blur();
  await expect(row1.locator('td').first()).toHaveText('7');

  // trigger autosave (e.g. switch tabs), reload
  await page.reload();
  // re-open assembly, navigate back to Cut List tab
  // ... assert Item# 7 persists ...

  // click Renumber → resequences 1..N
  await page.getByRole('button', { name: 'Renumber' }).click();
  await expect(row1.locator('td').first()).toHaveText('1');
});
```

- [ ] **Step 2: Run, then commit**

### Task 29: E2E `cut-list-row-click-selects.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-row-click-selects.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
// ... seed 1 panel, place it twice ...
test('cut-list row click multi-selects matching components', async ({ page }) => {
  // ... setup with 2 instances of the same panel ...
  await page.getByLabel('Cut List tab').click();
  await page.locator('[data-cutlist-row]').first().click();

  // Use the existing __zilventorComponentSelectedOverlay dev hook (4c).
  const selected = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorComponentSelectedOverlay: (id: string) => boolean };
    return [w.__zilventorComponentSelectedOverlay('p1'), w.__zilventorComponentSelectedOverlay('p2')];
  });
  expect(selected).toEqual([true, true]);
});
```

- [ ] **Step 2: Run, then commit**

### Task 30: E2E `cut-list-csv-export.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-csv-export.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
// ... seed and place 2 banded panels ...
test('cut-list CSV export captures 3-section content', async ({ page }) => {
  // ... setup ...
  await page.getByLabel('Cut List tab').click();
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const csv = await page.evaluate(() => {
    const w = window as unknown as { __zilventorCutListCsvBytes: Uint8Array };
    return new TextDecoder().decode(w.__zilventorCutListCsvBytes);
  });
  expect(csv).toContain('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  expect(csv).toContain('Edge Band Material,Total Length (mm),Total Length (m)');
  expect(csv).toContain('Excluded from cut list');
});
```

- [ ] **Step 2: Run, then commit**

### Task 31: E2E `cut-list-non-panel-exclusion.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-non-panel-exclusion.spec.ts`

- [ ] **Step 1: Implement the spec**

Place 2 panel parts + 3 non-panel parts (e.g. existing extrude-based fixtures). Open Cut List, expect exclusion footer reads `3 components` and `2 distinct parts` (assuming 2 of the 3 non-panel are the same partPath; adjust counts to match the fixtures used).

- [ ] **Step 2: Run, then commit**

### Task 32: E2E `cut-list-broken-material.spec.ts`

**Files:**
- Create: `tests/e2e/furniture/cut-list-broken-material.spec.ts`

- [ ] **Step 1: Implement the spec**

```ts
import { test, expect } from '@playwright/test';
// seed a panel referencing m-birch; place it; then via OPFS dev hook
// strip m-birch from the assembly's materials registry; reload table.
test('cut-list shows (missing material) and yellow tint when registry ref breaks', async ({ page }) => {
  // ... setup ...
  // remove m-birch from the active assembly's materials (use a dev hook)
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorRemoveMaterialFromActiveAssembly: (id: string) => Promise<void> };
    return w.__zilventorRemoveMaterialFromActiveAssembly('m-birch');
  });
  await page.getByLabel('Cut List tab').click();
  const row = page.locator('[data-cutlist-row]').first();
  await expect(row).toHaveAttribute('aria-invalid', 'true');
  await expect(row).toContainText('(missing material)');
});
```

(If `__zilventorRemoveMaterialFromActiveAssembly` doesn't exist, add it under `import.meta.env.DEV` in App.tsx — small dev-only helper.)

- [ ] **Step 2: Run, then commit**

---

## Phase 10 — Perf

### Task 33: Perf spec `cut-list-aggregate-large.spec.ts`

**Files:**
- Create: `tests/perf/cut-list-aggregate-large.spec.ts`
- Modify: `packages/app/src/App.tsx` (add `__zilventorCutListAggregateMs` dev hook)

- [ ] **Step 1: Add the dev hook**

In `packages/app/src/App.tsx`, alongside `__zilventorBomAggregateMs`, add:

```ts
if (import.meta.env.DEV) {
  (globalThis as unknown as { __zilventorCutListAggregateMs: (trials: number) => number }).__zilventorCutListAggregateMs = (trials: number) => {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return 0;
    const samples: number[] = [];
    for (let i = 0; i < trials; i++) {
      const t0 = performance.now();
      aggregateCutListRecursive(
        a, subAssemblyCacheRef.current, panelSpecCacheRef.current,
        a.materials ?? [], partInfoCacheRef.current,
      );
      samples.push(performance.now() - t0);
    }
    samples.sort((x, y) => x - y);
    return samples[Math.floor(samples.length * 0.95)];
  };
}
```

- [ ] **Step 2: Implement the perf spec**

Create `tests/perf/cut-list-aggregate-large.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
// Build a synthetic 200-panel assembly across 50 distinct panel specs across
// 3 nesting levels using __zilventor dev hooks.

test('aggregateCutListRecursive p95 < 5 ms over 50 trials at 200 panels', async ({ page }) => {
  await page.goto('/');
  // ... build the synthetic assembly via dev hooks (mirror bom-aggregate-large.spec.ts) ...
  const p95 = await page.evaluate(() => {
    const w = window as unknown as { __zilventorCutListAggregateMs: (n: number) => number };
    return w.__zilventorCutListAggregateMs(50);
  });
  expect(p95).toBeLessThan(5);
});

test('Cut List first-render wall clock <= 1500 ms at 200 panels', async ({ page }) => {
  // ... build synthetic assembly ...
  const t0 = Date.now();
  await page.getByLabel('Cut List tab').click();
  await page.locator('[data-cutlist-row]').first().waitFor();
  const elapsed = Date.now() - t0;
  expect(elapsed).toBeLessThanOrEqual(1500);
});
```

- [ ] **Step 3: Run the perf spec**

Run: `pnpm playwright test tests/perf/cut-list-aggregate-large.spec.ts --project=perf`
Expected: PASS — both budgets met. If first-render wall clock fails, the cause is likely OPFS read fan-out — use `Promise.all` in `loadCutListInputs` (already implemented) and verify the dev hook is warming the cache before measurement.

- [ ] **Step 4: Commit**

```bash
git add tests/perf/cut-list-aggregate-large.spec.ts packages/app/src/App.tsx
git commit -m "test(perf): T33 cut-list aggregate + first-render budgets

aggregateCutListRecursive p95 < 5 ms; first-render <= 1500 ms
at 200 panels across 50 specs across 3 nesting levels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 11 — Manual smoke + final verification

### Task 34: Manual-smoke checklist doc

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-5d.md`

- [ ] **Step 1: Write the doc**

```markdown
# Sub-project 5d — Manual smoke checklist

Run these on the user's box after the automated suite is green. Log dates + observations inline.

## Scenario 1 — Single cabinet (Hello-Panel)

1. Open the 5a "Hello-Panel" project.
2. Place 4 panels inside an assembly: 2 sides (600×400×18 Birch 18mm, grain=length, PVC top-rim band on Front), top (600×600×18 same), bottom (600×600×18 same).
3. Furniture → Cut List → expect 3 distinct rows (qty 2 / 1 / 1).
4. Edge Band Totals footer should read PVC 1mm white with the correct mm/m.
5. Click Export CSV → save dialog opens with `<assembly-name>-cutlist.csv` suggested.
6. Open the CSV in a spreadsheet — 3 sections render correctly.

## Scenario 2 — Two-level recursion

1. Save the 5a "Cabinet-prep" assembly as `cabinet.ziasm`.
2. Create an outer "kitchen.ziasm", place `cabinet.ziasm` twice.
3. Open Cut List → expect QTY counts to double versus a single placement.

## Scenario 3 — Renumber + edit persistence

1. Open any cut-list-active assembly with at least 3 distinct panel specs.
2. Click Renumber.
3. Inline-edit one row's Item# to a value that collides with another row.
4. Verify the other row bumps to max+1, no cascade.
5. Save & reload. Verify item numbers persist.

## Sign-off

| Date | Initials | Pass / Notes |
|---|---|---|
| | | |
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-5d.md
git commit -m "docs(manual-tests): T34 sub-project 5d smoke checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 35: Final verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm -r typecheck`
Expected: all 5 packages `Done`.

- [ ] **Step 2: Full unit + integration suites**

Run: `pnpm -r test`
Expected: PASS across `shared`, `sketcher-worker`, `kernel`, `app`. Capture totals.

- [ ] **Step 3: Full Playwright suite (chromium)**

Run: `pnpm playwright test`
Expected: PASS — 5d adds 9 furniture + 1 perf to the existing 57+ baseline.

- [ ] **Step 4: Verify no flaky-skipped specs**

Run: `pnpm playwright test --reporter=list 2>&1 | grep -i skipped` — should be empty (or only the pre-existing baseline).

- [ ] **Step 5: Update memory**

Append to `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/MEMORY.md`:

```
- [Sub-project 5d execution state (2026-05-XX)](project_subproject_5d_execution_state.md) — SHIPPED at <hash>; 35 tasks; cut list tab + recursive aggregator + 3-section CSV; 9 e2e + 1 perf green
```

Create the linked memory file with the same summary shape as `project_subproject_5a_execution_state.md`.

- [ ] **Step 6: Final commit + status report**

```bash
git status   # verify clean
git log --oneline -10
```

Report to user: HEAD hash, total task count, total test count delta, and any deferred follow-ups discovered during execution (these become 5d's F-list).

---

## Final notes for the executor

- **Read sibling files first.** Every TDD task assumes you'll read the closest analog (4c BOM equivalent) before implementing. Conventions like cell-stop-propagation, cache invalidation hook locations, ribbon panel wrapper classes are not duplicated in this plan — they live in the existing 4c/4d/5a code.
- **Follow 4c precedent on commands.** Commands receive their data via constructor (4c-style), not via shared refs. The spec mentioned a `cutListResultRef` but the implementation here passes the result directly.
- **Cache-completeness guard is critical.** The autosave merge MUST gate the prune on `cacheComplete`. Skipping this guard will erase user-set item numbers when the cut list tab hasn't been opened. The test in T22 covers it.
- **`panelSpecCacheRef` shares invalidation hooks with `partInfoCacheRef`.** Every `partInfoCache.delete(...)` and `partInfoCache.clear()` site in App.tsx must gain a sibling `panelSpecCache.delete(...)` / `clear()`.
- **Manifest format jumps v10 → v11 in T6.** Anything that asserted `formatVersion === 10` needs updating. The migrator is additive only.
- **No new viewport code.** Selection reuses the existing 4c orange overlay; do not extend `SceneManager`.
- **Commit after every passing step.** Frequent commits make subagent-driven execution trivial to recover from.
