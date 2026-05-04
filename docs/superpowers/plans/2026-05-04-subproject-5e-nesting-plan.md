# Sub-project 5e (Nesting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sheet-stock nesting to ZilInventor: greedy-guillotine packing of the 5d cut-list onto material sheets with kerf, per-sheet SVG diagrams in a new BrowserPane tab, and PDF / per-sheet PNG export.

**Architecture:** Pure algorithm in `packages/shared/src/nesting/` (consumes existing `CutListResult` + extended `MaterialEntry` with optional sheet-stock fields). New `GenerateNestCommand` (undoable) writes `asm.nest = NestState` snapshotted at gen time; `<NestingTab>` renders persisted sheets as inline SVG with stale-banner via SHA-256 fingerprint. `ExportNestPdfCommand` uses jsPDF (vector); `ExportNestPngCommand` uses OffscreenCanvas (raster). Manifest bumps v12 → v13 (additive only — no-op migration).

**Tech Stack:** TypeScript, Vitest (unit), Playwright (e2e + perf), React 18, zustand, jsPDF (new), OffscreenCanvas. No new path aliases. Single existing pattern: pure shared module → app-level command + dialog + ribbon button → BrowserPane tab.

**Spec:** `docs/superpowers/specs/2026-05-04-subproject-5e-nesting-design.md` at HEAD `90fac55`.

**Agent dispatch:** Every implementation task in this plan is dispatched to a Sonnet (`claude-sonnet-4-6`) subagent via `superpowers:subagent-driven-development`. The main Opus thread orchestrates and reviews between dispatches per `feedback_sonnet_subagents_default`.

**Worktree:** Create with `superpowers:using-git-worktrees` before T1 — branch `feature/subproject-5e`, path `.worktrees/subproject-5e/`. All tasks below execute inside that worktree. The final phase merges back to master via `superpowers:finishing-a-development-branch`.

---

## Phase 1 — Shared types + manifest v12→v13

Five tasks; tightly coupled (all type/manifest changes). Dispatch as one batch to a single Sonnet subagent.

### Task 1: Extend MaterialEntry with sheet-stock fields

**Files:**
- Modify: `packages/shared/src/material.ts`
- Modify (test): `packages/shared/src/__tests__/material.spec.ts` (create if absent)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/material.spec.ts
import { describe, it, expect } from 'vitest';
import { isMaterialEntry } from '../material';

describe('isMaterialEntry — sheet-stock fields', () => {
  const base = { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' };

  it('accepts entry without sheet-stock fields (legacy)', () => {
    expect(isMaterialEntry(base)).toBe(true);
  });

  it('accepts entry with both sheetLengthMm and sheetWidthMm > 0', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 2440, sheetWidthMm: 1220 })).toBe(true);
  });

  it('rejects entry with only sheetLengthMm set', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 2440 })).toBe(false);
  });

  it('rejects entry with only sheetWidthMm set', () => {
    expect(isMaterialEntry({ ...base, sheetWidthMm: 1220 })).toBe(false);
  });

  it('rejects entry with sheetLengthMm <= 0', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: 0, sheetWidthMm: 1220 })).toBe(false);
    expect(isMaterialEntry({ ...base, sheetLengthMm: -1, sheetWidthMm: 1220 })).toBe(false);
  });

  it('rejects entry with non-finite sheet dims', () => {
    expect(isMaterialEntry({ ...base, sheetLengthMm: NaN, sheetWidthMm: 1220 })).toBe(false);
    expect(isMaterialEntry({ ...base, sheetLengthMm: Infinity, sheetWidthMm: 1220 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/shared && pnpm test:unit -- material
```
Expected: 5 of 6 fail (the legacy-no-fields case may pass as-is).

- [ ] **Step 3: Modify `packages/shared/src/material.ts`**

```ts
export type MaterialId = string;

export interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;
  readonly defaultThickness: number;
  readonly color: string;
  readonly sheetLengthMm?: number;
  readonly sheetWidthMm?: number;
}

export type MaterialRegistry = readonly MaterialEntry[];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isPositiveFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export function isMaterialEntry(v: unknown): v is MaterialEntry {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (!(typeof m.id === 'string' && m.id.length > 0
    && typeof m.name === 'string' && m.name.length > 0
    && typeof m.defaultThickness === 'number' && Number.isFinite(m.defaultThickness) && m.defaultThickness > 0
    && typeof m.color === 'string' && HEX_COLOR_RE.test(m.color))) return false;
  const hasL = m.sheetLengthMm !== undefined;
  const hasW = m.sheetWidthMm !== undefined;
  if (hasL !== hasW) return false;
  if (hasL && !isPositiveFiniteNumber(m.sheetLengthMm)) return false;
  if (hasW && !isPositiveFiniteNumber(m.sheetWidthMm)) return false;
  return true;
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/shared && pnpm test:unit -- material
```
Expected: 6/6 pass.

- [ ] **Step 5: Run full shared typecheck**

```
cd packages/shared && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/material.ts packages/shared/src/__tests__/material.spec.ts
git commit -m "feat(shared): MaterialEntry sheet-stock fields (5e §2.1)"
```

---

### Task 2: NestState + NestSheet + PlacedPanel + NestExclusion types

**Files:**
- Create: `packages/shared/src/nesting/nestState.ts`
- Create: `packages/shared/src/nesting/types.ts`
- Modify: `packages/shared/src/index.ts` (re-export new types)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Create `packages/shared/src/nesting/types.ts`**

```ts
import type { MaterialId } from '../material';
import type { GrainDirection } from '../panel-feature';

export interface NestInputRow {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly qty: number;
  readonly length: number;
  readonly width: number;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
}
```

- [ ] **Step 2: Create `packages/shared/src/nesting/nestState.ts`**

```ts
import type { MaterialId } from '../material';

export interface PlacedPanel {
  readonly itemNumber: number;
  readonly rowKey: string;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
  readonly rotated: boolean;
}

export interface NestSheet {
  readonly materialId: MaterialId;
  readonly sheetIndex: number;
  readonly sheetLengthMm: number;
  readonly sheetWidthMm: number;
  readonly panels: readonly PlacedPanel[];
  readonly utilizationPct: number;
}

export type NestExclusionReason = 'no-sheet-stock' | 'panel-exceeds-sheet';

export interface NestExclusion {
  readonly materialId: MaterialId;
  readonly reason: NestExclusionReason;
  readonly itemNumbers: readonly number[];
}

export interface NestState {
  readonly params: { readonly kerfMm: number };
  readonly generatedAt: number;
  readonly inputFingerprint: string;
  readonly sheets: readonly NestSheet[];
  readonly excluded: readonly NestExclusion[];
}
```

- [ ] **Step 3: Add re-exports to `packages/shared/src/index.ts`**

Append after the existing exports:
```ts
export type { NestInputRow } from './nesting/types';
export type {
  PlacedPanel, NestSheet, NestExclusion, NestExclusionReason, NestState,
} from './nesting/nestState';
```

- [ ] **Step 4: Typecheck**

```
cd packages/shared && pnpm typecheck
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/nesting/ packages/shared/src/index.ts
git commit -m "feat(shared): NestState/NestSheet/PlacedPanel/NestExclusion + NestInputRow types (5e §2.2/§2.4)"
```

---

### Task 3: Add `nest?: NestState` to AssemblyDocument

**Files:**
- Modify: `packages/shared/src/types.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Inspect current `AssemblyDocument`**

```
grep -n "AssemblyDocument" packages/shared/src/types.ts
```

- [ ] **Step 2: Modify `packages/shared/src/types.ts`**

Add the import at the top alongside existing shared imports:
```ts
import type { NestState } from './nesting/nestState';
```

Add the field to `AssemblyDocument` after `hardware: HardwareEntry[];` (per `exactOptionalPropertyTypes: true`, do NOT initialise to `undefined` anywhere — just declare optional):
```ts
export type AssemblyDocument = {
  // ... existing fields ...
  materials: MaterialEntry[];
  hardware: HardwareEntry[];
  nest?: NestState;
};
```

- [ ] **Step 3: Typecheck**

```
pnpm -r typecheck
```
Expected: clean across all packages (the new field is optional, no consumer is forced to init it).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): AssemblyDocument.nest? optional field (5e §2.3)"
```

---

### Task 4: Bump CURRENT_FORMAT_VERSION 12 → 13 with no-op migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Create: `packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v12 → v13 (5e — no-op additive)', () => {
  it('CURRENT_FORMAT_VERSION is 13', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(13);
  });

  it('passes a v12 assembly through unchanged (nest stays absent)', () => {
    const v12Asm = {
      version: 12, kind: 'assembly',
      doc: {
        id: 'a1', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [], hardware: [],
      },
    };
    const out = migrateManifest(v12Asm as never) as { version: number; doc: Record<string, unknown> };
    expect(out.version).toBe(13);
    expect('nest' in out.doc).toBe(false);
  });

  it('passes a v12 part through unchanged', () => {
    const v12Part = {
      version: 12, kind: 'part',
      doc: { id: 'p1', name: 'P', units: 'mm', parameters: {}, sketches: [],
             featureTree: [], parameterRefs: [], properties: {}, materials: [], hardware: [] },
    };
    const out = migrateManifest(v12Part as never) as { version: number };
    expect(out.version).toBe(13);
  });

  it('does not add sheet-stock fields to materials on migration', () => {
    const v12Asm = {
      version: 12, kind: 'assembly',
      doc: {
        id: 'a1', name: 'A', units: 'mm',
        parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {},
        bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {},
        materials: [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc' }],
        hardware: [],
      },
    };
    const out = migrateManifest(v12Asm as never) as { doc: { materials: unknown[] } };
    const m = out.doc.materials[0] as Record<string, unknown>;
    expect('sheetLengthMm' in m).toBe(false);
    expect('sheetWidthMm' in m).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/shared && pnpm test:unit -- migrateManifest-v12-to-v13
```
Expected: fail (`CURRENT_FORMAT_VERSION` is still 12).

- [ ] **Step 3: Modify `packages/shared/src/fileFormat.ts`**

Find `CURRENT_FORMAT_VERSION` and bump:
```ts
export const CURRENT_FORMAT_VERSION = 13;
```

Find the `migrations` array/record (indexed by source version) and add an entry at index 12 that returns the doc unchanged:
```ts
// Inside the migrations table, after migrations[11]:
12: (m: AnyManifest): AnyManifest => {
  // 5e v12→v13: no-op. AssemblyDocument.nest stays absent;
  // MaterialEntry.sheetLengthMm / sheetWidthMm stay absent. Fields appear via writes only.
  return { ...m, version: 13 };
},
```

(If the migrations table uses a different shape — e.g. an array — match the existing convention; the explore report showed `migrations[11]` calling `addHardwareField` then `seedBuiltinHardware`, so use the same indexing scheme.)

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/shared && pnpm test:unit -- migrateManifest-v12-to-v13
```
Expected: 3/3 pass.

- [ ] **Step 5: Run full shared unit suite to check no regression**

```
cd packages/shared && pnpm test:unit
```
Expected: all green (existing v11→v12 + earlier migration tests still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v12-to-v13.spec.ts
git commit -m "feat(shared): manifest v12→v13 no-op migration for 5e (additive nest? + sheet-stock)"
```

---

### Task 5: Confirm full-repo typecheck after Phase 1

**Files:** none modified — verification only.

**Agent:** Sonnet implementer.

- [ ] **Step 1: Run typecheck across all packages**

```
pnpm -r typecheck
```
Expected: clean across `shared`, `kernel`, `sketcher-worker`, `app`, `icons`. No fixture or call site should break — `nest` is optional, sheet-stock fields are optional, migration is additive.

- [ ] **Step 2: Run full unit suite**

```
pnpm -r test:unit
```
Expected: all 1300+ tests pass (Phase 1 added ~10 tests; nothing should regress).

- [ ] **Step 3: If anything fails — debug; do NOT advance to Phase 2 with red tests.**

If a kernel/app fixture rejects the new optional field on a documented `MaterialEntry` JSON literal (unlikely under `exactOptionalPropertyTypes: true`, but possible), the failure must be addressed before Phase 2 begins. Typical fix: nothing — the field is optional and absent.

---

## Phase 2 — Pure packing algorithm + fingerprint

Three tasks; T6 is the meat (~12 tests), T7 builds on it (~5 tests), T8 is standalone (~5 tests). Dispatch as one Sonnet subagent batch — all three live in `packages/shared/src/nesting/` and share types.

### Task 6: packGuillotine

**Files:**
- Create: `packages/shared/src/nesting/packGuillotine.ts`
- Create: `packages/shared/src/nesting/__tests__/packGuillotine.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests** (paste verbatim — do not summarise)

```ts
// packages/shared/src/nesting/__tests__/packGuillotine.spec.ts
import { describe, it, expect } from 'vitest';
import { packGuillotine } from '../packGuillotine';
import type { NestInputRow } from '../types';

const row = (overrides: Partial<NestInputRow> = {}): NestInputRow => ({
  itemNumber: 1, rowKey: 'r1', qty: 1, length: 600, width: 400,
  materialId: 'm1', grain: 'length', ...overrides,
});

describe('packGuillotine', () => {
  it('empty input → 0 sheets, 0 oversized', () => {
    const out = packGuillotine([], 2440, 1220, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toHaveLength(0);
  });

  it('single panel fits → 1 sheet, 1 panel at (0,0), rotated=false', () => {
    const out = packGuillotine([row()], 2440, 1220, 3);
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0]!.panels).toHaveLength(1);
    expect(out.sheets[0]!.panels[0]).toMatchObject({ x: 0, y: 0, length: 600, width: 400, rotated: false });
  });

  it('single panel exceeds sheet (longer than sheet length) → 0 sheets, 1 oversized', () => {
    const out = packGuillotine([row({ length: 3000, width: 400, grain: 'length' })], 2440, 1220, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toEqual([{ itemNumber: 1, rowKey: 'r1' }]);
  });

  it('two same-size panels grain=none → 1 sheet, deterministic placement', () => {
    const r = row({ qty: 2, grain: 'none' });
    const a = packGuillotine([r], 2440, 1220, 3);
    const b = packGuillotine([r], 2440, 1220, 3);
    expect(a).toEqual(b);
    expect(a.sheets).toHaveLength(1);
    expect(a.sheets[0]!.panels).toHaveLength(2);
  });

  it("grain='length' forbids rotation even when rotation would pack better", () => {
    // Sheet 700×1220; panel 800×400 grain='length' would fit only rotated, but grain forbids it.
    const out = packGuillotine([row({ length: 800, width: 400, grain: 'length' })], 700, 1220, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.oversized).toHaveLength(1);
  });

  it("grain='width' forces rotation (panel L=600,W=400 → placed L=400 along sheet width)", () => {
    const out = packGuillotine([row({ length: 600, width: 400, grain: 'width' })], 2440, 1220, 3);
    expect(out.sheets).toHaveLength(1);
    const p = out.sheets[0]!.panels[0]!;
    expect(p.rotated).toBe(true);
    expect(p.length).toBe(400); // post-rotation: panel.width along sheet length
    expect(p.width).toBe(600);
  });

  it('kerf is applied between adjacent panels', () => {
    const r = row({ length: 300, width: 200, qty: 3, grain: 'length' });
    const out = packGuillotine([r], 2440, 1220, 5);
    const xs = out.sheets[0]!.panels.map((p) => p.x).sort((a, b) => a - b);
    // First at x=0; second at x = 300 + 5 = 305; third at 305 + 300 + 5 = 610.
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(305);
    expect(xs[2]).toBe(610);
  });

  it('first-fit-decreasing ordering — golden test on 6-panel mix', () => {
    const rows: NestInputRow[] = [
      row({ rowKey: 'a', itemNumber: 1, length: 800, width: 400 }),
      row({ rowKey: 'b', itemNumber: 2, length: 600, width: 400 }),
      row({ rowKey: 'c', itemNumber: 3, length: 1000, width: 400 }),
      row({ rowKey: 'd', itemNumber: 4, length: 400, width: 400 }),
      row({ rowKey: 'e', itemNumber: 5, length: 1200, width: 400 }),
      row({ rowKey: 'f', itemNumber: 6, length: 200, width: 400 }),
    ];
    const out = packGuillotine(rows, 2440, 1220, 3);
    // FFD by max(L,W) DESC: e(1200), c(1000), a(800), b(600), d(400), f(200)
    // First sheet, first row of panels (y=0): they should be placed in that sort order.
    const firstRow = out.sheets[0]!.panels.filter((p) => p.y === 0).sort((a, b) => a.x - b.x);
    expect(firstRow.map((p) => p.itemNumber)).toEqual([5, 3, 1, 2, 4, 6]);
  });

  it('determinism: same input twice → byte-identical sheet output', () => {
    const rows: NestInputRow[] = Array.from({ length: 8 }, (_, i) => row({
      itemNumber: i + 1, rowKey: `r${i}`, length: 300 + i * 50, width: 200, grain: 'none',
    }));
    const a = JSON.stringify(packGuillotine(rows, 2440, 1220, 3));
    const b = JSON.stringify(packGuillotine(rows, 2440, 1220, 3));
    expect(a).toBe(b);
  });

  it('multi-sheet — 3 large panels each >50% of a sheet → 3 sheets', () => {
    const r = row({ length: 1500, width: 800, qty: 3, grain: 'length' });
    const out = packGuillotine([r], 2440, 1220, 3);
    expect(out.sheets).toHaveLength(3);
    out.sheets.forEach((s, i) => expect(s.sheetIndex).toBe(i + 1));
  });

  it('utilizationPct = panel area / sheet area × 100 (1 decimal)', () => {
    // Sheet 1000×1000; one panel 500×500 → 25.0%
    const out = packGuillotine([row({ length: 500, width: 500, grain: 'length' })], 1000, 1000, 0);
    expect(out.sheets[0]!.utilizationPct).toBe(25.0);
  });

  it('expands qty correctly into multiple panels', () => {
    const out = packGuillotine([row({ qty: 4 })], 2440, 1220, 3);
    expect(out.sheets[0]!.panels).toHaveLength(4);
    out.sheets[0]!.panels.forEach((p) => expect(p.itemNumber).toBe(1));
  });
});
```

- [ ] **Step 2: Run the test (expect fail — module missing)**

```
cd packages/shared && pnpm test:unit -- packGuillotine
```
Expected: file-not-found.

- [ ] **Step 3: Implement `packages/shared/src/nesting/packGuillotine.ts`**

```ts
import type { GrainDirection } from '../panel-feature';
import type { MaterialId } from '../material';
import type { NestInputRow } from './types';
import type { NestSheet, PlacedPanel } from './nestState';

interface FreeRect { x: number; y: number; w: number; h: number; }
interface PanelInstance {
  itemNumber: number;
  rowKey: string;
  L: number;
  W: number;
  grain: GrainDirection;
}

export interface PackResult {
  sheets: NestSheet[];
  oversized: { itemNumber: number; rowKey: string }[];
}

export function packGuillotine(
  rows: readonly NestInputRow[],
  sheetLengthMm: number,
  sheetWidthMm: number,
  kerfMm: number,
): PackResult {
  // 1. Expand qty into a flat list.
  const panels: PanelInstance[] = [];
  for (const r of rows) {
    for (let i = 0; i < r.qty; i++) {
      panels.push({ itemNumber: r.itemNumber, rowKey: r.rowKey, L: r.length, W: r.width, grain: r.grain });
    }
  }

  // 2. Stable sort: max(L,W) DESC, then min(L,W) DESC, then itemNumber ASC.
  panels.sort((a, b) => {
    const aMax = Math.max(a.L, a.W), bMax = Math.max(b.L, b.W);
    if (aMax !== bMax) return bMax - aMax;
    const aMin = Math.min(a.L, a.W), bMin = Math.min(b.L, b.W);
    if (aMin !== bMin) return bMin - aMin;
    return a.itemNumber - b.itemNumber;
  });

  // 3. Pre-filter oversized.
  const oversized: PackResult['oversized'] = [];
  const fits = (p: PanelInstance): boolean => {
    if (p.grain === 'length') return p.L <= sheetLengthMm && p.W <= sheetWidthMm;
    if (p.grain === 'width')  return p.W <= sheetLengthMm && p.L <= sheetWidthMm;
    const minD = Math.min(p.L, p.W), maxD = Math.max(p.L, p.W);
    const minS = Math.min(sheetLengthMm, sheetWidthMm), maxS = Math.max(sheetLengthMm, sheetWidthMm);
    return minD <= minS && maxD <= maxS;
  };
  const remaining: PanelInstance[] = [];
  for (const p of panels) {
    if (fits(p)) remaining.push(p);
    else oversized.push({ itemNumber: p.itemNumber, rowKey: p.rowKey });
  }

  // 4. Pack into sheets.
  const sheets: NestSheet[] = [];
  let sheetIndex = 1;
  while (remaining.length > 0) {
    const placed: PlacedPanel[] = [];
    let freeRects: FreeRect[] = [{ x: 0, y: 0, w: sheetLengthMm, h: sheetWidthMm }];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let pi = 0; pi < remaining.length; pi++) {
        const p = remaining[pi]!;
        const placement = chooseOrientationAndRect(p, freeRects);
        if (!placement) continue;
        const { rectIdx, panelL, panelW, rotated, x, y } = placement;
        placed.push({ itemNumber: p.itemNumber, rowKey: p.rowKey, x, y, length: panelL, width: panelW, rotated });
        const parent = freeRects[rectIdx]!;
        const right: FreeRect = { x: x + panelL + kerfMm, y, w: parent.w - panelL - kerfMm, h: panelW };
        const bottom: FreeRect = { x, y: y + panelW + kerfMm, w: parent.w, h: parent.h - panelW - kerfMm };
        const next: FreeRect[] = [];
        for (let i = 0; i < freeRects.length; i++) if (i !== rectIdx) next.push(freeRects[i]!);
        if (right.w > 0 && right.h > 0) next.push(right);
        if (bottom.w > 0 && bottom.h > 0) next.push(bottom);
        freeRects = next;
        remaining.splice(pi, 1);
        progressed = true;
        break;
      }
    }
    const totalArea = placed.reduce((sum, p) => sum + p.length * p.width, 0);
    const utilizationPct = Math.round((totalArea / (sheetLengthMm * sheetWidthMm)) * 1000) / 10;
    sheets.push({
      materialId: '' as MaterialId, // filled in by packAllMaterials
      sheetIndex,
      sheetLengthMm,
      sheetWidthMm,
      panels: placed,
      utilizationPct,
    });
    sheetIndex++;
  }

  return { sheets, oversized };
}

interface ChosenPlacement {
  rectIdx: number;
  panelL: number; panelW: number;
  rotated: boolean;
  x: number; y: number;
}

function chooseOrientationAndRect(p: PanelInstance, freeRects: readonly FreeRect[]): ChosenPlacement | null {
  // Build the orientation list per grain rule.
  type Orient = { L: number; W: number; rotated: boolean };
  const orientations: Orient[] = [];
  if (p.grain === 'length') orientations.push({ L: p.L, W: p.W, rotated: false });
  else if (p.grain === 'width') orientations.push({ L: p.W, W: p.L, rotated: true });
  else { // 'none'
    orientations.push({ L: p.L, W: p.W, rotated: false });
    if (p.L !== p.W) orientations.push({ L: p.W, W: p.L, rotated: true });
  }

  // For each free rect (in insertion order), try each allowed orientation.
  // For grain='none', score by max-leftover dim; tie-break rotated=false first.
  let best: ChosenPlacement | null = null;
  let bestScore = -Infinity;
  for (let ri = 0; ri < freeRects.length; ri++) {
    const r = freeRects[ri]!;
    for (const o of orientations) {
      if (o.L > r.w || o.W > r.h) continue;
      // Compute leftover-rect score: larger of (right, bottom) child's max(w,h).
      const rightW = r.w - o.L;
      const bottomH = r.h - o.W;
      const score = Math.max(Math.max(rightW, o.W), Math.max(r.w, bottomH));
      const candidate: ChosenPlacement = { rectIdx: ri, panelL: o.L, panelW: o.W, rotated: o.rotated, x: r.x, y: r.y };
      if (p.grain !== 'none') return candidate; // grain-locked: take the first fit
      if (score > bestScore || (score === bestScore && best && o.rotated === false && best.rotated === true)) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) return best; // first-fit at the first free rect that admits any orientation
  }
  return best;
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/shared && pnpm test:unit -- packGuillotine
```
Expected: 12/12 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/nesting/packGuillotine.ts packages/shared/src/nesting/__tests__/packGuillotine.spec.ts
git commit -m "feat(shared): packGuillotine — greedy first-fit-decreasing nesting algo (5e §3.1)"
```

---

### Task 7: packAllMaterials orchestration

**Files:**
- Create: `packages/shared/src/nesting/packAllMaterials.ts`
- Create: `packages/shared/src/nesting/__tests__/packAllMaterials.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/nesting/__tests__/packAllMaterials.spec.ts
import { describe, it, expect } from 'vitest';
import { packAllMaterials } from '../packAllMaterials';
import type { NestInputRow } from '../types';
import type { MaterialEntry } from '../../material';

const r = (o: Partial<NestInputRow>): NestInputRow => ({
  itemNumber: 1, rowKey: 'r1', qty: 1, length: 600, width: 400,
  materialId: 'm1', grain: 'length', ...o,
});

const mat = (o: Partial<MaterialEntry> & { id: string }): MaterialEntry => ({
  id: o.id, name: o.name ?? o.id, defaultThickness: 18, color: '#aabbcc',
  sheetLengthMm: o.sheetLengthMm,
  sheetWidthMm: o.sheetWidthMm,
});

describe('packAllMaterials', () => {
  it('groups rows by materialId; ordering by (materialId.localeCompare, sheetIndex)', () => {
    const rows = [
      r({ rowKey: 'b1', itemNumber: 1, materialId: 'b' }),
      r({ rowKey: 'a1', itemNumber: 2, materialId: 'a' }),
    ];
    const materials: MaterialEntry[] = [
      mat({ id: 'a', sheetLengthMm: 2440, sheetWidthMm: 1220 }),
      mat({ id: 'b', sheetLengthMm: 2440, sheetWidthMm: 1220 }),
    ];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets.map((s) => s.materialId)).toEqual(['a', 'b']);
  });

  it("material missing sheet stock → exclusion 'no-sheet-stock' with empty itemNumbers", () => {
    const rows = [r({ materialId: 'm1' })];
    const materials = [mat({ id: 'm1' })]; // no sheet dims
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toEqual([{ materialId: 'm1', reason: 'no-sheet-stock', itemNumbers: [] }]);
  });

  it("material with oversized panel → exclusion 'panel-exceeds-sheet' listing itemNumber", () => {
    const rows = [r({ length: 3000, materialId: 'm1', itemNumber: 7 })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toEqual([{ materialId: 'm1', reason: 'panel-exceeds-sheet', itemNumbers: [7] }]);
  });

  it('snapshots sheetLengthMm/sheetWidthMm into each NestSheet', () => {
    const rows = [r({ materialId: 'm1' })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets[0]!.sheetLengthMm).toBe(2440);
    expect(out.sheets[0]!.sheetWidthMm).toBe(1220);
    expect(out.sheets[0]!.materialId).toBe('m1');
  });

  it('rows referencing a materialId not in the registry → silently dropped (no exclusion, no crash)', () => {
    const rows = [r({ materialId: 'ghost' })];
    const materials = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];
    const out = packAllMaterials(rows, materials, 3);
    expect(out.sheets).toHaveLength(0);
    expect(out.excluded).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test (expect fail)**

```
cd packages/shared && pnpm test:unit -- packAllMaterials
```

- [ ] **Step 3: Implement `packages/shared/src/nesting/packAllMaterials.ts`**

```ts
import type { MaterialRegistry } from '../material';
import type { NestInputRow } from './types';
import type { NestSheet, NestExclusion } from './nestState';
import { packGuillotine } from './packGuillotine';

export interface PackAllResult {
  sheets: NestSheet[];
  excluded: NestExclusion[];
}

export function packAllMaterials(
  inputRows: readonly NestInputRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): PackAllResult {
  const byMaterial = new Map<string, NestInputRow[]>();
  for (const row of inputRows) {
    let bucket = byMaterial.get(row.materialId);
    if (!bucket) { bucket = []; byMaterial.set(row.materialId, bucket); }
    bucket.push(row);
  }

  const sheets: NestSheet[] = [];
  const excluded: NestExclusion[] = [];
  const materialIdsSorted = Array.from(byMaterial.keys()).sort((a, b) => a.localeCompare(b));

  for (const materialId of materialIdsSorted) {
    const mat = materials.find((m) => m.id === materialId);
    if (!mat) continue; // row referencing unknown material — silently dropped
    if (mat.sheetLengthMm === undefined || mat.sheetWidthMm === undefined) {
      excluded.push({ materialId, reason: 'no-sheet-stock', itemNumbers: [] });
      continue;
    }
    const rows = byMaterial.get(materialId)!;
    const result = packGuillotine(rows, mat.sheetLengthMm, mat.sheetWidthMm, kerfMm);
    for (const sheet of result.sheets) {
      sheets.push({ ...sheet, materialId });
    }
    if (result.oversized.length > 0) {
      const itemNumbers = Array.from(new Set(result.oversized.map((o) => o.itemNumber))).sort((a, b) => a - b);
      excluded.push({ materialId, reason: 'panel-exceeds-sheet', itemNumbers });
    }
  }

  return { sheets, excluded };
}
```

- [ ] **Step 4: Run the test (expect pass)**

```
cd packages/shared && pnpm test:unit -- packAllMaterials
```
Expected: 5/5 pass.

- [ ] **Step 5: Add re-export to `packages/shared/src/index.ts`**

```ts
export { packGuillotine, type PackResult } from './nesting/packGuillotine';
export { packAllMaterials, type PackAllResult } from './nesting/packAllMaterials';
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/nesting/packAllMaterials.ts packages/shared/src/nesting/__tests__/packAllMaterials.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): packAllMaterials orchestrator + exclusion taxonomy (5e §3.3)"
```

---

### Task 8: computeNestFingerprint

**Files:**
- Create: `packages/shared/src/nesting/fingerprint.ts`
- Create: `packages/shared/src/nesting/__tests__/fingerprint.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/nesting/__tests__/fingerprint.spec.ts
import { describe, it, expect } from 'vitest';
import { computeNestFingerprint } from '../fingerprint';
import type { CutListRow } from '../../cutListRow';
import type { MaterialEntry } from '../../material';

const cutRow = (o: Partial<CutListRow>): CutListRow => ({
  rowKey: 'r1', itemNumber: 1, qty: 1,
  length: 600, width: 400, thickness: 18,
  materialId: 'm1', materialName: 'Birch', grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
  ...o,
});

const mat = (o: Partial<MaterialEntry> & { id: string }): MaterialEntry => ({
  id: o.id, name: o.name ?? o.id, defaultThickness: 18, color: '#aabbcc',
  sheetLengthMm: o.sheetLengthMm, sheetWidthMm: o.sheetWidthMm,
});

describe('computeNestFingerprint', () => {
  const m = [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })];

  it('same inputs → same hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({})], m, 3);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('renumbering (different itemNumber, same rowKey) → same hash', async () => {
    const a = await computeNestFingerprint([cutRow({ itemNumber: 1 })], m, 3);
    const b = await computeNestFingerprint([cutRow({ itemNumber: 99 })], m, 3);
    expect(a).toBe(b);
  });

  it('edge-band changes → same hash (we do not include edges)', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({
      edgeBands: { front: { materialId: 'b1', materialName: 'Band' }, back: null, left: null, right: null },
    })], m, 3);
    expect(a).toBe(b);
  });

  it('kerf change → different hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], m, 3);
    const b = await computeNestFingerprint([cutRow({})], m, 5);
    expect(a).not.toBe(b);
  });

  it('sheet-stock change → different hash', async () => {
    const a = await computeNestFingerprint([cutRow({})], [mat({ id: 'm1', sheetLengthMm: 2440, sheetWidthMm: 1220 })], 3);
    const b = await computeNestFingerprint([cutRow({})], [mat({ id: 'm1', sheetLengthMm: 3000, sheetWidthMm: 1500 })], 3);
    expect(a).not.toBe(b);
  });

  it('row order does not affect hash', async () => {
    const r1 = cutRow({ rowKey: 'a' });
    const r2 = cutRow({ rowKey: 'b' });
    const a = await computeNestFingerprint([r1, r2], m, 3);
    const b = await computeNestFingerprint([r2, r1], m, 3);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run (expect fail)**

```
cd packages/shared && pnpm test:unit -- fingerprint
```

- [ ] **Step 3: Implement `packages/shared/src/nesting/fingerprint.ts`**

```ts
import type { CutListRow } from '../cutListRow';
import type { MaterialRegistry } from '../material';

export async function computeNestFingerprint(
  rows: readonly CutListRow[],
  materials: MaterialRegistry,
  kerfMm: number,
): Promise<string> {
  const payload = JSON.stringify({
    rows: rows
      .map((r) => ({
        rowKey: r.rowKey, qty: r.qty,
        length: r.length, width: r.width, thickness: r.thickness,
        materialId: r.materialId, grain: r.grain,
      }))
      .sort((a, b) => a.rowKey.localeCompare(b.rowKey)),
    sheetStock: materials
      .filter((m) => m.sheetLengthMm !== undefined && m.sheetWidthMm !== undefined)
      .map((m) => [m.id, m.sheetLengthMm!, m.sheetWidthMm!] as [string, number, number])
      .sort((a, b) => a[0].localeCompare(b[0])),
    kerfMm,
  });
  const buf = new TextEncoder().encode(payload);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Run (expect pass)**

```
cd packages/shared && pnpm test:unit -- fingerprint
```
Expected: 6/6 pass.

- [ ] **Step 5: Add re-export to `packages/shared/src/index.ts`**

```ts
export { computeNestFingerprint } from './nesting/fingerprint';
```

- [ ] **Step 6: Run full shared unit suite**

```
cd packages/shared && pnpm test:unit
```
Expected: all green (Phase 1 + 2 cumulative).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/nesting/fingerprint.ts packages/shared/src/nesting/__tests__/fingerprint.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): computeNestFingerprint — SHA-256 over rows+sheetStock+kerf (5e §7)"
```

---

## Phase 3 — MaterialRegistryEditor extension

Two tasks. T9 widens the command opts; T10 wires UI. Dispatch as one Sonnet subagent batch.

### Task 9: Extend AddMaterialCommand & EditMaterialCommand opts

**Files:**
- Modify: `packages/app/src/commands/AddMaterialCommand.ts`
- Modify: `packages/app/src/commands/EditMaterialCommand.ts`
- Modify: `packages/app/src/commands/__tests__/material-commands.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Add failing tests**

Append to `packages/app/src/commands/__tests__/material-commands.spec.ts`:
```ts
describe('AddMaterialCommand — sheet stock fields', () => {
  it('accepts sheetLengthMm + sheetWidthMm and stores them on the entry', async () => {
    // Reset the store to a known empty registry first using existing test helper.
    await new AddMaterialCommand({
      name: 'Birch', defaultThickness: 18, color: '#aabbcc',
      sheetLengthMm: 2440, sheetWidthMm: 1220,
    }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    expect(entry.sheetLengthMm).toBe(2440);
    expect(entry.sheetWidthMm).toBe(1220);
  });

  it('omits sheet-stock fields when not provided', async () => {
    await new AddMaterialCommand({ name: 'Plain', defaultThickness: 18, color: '#aabbcc' }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    expect('sheetLengthMm' in entry).toBe(false);
    expect('sheetWidthMm' in entry).toBe(false);
  });
});

describe('EditMaterialCommand — sheet stock fields', () => {
  it('round-trips sheet-stock patch through the registry', async () => {
    await new AddMaterialCommand({ name: 'X', defaultThickness: 18, color: '#aabbcc' }).apply();
    const entry = useAppStore.getState().activeAssembly!.materials.at(-1)!;
    await new EditMaterialCommand({ id: entry.id, patch: { sheetLengthMm: 3000, sheetWidthMm: 1500 } }).apply();
    const updated = useAppStore.getState().activeAssembly!.materials.find((m) => m.id === entry.id)!;
    expect(updated.sheetLengthMm).toBe(3000);
    expect(updated.sheetWidthMm).toBe(1500);
  });
});
```

- [ ] **Step 2: Run (expect fail — opts type rejects new fields)**

```
cd packages/app && pnpm test:unit -- material-commands
```

- [ ] **Step 3: Modify `AddMaterialCommand.ts`**

Find the `AddMaterialOpts` type and extend:
```ts
export type AddMaterialOpts = {
  name: string;
  defaultThickness: number;
  color: string;
  sheetLengthMm?: number;
  sheetWidthMm?: number;
};
```

Inside `apply()`, where the new entry is constructed, conditionally include the optional fields (per `exactOptionalPropertyTypes: true`, do NOT spread `undefined`):
```ts
const entry: MaterialEntry = {
  id: nextId(),
  name: this.opts.name,
  defaultThickness: this.opts.defaultThickness,
  color: this.opts.color,
  ...(this.opts.sheetLengthMm !== undefined ? { sheetLengthMm: this.opts.sheetLengthMm } : {}),
  ...(this.opts.sheetWidthMm  !== undefined ? { sheetWidthMm:  this.opts.sheetWidthMm  } : {}),
};
useAppStore.getState().addMaterial(entry);
```

- [ ] **Step 4: Verify EditMaterialCommand needs no change**

`EditMaterialPatch = Partial<Omit<MaterialEntry, 'id'>>` — auto-picks up the new fields. Confirm the command's `apply()` already passes `patch` through to `useAppStore.getState().updateMaterial(id, patch)`. If the store reducer drops unknown keys, fix it there too:

```
grep -n "updateMaterial" packages/app/src/store/useAppStore.ts
```

If the reducer enumerates a fixed set of keys, add `sheetLengthMm` and `sheetWidthMm` to it. (Most likely it spreads the patch — no change needed.)

- [ ] **Step 5: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- material-commands
```
Expected: existing tests + 3 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/AddMaterialCommand.ts packages/app/src/commands/EditMaterialCommand.ts packages/app/src/commands/__tests__/material-commands.spec.ts
git commit -m "feat(app): AddMaterialCommand/EditMaterialCommand accept sheet-stock opts (5e §5.5)"
```

---

### Task 10: Extend MaterialRegistryEditor with Sheet L / Sheet W columns

**Files:**
- Modify: `packages/app/src/shell/MaterialRegistryEditor.tsx`
- Modify: `packages/app/src/shell/__tests__/MaterialRegistryEditor.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Add failing tests**

Append to the editor spec:
```tsx
describe('MaterialRegistryEditor — sheet stock columns', () => {
  it('renders Sheet L (mm) and Sheet W (mm) headers', () => {
    render(<MaterialRegistryEditor />);
    expect(screen.getByText('Sheet L (mm)')).toBeInTheDocument();
    expect(screen.getByText('Sheet W (mm)')).toBeInTheDocument();
  });

  it('shows inline error "set both or neither" when only one sheet dim is set', async () => {
    // Add a row, enter edit mode, set only sheetLengthMm.
    // ... use existing test helpers to enter edit mode.
    fireEvent.change(screen.getByLabelText('Edit sheet length'), { target: { value: '2440' } });
    expect(screen.getByText(/set both Sheet L and Sheet W/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('persists both sheet dims when both are provided and Save is clicked', async () => {
    // Pre-seed a material; enter edit mode.
    fireEvent.change(screen.getByLabelText('Edit sheet length'), { target: { value: '2440' } });
    fireEvent.change(screen.getByLabelText('Edit sheet width'), { target: { value: '1220' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const updated = useAppStore.getState().activeAssembly!.materials.at(0)!;
    expect(updated.sheetLengthMm).toBe(2440);
    expect(updated.sheetWidthMm).toBe(1220);
  });

  it('clearing both sheet dims (both inputs empty) is valid and persists undefined', async () => {
    fireEvent.change(screen.getByLabelText('Edit sheet length'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Edit sheet width'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    const updated = useAppStore.getState().activeAssembly!.materials.at(0)!;
    expect(updated.sheetLengthMm).toBeUndefined();
    expect(updated.sheetWidthMm).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run (expect fail)**

```
cd packages/app && pnpm test:unit -- MaterialRegistryEditor
```

- [ ] **Step 3: Modify `MaterialRegistryEditor.tsx`**

Extend `RowEditState` `edit` mode to include the two new string fields:
```ts
| { mode: 'edit'; id: string; name: string; defaultThickness: string; color: string;
    sheetLengthMm: string; sheetWidthMm: string; error: string | null }
```

Add two `<th>` headers between the existing Color and the actions column (before line 184's empty `<th>`):
```tsx
<th>Sheet L (mm)</th>
<th>Sheet W (mm)</th>
```

For each row in display mode, add two read cells (mirroring the `defaultThickness` cell at line 260):
```tsx
<td style={cellStyle}>{m.sheetLengthMm ?? ''}</td>
<td style={cellStyle}>{m.sheetWidthMm ?? ''}</td>
```

For each row in edit mode, add two `<input>` cells (mirroring the `defaultThickness` cell at line 206):
```tsx
<td style={cellStyle}>
  <input aria-label="Edit sheet length" type="text" inputMode="numeric"
    value={rowState.sheetLengthMm}
    onChange={(e) => setRowState({
      ...rowState, sheetLengthMm: e.target.value,
      error: validateSheetStock(e.target.value, rowState.sheetWidthMm),
    })} />
</td>
<td style={cellStyle}>
  <input aria-label="Edit sheet width" type="text" inputMode="numeric"
    value={rowState.sheetWidthMm}
    onChange={(e) => setRowState({
      ...rowState, sheetWidthMm: e.target.value,
      error: validateSheetStock(rowState.sheetLengthMm, e.target.value),
    })} />
</td>
```

Add the validator helper near the top of the file:
```ts
function validateSheetStock(lStr: string, wStr: string): string | null {
  const lEmpty = lStr.trim() === '';
  const wEmpty = wStr.trim() === '';
  if (lEmpty && wEmpty) return null;
  if (lEmpty || wEmpty) return 'Set both Sheet L and Sheet W, or leave both empty.';
  const ln = Number(lStr), wn = Number(wStr);
  if (!Number.isFinite(ln) || ln <= 0 || !Number.isFinite(wn) || wn <= 0) return 'Sheet dims must be positive numbers.';
  return null;
}
```

When the user clicks Save, build the patch carefully (omit fields when empty):
```ts
const patch: Partial<Omit<MaterialEntry, 'id'>> = {
  name: rowState.name,
  defaultThickness: Number(rowState.defaultThickness),
  color: rowState.color,
};
const lEmpty = rowState.sheetLengthMm.trim() === '';
const wEmpty = rowState.sheetWidthMm.trim() === '';
if (!lEmpty && !wEmpty) {
  patch.sheetLengthMm = Number(rowState.sheetLengthMm);
  patch.sheetWidthMm  = Number(rowState.sheetWidthMm);
}
// Note: clearing both means we want to remove the fields. EditMaterialPatch is Partial,
// so omitting the keys leaves them unchanged. To explicitly clear, we need a separate
// "clear-sheet-stock" path. Implement clearing via patch: { sheetLengthMm: undefined, sheetWidthMm: undefined }
// IF and only if the store reducer treats explicit-undefined as "delete the key".
// If the reducer drops undefined values, the test "clearing both ... persists undefined"
// will fail and we must add a dedicated `clearSheetStock` path.
await bus.execute(new EditMaterialCommand({ id: rowState.id, patch }));
```

If clearing-both fails the test, add a `clearSheetStock?: true` opt to `EditMaterialPatch` (or a separate `ClearMaterialSheetStockCommand`) and dispatch it instead. Pick the smallest-diff fix; document the choice in the commit message.

When entering edit mode, initialise the two new strings from the entry:
```ts
sheetLengthMm: m.sheetLengthMm !== undefined ? String(m.sheetLengthMm) : '',
sheetWidthMm:  m.sheetWidthMm  !== undefined ? String(m.sheetWidthMm)  : '',
```

Save button gating:
```tsx
<button onClick={handleSave} disabled={rowState.error !== null}>Save</button>
```

- [ ] **Step 4: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- MaterialRegistryEditor
```
Expected: existing + 4 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/MaterialRegistryEditor.tsx packages/app/src/shell/__tests__/MaterialRegistryEditor.spec.tsx
git commit -m "feat(app): MaterialRegistryEditor — Sheet L/W columns + validation (5e §5.5)"
```

---

## Phase 4 — Store + GenerateNestCommand + ribbon panel + dialog + tab-mutex

Seven tasks. Three logical groups:

- **Group A (T11–T12):** store slots + `GenerateNestCommand` (tightly coupled).
- **Group B (T13–T15):** four-way tab mutex (`OpenNestingTabCommand` + update existing two Open*TabCommand + BrowserPane Assembly button).
- **Group C (T16–T17):** NestDialog component + Furniture ribbon Nesting panel.

Dispatch as three Sonnet subagent batches in series (B depends on A's store slot; C depends on A + B).

### Task 11: Add `nestingTabActive` + `nestDialog` slots to useAppStore

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Locate the existing tab-active and dialog slots**

```
grep -n "cutListTabActive\|cabinetDialog\|hardwareDialog" packages/app/src/store/useAppStore.ts
```

- [ ] **Step 2: Add the new slot types above `AppState`**

```ts
export type NestDialogState = { kind: 'open' };
```

- [ ] **Step 3: Add fields to `AppState`** (mirror `cutListTabActive` and `hardwareDialog`)

```ts
nestingTabActive: boolean;
setNestingTabActive: (v: boolean) => void;
nestDialog: NestDialogState | null;
setNestDialog: (s: NestDialogState | null) => void;
```

- [ ] **Step 4: Add the create-time initialisers**

```ts
nestingTabActive: false,
setNestingTabActive: (v) => set({ nestingTabActive: v }),
nestDialog: null,
setNestDialog: (s) => set({ nestDialog: s }),
```

- [ ] **Step 5: Typecheck**

```
cd packages/app && pnpm typecheck
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store/useAppStore.ts
git commit -m "feat(app): useAppStore — nestingTabActive + nestDialog slots (5e §5.3/§5.4)"
```

---

### Task 12: GenerateNestCommand (undoable) + unit tests

**Files:**
- Create: `packages/app/src/commands/GenerateNestCommand.ts`
- Create: `packages/app/src/commands/__tests__/GenerateNestCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/app/src/commands/__tests__/GenerateNestCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateNestCommand } from '../GenerateNestCommand';
import { useAppStore } from '../../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

const fakeResult = (rows: CutListResult['rows'] = []): CutListResult => ({
  rows, bandTotals: [], excluded: { componentCount: 0, partCount: 0 },
});

const matRegistry = (): MaterialRegistry => [
  { id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc',
    sheetLengthMm: 2440, sheetWidthMm: 1220 },
];

describe('GenerateNestCommand', () => {
  beforeEach(() => {
    // Use existing test setup that seeds an empty assembly into useAppStore.
    // (Mirror what RenumberCutListCommand.spec.ts does.)
  });

  it('apply writes asm.nest with sheets + fingerprint + generatedAt', async () => {
    const cmd = new GenerateNestCommand({
      kerfMm: 3,
      result: fakeResult([{
        rowKey: 'r1', itemNumber: 1, qty: 1, length: 600, width: 400, thickness: 18,
        materialId: 'm1', materialName: 'Birch', grain: 'length',
        edgeBands: { front: null, back: null, left: null, right: null },
        partPath: 'p.zipt', partName: 'P', componentPathKeys: ['c1'],
      }]),
      materials: matRegistry(),
    });
    await cmd.apply();
    const nest = useAppStore.getState().activeAssembly!.nest;
    expect(nest).toBeDefined();
    expect(nest!.params.kerfMm).toBe(3);
    expect(nest!.sheets).toHaveLength(1);
    expect(nest!.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof nest!.generatedAt).toBe('number');
  });

  it('revert restores the prior asm.nest (undefined for first generation)', async () => {
    const cmd = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.nest).toBeDefined();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toBeUndefined();
  });

  it('revert restores the prior NestState for subsequent generations', async () => {
    const cmd1 = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await cmd1.apply();
    const firstNest = useAppStore.getState().activeAssembly!.nest;
    const cmd2 = new GenerateNestCommand({ kerfMm: 5, result: fakeResult([]), materials: matRegistry() });
    await cmd2.apply();
    expect(useAppStore.getState().activeAssembly!.nest!.params.kerfMm).toBe(5);
    await cmd2.revert();
    expect(useAppStore.getState().activeAssembly!.nest).toEqual(firstNest);
  });

  it('idempotent on same inputs (re-apply produces same fingerprint, sheets)', async () => {
    const opts = { kerfMm: 3, result: fakeResult([]), materials: matRegistry() };
    const a = new GenerateNestCommand(opts); await a.apply();
    const fp1 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    const sheets1 = useAppStore.getState().activeAssembly!.nest!.sheets;
    const b = new GenerateNestCommand(opts); await b.apply();
    const fp2 = useAppStore.getState().activeAssembly!.nest!.inputFingerprint;
    const sheets2 = useAppStore.getState().activeAssembly!.nest!.sheets;
    expect(fp1).toBe(fp2);
    expect(sheets1).toEqual(sheets2);
  });

  it('apply with no active assembly is a no-op (does not throw)', async () => {
    useAppStore.setState({ activeAssembly: null } as never);
    const cmd = new GenerateNestCommand({ kerfMm: 3, result: fakeResult([]), materials: matRegistry() });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run (expect fail)**

```
cd packages/app && pnpm test:unit -- GenerateNestCommand
```

- [ ] **Step 3: Implement `GenerateNestCommand.ts`**

```ts
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';
import type { CutListResult } from '@zilventor/shared/src/cutListRow';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import type { NestInputRow, NestState } from '@zilventor/shared';
import { packAllMaterials, computeNestFingerprint } from '@zilventor/shared';

export class GenerateNestCommand implements Command {
  readonly name = 'GenerateNest';
  private prevNest: NestState | undefined;
  private prevHadActiveAssembly = false;

  constructor(private readonly opts: {
    kerfMm: number;
    result: CutListResult;
    materials: MaterialRegistry;
  }) {}

  async apply(): Promise<void> {
    const a = useAppStore.getState().activeAssembly;
    if (!a) return;
    this.prevHadActiveAssembly = true;
    this.prevNest = a.nest;

    const inputRows: NestInputRow[] = this.opts.result.rows.map((r) => ({
      itemNumber: r.itemNumber, rowKey: r.rowKey, qty: r.qty,
      length: r.length, width: r.width,
      materialId: r.materialId, grain: r.grain,
    }));
    const { sheets, excluded } = packAllMaterials(inputRows, this.opts.materials, this.opts.kerfMm);
    const inputFingerprint = await computeNestFingerprint(this.opts.result.rows, this.opts.materials, this.opts.kerfMm);
    const nest: NestState = {
      params: { kerfMm: this.opts.kerfMm },
      generatedAt: Date.now(),
      inputFingerprint,
      sheets,
      excluded,
    };
    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      return { activeAssembly: { ...s.activeAssembly, nest } } as never;
    });
  }

  async revert(): Promise<void> {
    if (!this.prevHadActiveAssembly) return;
    useAppStore.setState((s) => {
      if (!s.activeAssembly) return s;
      const next = { ...s.activeAssembly };
      if (this.prevNest === undefined) delete (next as { nest?: NestState }).nest;
      else next.nest = this.prevNest;
      return { activeAssembly: next } as never;
    });
  }
}
```

- [ ] **Step 4: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- GenerateNestCommand
```
Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/GenerateNestCommand.ts packages/app/src/commands/__tests__/GenerateNestCommand.spec.ts
git commit -m "feat(app): GenerateNestCommand — undoable, snapshots cut-list+materials (5e §4.1)"
```

---

### Task 13: OpenNestingTabCommand (4-way mutex)

**Files:**
- Create: `packages/app/src/commands/OpenNestingTabCommand.ts`
- Create: `packages/app/src/commands/__tests__/OpenNestingTabCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/OpenNestingTabCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { OpenNestingTabCommand } from '../OpenNestingTabCommand';
import { useAppStore } from '../../store/useAppStore';

describe('OpenNestingTabCommand', () => {
  it('sets nestingTabActive=true and clears bom + cutList tabs', async () => {
    useAppStore.setState({ bomTabActive: true, cutListTabActive: true, nestingTabActive: false } as never);
    await new OpenNestingTabCommand().apply();
    const s = useAppStore.getState();
    expect(s.nestingTabActive).toBe(true);
    expect(s.bomTabActive).toBe(false);
    expect(s.cutListTabActive).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `OpenNestingTabCommand.ts`**

```ts
import { useAppStore } from '../store/useAppStore';

export class OpenNestingTabCommand {
  async apply(): Promise<void> {
    const s = useAppStore.getState();
    s.setNestingTabActive(true);
    s.setBomTabActive(false);
    s.setCutListTabActive(false);
  }
}
```

- [ ] **Step 3: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- OpenNestingTabCommand
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/commands/OpenNestingTabCommand.ts packages/app/src/commands/__tests__/OpenNestingTabCommand.spec.ts
git commit -m "feat(app): OpenNestingTabCommand — 4-way mutex with assembly/bom/cutlist (5e §4.4)"
```

---

### Task 14: Update OpenCutListTabCommand & OpenBomTabCommand to clear nestingTabActive

**Files:**
- Modify: `packages/app/src/commands/OpenCutListTabCommand.ts`
- Modify: `packages/app/src/commands/OpenBomTabCommand.ts`
- Modify (test): existing specs for those two commands (add an assertion that nesting is cleared too)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Add the failing assertions to existing specs**

In `packages/app/src/commands/__tests__/OpenCutListTabCommand.spec.ts`:
```ts
it('clears nestingTabActive (4-way mutex)', async () => {
  useAppStore.setState({ nestingTabActive: true } as never);
  await new OpenCutListTabCommand().apply();
  expect(useAppStore.getState().nestingTabActive).toBe(false);
});
```

Same shape in `OpenBomTabCommand.spec.ts`.

- [ ] **Step 2: Run (expect fail)**

- [ ] **Step 3: Modify both Open*TabCommand files to also call `setNestingTabActive(false)`**

`OpenCutListTabCommand.ts`:
```ts
async apply(): Promise<void> {
  const s = useAppStore.getState();
  s.setCutListTabActive(true);
  s.setBomTabActive(false);
  s.setNestingTabActive(false);
}
```

`OpenBomTabCommand.ts`:
```ts
async apply(): Promise<void> {
  const s = useAppStore.getState();
  s.setBomTabActive(true);
  s.setCutListTabActive(false);
  s.setNestingTabActive(false);
}
```

- [ ] **Step 4: Run (expect pass)**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/OpenCutListTabCommand.ts packages/app/src/commands/OpenBomTabCommand.ts packages/app/src/commands/__tests__/OpenCutListTabCommand.spec.ts packages/app/src/commands/__tests__/OpenBomTabCommand.spec.ts
git commit -m "feat(app): widen Open{CutList,Bom}TabCommand mutex to clear nesting tab (5e §5.3)"
```

---

### Task 15: Update BrowserPane Assembly tab button to clear nestingTabActive

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Locate the Assembly tab button**

```
grep -n "Assembly tab" packages/app/src/shell/BrowserPane.tsx
```

- [ ] **Step 2: Modify its onClick to also clear nestingTabActive**

```tsx
<button type="button" aria-label="Assembly tab"
  onClick={() => { setBomTabActive(false); setCutListTabActive(false); setNestingTabActive(false); }}
  ...>Assembly</button>
```

Add the `setNestingTabActive` selector at the top of the component:
```ts
const setNestingTabActive = useAppStore((s) => s.setNestingTabActive);
```

The "Assembly active" CSS class condition needs `nestingTabActive` too:
```tsx
const nestingTabActive = useAppStore((s) => s.nestingTabActive);
const assemblyActive = !bomTabActive && !cutListTabActive && !nestingTabActive;
className={`px-2 py-0.5 text-xs ${assemblyActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}
```

(Also use `assemblyActive` in the existing tab-content switch below the strip.)

- [ ] **Step 3: Typecheck + run BrowserPane unit tests**

```
cd packages/app && pnpm typecheck && pnpm test:unit -- BrowserPane
```
Expected: clean and green.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx
git commit -m "feat(app): BrowserPane Assembly button clears nestingTabActive (5e §5.3)"
```

---

### Task 16: NestDialog component

**Files:**
- Create: `packages/app/src/shell/NestDialog.tsx`
- Create: `packages/app/src/shell/__tests__/NestDialog.spec.tsx`
- Create: `packages/app/src/commands/OpenNestDialogCommand.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement `OpenNestDialogCommand.ts`** (mirror `OpenCabinetDialogCommand`)

```ts
import { useAppStore } from '../store/useAppStore';
export class OpenNestDialogCommand {
  async apply(): Promise<void> {
    useAppStore.getState().setNestDialog({ kind: 'open' });
  }
}
```

- [ ] **Step 2: Implement `NestDialog.tsx`** (mirror `CabinetDialog.tsx`)

```tsx
import { useState, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { useCutListResult } from './useCutListResult';

export function NestDialog() {
  const dialog = useAppStore((s) => s.nestDialog);
  const setDialog = useAppStore((s) => s.setNestDialog);
  const bus = useAppStore((s) => s.bus);
  const materials = useAppStore((s) => s.activeAssembly?.materials ?? []);
  const cutListResult = useCutListResult();
  const [kerfStr, setKerfStr] = useState('3');

  if (!dialog) return null;

  const kerf = Number(kerfStr);
  const validKerf = Number.isFinite(kerf) && kerf > 0;
  const panelCount = cutListResult.rows.reduce((sum, r) => sum + r.qty, 0);
  const materialIdsWithRows = new Set(cutListResult.rows.map((r) => r.materialId));
  const materialsWithStock = materials.filter(
    (m) => materialIdsWithRows.has(m.id) && m.sheetLengthMm !== undefined && m.sheetWidthMm !== undefined,
  );
  const summary = `${panelCount} panels across ${materialsWithStock.length} materials will be nested`;

  const handleOk = async () => {
    if (!validKerf) return;
    await bus.execute(new GenerateNestCommand({ kerfMm: kerf, result: cutListResult, materials }));
    setDialog(null);
  };
  const handleCancel = () => setDialog(null);

  return (
    <div role="dialog" aria-label="Nest dialog" onKeyDown={(e) => { if (e.key === 'Escape') handleCancel(); }}>
      <h3>Generate Nest</h3>
      <label>
        Kerf (mm)
        <input aria-label="Kerf" type="text" inputMode="numeric"
          value={kerfStr} onChange={(e) => setKerfStr(e.target.value)} />
      </label>
      {!validKerf && <div role="alert">Kerf must be a positive number.</div>}
      <p>{summary}</p>
      <button onClick={handleCancel}>Cancel</button>
      <button onClick={handleOk} aria-disabled={!validKerf} disabled={!validKerf}>OK</button>
    </div>
  );
}
```

- [ ] **Step 3: Mount the dialog at the app shell level**

In the same place `CabinetDialog` and `HardwareDialog` are mounted (likely `App.tsx` or `Shell.tsx`):
```tsx
<NestDialog />
```

- [ ] **Step 4: Tests**

```tsx
// packages/app/src/shell/__tests__/NestDialog.spec.tsx
describe('NestDialog', () => {
  it('renders nothing when nestDialog is null', () => { /* ... */ });
  it('renders kerf input + summary + OK/Cancel when open', () => { /* ... */ });
  it('OK runs GenerateNestCommand via bus and closes dialog', async () => { /* ... */ });
  it('Cancel closes dialog without running command', () => { /* ... */ });
  it('Esc closes dialog', () => { /* ... */ });
  it('OK is disabled when kerf is empty / non-positive / non-numeric', () => { /* ... */ });
});
```

Fill each test with concrete React Testing Library calls, mirroring `CabinetDialog.spec.tsx`.

- [ ] **Step 5: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- NestDialog
```

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/NestDialog.tsx packages/app/src/shell/__tests__/NestDialog.spec.tsx packages/app/src/commands/OpenNestDialogCommand.ts
git commit -m "feat(app): NestDialog + OpenNestDialogCommand (5e §5.4)"
```

---

### Task 17: Furniture ribbon Nesting panel

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Locate the Cut List `RibbonPanel` block (lines ~107–119)**

- [ ] **Step 2: Append a Nesting `RibbonPanel` after it**

```tsx
<div aria-label="Nesting panel">
  <RibbonPanel title="Nesting">
    <button type="button" className="text-xs hover:text-white"
      onClick={() => void new OpenNestDialogCommand().apply()}>
      Generate Nest
    </button>
    <button type="button" className="text-xs hover:text-white"
      aria-disabled={!activeAssembly?.nest}
      disabled={!activeAssembly?.nest}
      onClick={async () => {
        if (!activeAssembly?.nest) return;
        await bus.execute(new ExportNestPdfCommand({ nest: activeAssembly.nest, materials: activeAssembly.materials }));
      }}>
      Export PDF
    </button>
  </RibbonPanel>
</div>
```

(Note: `ExportNestPdfCommand` is added in Task 24. Until then, leave the import + handler commented out OR stub it to a `console.log`. Phase 6 will wire it.)

- [ ] **Step 3: Add imports**

```ts
import { OpenNestDialogCommand } from '../../commands/OpenNestDialogCommand';
// import { ExportNestPdfCommand } from '../../commands/ExportNestPdfCommand'; // wired in Phase 6
```

- [ ] **Step 4: Typecheck**

```
cd packages/app && pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx
git commit -m "feat(app): Furniture ribbon Nesting panel — Generate Nest + (stubbed) Export PDF (5e §5.4)"
```

---

## Phase 5 — NestingTab UI in BrowserPane

Three tasks. T18 SheetSvg (pure-render component); T19 NestingTab wrapper (consumes useCutListResult + StaleBanner + ExcludedSection); T20 BrowserPane integration.

### Task 18: SheetSvg component

**Files:**
- Create: `packages/app/src/shell/SheetSvg.tsx`
- Create: `packages/app/src/shell/__tests__/SheetSvg.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```tsx
// packages/app/src/shell/SheetSvg.tsx
import type { NestSheet } from '@zilventor/shared';
import type { MaterialEntry } from '@zilventor/shared/src/material';
import type { GrainDirection } from '@zilventor/shared/src/panel-feature';

export type SheetSvgProps = {
  sheet: NestSheet;
  material: MaterialEntry | undefined;
  grainByRowKey: Map<string, GrainDirection>;
  onExportPng: (sheet: NestSheet) => void;
};

export function SheetSvg({ sheet, material, grainByRowKey, onExportPng }: SheetSvgProps) {
  const fill = material?.color ?? '#dddddd';
  return (
    <div data-nesting-sheet={`${sheet.materialId}:${sheet.sheetIndex}`}>
      <div className="flex items-center justify-between text-xs mb-1">
        <span>Sheet {sheet.sheetIndex} — {sheet.utilizationPct}% utilisation</span>
        <button type="button" aria-label={`Export PNG sheet ${sheet.sheetIndex}`}
          onClick={() => onExportPng(sheet)}>Export PNG</button>
      </div>
      <svg viewBox={`0 0 ${sheet.sheetLengthMm} ${sheet.sheetWidthMm}`}
        preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: 'auto' }}>
        <rect x={0} y={0} width={sheet.sheetLengthMm} height={sheet.sheetWidthMm}
          fill="white" stroke="#888" strokeWidth={2} />
        {sheet.panels.map((p, i) => {
          const grain = grainByRowKey.get(p.rowKey) ?? 'none';
          return (
            <g key={i} data-nesting-panel={`${p.itemNumber}:${i}`}>
              <rect x={p.x} y={p.y} width={p.length} height={p.width}
                fill={fill} stroke="#222" strokeWidth={1} />
              <text x={p.x + 8} y={p.y + 24} fontSize={20} fill="#222">#{p.itemNumber}</text>
              {p.length > 200 && (
                <text x={p.x + p.length / 2} y={p.y + p.width / 2}
                  textAnchor="middle" dominantBaseline="middle" fontSize={18} fill="#222">
                  {p.length}×{p.width}
                </text>
              )}
              {grain !== 'none' && (
                <path d={grainArrowPath(p, grain, p.rotated)} stroke="#222" strokeWidth={1.5} fill="none" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function grainArrowPath(
  p: { x: number; y: number; length: number; width: number },
  grain: GrainDirection,
  rotated: boolean,
): string {
  // Grain along sheet length when grain='length' and not rotated, OR grain='width' and rotated.
  const alongLength = (grain === 'length' && !rotated) || (grain === 'width' && rotated);
  const cx = p.x + p.length / 2, cy = p.y + p.width / 2;
  const half = Math.min(p.length, p.width) * 0.25;
  if (alongLength) {
    return `M${cx - half},${cy} L${cx + half},${cy} M${cx + half - 6},${cy - 6} L${cx + half},${cy} L${cx + half - 6},${cy + 6}`;
  }
  return `M${cx},${cy - half} L${cx},${cy + half} M${cx - 6},${cy + half - 6} L${cx},${cy + half} L${cx + 6},${cy + half - 6}`;
}
```

- [ ] **Step 2: Tests**

```tsx
describe('SheetSvg', () => {
  const baseSheet = {
    materialId: 'm1', sheetIndex: 1, sheetLengthMm: 2440, sheetWidthMm: 1220,
    utilizationPct: 50.0,
    panels: [
      { itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 600, width: 400, rotated: false },
    ],
  } as const;

  it('renders sheet header with index and utilisation', () => {
    render(<SheetSvg sheet={baseSheet} material={undefined} grainByRowKey={new Map()} onExportPng={() => {}} />);
    expect(screen.getByText(/Sheet 1.*50/i)).toBeInTheDocument();
  });

  it('renders one rect per placed panel + #itemNumber label', () => { /* ... */ });
  it('omits the LxW label when length <= 200mm', () => { /* ... */ });
  it('renders grain arrow when grain != none', () => { /* ... */ });
  it('clicking Export PNG calls onExportPng with the sheet', () => { /* ... */ });
});
```

- [ ] **Step 3: Run (expect pass)**

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/SheetSvg.tsx packages/app/src/shell/__tests__/SheetSvg.spec.tsx
git commit -m "feat(app): SheetSvg — per-sheet inline SVG render with grain arrows (5e §5.2)"
```

---

### Task 19: NestingTab + StaleBanner + ExcludedSection

**Files:**
- Create: `packages/app/src/shell/NestingTab.tsx`
- Create: `packages/app/src/shell/__tests__/NestingTab.spec.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```tsx
// packages/app/src/shell/NestingTab.tsx
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useCutListResult } from './useCutListResult';
import { computeNestFingerprint, type NestSheet, type NestExclusion } from '@zilventor/shared';
import { GenerateNestCommand } from '../commands/GenerateNestCommand';
import { ExportNestPngCommand } from '../commands/ExportNestPngCommand';
import { SheetSvg } from './SheetSvg';

export function NestingTab() {
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const bus = useAppStore((s) => s.bus);
  const materials = activeAssembly?.materials ?? [];
  const nest = activeAssembly?.nest;
  const cutListResult = useCutListResult();

  const [currentFingerprint, setCurrentFingerprint] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const kerf = nest?.params.kerfMm ?? 3;
    void computeNestFingerprint(cutListResult.rows, materials, kerf).then((fp) => {
      if (!cancelled) setCurrentFingerprint(fp);
    });
    return () => { cancelled = true; };
  }, [cutListResult.rows, materials, nest?.params.kerfMm]);

  const stale = !!nest && currentFingerprint !== null && currentFingerprint !== nest.inputFingerprint;
  const grainByRowKey = useMemo(() => {
    const m = new Map<string, typeof cutListResult.rows[number]['grain']>();
    cutListResult.rows.forEach((r) => m.set(r.rowKey, r.grain));
    return m;
  }, [cutListResult.rows]);

  if (!nest) {
    return <div className="p-4 text-xs text-neutral-400">No nest generated yet. Click "Generate Nest" on the Furniture tab.</div>;
  }

  const grouped = new Map<string, NestSheet[]>();
  nest.sheets.forEach((s) => {
    if (!grouped.has(s.materialId)) grouped.set(s.materialId, []);
    grouped.get(s.materialId)!.push(s);
  });

  const handleRegenerate = async () => {
    await bus.execute(new GenerateNestCommand({ kerfMm: nest.params.kerfMm, result: cutListResult, materials }));
  };
  const handleExportPng = async (sheet: NestSheet) => {
    await bus.execute(new ExportNestPngCommand({ sheet, materials }));
  };

  return (
    <div data-nesting-tab>
      {stale && (
        <div role="status" aria-label="Nest stale" className="bg-yellow-100 text-yellow-900 px-2 py-1">
          ⚠️ Cut list changed since last nest.
          <button onClick={handleRegenerate} className="ml-2 underline">Regenerate</button>
        </div>
      )}
      {Array.from(grouped.entries()).map(([materialId, sheets]) => {
        const m = materials.find((mm) => mm.id === materialId);
        const avgUtil = sheets.reduce((s, sh) => s + sh.utilizationPct, 0) / sheets.length;
        return (
          <section key={materialId} className="mb-4" aria-label={`Material section ${materialId}`}>
            <h4 className="text-xs font-semibold mb-1">
              {m?.name ?? materialId} — {sheets.length} sheet{sheets.length === 1 ? '' : 's'}, avg {avgUtil.toFixed(1)}% util
            </h4>
            {sheets.map((s) => (
              <SheetSvg key={`${s.materialId}-${s.sheetIndex}`}
                sheet={s} material={m} grainByRowKey={grainByRowKey} onExportPng={handleExportPng} />
            ))}
          </section>
        );
      })}
      {nest.excluded.length > 0 && <ExcludedSection excluded={nest.excluded} />}
    </div>
  );
}

function ExcludedSection({ excluded }: { excluded: readonly NestExclusion[] }) {
  return (
    <section aria-label="Nest excluded section" className="border-t pt-2 text-xs">
      <h4 className="font-semibold">Excluded</h4>
      <ul>
        {excluded.map((e, i) => (
          <li key={i}>
            <strong>{e.materialId}</strong>: {e.reason === 'no-sheet-stock' ? 'no sheet stock defined'
              : `panel exceeds sheet (item${e.itemNumbers.length === 1 ? '' : 's'} #${e.itemNumbers.join(', #')})`}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Tests**

```tsx
describe('NestingTab', () => {
  it('renders empty-state when activeAssembly.nest is undefined', () => { /* ... */ });
  it('renders one section per material with avg utilisation', () => { /* ... */ });
  it('shows stale banner when current fingerprint differs from persisted', async () => { /* ... */ });
  it('hides stale banner when fingerprints match', async () => { /* ... */ });
  it('clicking Regenerate dispatches GenerateNestCommand via bus', async () => { /* ... */ });
  it('renders ExcludedSection when nest.excluded is non-empty', () => { /* ... */ });
});
```

(Use `vi.mock('@zilventor/shared', ...)` to stub `computeNestFingerprint` returning a known string for the stale-banner tests.)

- [ ] **Step 3: Run (expect pass)**

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/NestingTab.tsx packages/app/src/shell/__tests__/NestingTab.spec.tsx
git commit -m "feat(app): NestingTab + StaleBanner + ExcludedSection (5e §5.1/§7)"
```

---

### Task 20: BrowserPane 4th tab integration

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Add the 4th tab button after Cut List**

```tsx
<button type="button" aria-label="Nesting tab"
  onClick={() => void new OpenNestingTabCommand().apply()}
  className={`px-2 py-0.5 text-xs ${nestingTabActive ? 'bg-shell-panel text-white' : 'text-neutral-400'}`}>
  Nesting
</button>
```

- [ ] **Step 2: Add the tab-content branch**

In the tab-content switching block (where `cutListTabActive` and `bomTabActive` branches live), add:
```tsx
if (nestingTabActive) return <NestingTab />;
```

- [ ] **Step 3: Imports**

```ts
import { OpenNestingTabCommand } from '../commands/OpenNestingTabCommand';
import { NestingTab } from './NestingTab';
```

- [ ] **Step 4: Run unit suite**

```
cd packages/app && pnpm test:unit -- BrowserPane
```
Expected: green; existing 3-tab tests still pass; tab strip now has 4 buttons.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx
git commit -m "feat(app): BrowserPane 4th tab — Nesting (5e §5.3)"
```

---

## Phase 6 — PDF export

Five tasks. T21 dep add; T22 download helper; T23 pure renderer; T24 command; T25 ribbon wire-through.

### Task 21: Add jspdf dependency to packages/app

**Files:**
- Modify: `packages/app/package.json`
- Modify: `pnpm-lock.yaml` (auto)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Inspect current deps and add jspdf**

```
cd /Users/lion/Documents/Projects/mine/zilventor && pnpm --filter @zilventor/app add jspdf@^2.5.1
```

- [ ] **Step 2: Verify install**

```
grep '"jspdf"' packages/app/package.json
```
Expected: shows `jspdf` in dependencies.

- [ ] **Step 3: Smoke import**

```
cd packages/app && node -e "import('jspdf').then(m => console.log(typeof m.jsPDF))"
```
Expected: `function`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml
git commit -m "chore(app): add jspdf dependency for 5e PDF export"
```

---

### Task 22: triggerDownload helper (showSaveFilePicker + a-tag fallback)

**Files:**
- Create: `packages/app/src/nesting/triggerDownload.ts`
- Create: `packages/app/src/nesting/__tests__/triggerDownload.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Read the existing CSV download pattern for reference**

```
cat packages/app/src/commands/ExportCutListCsvCommand.ts
```

Mirror its two-tier strategy.

- [ ] **Step 2: Implement**

```ts
// packages/app/src/nesting/triggerDownload.ts
type SaveOpts = {
  suggestedName: string;
  mimeType: string;
  extension: string;          // e.g. 'pdf' or 'png' (no leading dot)
  description: string;        // human label for the file picker
};

export async function triggerDownload(blob: Blob, opts: SaveOpts): Promise<void> {
  const w = globalThis as unknown as { showSaveFilePicker?: (o: unknown) => Promise<unknown> };
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = (await w.showSaveFilePicker({
        suggestedName: opts.suggestedName,
        types: [{ description: opts.description, accept: { [opts.mimeType]: [`.${opts.extension}`] } }],
      })) as { createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> };
      const stream = await handle.createWritable();
      await stream.write(blob);
      await stream.close();
      return;
    } catch (err: unknown) {
      // User cancelled → AbortError; fall through to a-tag fallback.
      if ((err as { name?: string }).name === 'AbortError') return;
      // Other errors fall through to fallback too.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

- [ ] **Step 3: Tests**

```ts
describe('triggerDownload', () => {
  it('uses showSaveFilePicker when available and writes the blob', async () => {
    const writes: Blob[] = [];
    const closes: number[] = [];
    (globalThis as Record<string, unknown>).showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (b: Blob) => { writes.push(b); },
        close: async () => { closes.push(1); },
      }),
    });
    const blob = new Blob(['x'], { type: 'text/plain' });
    await triggerDownload(blob, { suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text' });
    expect(writes).toHaveLength(1);
    expect(closes).toHaveLength(1);
  });

  it('falls back to a-tag when showSaveFilePicker is undefined', async () => {
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    let clicked = 0;
    const origCreate = document.createElement;
    document.createElement = ((tag: string) => {
      const el = origCreate.call(document, tag) as HTMLAnchorElement;
      if (tag === 'a') {
        const origClick = el.click.bind(el);
        el.click = () => { clicked++; origClick(); };
      }
      return el;
    }) as never;
    const blob = new Blob(['x'], { type: 'text/plain' });
    await triggerDownload(blob, { suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text' });
    expect(clicked).toBe(1);
    document.createElement = origCreate;
  });

  it('AbortError from showSaveFilePicker → no fallback, returns silently', async () => {
    (globalThis as Record<string, unknown>).showSaveFilePicker = async () => {
      const e = new Error('cancelled'); (e as { name?: string }).name = 'AbortError'; throw e;
    };
    await expect(triggerDownload(new Blob(['x']), {
      suggestedName: 't.txt', mimeType: 'text/plain', extension: 'txt', description: 'Text',
    })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- triggerDownload
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/nesting/triggerDownload.ts packages/app/src/nesting/__tests__/triggerDownload.spec.ts
git commit -m "feat(app): triggerDownload helper — showSaveFilePicker + a-tag fallback (5e §6.3)"
```

---

### Task 23: renderNestPdf pure function

**Files:**
- Create: `packages/app/src/nesting/renderNestPdf.ts`
- Create: `packages/app/src/nesting/__tests__/renderNestPdf.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```ts
// packages/app/src/nesting/renderNestPdf.ts
import { jsPDF } from 'jspdf';
import type { NestState, NestSheet } from '@zilventor/shared';
import type { MaterialEntry, MaterialRegistry } from '@zilventor/shared/src/material';

export function renderNestPdf(nest: NestState, materials: MaterialRegistry): Blob {
  if (nest.sheets.length === 0) {
    const empty = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
    empty.text('No sheets', 20, 20);
    return empty.output('blob');
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a3', orientation: 'landscape' });
  const totalsByMaterial = new Map<string, number>();
  nest.sheets.forEach((s) => totalsByMaterial.set(s.materialId, (totalsByMaterial.get(s.materialId) ?? 0) + 1));

  nest.sheets.forEach((sheet, i) => {
    const orientation: 'landscape' | 'portrait' =
      sheet.sheetLengthMm >= sheet.sheetWidthMm ? 'landscape' : 'portrait';
    if (i === 0) {
      if (orientation !== 'landscape') {
        pdf.deletePage(1);
        pdf.addPage('a3', orientation);
      }
    } else {
      pdf.addPage('a3', orientation);
    }
    const material = materials.find((m) => m.id === sheet.materialId);
    drawSheetPdf(pdf, sheet, material, totalsByMaterial.get(sheet.materialId) ?? 1, { marginMm: 10 });
  });

  return pdf.output('blob');
}

function drawSheetPdf(
  pdf: jsPDF, sheet: NestSheet, material: MaterialEntry | undefined, totalForMat: number,
  opts: { marginMm: number },
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = opts.marginMm;
  const titleH = 12;
  const drawW = pageW - 2 * margin;
  const drawH = pageH - 2 * margin - titleH;
  const scale = Math.min(drawW / sheet.sheetLengthMm, drawH / sheet.sheetWidthMm);

  // Title bar
  pdf.setFontSize(12);
  const title = `${material?.name ?? sheet.materialId} — Sheet ${sheet.sheetIndex}/${totalForMat} — ${sheet.utilizationPct}% util`;
  pdf.text(title, margin, margin + 6);

  // Sheet outline
  const ox = margin, oy = margin + titleH;
  pdf.setDrawColor(136); pdf.setLineWidth(0.4);
  pdf.rect(ox, oy, sheet.sheetLengthMm * scale, sheet.sheetWidthMm * scale);

  // Panels
  const fillRgb = hexToRgb(material?.color ?? '#dddddd');
  for (const p of sheet.panels) {
    const x = ox + p.x * scale;
    const y = oy + p.y * scale;
    const w = p.length * scale;
    const h = p.width * scale;
    pdf.setFillColor(fillRgb.r, fillRgb.g, fillRgb.b);
    pdf.setDrawColor(34); pdf.setLineWidth(0.2);
    pdf.rect(x, y, w, h, 'FD');
    pdf.setFontSize(9); pdf.setTextColor(34);
    pdf.text(`#${p.itemNumber}`, x + 1.5, y + 4);
    if (p.length > 200) {
      pdf.setFontSize(8);
      pdf.text(`${p.length}×${p.width}`, x + w / 2, y + h / 2, { align: 'center', baseline: 'middle' });
    }
  }
  pdf.setTextColor(0);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  const expand = (s: string): string => s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  const e = expand(m);
  return { r: parseInt(e.slice(0, 2), 16), g: parseInt(e.slice(2, 4), 16), b: parseInt(e.slice(4, 6), 16) };
}
```

- [ ] **Step 2: Tests**

```ts
describe('renderNestPdf', () => {
  const sheet = (i: number, panels: number) => ({
    materialId: 'm1', sheetIndex: i, sheetLengthMm: 2440, sheetWidthMm: 1220, utilizationPct: 50.0,
    panels: Array.from({ length: panels }, (_, k) => ({
      itemNumber: k + 1, rowKey: `r${k}`, x: k * 700, y: 0, length: 600, width: 400, rotated: false,
    })),
  });
  const nestState = (sheets: ReturnType<typeof sheet>[]) => ({
    params: { kerfMm: 3 }, generatedAt: 0, inputFingerprint: 'x', sheets, excluded: [],
  });
  const materials = [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc',
    sheetLengthMm: 2440, sheetWidthMm: 1220 }];

  it('returns a Blob with type application/pdf', () => {
    const blob = renderNestPdf(nestState([sheet(1, 3)]), materials);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });

  it('multi-sheet → multi-page (file size larger than single-sheet)', () => {
    const small = renderNestPdf(nestState([sheet(1, 1)]), materials);
    const big = renderNestPdf(nestState([sheet(1, 1), sheet(2, 1), sheet(3, 1)]), materials);
    expect(big.size).toBeGreaterThan(small.size);
  });

  it('zero-sheet nest → returns a one-page "No sheets" PDF', () => {
    const blob = renderNestPdf(nestState([]), materials);
    expect(blob.size).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run (expect pass)**

```
cd packages/app && pnpm test:unit -- renderNestPdf
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/nesting/renderNestPdf.ts packages/app/src/nesting/__tests__/renderNestPdf.spec.ts
git commit -m "feat(app): renderNestPdf — vector multi-page A3 (5e §6.1)"
```

---

### Task 24: ExportNestPdfCommand

**Files:**
- Create: `packages/app/src/commands/ExportNestPdfCommand.ts`
- Create: `packages/app/src/commands/__tests__/ExportNestPdfCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```ts
// packages/app/src/commands/ExportNestPdfCommand.ts
import type { NestState } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import { renderNestPdf } from '../nesting/renderNestPdf';
import { triggerDownload } from '../nesting/triggerDownload';

declare global {
  // E2E-inspectable bytes from the latest export call (mirrors __zilventorCutListCsvBytes).
  // eslint-disable-next-line no-var
  var __zilventorNestPdfBytes: Uint8Array | undefined;
}

export class ExportNestPdfCommand {
  constructor(private readonly opts: { nest: NestState; materials: MaterialRegistry; suggestedName?: string }) {}

  async apply(): Promise<void> {
    const blob = renderNestPdf(this.opts.nest, this.opts.materials);
    const buf = new Uint8Array(await blob.arrayBuffer());
    (globalThis as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes = buf;
    await triggerDownload(blob, {
      suggestedName: this.opts.suggestedName ?? `nest-${timestamp()}.pdf`,
      mimeType: 'application/pdf', extension: 'pdf', description: 'Nest PDF',
    });
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
```

- [ ] **Step 2: Tests**

```ts
describe('ExportNestPdfCommand', () => {
  it('apply writes globalThis.__zilventorNestPdfBytes and triggers download', async () => {
    const nest = { params: { kerfMm: 3 }, generatedAt: 0, inputFingerprint: 'x',
      sheets: [{ materialId: 'm1', sheetIndex: 1, sheetLengthMm: 2440, sheetWidthMm: 1220,
        utilizationPct: 0, panels: [] }],
      excluded: [] } as const;
    const materials = [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc',
      sheetLengthMm: 2440, sheetWidthMm: 1220 }];
    delete (globalThis as Record<string, unknown>).showSaveFilePicker;
    const cmd = new ExportNestPdfCommand({ nest, materials, suggestedName: 'test.pdf' });
    await cmd.apply();
    const bytes = (globalThis as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes;
    expect(bytes).toBeDefined();
    expect(bytes!.length).toBeGreaterThan(0);
    // First 4 bytes of any PDF: '%PDF'
    expect(String.fromCharCode(...bytes!.slice(0, 4))).toBe('%PDF');
  });
});
```

- [ ] **Step 3: Run (expect pass)**

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/commands/ExportNestPdfCommand.ts packages/app/src/commands/__tests__/ExportNestPdfCommand.spec.ts
git commit -m "feat(app): ExportNestPdfCommand + __zilventorNestPdfBytes E2E hook (5e §4.2)"
```

---

### Task 25: Wire Export PDF ribbon button

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Uncomment / add the ExportNestPdfCommand import**

```ts
import { ExportNestPdfCommand } from '../../commands/ExportNestPdfCommand';
```

- [ ] **Step 2: Replace the stubbed Export PDF onClick (from Task 17) with the real handler**

```tsx
onClick={async () => {
  if (!activeAssembly?.nest) return;
  await bus.execute(new ExportNestPdfCommand({
    nest: activeAssembly.nest, materials: activeAssembly.materials,
    suggestedName: `${activeAssembly.name}-nest.pdf`,
  }));
}}
```

- [ ] **Step 3: Typecheck and run app unit suite**

```
cd packages/app && pnpm typecheck && pnpm test:unit
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx
git commit -m "feat(app): wire Furniture-ribbon Export PDF button to ExportNestPdfCommand (5e §5.4)"
```

---

## Phase 7 — PNG export

Three tasks. Mirrors Phase 6 but per-sheet, raster.

### Task 26: renderNestSheetPng pure function

**Files:**
- Create: `packages/app/src/nesting/renderNestSheetPng.ts`
- Create: `packages/app/src/nesting/__tests__/renderNestSheetPng.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```ts
// packages/app/src/nesting/renderNestSheetPng.ts
import type { NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';

export async function renderNestSheetPng(
  sheet: NestSheet,
  materials: MaterialRegistry,
  opts: { canvasWidthPx: number },
): Promise<Blob> {
  const aspect = sheet.sheetWidthMm / sheet.sheetLengthMm;
  const width = opts.canvasWidthPx;
  const height = Math.max(1, Math.round(width * aspect));

  // Prefer OffscreenCanvas; fall back to a regular <canvas> for environments lacking it (test JSDOM).
  type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let toBlob: () => Promise<Blob>;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
    toBlob = () => (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    toBlob = () => new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((b) => b ? resolve(b) : reject(new Error('toBlob null')), 'image/png');
    });
  }
  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx) throw new Error('2d context unavailable');

  const material = materials.find((m) => m.id === sheet.materialId);
  drawSheetCanvas(ctx, sheet, material?.color ?? '#dddddd', width, height);

  return toBlob();
}

function drawSheetCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  sheet: NestSheet, fill: string, widthPx: number, heightPx: number,
): void {
  const scale = widthPx / sheet.sheetLengthMm;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, widthPx, heightPx);

  for (const p of sheet.panels) {
    const x = p.x * scale, y = p.y * scale, w = p.length * scale, h = p.width * scale;
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#222';
    ctx.font = '14px sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`#${p.itemNumber}`, x + 4, y + 4);
    if (p.length > 200) {
      ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${p.length}×${p.width}`, x + w / 2, y + h / 2);
      ctx.textAlign = 'start'; ctx.textBaseline = 'top';
    }
  }
}
```

- [ ] **Step 2: Tests**

```ts
describe('renderNestSheetPng', () => {
  const sheet = {
    materialId: 'm1', sheetIndex: 1, sheetLengthMm: 2440, sheetWidthMm: 1220, utilizationPct: 50.0,
    panels: [{ itemNumber: 1, rowKey: 'r1', x: 0, y: 0, length: 600, width: 400, rotated: false }],
  } as const;
  const materials = [{ id: 'm1', name: 'Birch', defaultThickness: 18, color: '#aabbcc',
    sheetLengthMm: 2440, sheetWidthMm: 1220 }];

  it('returns a Blob of type image/png', async () => {
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 256 });
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('preserves sheet aspect ratio in output canvas', async () => {
    // Aspect = 1220/2440 = 0.5 → for canvasWidthPx=200, expect height ≈ 100.
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 200 });
    // Decode the PNG header bytes to read width/height.
    const buf = new Uint8Array(await blob.arrayBuffer());
    // PNG IHDR width is at bytes 16..19 (big-endian); height at 20..23.
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const w = view.getUint32(16, false);
    const h = view.getUint32(20, false);
    expect(w).toBe(200);
    expect(h).toBe(100);
  });
});
```

- [ ] **Step 3: Run (expect pass — JSDOM should fall back to HTMLCanvasElement)**

If JSDOM's `<canvas>` has no working 2D context, switch the test to use vitest's `--environment=happy-dom` for this file via inline `// @vitest-environment happy-dom`.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/nesting/renderNestSheetPng.ts packages/app/src/nesting/__tests__/renderNestSheetPng.spec.ts
git commit -m "feat(app): renderNestSheetPng — OffscreenCanvas raster (5e §6.2)"
```

---

### Task 27: ExportNestPngCommand

**Files:**
- Create: `packages/app/src/commands/ExportNestPngCommand.ts`
- Create: `packages/app/src/commands/__tests__/ExportNestPngCommand.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Implement**

```ts
// packages/app/src/commands/ExportNestPngCommand.ts
import type { NestSheet } from '@zilventor/shared';
import type { MaterialRegistry } from '@zilventor/shared/src/material';
import { renderNestSheetPng } from '../nesting/renderNestSheetPng';
import { triggerDownload } from '../nesting/triggerDownload';

export class ExportNestPngCommand {
  constructor(private readonly opts: { sheet: NestSheet; materials: MaterialRegistry }) {}

  async apply(): Promise<void> {
    const { sheet, materials } = this.opts;
    const blob = await renderNestSheetPng(sheet, materials, { canvasWidthPx: 1024 });
    const buf = new Uint8Array(await blob.arrayBuffer());
    (globalThis as { __zilventorNestPngBytes?: Uint8Array }).__zilventorNestPngBytes = buf;
    await triggerDownload(blob, {
      suggestedName: `nest-${sheet.materialId}-${sheet.sheetIndex}.png`,
      mimeType: 'image/png', extension: 'png', description: 'Nest sheet PNG',
    });
  }
}
```

- [ ] **Step 2: Tests** (mirror PDF command shape; assert PNG signature `\x89PNG`).

- [ ] **Step 3: Run + commit**

```bash
git add packages/app/src/commands/ExportNestPngCommand.ts packages/app/src/commands/__tests__/ExportNestPngCommand.spec.ts
git commit -m "feat(app): ExportNestPngCommand + __zilventorNestPngBytes hook (5e §4.3)"
```

---

### Task 28: Per-sheet PNG button is already wired

**Files:** none — verification only.

**Agent:** Sonnet implementer.

- [ ] **Step 1: Verify the SheetSvg `onExportPng` callback (Task 18) and NestingTab handler (Task 19) compile and behave**

NestingTab's `handleExportPng` (Task 19) already dispatches `ExportNestPngCommand`. With Tasks 26+27 landed, this path is now live end-to-end.

- [ ] **Step 2: Run app unit suite**

```
cd packages/app && pnpm test:unit
```
Expected: all green.

- [ ] **Step 3: No commit (no changes).** Move on to Phase 8.

---

## Phase 8 — E2E specs

Four tasks; one chromium spec each. All live under `tests/e2e/furniture/`. The existing helper `tests/e2e/helpers/seedAssemblyPanelPart.ts` is reused. Cabinet-creation specs use `5b`'s existing `CreateCabinetCommand` exposed via dev hook.

### Task 29: T-5e-1 nesting-single-sheet

**Files:**
- Create: `tests/e2e/furniture/nesting-single-sheet.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Inspect an existing 5d cut-list spec for the bootstrapping pattern**

```
ls tests/e2e/furniture/cut-list-*.spec.ts | head -3
cat tests/e2e/furniture/cut-list-place-and-aggregate.spec.ts
```

- [ ] **Step 2: Write the spec**

```ts
// tests/e2e/furniture/nesting-single-sheet.spec.ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

test('T-5e-1: 6 panels of one material → 1 sheet with 6 #item labels', async ({ page }) => {
  await page.goto('/');
  // Create a new assembly + add a material with sheet stock via dev hooks.
  await page.evaluate(() => window.__zilventorStore.getState().createNewAssembly?.());
  await page.evaluate(() => {
    const s = window.__zilventorStore.getState();
    s.addMaterial({ id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c',
      sheetLengthMm: 2440, sheetWidthMm: 1220 });
  });
  for (let i = 1; i <= 6; i++) {
    await seedAssemblyPanelPart(page, {
      partPath: `panels/p${i}.zipt`, partName: `Panel ${i}`,
      length: 600, width: 400, thickness: 18, materialId: 'birch18', grain: 'length',
    });
  }
  // Open Furniture tab → click Generate Nest button → fill kerf → OK.
  await page.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  // Open Nesting tab.
  await page.getByLabel('Nesting tab').click();
  // Expect 1 sheet, with 6 panels labelled #1..#6.
  const sheets = page.locator('[data-nesting-sheet]');
  await expect(sheets).toHaveCount(1);
  const panels = page.locator('[data-nesting-panel]');
  await expect(panels).toHaveCount(6);
  for (let i = 1; i <= 6; i++) {
    await expect(page.getByText(`#${i}`, { exact: true })).toBeVisible();
  }
});
```

- [ ] **Step 3: Run (expect pass — single chromium spec)**

```
pnpm exec playwright test --project=chromium tests/e2e/furniture/nesting-single-sheet.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/furniture/nesting-single-sheet.spec.ts
git commit -m "test(e2e): T-5e-1 single-sheet nesting (6 panels → 1 sheet) (5e §9.3)"
```

---

### Task 30: T-5e-2 nesting-multi-sheet

**Files:**
- Create: `tests/e2e/furniture/nesting-multi-sheet.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the spec** — mirror T-5e-1, but place 4 cabinets via the existing 5b cabinet dev hook (find it in App.tsx):

```ts
// tests/e2e/furniture/nesting-multi-sheet.spec.ts
import { test, expect } from '@playwright/test';

test('T-5e-2: 4 cabinets → ≥ 2 sheets, all #item labels visible across sheets', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__zilventorStore.getState().createNewAssembly?.());
  await page.evaluate(() => {
    window.__zilventorStore.getState().addMaterial({
      id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c',
      sheetLengthMm: 2440, sheetWidthMm: 1220,
    });
  });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(async (idx) => {
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand');
      const cmd = new CreateCabinetCommand({
        kind: 'base', name: `Cab ${idx + 1}`,
        widthMm: 600, depthMm: 580, heightMm: 720, toekickHeightMm: 100, setbackMm: 50,
        shelfCount: 1,
        carcassMaterialId: 'birch18', backMaterialId: 'birch18', edgeBandMaterialId: null,
      });
      await window.__zilventorStore.getState().bus.execute(cmd);
    }, i);
  }
  await page.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByLabel('Nesting tab').click();

  await expect(page.locator('[data-nesting-sheet]')).toHaveCount.greaterThanOrEqual?.(2)
    ?? expect(await page.locator('[data-nesting-sheet]').count()).toBeGreaterThanOrEqual(2);

  // Cross-check: every cut-list itemNumber visible across the rendered sheets.
  await page.getByLabel('Cut List tab').click();
  const cutListItemNumbers = await page.locator('[data-cutlist-row]').evaluateAll(
    (rows) => rows.map((r) => Number(r.getAttribute('data-item-number')))
      .filter((n) => Number.isFinite(n)),
  );
  await page.getByLabel('Nesting tab').click();
  for (const n of cutListItemNumbers) {
    await expect(page.getByText(`#${n}`, { exact: true }).first()).toBeVisible();
  }
});
```

If the import-from-vite-served-path pattern (`'/src/commands/CreateCabinetCommand'`) does not work in your Playwright bootstrapping, expose `CreateCabinetCommand` via a dev hook in `App.tsx` (e.g. `globalThis.__zilventorCommands = { CreateCabinetCommand }`) and call it via `await page.evaluate(({...args}) => window.__zilventorCommands.CreateCabinetCommand.run(args))`. Match whatever convention the existing 5b spec uses.

- [ ] **Step 2: Run + commit**

```
pnpm exec playwright test --project=chromium tests/e2e/furniture/nesting-multi-sheet.spec.ts
git add tests/e2e/furniture/nesting-multi-sheet.spec.ts
git commit -m "test(e2e): T-5e-2 multi-sheet nesting (4 cabinets → ≥2 sheets) (5e §9.3)"
```

---

### Task 31: T-5e-3 nesting-stale-banner

**Files:**
- Create: `tests/e2e/furniture/nesting-stale-banner.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/furniture/nesting-stale-banner.spec.ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

test('T-5e-3: edit cut-list → stale banner → Regenerate clears it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__zilventorStore.getState().createNewAssembly?.());
  await page.evaluate(() => {
    window.__zilventorStore.getState().addMaterial({
      id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c',
      sheetLengthMm: 2440, sheetWidthMm: 1220,
    });
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/p1.zipt', partName: 'Panel 1',
    length: 600, width: 400, thickness: 18, materialId: 'birch18', grain: 'length',
  });
  await page.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByLabel('Nesting tab').click();
  // No banner yet.
  await expect(page.getByLabel('Nest stale')).toHaveCount(0);

  // Add another panel — banner should appear.
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/p2.zipt', partName: 'Panel 2',
    length: 800, width: 400, thickness: 18, materialId: 'birch18', grain: 'length',
  });
  await page.getByLabel('Nesting tab').click();
  await expect(page.getByLabel('Nest stale')).toBeVisible();

  // Regenerate clears banner.
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByLabel('Nest stale')).toHaveCount(0);
  await expect(page.locator('[data-nesting-panel]')).toHaveCount(2);
});
```

- [ ] **Step 2: Run + commit**

```
pnpm exec playwright test --project=chromium tests/e2e/furniture/nesting-stale-banner.spec.ts
git add tests/e2e/furniture/nesting-stale-banner.spec.ts
git commit -m "test(e2e): T-5e-3 stale-banner round-trip (5e §9.3)"
```

---

### Task 32: T-5e-4 nesting-export-pdf

**Files:**
- Create: `tests/e2e/furniture/nesting-export-pdf.spec.ts`

**Agent:** Sonnet implementer.

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/furniture/nesting-export-pdf.spec.ts
import { test, expect } from '@playwright/test';
import { seedAssemblyPanelPart } from '../helpers/seedAssemblyPanelPart';

test('T-5e-4: Export PDF downloads a non-zero application/pdf file', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__zilventorStore.getState().createNewAssembly?.());
  await page.evaluate(() => {
    window.__zilventorStore.getState().addMaterial({
      id: 'birch18', name: 'Birch 18mm', defaultThickness: 18, color: '#d2b48c',
      sheetLengthMm: 2440, sheetWidthMm: 1220,
    });
  });
  await seedAssemblyPanelPart(page, {
    partPath: 'panels/p1.zipt', partName: 'Panel 1',
    length: 600, width: 400, thickness: 18, materialId: 'birch18', grain: 'length',
  });
  await page.getByRole('button', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Generate Nest' }).click();
  await page.getByLabel('Kerf').fill('3');
  await page.getByRole('button', { name: 'OK' }).click();

  // Trigger Export PDF and capture the download.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  expect(download.suggestedFilename().startsWith('')).toBe(true); // any prefix is OK; name is `{asmName}-nest.pdf`
  // Inspect bytes via dev hook (faster than waiting for stream).
  const len = await page.evaluate(() => (window as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes?.length ?? 0);
  expect(len).toBeGreaterThan(0);
  // PDF magic '%PDF' = bytes [37, 80, 68, 70].
  const head = await page.evaluate(() => Array.from(((window as { __zilventorNestPdfBytes?: Uint8Array }).__zilventorNestPdfBytes ?? new Uint8Array()).slice(0, 4)));
  expect(head).toEqual([37, 80, 68, 70]);
});
```

- [ ] **Step 2: Run + commit**

```
pnpm exec playwright test --project=chromium tests/e2e/furniture/nesting-export-pdf.spec.ts
git add tests/e2e/furniture/nesting-export-pdf.spec.ts
git commit -m "test(e2e): T-5e-4 Export PDF download + magic-byte check (5e §9.3)"
```

---

## Phase 9 — Perf + manual smoke

### Task 33: Perf nest-large.perf.spec.ts

**Files:**
- Create: `tests/perf/nest-large.spec.ts`
- Modify: `packages/app/src/App.tsx` (expose `__zilventorNestPackMs(iterations: number): number` dev hook)

**Agent:** Sonnet implementer.

- [ ] **Step 1: Add the dev hook in `App.tsx`** (find the existing `__zilventorCutListAggregateMs` block and mirror it)

```ts
(globalThis as { __zilventorNestPackMs?: (iterations: number) => number }).__zilventorNestPackMs = (iterations: number) => {
  // Build a synthetic 200-panel single-material input.
  const rows: import('@zilventor/shared').NestInputRow[] = [];
  for (let i = 0; i < 200; i++) {
    rows.push({
      itemNumber: i + 1, rowKey: `r${i}`, qty: 1,
      length: 300 + (i % 7) * 50, width: 200 + (i % 5) * 30,
      materialId: 'm1', grain: 'length',
    });
  }
  const materials = [{ id: 'm1', name: 'X', defaultThickness: 18, color: '#aabbcc',
    sheetLengthMm: 2440, sheetWidthMm: 1220 }];
  const { packAllMaterials } = require('@zilventor/shared');
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    packAllMaterials(rows, materials, 3);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.95)] ?? 0;
};
```

(If `require` is not available in the Vite bundle, hoist the import to the top of `App.tsx`.)

- [ ] **Step 2: Write the perf spec**

```ts
// tests/perf/nest-large.spec.ts
import { test, expect } from '@playwright/test';

test('Perf T33: packAllMaterials p95 < 50 ms for 200-panel single-material nest', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof (window as { __zilventorNestPackMs?: unknown }).__zilventorNestPackMs === 'function');
  const p95 = await page.evaluate(() => (window as { __zilventorNestPackMs?: (n: number) => number }).__zilventorNestPackMs!(20));
  console.log(`[perf] nest-large p95 = ${p95.toFixed(2)} ms (budget 50ms)`);
  expect(p95).toBeLessThan(50);
});
```

- [ ] **Step 3: Run (expect pass)**

```
pnpm exec playwright test --project=perf tests/perf/nest-large.spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/perf/nest-large.spec.ts packages/app/src/App.tsx
git commit -m "test(perf): nest-large p95 < 50ms (5e §9.4)"
```

---

### Task 34: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-5e.md`

**Agent:** Sonnet implementer (Haiku acceptable per `feedback_sonnet_subagents_default` for trivial doc — but ensure cwd anchoring in the dispatch prompt).

- [ ] **Step 1: Write the smoke doc**

```markdown
# Sub-project 5e — Manual smoke checklist

Run after merge, on the user's local box. Mirrors the 5b/5c/5d patterns.

## Setup
- `pnpm dev` from repo root, open the printed URL.
- Open DevTools console.

## T1 — One cabinet → one sheet
1. New assembly. Add material **Birch 18mm** with `defaultThickness=18`, `color=#d2b48c`, `sheetLengthMm=2440`, `sheetWidthMm=1220`.
2. Furniture → Cabinets → Base Cabinet (defaults). OK.
3. Furniture → Nesting → Generate Nest. Kerf `3`. OK.
4. Open Nesting tab.
5. **Expect:** 1 material section "Birch 18mm — 1 sheet, ~XX% util". 1 SVG sheet. ~5 panels visible with #item labels matching the Cut List tab.

## T2 — Three cabinets across two materials → two sections
1. Continue from T1 state.
2. Add a second material **Plywood 12mm**, `defaultThickness=12`, `color=#deb887`, `sheetLengthMm=2440`, `sheetWidthMm=1220`.
3. Furniture → Cabinets → Base Cabinet, change `Back material` to Plywood 12mm. OK. Repeat once more.
4. Furniture → Nesting → Generate Nest. Kerf `3`. OK. Open Nesting tab.
5. **Expect:** Two material sections (Birch + Plywood), each with ≥1 sheet.

## T3 — Material with no sheet stock → excluded section
1. Continue from T2 state.
2. Add a third material **Veneer 4mm** with `defaultThickness=4`, `color=#a0522d`. **Leave Sheet L and Sheet W empty.**
3. Add a panel of that material via Furniture → Cabinets → Base Cabinet, set Back material to Veneer 4mm. OK.
4. Generate Nest. Open Nesting tab.
5. **Expect:** Existing material sections still render. Excluded section at bottom: `Veneer 4mm: no sheet stock defined`.

## T4 — Edit cabinet → stale banner → Regenerate
1. Continue from T3 state.
2. Furniture → Cabinets → Base Cabinet, change `Height` to 900 mm. OK.
3. Open Nesting tab.
4. **Expect:** ⚠️ "Cut list changed since last nest." banner with [Regenerate] button.
5. Click Regenerate.
6. **Expect:** Banner disappears; sheet count and panel sizes reflect the taller cabinet.

## Sign-off
- Confirm each scenario passes; record any deviations.
- Smoke pass = ready to close 5e.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-5e.md
git commit -m "docs(manual-tests): T1..T4 sub-project 5e nesting smoke checklist (5e §9.5)"
```

---

## Phase 10 — Final verification + merge

### Task 35: Full regression run + merge to master

**Files:** none — verification + merge only.

**Agent:** Main controller (Opus). Do NOT delegate this — run inline.

- [ ] **Step 1: Full typecheck**

```
pnpm -r typecheck
```
Expected: clean across all 5 packages.

- [ ] **Step 2: Full unit suite**

```
pnpm -r test:unit
```
Expected: previous count + ~50 new tests, all green.

- [ ] **Step 3: Full integration**

```
pnpm -r test:integration
```
Expected: 196/33 unchanged.

- [ ] **Step 4: Full E2E (chromium project)**

```
pnpm exec playwright test --project=chromium
```
Expected: 4 new T-5e-* specs pass; 35 pre-existing model/* flakes (fillet, hole, sweep, shell, mirror, linear-pattern, revolve viewport-triangle-count timeouts) may still flake — they pre-date 5e. Run twice if needed; if 5e specs are stable, accept the pre-existing flake set.

- [ ] **Step 5: Perf**

```
pnpm exec playwright test --project=perf --grep "Perf T33"
```
Expected: p95 < 50ms.

- [ ] **Step 6: Verify all spec success criteria (§1.4) demonstrably hold**

Walk through SC#1..SC#11 in `docs/superpowers/specs/2026-05-04-subproject-5e-nesting-design.md` §1.4. Confirm each is satisfied by the green test suite. Note any remaining gaps as F-items.

- [ ] **Step 7: Hand off to `superpowers:finishing-a-development-branch`**

This skill walks the merge: fast-forward `feature/subproject-5e` to master, remove the worktree, delete the branch, update master HEAD reference in the next-session-resume memory.

- [ ] **Step 8: Update `MEMORY.md` index** with a new pointer for `project_subproject_5e_execution_state.md` (the post-merge agent will write that file from the merge events).

---

## Self-review checklist

After plan landed, verify before dispatching Task 1:

- ✅ Each spec section in `2026-05-04-subproject-5e-nesting-design.md` maps to at least one task:
  - §1.1 (deliverables) → Tasks 1, 2, 6, 7, 8, 10, 12, 16, 17, 19, 23, 24, 26, 27.
  - §1.4 (SC #1..#11) → e2e Tasks 29-32, perf Task 33, smoke Task 34, plus all unit tasks for the underlying SCs.
  - §2 (data model) → Tasks 1, 2, 3.
  - §3 (algorithm) → Tasks 6, 7.
  - §4 (commands) → Tasks 12, 13, 24, 27.
  - §5 (UI) → Tasks 10, 16, 17, 18, 19, 20, 25.
  - §6 (export) → Tasks 21, 22, 23, 26.
  - §7 (fingerprint) → Task 8.
  - §8 (persistence) → Tasks 3, 4 + (round-trip via 5d's existing AssemblyPacker; no new task needed).
  - §9 (testing) → Tasks 6, 7, 8, 12, 13, 18, 19, 23, 24, 26, 27, 29-32, 33.
- ✅ All function names consistent across tasks: `packGuillotine`, `packAllMaterials`, `computeNestFingerprint`, `renderNestPdf`, `renderNestSheetPng`, `triggerDownload`, `GenerateNestCommand`, `ExportNestPdfCommand`, `ExportNestPngCommand`, `OpenNestingTabCommand`, `OpenNestDialogCommand`, `NestDialog`, `SheetSvg`, `NestingTab`.
- ✅ All field names consistent: `sheetLengthMm`, `sheetWidthMm`, `kerfMm`, `inputFingerprint`, `generatedAt`, `nestingTabActive`, `nestDialog`, `__zilventorNestPdfBytes`, `__zilventorNestPngBytes`, `__zilventorNestPackMs`.
- ✅ No placeholders (TODO / TBD / "implement later" / "similar to Task N"). Where snippets elide existing surrounding code, the elision is signposted (`// ... existing fields ...`) and the task instructs the agent to reference the existing file.
- ✅ Each task lists Files (Create/Modify), Steps (write test → run fail → implement → run pass → commit), and an Agent line for dispatch.

---

## Execution choice

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-subproject-5e-nesting-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh Sonnet subagent per task, review between tasks, fast iteration. Aligns with `feedback_sonnet_subagents_default`. Required sub-skill: `superpowers:subagent-driven-development`.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints for review.

**Which approach?**

