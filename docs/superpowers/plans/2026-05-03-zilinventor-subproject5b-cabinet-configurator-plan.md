# Sub-project 5b — Cabinet Configurator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parametric **Base Cabinet** template + ribbon button + modal dialog + atomic create-and-place command to ZilInventor's Furniture tab. Clicking Furniture → Cabinets → Base Cabinet → OK writes one `.ziasm` plus one `.zipt` per panel role (left/right side, top, bottom, back, toekick, 1..N shelves) to OPFS and drops the `.ziasm` into the active assembly. The 5d cut-list aggregator and 4c BOM aggregator pick up the panels with no changes. v1 is a one-shot generator: the recipe is not persisted, so re-edit is not supported (deferred to a future `5b-edit` sub-project).

**Architecture:** A new pure builder `buildBaseCabinet(params, registry): CabinetBuildOutput` in `packages/shared/src/cabinets/` produces a deterministic, ordered list of `PanelFeature` definitions plus their per-component positions in cabinet-local coordinates (back-left-bottom-floor corner = origin; +X width, +Y depth, +Z height). A new atomic `CreateCabinetCommand` in `packages/app/src/commands/` consumes that output, writes each panel as a fresh 5a-shape `.zipt`, packs the layout as a 5d-shape `.ziasm`, and delegates to the existing `PlaceComponentCommand` for the in-assembly drop. A new `CabinetDialog.tsx` (modeled on `PanelDialog.tsx`) gathers parameters with inline validation. `FurnitureTab.tsx` gains a third `RibbonPanel` (Cabinets) with a single **Base Cabinet** button. No kernel changes; no manifest version bump (still v11).

**Tech Stack:** TypeScript / pnpm workspace; React + Zustand UI (existing dialog-state pattern in `useAppStore.PanelDialogState`); OPFS via `@zilventor/kernel/src/storage/Opfs` + `tarGzipUtil` (existing); Vitest unit/integration; Playwright e2e + perf. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-05-03-subproject-5b-cabinet-configurator-design.md` (committed at `a8e0ac0`)

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Shared types and pure builder (TDD)

### Task 1: Create `packages/shared/src/cabinets/types.ts`

**Files:**
- Create: `packages/shared/src/cabinets/types.ts`

- [ ] **Step 1: Write the type module**

```ts
import type { PanelFeature } from '../panel-feature';
import type { MaterialEntry, MaterialId } from '../material';

export type PanelRole =
  | 'leftSide'
  | 'rightSide'
  | 'bottom'
  | 'top'
  | 'back'
  | 'toekick'
  | 'shelf';

export interface BaseCabinetParams {
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly toekickHeight: number;
  readonly toekickSetback: number;
  readonly shelfCount: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}

export interface CabinetPanelDef {
  readonly role: PanelRole;
  readonly shelfIndex?: number;
  readonly fileNameSuffix: string;
  readonly panel: PanelFeature;
}

export interface CabinetComponentDef {
  readonly fileNameSuffix: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: { readonly rx: number; readonly ry: number; readonly rz: number };
}

export interface CabinetBuildOutput {
  readonly panels: ReadonlyArray<CabinetPanelDef>;
  readonly layout: ReadonlyArray<CabinetComponentDef>;
}

export type CabinetTemplateErrorKind =
  | 'nameEmpty'
  | 'widthTooSmall'
  | 'depthTooSmall'
  | 'heightTooSmall'
  | 'toekickHeightTooLarge'
  | 'toekickSetbackTooLarge'
  | 'shelfCountTooLarge'
  | 'carcassMaterialMissing'
  | 'backMaterialMissing';

export interface CabinetTemplateErrorDetails {
  readonly kind: CabinetTemplateErrorKind;
  readonly maxShelves?: number;
  readonly minDimension?: number;
}

export class CabinetTemplateError extends Error {
  readonly kind: CabinetTemplateErrorKind;
  readonly details: CabinetTemplateErrorDetails;
  constructor(details: CabinetTemplateErrorDetails) {
    super(`CabinetTemplateError: ${details.kind}`);
    this.name = 'CabinetTemplateError';
    this.kind = details.kind;
    this.details = details;
  }
}

export interface ResolvedCabinetMaterials {
  readonly carcass: MaterialEntry;
  readonly back: MaterialEntry;
  readonly band: MaterialEntry | null;
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @zilventor/shared typecheck`. Expected: `Done` for `@zilventor/shared`.

- [ ] **Step 3: Commit with message**

`feat(shared): cabinet template types for sub-project 5b` — body explains "BaseCabinetParams + CabinetBuildOutput + CabinetTemplateError taxonomy; runtime impl lands in T2..T8". Footer required.

---

### Task 2: First failing test — default params produce 7 panels

**Files:**
- Create: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`
- Create: `packages/shared/src/cabinets/baseCabinet.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBaseCabinet } from '../baseCabinet';
import type { BaseCabinetParams } from '../types';

const carcass: MaterialEntry = {
  id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896',
};
const back: MaterialEntry = {
  id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47',
};

const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

const DEFAULT_PARAMS: BaseCabinetParams = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

describe('buildBaseCabinet — default params', () => {
  it('emits 7 panels in deterministic role order', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    expect(out.panels.map((p) => p.role)).toEqual([
      'leftSide', 'rightSide', 'bottom', 'top', 'back', 'toekick', 'shelf',
    ]);
    expect(out.panels).toHaveLength(7);
    expect(out.layout).toHaveLength(7);
  });

  it('emits a layout entry per panel with matching fileNameSuffix', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const panelSuffixes = out.panels.map((p) => p.fileNameSuffix);
    const layoutSuffixes = out.layout.map((c) => c.fileNameSuffix);
    expect(layoutSuffixes).toEqual(panelSuffixes);
  });
});
```

- [ ] **Step 2: Create the stub `baseCabinet.ts`** so imports resolve but tests fail:

```ts
import type { MaterialEntry } from '../material';
import type { BaseCabinetParams, CabinetBuildOutput } from './types';

export function buildBaseCabinet(
  _params: BaseCabinetParams,
  _registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  return { panels: [], layout: [] };
}
```

- [ ] **Step 3: Run the failing tests**

Run: `pnpm --filter @zilventor/shared test -- baseCabinet.spec`. Expected: 2 FAIL — `Expected 7, received 0`.

- [ ] **Step 4: Implement the full default-params build**

Replace `packages/shared/src/cabinets/baseCabinet.ts` with the full skeleton — handles every role using the §2.2 orientation table:

```ts
import type { MaterialEntry, MaterialId } from '../material';
import type { GrainDirection, PanelFeature } from '../panel-feature';
import type {
  BaseCabinetParams,
  CabinetBuildOutput,
  CabinetComponentDef,
  CabinetPanelDef,
  PanelRole,
  ResolvedCabinetMaterials,
} from './types';
import { CabinetTemplateError } from './types';

const SHELF_DEPTH_SHRINK_MM = 20;

export function buildBaseCabinet(
  params: BaseCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const materials = resolveMaterials(params, registry);
  validate(params, materials);

  const Tc = materials.carcass.defaultThickness;
  const Tb = materials.back.defaultThickness;
  const { width: W, depth: D, height: H, toekickHeight: tkH, toekickSetback: tkS } = params;

  const panels: CabinetPanelDef[] = [];
  const layout: CabinetComponentDef[] = [];

  pushPanel(panels, layout, {
    role: 'leftSide', fileNameSuffix: 'Left Side',
    length: H, width: D, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('leftSide', params.bandMaterialId),
    position: { x: 0, y: 0, z: 0 },
  });

  pushPanel(panels, layout, {
    role: 'rightSide', fileNameSuffix: 'Right Side',
    length: H, width: D, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('rightSide', params.bandMaterialId),
    position: { x: W - Tc, y: 0, z: 0 },
  });

  pushPanel(panels, layout, {
    role: 'bottom', fileNameSuffix: 'Bottom',
    length: W - 2 * Tc, width: D - Tb, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('bottom', params.bandMaterialId),
    position: { x: Tc, y: Tb, z: tkH },
  });

  pushPanel(panels, layout, {
    role: 'top', fileNameSuffix: 'Top',
    length: W - 2 * Tc, width: D - Tb, thickness: Tc,
    materialId: materials.carcass.id, grain: 'length',
    bands: bandsForRole('top', params.bandMaterialId),
    position: { x: Tc, y: Tb, z: H - Tc },
  });

  pushPanel(panels, layout, {
    role: 'back', fileNameSuffix: 'Back',
    length: W, width: H, thickness: Tb,
    materialId: materials.back.id, grain: 'length',
    bands: bandsForRole('back', params.bandMaterialId),
    position: { x: 0, y: 0, z: 0 },
  });

  if (tkH > 0) {
    pushPanel(panels, layout, {
      role: 'toekick', fileNameSuffix: 'Toekick',
      length: W - 2 * Tc, width: tkH, thickness: Tc,
      materialId: materials.carcass.id, grain: 'length',
      bands: bandsForRole('toekick', params.bandMaterialId),
      position: { x: Tc, y: D - tkS - Tc, z: 0 },
    });
  }

  if (params.shelfCount > 0) {
    const innerBottom = tkH + Tc;
    const innerTop = H - Tc;
    const span = innerTop - innerBottom;
    const step = span / (params.shelfCount + 1);
    for (let i = 1; i <= params.shelfCount; i++) {
      const z = innerBottom + i * step;
      pushPanel(panels, layout, {
        role: 'shelf', shelfIndex: i, fileNameSuffix: `Shelf ${i}`,
        length: W - 2 * Tc, width: D - Tb - SHELF_DEPTH_SHRINK_MM, thickness: Tc,
        materialId: materials.carcass.id, grain: 'length',
        bands: bandsForRole('shelf', params.bandMaterialId),
        position: { x: Tc, y: Tb, z },
      });
    }
  }

  return { panels, layout };
}

interface PushArgs {
  role: PanelRole;
  shelfIndex?: number;
  fileNameSuffix: string;
  length: number;
  width: number;
  thickness: number;
  materialId: MaterialId;
  grain: GrainDirection;
  bands: PanelFeature['edgeBands'];
  position: { x: number; y: number; z: number };
}

function pushPanel(
  panels: CabinetPanelDef[],
  layout: CabinetComponentDef[],
  args: PushArgs,
): void {
  const panel: PanelFeature = {
    kind: 'panel',
    id: `pf-${args.role}${args.shelfIndex ? `-${args.shelfIndex}` : ''}`,
    length: { kind: 'literal', value: args.length },
    width: { kind: 'literal', value: args.width },
    thickness: { kind: 'literal', value: args.thickness },
    thicknessFromMaterial: true,
    materialId: args.materialId,
    grain: args.grain,
    edgeBands: args.bands,
  };
  panels.push({
    role: args.role,
    ...(args.shelfIndex !== undefined ? { shelfIndex: args.shelfIndex } : {}),
    fileNameSuffix: args.fileNameSuffix,
    panel,
  });
  layout.push({
    fileNameSuffix: args.fileNameSuffix,
    position: args.position,
    rotation: { rx: 0, ry: 0, rz: 0 },
  });
}

function bandsForRole(role: PanelRole, bandId: MaterialId | null): PanelFeature['edgeBands'] {
  const empty = { front: null, back: null, left: null, right: null } as const;
  if (bandId === null) return empty;
  if (role === 'leftSide' || role === 'rightSide' || role === 'bottom' || role === 'top' || role === 'shelf') {
    return { front: { materialId: bandId }, back: null, left: null, right: null };
  }
  return empty;
}

function resolveMaterials(
  params: BaseCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): ResolvedCabinetMaterials {
  const carcass = registry.find((m) => m.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const back = registry.find((m) => m.id === params.backMaterialId);
  if (!back) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });
  const band = params.bandMaterialId === null
    ? null
    : registry.find((m) => m.id === params.bandMaterialId) ?? null;
  return { carcass, back, band };
}

function validate(params: BaseCabinetParams, materials: ResolvedCabinetMaterials): void {
  const Tc = materials.carcass.defaultThickness;
  if (params.name.trim() === '') throw new CabinetTemplateError({ kind: 'nameEmpty' });
  if (params.width <= 2 * Tc) throw new CabinetTemplateError({ kind: 'widthTooSmall', minDimension: 2 * Tc });
  if (params.depth <= 2 * Tc) throw new CabinetTemplateError({ kind: 'depthTooSmall', minDimension: 2 * Tc });
  if (params.height <= 2 * Tc + params.toekickHeight) throw new CabinetTemplateError({ kind: 'heightTooSmall' });
  if (params.toekickHeight >= params.height / 2) throw new CabinetTemplateError({ kind: 'toekickHeightTooLarge' });
  if (params.toekickSetback >= params.depth - Tc) throw new CabinetTemplateError({ kind: 'toekickSetbackTooLarge' });
  const innerH = params.height - params.toekickHeight - 2 * Tc;
  const maxShelves = Math.max(0, Math.floor(innerH / 100));
  if (params.shelfCount > maxShelves) {
    throw new CabinetTemplateError({ kind: 'shelfCountTooLarge', maxShelves });
  }
}
```

- [ ] **Step 5: Run the test — should pass now**

Run: `pnpm --filter @zilventor/shared test -- baseCabinet.spec`. Expected: 2 PASS.

- [ ] **Step 6: Commit**

`feat(shared): buildBaseCabinet default-params skeleton` — body: "7-panel deterministic output for default base-cabinet params (W=600 D=560 H=720 toekick=100/50 1 shelf). Subsequent tasks add tests for variable shelfCount, toekick=0, validation paths, edge bands, and grain." Footer required.

---

### Task 3: Pin side / top-bottom / back / toekick positions

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing geometry tests**

```ts
describe('buildBaseCabinet — geometry (defaults)', () => {
  it('places left side at X=0, right side at X = W − Tc', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const left = out.layout.find((c) => c.fileNameSuffix === 'Left Side')!;
    const right = out.layout.find((c) => c.fileNameSuffix === 'Right Side')!;
    expect(left.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(right.position).toEqual({ x: 600 - 18, y: 0, z: 0 });
  });

  it('places bottom at Z = toekickHeight, inset by Tc on X and Tb on Y', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const bottom = out.layout.find((c) => c.fileNameSuffix === 'Bottom')!;
    expect(bottom.position).toEqual({ x: 18, y: 6, z: 100 });
  });

  it('places top at Z = H − Tc', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const top = out.layout.find((c) => c.fileNameSuffix === 'Top')!;
    expect(top.position).toEqual({ x: 18, y: 6, z: 720 - 18 });
  });

  it('places back flush against back wall (Y=0) at full W × H × Tb', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const back = out.layout.find((c) => c.fileNameSuffix === 'Back')!;
    expect(back.position).toEqual({ x: 0, y: 0, z: 0 });
    const backPanel = out.panels.find((p) => p.role === 'back')!;
    expect(backPanel.panel.thickness).toEqual({ kind: 'literal', value: 6 });
    expect(backPanel.panel.length).toEqual({ kind: 'literal', value: 600 });
    expect(backPanel.panel.width).toEqual({ kind: 'literal', value: 720 });
  });

  it('places toekick at Y = D − setback − Tc, Z = 0', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const tk = out.layout.find((c) => c.fileNameSuffix === 'Toekick')!;
    expect(tk.position).toEqual({ x: 18, y: 560 - 50 - 18, z: 0 });
    const tkPanel = out.panels.find((p) => p.role === 'toekick')!;
    expect(tkPanel.panel.length).toEqual({ kind: 'literal', value: 600 - 36 });
    expect(tkPanel.panel.width).toEqual({ kind: 'literal', value: 100 });
    expect(tkPanel.panel.thickness).toEqual({ kind: 'literal', value: 18 });
  });
});
```

- [ ] **Step 2: Run the tests** (T2's full impl already covers these)

Run: `pnpm --filter @zilventor/shared test -- baseCabinet.spec`. Expected: PASS.

- [ ] **Step 3: Commit**

`test(shared): pin geometry positions for buildBaseCabinet defaults` — body: "Locks side/top-bottom/back/toekick positions and dimensions against the spec §2.2 orientation table." Footer required.

---

### Task 4: Variable shelfCount + even spacing + depth-shrink

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('buildBaseCabinet — shelves', () => {
  it('shelfCount=0 emits no shelf panel', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 0 }, REGISTRY);
    expect(out.panels.filter((p) => p.role === 'shelf')).toHaveLength(0);
    expect(out.panels).toHaveLength(6);
  });

  it('shelfCount=3 emits 3 evenly-spaced shelves between bottom and top', () => {
    const params = { ...DEFAULT_PARAMS, shelfCount: 3 };
    const out = buildBaseCabinet(params, REGISTRY);
    const shelves = out.panels.filter((p) => p.role === 'shelf');
    expect(shelves).toHaveLength(3);
    expect(shelves.map((s) => s.shelfIndex)).toEqual([1, 2, 3]);
    // Inner span: H − tkH − 2·Tc = 720 − 100 − 36 = 584; step = 584/4 = 146.
    // Z values (measured from inner bottom = tkH + Tc = 118):
    // 118 + 146 = 264, 410, 556.
    const layout = out.layout.filter((c) => c.fileNameSuffix.startsWith('Shelf '));
    expect(layout.map((c) => c.position.z)).toEqual([264, 410, 556]);
  });

  it('shelf width is shrunk by SHELF_DEPTH_SHRINK_MM (20mm) for finger clearance', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    const shelf = out.panels.find((p) => p.role === 'shelf')!;
    // Bottom width is D − Tb = 560 − 6 = 554; shelf is 554 − 20 = 534.
    expect(shelf.panel.width).toEqual({ kind: 'literal', value: 534 });
  });

  it('shelf fileNameSuffix is "Shelf N" with 1-based index', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 2 }, REGISTRY);
    const shelves = out.panels.filter((p) => p.role === 'shelf');
    expect(shelves.map((s) => s.fileNameSuffix)).toEqual(['Shelf 1', 'Shelf 2']);
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(shared): shelf count, spacing, and depth-shrink for buildBaseCabinet` — body: "Pins the §2.2 z_i = tkH + Tc + i·((H−tkH−2·Tc)/(N+1)) formula plus the 20mm finger-clearance shrink." Footer required.

---

### Task 5: `toekickHeight=0` edge case

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('buildBaseCabinet — toekick disabled (toekickHeight=0)', () => {
  it('emits no toekick panel and bottom sits at Z=0', () => {
    const out = buildBaseCabinet({ ...DEFAULT_PARAMS, toekickHeight: 0 }, REGISTRY);
    expect(out.panels.filter((p) => p.role === 'toekick')).toHaveLength(0);
    const bottom = out.layout.find((c) => c.fileNameSuffix === 'Bottom')!;
    expect(bottom.position.z).toBe(0);
  });

  it('shelves redistribute over the larger inner span when toekick=0', () => {
    const params = { ...DEFAULT_PARAMS, toekickHeight: 0, shelfCount: 1 };
    const out = buildBaseCabinet(params, REGISTRY);
    const shelf = out.layout.find((c) => c.fileNameSuffix === 'Shelf 1')!;
    // Inner span = 720 − 0 − 36 = 684; step = 684/2 = 342; z = 18 + 342 = 360.
    expect(shelf.position.z).toBe(360);
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS (T2's `if (tkH > 0)` guard already handles this).

- [ ] **Step 3: Commit**

`test(shared): buildBaseCabinet toekickHeight=0 path` — body: "Pins the no-toekick variant: 6 panels, bottom at Z=0, shelves redistribute over the larger inner span." Footer required.

---

### Task 6: Validation rejection paths

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
import { CabinetTemplateError } from '../types';

describe('buildBaseCabinet — validation', () => {
  function expectError(params: Partial<BaseCabinetParams>, kind: string): void {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, ...params }, REGISTRY))
      .toThrow(expect.objectContaining({ name: 'CabinetTemplateError', kind }));
  }

  it('rejects empty name', () => expectError({ name: '   ' }, 'nameEmpty'));
  it('rejects width ≤ 2·Tc', () => expectError({ width: 36 }, 'widthTooSmall'));
  it('rejects depth ≤ 2·Tc', () => expectError({ depth: 36 }, 'depthTooSmall'));
  it('rejects height ≤ 2·Tc + toekick', () => expectError({ height: 100 }, 'heightTooSmall'));
  it('rejects toekickHeight ≥ H/2', () => expectError({ toekickHeight: 360 }, 'toekickHeightTooLarge'));
  it('rejects toekickSetback ≥ depth − Tc', () => expectError({ toekickSetback: 600 }, 'toekickSetbackTooLarge'));

  it('rejects shelfCount > maxShelves with details.maxShelves populated', () => {
    // Inner H = 720 − 100 − 36 = 584; max = floor(584/100) = 5.
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 99 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'shelfCountTooLarge' }));
    try { buildBaseCabinet({ ...DEFAULT_PARAMS, shelfCount: 99 }, REGISTRY); }
    catch (e) {
      expect(e).toBeInstanceOf(CabinetTemplateError);
      expect((e as CabinetTemplateError).details.maxShelves).toBe(5);
    }
  });

  it('rejects missing carcass material', () => {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });

  it('rejects missing back material', () => {
    expect(() => buildBaseCabinet({ ...DEFAULT_PARAMS, backMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'backMaterialMissing' }));
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS (T2's `validate()` already covers these).

- [ ] **Step 3: Commit**

`test(shared): pin validation taxonomy for buildBaseCabinet` — body: "9 rejection paths from spec §5.1 — every CabinetTemplateError.kind asserted to fire on the right input." Footer required.

---

### Task 7: Edge-band template encoding

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('buildBaseCabinet — edge bands', () => {
  it('with bandMaterialId=null, every panel has all four edge slots null', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    for (const p of out.panels) {
      expect(p.panel.edgeBands).toEqual({ front: null, back: null, left: null, right: null });
    }
  });

  it('with bandMaterialId set, only sides/top/bottom/shelves carry a Front band', () => {
    const params = { ...DEFAULT_PARAMS, bandMaterialId: 'm-pvc-white' };
    const REG_WITH_BAND = [
      ...REGISTRY,
      { id: 'm-pvc-white', name: 'PVC 1mm white', defaultThickness: 1, color: '#fff' },
    ];
    const out = buildBaseCabinet(params, REG_WITH_BAND);
    const banded = ['leftSide', 'rightSide', 'bottom', 'top', 'shelf'];
    for (const p of out.panels) {
      const fr = p.panel.edgeBands.front;
      if (banded.includes(p.role)) {
        expect(fr).toEqual({ materialId: 'm-pvc-white' });
      } else {
        expect(fr).toBeNull();
      }
      expect(p.panel.edgeBands.back).toBeNull();
      expect(p.panel.edgeBands.left).toBeNull();
      expect(p.panel.edgeBands.right).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(shared): pin edge-band template encoding for buildBaseCabinet` — body: "bandMaterialId=null → all slots null; bandMaterialId set → front of sides/top/bottom/shelf, nothing else." Footer required.

---

### Task 8: Grain encoding per role

**Files:**
- Modify: `packages/shared/src/cabinets/__tests__/baseCabinet.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('buildBaseCabinet — grain', () => {
  it('every role uses grain="length" by default', () => {
    const out = buildBaseCabinet(DEFAULT_PARAMS, REGISTRY);
    for (const p of out.panels) {
      expect(p.panel.grain).toBe('length');
    }
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(shared): pin grain="length" for every role in buildBaseCabinet` — body: "The aggregator handles material-grain='none' separately; template hint is consistent." Footer required.

---

### Task 9: Shared barrel re-exports

**Files:**
- Create: `packages/shared/src/cabinets/index.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create the cabinets barrel**

`packages/shared/src/cabinets/index.ts`:

```ts
export * from './types';
export * from './baseCabinet';
```

- [ ] **Step 2: Re-export from the package root**

In `packages/shared/src/index.ts` add below the existing exports:

```ts
export * from './cabinets';
```

- [ ] **Step 3: Run typecheck across the workspace**

Run: `pnpm -r typecheck`. Expected: all 5 packages `Done`.

- [ ] **Step 4: Commit**

`feat(shared): barrel-export cabinets module from package root` — body: "Lets app/kernel imports use { buildBaseCabinet, BaseCabinetParams, CabinetTemplateError, ... } from '@zilventor/shared'." Footer required.

---

## Phase 2 — Command layer

### Task 10: `CabinetDialogState` slot in store + `OpenCabinetDialogCommand`

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Create: `packages/app/src/commands/OpenCabinetDialogCommand.ts`

- [ ] **Step 1: Add the dialog-state slot to the store**

In `packages/app/src/store/useAppStore.ts`, below the existing `PanelDialogState` (around line 63) add:

```ts
export type CabinetDialogState = {
  template: 'baseCabinet';
  initial?: import('@zilventor/shared').BaseCabinetParams;
  onSubmit: (params: import('@zilventor/shared').BaseCabinetParams) => void;
  onCancel: () => void;
};
```

In the `AppState` type (around line 224) add the field next to `panelDialog`:

```ts
  cabinetDialog: CabinetDialogState | null;
  setCabinetDialog(s: CabinetDialogState | null): void;
```

In the store factory (around line 609) add the defaults next to `panelDialog`:

```ts
  cabinetDialog: null,
  setCabinetDialog: (s) => set({ cabinetDialog: s }),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @zilventor/app typecheck`. Expected: `Done`.

- [ ] **Step 3: Create `OpenCabinetDialogCommand.ts`**

```ts
import type { BaseCabinetParams } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore, type CabinetDialogState } from '../store/useAppStore';

export type OpenCabinetDialogOpts = {
  template: 'baseCabinet';
  initial?: BaseCabinetParams;
  onSubmit: (params: BaseCabinetParams) => void;
  onCancel?: () => void;
};

export class OpenCabinetDialogCommand implements Command {
  readonly name = 'OpenCabinetDialog';
  constructor(private readonly opts: OpenCabinetDialogOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    if (!state.activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: CabinetDialogState = {
      template: this.opts.template,
      ...(this.opts.initial ? { initial: this.opts.initial } : {}),
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setCabinetDialog(null)),
    };
    useAppStore.getState().setCabinetDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
```

- [ ] **Step 4: Run typecheck** — Expected: `Done`.

- [ ] **Step 5: Commit**

`feat(app): CabinetDialogState slot + OpenCabinetDialogCommand` — body: "Mirrors the PanelDialog open-flow shape. Assembly-only; throws NO_ACTIVE_ASSEMBLY when no assembly is active." Footer required.

---

### Task 11: `CreateCabinetCommand` — name auto-suffix collision avoidance

**Files:**
- Create: `packages/app/src/commands/CreateCabinetCommand.ts`
- Create: `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CreateCabinetCommand } from '../CreateCabinetCommand';
import type { OpfsLike } from '../../assembly/SubAssemblyCache';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry } from '@zilventor/shared';

class MemOpfs implements OpfsLike {
  files = new Map<string, Uint8Array>();
  async exists(p: string) { return this.files.has(p); }
  async read(p: string) { const b = this.files.get(p); if (!b) throw new Error(`no ${p}`); return b; }
  async write(p: string, b: Uint8Array) { this.files.set(p, b); }
  async delete(p: string) { this.files.delete(p); }
  async list(): Promise<string[]> { return Array.from(this.files.keys()); }
}

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAssembly(name = 'Project'): AssemblyDocument {
  const doc: AssemblyDocument = {
    id: 'A1', name, units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [],
    groundedComponentPaths: [], colors: {},
    bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials: [carcass, back],
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  return doc;
}

const DEFAULTS = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
} as const;

describe('CreateCabinetCommand — name auto-suffix', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes the cabinet at the requested name when nothing collides', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = await opfs.list();
    expect(paths).toContain('Base Cabinet 1.ziasm');
    expect(paths).toContain('Base Cabinet 1 - Left Side.zipt');
  });

  it('auto-suffixes to "Base Cabinet 2" when "Base Cabinet 1.ziasm" exists', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await opfs.write('Base Cabinet 1.ziasm', new Uint8Array([1]));
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = await opfs.list();
    expect(paths).toContain('Base Cabinet 2.ziasm');
    expect(paths).toContain('Base Cabinet 2 - Left Side.zipt');
    expect(await opfs.read('Base Cabinet 1.ziasm')).toEqual(new Uint8Array([1]));
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL `Cannot find module '../CreateCabinetCommand'`.

Run: `pnpm --filter @zilventor/app test -- CreateCabinetCommand.spec`.

- [ ] **Step 3: Implement the command**

`packages/app/src/commands/CreateCabinetCommand.ts`:

```ts
import type {
  AssemblyDocument,
  BaseCabinetParams,
  CabinetBuildOutput,
  ComponentInstance,
  PanelFeature,
  PartDocument,
} from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION, buildBaseCabinet } from '@zilventor/shared';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { packAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { Command } from './Command';
import type { OpfsLike } from '../assembly/SubAssemblyCache';
import { useAppStore } from '../store/useAppStore';
import { PlaceComponentCommand } from './PlaceComponentCommand';

interface OpfsWriteDeleteCapable {
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete?(path: string): Promise<void>;
}

export type CreateCabinetOpts = {
  template: 'baseCabinet';
  params: BaseCabinetParams;
  opfs: OpfsLike & OpfsWriteDeleteCapable;
};

const SUFFIX_LIMIT = 999;

export class CreateCabinetCommand implements Command {
  readonly name = 'CreateCabinet';
  private writtenFiles: string[] = [];
  private placeCommand: PlaceComponentCommand | null = null;
  private resolvedName: string | null = null;

  constructor(private readonly opts: CreateCabinetOpts) {}

  async apply(): Promise<void> {
    const state = useAppStore.getState();
    const asm = state.activeAssembly;
    if (!asm) throw new Error('NO_ACTIVE_ASSEMBLY');

    const finalName = await this.resolveCollisionFreeName(this.opts.params.name);
    this.resolvedName = finalName;
    const params = { ...this.opts.params, name: finalName };

    const built = buildBaseCabinet(params, asm.materials);

    try {
      for (const p of built.panels) {
        const path = `${finalName} - ${p.fileNameSuffix}.zipt`;
        const bytes = await this.packPanelPart(p.panel, p.fileNameSuffix, asm);
        await this.opts.opfs.write(path, bytes);
        this.writtenFiles.push(path);
      }

      const ziasmPath = `${finalName}.ziasm`;
      const cabinetDoc = this.buildCabinetAssembly(finalName, built, asm);
      const ziasmBytes = await packAssembly(cabinetDoc, new Uint8Array());
      await this.opts.opfs.write(ziasmPath, ziasmBytes);
      this.writtenFiles.push(ziasmPath);

      this.placeCommand = new PlaceComponentCommand({ partPath: ziasmPath, opfs: this.opts.opfs });
      await this.placeCommand.apply();
    } catch (err) {
      await this.deleteWrittenFiles();
      throw err;
    }
  }

  async revert(): Promise<void> {
    if (this.placeCommand) {
      await this.placeCommand.revert();
      this.placeCommand = null;
    }
    await this.deleteWrittenFiles();
  }

  private async deleteWrittenFiles(): Promise<void> {
    if (typeof this.opts.opfs.delete !== 'function') return;
    for (const p of [...this.writtenFiles].reverse()) {
      try { await this.opts.opfs.delete(p); } catch { /* best-effort */ }
    }
    this.writtenFiles = [];
  }

  private async resolveCollisionFreeName(base: string): Promise<string> {
    const trimmed = base.trim();
    if (!(await this.opts.opfs.exists(`${trimmed}.ziasm`))) return trimmed;
    const match = /^(.*?)(?:\s+(\d+))?$/.exec(trimmed);
    const stem = match?.[1] ?? trimmed;
    const startN = match?.[2] ? Number(match[2]) + 1 : 2;
    for (let n = startN; n <= SUFFIX_LIMIT; n++) {
      const candidate = `${stem} ${n}`;
      if (!(await this.opts.opfs.exists(`${candidate}.ziasm`))) return candidate;
    }
    return `${stem} ${Date.now()}`;
  }

  private async packPanelPart(
    panel: PanelFeature,
    nameSuffix: string,
    asm: AssemblyDocument,
  ): Promise<Uint8Array> {
    const basePart = newPart(`${this.resolvedName} - ${nameSuffix}`);
    const partWithMaterials: PartDocument = {
      ...basePart,
      materials: [...asm.materials],
    };
    const partWithPanel = addFeature(partWithMaterials, panel);
    const manifest = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: partWithPanel,
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }

  private buildCabinetAssembly(
    cabinetName: string,
    built: CabinetBuildOutput,
    asm: AssemblyDocument,
  ): AssemblyDocument {
    const components: ComponentInstance[] = built.layout.map((c, i) => ({
      id: `C${i + 1}`,
      partPath: `${cabinetName} - ${c.fileNameSuffix}.zipt`,
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      rotation: { rx: c.rotation.rx, ry: c.rotation.ry, rz: c.rotation.rz },
      visible: true,
    }));
    return {
      id: `A${Date.now()}`,
      name: cabinetName,
      units: 'mm',
      parameters: {},
      properties: {},
      components,
      constraints: [],
      groundedComponentPaths: components.length > 0 ? [components[0].id] : [],
      colors: {},
      bomItemNumbers: {},
      cutListItemNumbers: {},
      colorOverrides: {},
      materials: [...asm.materials],
    };
  }
}
```

- [ ] **Step 4: Run the tests** — Expected: 2 PASS.

- [ ] **Step 5: Commit**

`feat(app): CreateCabinetCommand atomic write+place` — body: "Pure orchestrator: buildBaseCabinet → write 7 .zipts + 1 .ziasm to OPFS → PlaceComponentCommand into active assembly. Auto-suffixes the cabinet name on collision. Inner rollback deletes anything written before a mid-flight failure." Footer required.

---

### Task 12: Happy-path file inventory + place

**Files:**
- Modify: `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`

- [ ] **Step 1: Append the failing tests**

```ts
describe('CreateCabinetCommand — happy path', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('writes 1 .ziasm + 7 .zipt files for default params (1 shelf)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const paths = (await opfs.list()).sort();
    expect(paths).toEqual([
      'Base Cabinet 1 - Back.zipt',
      'Base Cabinet 1 - Bottom.zipt',
      'Base Cabinet 1 - Left Side.zipt',
      'Base Cabinet 1 - Right Side.zipt',
      'Base Cabinet 1 - Shelf 1.zipt',
      'Base Cabinet 1 - Toekick.zipt',
      'Base Cabinet 1 - Top.zipt',
      'Base Cabinet 1.ziasm',
    ]);
  });

  it('adds exactly one component to the active assembly referencing the new .ziasm', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs }).apply();
    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components).toHaveLength(1);
    expect(asm.components[0].partPath).toBe('Base Cabinet 1.ziasm');
    expect(asm.components[0].position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('shelfCount=0 emits 6 .zipts (no shelf)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'BC noShelves', shelfCount: 0 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths).toHaveLength(6);
    expect(paths.some((p) => p.includes('Shelf'))).toBe(false);
  });

  it('toekickHeight=0 emits 6 .zipts (no toekick)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({
      template: 'baseCabinet',
      params: { ...DEFAULTS, name: 'BC flat', toekickHeight: 0, toekickSetback: 0 },
      opfs,
    }).apply();
    const paths = (await opfs.list()).filter((p) => p.endsWith('.zipt'));
    expect(paths).toHaveLength(6);
    expect(paths.some((p) => p.includes('Toekick'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS (T11's impl covers these).

- [ ] **Step 3: Commit**

`test(app): CreateCabinetCommand happy-path file inventory + place` — body: "Pins the 1 .ziasm + 7 .zipt default outcome and the 6 .zipt shelfCount=0 / toekick=0 variants." Footer required.

---

### Task 13: Revert deletes files + un-places

**Files:**
- Modify: `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`

- [ ] **Step 1: Append the failing test**

```ts
describe('CreateCabinetCommand — revert', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('removes the placed component and deletes all 8 written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(1);
    expect((await opfs.list()).length).toBe(8);

    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(app): CreateCabinetCommand.revert clears component + files` — body: "Apply leaves 1 component + 8 files; revert leaves 0 of each. Matches spec §1.4.8." Footer required.

---

### Task 14: Mid-flight write rollback

**Files:**
- Modify: `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`

- [ ] **Step 1: Append the failing test**

```ts
describe('CreateCabinetCommand — mid-flight rollback', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  it('rolls back already-written files when a later write fails', async () => {
    seedAssembly();
    let writeCount = 0;
    const opfs = new MemOpfs();
    const realWrite = opfs.write.bind(opfs);
    opfs.write = async (p: string, b: Uint8Array) => {
      writeCount++;
      if (writeCount === 4) throw new Error('disk full');
      return realWrite(p, b);
    };
    const cmd = new CreateCabinetCommand({ template: 'baseCabinet', params: { ...DEFAULTS }, opfs });
    await expect(cmd.apply()).rejects.toThrow('disk full');
    expect(await opfs.list()).toEqual([]);
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(app): CreateCabinetCommand mid-flight rollback on disk error` — body: "A 4th-write failure deletes the 3 prior files and surfaces the original error. Active assembly stays empty — no orphan components." Footer required.

---

## Phase 3 — UI

### Task 15: `CabinetDialog` skeleton + structural test

**Files:**
- Create: `packages/app/src/shell/CabinetDialog.tsx`
- Create: `packages/app/src/shell/__tests__/CabinetDialog.spec.tsx`
- Modify: `packages/app/src/shell/WorkFeatureDialogsHost.tsx`

- [ ] **Step 1: Write the failing structural test**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CabinetDialog } from '../CabinetDialog';
import { useAppStore } from '../../store/useAppStore';
import type { AssemblyDocument, MaterialEntry } from '@zilventor/shared';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };

function seedAsm(materials = [carcass, back]): void {
  const doc: AssemblyDocument = {
    id: 'A1', name: 'Project', units: 'mm',
    parameters: {}, properties: {},
    components: [], constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
    materials,
  };
  useAppStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
}

describe('CabinetDialog — structural', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('renders nothing when cabinetDialog state is null', () => {
    seedAsm();
    const { container } = render(<CabinetDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all input fields when open', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: vi.fn(),
    });
    render(<CabinetDialog />);
    for (const label of [
      'Name', 'Width', 'Depth', 'Height',
      'Toekick height', 'Toekick setback', 'Shelf count',
      'Carcass material', 'Back material', 'Edge band material',
    ]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('OK calls onSubmit with the current params and clears the dialog state', () => {
    seedAsm();
    const onSubmit = vi.fn();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      name: 'Base Cabinet 1',
      width: 600, depth: 560, height: 720,
      toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
      carcassMaterialId: 'm-birch-18',
      backMaterialId: 'm-hb-6',
      bandMaterialId: null,
    });
    expect(useAppStore.getState().cabinetDialog).toBeNull();
  });
});
```

- [ ] **Step 2: Implement the dialog**

`packages/app/src/shell/CabinetDialog.tsx`:

```tsx
import React from 'react';
import type { BaseCabinetParams, MaterialId } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 480, color: '#eee', fontSize: 12, maxHeight: '90vh', overflowY: 'auto',
};
const sectionHeading: React.CSSProperties = {
  display: 'block', fontWeight: 600, fontSize: 12, marginTop: 8, marginBottom: 6,
};
const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 };
const labelStyle: React.CSSProperties = { width: 130, fontSize: 11 };
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#222', border: '1px solid #444', color: '#eee',
  padding: '4px 6px', fontSize: 11,
};
const errStyle: React.CSSProperties = { color: '#ffb3b3', fontSize: 10, marginLeft: 130, marginBottom: 4 };
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

const DEFAULTS: Omit<BaseCabinetParams, 'carcassMaterialId' | 'backMaterialId'> = {
  name: 'Base Cabinet 1',
  width: 600, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 50,
  shelfCount: 1, bandMaterialId: null,
};

export function CabinetDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.cabinetDialog);
  const setDialog = useAppStore((s) => s.setCabinetDialog);
  const asm = useAppStore((s) => s.activeAssembly);

  const initialCarcass = asm?.materials.find((m) => m.defaultThickness >= 12)?.id
    ?? asm?.materials[0]?.id ?? '';
  const initialBack = asm?.materials.find((m) => m.defaultThickness <= 8 && m.id !== initialCarcass)?.id
    ?? asm?.materials[0]?.id ?? '';

  const [params, setParams] = React.useState<BaseCabinetParams>({
    ...DEFAULTS,
    carcassMaterialId: initialCarcass,
    backMaterialId: initialBack,
    ...(dialog?.initial ?? {}),
  });

  React.useEffect(() => {
    if (!dialog) return;
    setParams((prev) => ({
      ...prev,
      carcassMaterialId: dialog.initial?.carcassMaterialId ?? initialCarcass,
      backMaterialId: dialog.initial?.backMaterialId ?? initialBack,
      ...(dialog.initial ?? {}),
    }));
  }, [dialog, initialCarcass, initialBack]);

  if (!dialog || !asm) return null;

  const errors = validate(params, asm.materials);
  const hasErr = Object.keys(errors).length > 0;

  function patch<K extends keyof BaseCabinetParams>(k: K, v: BaseCabinetParams[K]): void {
    setParams((p) => ({ ...p, [k]: v }));
  }

  function handleOk(): void {
    if (hasErr) return;
    dialog!.onSubmit(params);
    setDialog(null);
  }

  function handleCancel(): void {
    dialog!.onCancel();
    setDialog(null);
  }

  return (
    <div style={overlayStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) handleCancel(); }}>
      <div
        style={panelStyle}
        role="dialog"
        aria-label="Cabinet"
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleOk();
          else if (e.key === 'Escape') handleCancel();
        }}
        tabIndex={-1}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Base Cabinet</div>

        <div style={sectionHeading}>Name</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-name">Name</label>
          <input id="cab-name" style={inputStyle} value={params.name} onChange={(e) => patch('name', e.target.value)} />
        </div>
        {errors.name && <div style={errStyle}>{errors.name}</div>}

        <div style={sectionHeading}>Dimensions (mm)</div>
        {(['width', 'depth', 'height'] as const).map((k) => (
          <React.Fragment key={k}>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor={`cab-${k}`}>{cap(k)}</label>
              <input id={`cab-${k}`} aria-label={cap(k)} type="number" style={inputStyle}
                value={params[k]} onChange={(e) => patch(k, Number(e.target.value))} />
            </div>
            {errors[k] && <div style={errStyle}>{errors[k]}</div>}
          </React.Fragment>
        ))}

        <div style={sectionHeading}>Toekick (mm)</div>
        {(['toekickHeight', 'toekickSetback'] as const).map((k) => (
          <React.Fragment key={k}>
            <div style={fieldRow}>
              <label style={labelStyle} htmlFor={`cab-${k}`}>{titleFor(k)}</label>
              <input id={`cab-${k}`} aria-label={titleFor(k)} type="number" style={inputStyle}
                value={params[k]} onChange={(e) => patch(k, Number(e.target.value))} />
            </div>
            {errors[k] && <div style={errStyle}>{errors[k]}</div>}
          </React.Fragment>
        ))}

        <div style={sectionHeading}>Shelves</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-shelfCount">Shelf count</label>
          <input id="cab-shelfCount" aria-label="Shelf count" type="number" min={0} style={inputStyle}
            value={params.shelfCount}
            onChange={(e) => patch('shelfCount', Math.max(0, Math.floor(Number(e.target.value))))} />
        </div>
        {errors.shelfCount && <div style={errStyle}>{errors.shelfCount}</div>}

        <div style={sectionHeading}>Materials</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-carcass">Carcass material</label>
          <select id="cab-carcass" aria-label="Carcass material" style={inputStyle}
            value={params.carcassMaterialId}
            onChange={(e) => patch('carcassMaterialId', e.target.value as MaterialId)}>
            <option value="">— pick —</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.carcassMaterialId && <div style={errStyle}>{errors.carcassMaterialId}</div>}

        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-back">Back material</label>
          <select id="cab-back" aria-label="Back material" style={inputStyle}
            value={params.backMaterialId}
            onChange={(e) => patch('backMaterialId', e.target.value as MaterialId)}>
            <option value="">— pick —</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        {errors.backMaterialId && <div style={errStyle}>{errors.backMaterialId}</div>}

        <div style={sectionHeading}>Edge bands</div>
        <div style={fieldRow}>
          <label style={labelStyle} htmlFor="cab-band">Edge band material</label>
          <select id="cab-band" aria-label="Edge band material" style={inputStyle}
            value={params.bandMaterialId ?? ''}
            onChange={(e) => patch('bandMaterialId', e.target.value === '' ? null : (e.target.value as MaterialId))}>
            <option value="">None</option>
            {asm.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div style={{ ...errStyle, color: '#9ec0e8', fontStyle: 'italic' }}>
          Front edges of sides, top, bottom, and shelves will be banded.
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={btnStyle} onClick={handleCancel}>Cancel</button>
          <button style={okBtnStyle} onClick={handleOk} disabled={hasErr} aria-disabled={hasErr}>OK</button>
        </div>
      </div>
    </div>
  );
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function titleFor(k: 'toekickHeight' | 'toekickSetback'): string {
  return k === 'toekickHeight' ? 'Toekick height' : 'Toekick setback';
}

function validate(
  p: BaseCabinetParams,
  registry: ReadonlyArray<{ id: string; defaultThickness: number }>,
): Record<string, string> {
  const carcass = registry.find((m) => m.id === p.carcassMaterialId);
  const Tc = carcass?.defaultThickness ?? 18;
  const e: Record<string, string> = {};
  if (p.name.trim() === '') e.name = 'Cabinet name required.';
  if (p.width <= 2 * Tc) e.width = `Width must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.depth <= 2 * Tc) e.depth = `Depth must exceed ${2 * Tc} mm (2× carcass thickness).`;
  if (p.height <= 2 * Tc + p.toekickHeight) e.height = 'Height must exceed toekick + 2× carcass thickness.';
  if (p.toekickHeight !== 0 && p.toekickHeight >= p.height / 2) e.toekickHeight = 'Toekick must be less than half the cabinet height.';
  if (p.toekickSetback < 0 || p.toekickSetback >= p.depth - Tc) e.toekickSetback = `Setback must be between 0 and ${p.depth - Tc - 1} mm.`;
  const innerH = p.height - p.toekickHeight - 2 * Tc;
  const maxShelves = Math.max(0, Math.floor(innerH / 100));
  if (p.shelfCount < 0 || p.shelfCount > maxShelves) e.shelfCount = `0 ≤ shelf count ≤ ${maxShelves}.`;
  if (!carcass) e.carcassMaterialId = 'Pick a carcass material.';
  if (!registry.find((m) => m.id === p.backMaterialId)) e.backMaterialId = 'Pick a back material.';
  return e;
}
```

- [ ] **Step 3: Mount the dialog in the host**

In `packages/app/src/shell/WorkFeatureDialogsHost.tsx`, add `import { CabinetDialog } from './CabinetDialog';` at the top and mount `<CabinetDialog />` next to the existing dialog mounts in the JSX returned.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @zilventor/app test -- CabinetDialog.spec` then `pnpm --filter @zilventor/app typecheck`. Expected: 3 PASS + `Done`.

- [ ] **Step 5: Commit**

`feat(app): CabinetDialog modal form for base-cabinet template` — body: "Form: name, W/D/H, toekick H/setback, shelf count, carcass + back material, edge band material. OK calls onSubmit(params) and clears dialog state. Esc / backdrop click cancels." Footer required.

---

### Task 16: Validation messages and OK gating

**Files:**
- Modify: `packages/app/src/shell/__tests__/CabinetDialog.spec.tsx`

- [ ] **Step 1: Append the failing tests**

```tsx
describe('CabinetDialog — validation', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('disables OK and shows an error when width ≤ 2·Tc', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '36' } });
    expect(screen.getByText(/Width must exceed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('disables OK when carcass material is unset', () => {
    seedAsm();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Carcass material'), { target: { value: '' } });
    expect(screen.getByText('Pick a carcass material.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not call onSubmit when OK is clicked while invalid', () => {
    seedAsm();
    const onSubmit = vi.fn();
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit,
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests** — Expected: PASS.

- [ ] **Step 3: Commit**

`test(app): CabinetDialog validation gating + inline messages` — body: "Three negative cases pinned: width too small, missing carcass material, OK no-op when invalid." Footer required.

---

### Task 17: FurnitureTab — Cabinets ribbon panel + Base Cabinet button

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`

- [ ] **Step 1: Wire the Cabinets panel**

Replace the FurnitureTab module to add a third `RibbonPanel` titled "Cabinets" between Create and Cut List, with a single button `aria-label="Base Cabinet"` that:
- Is disabled (with title="Open or create an assembly first") when `!activeAssembly`.
- On click: `OpenCabinetDialogCommand({ template: 'baseCabinet', onSubmit })` where `onSubmit` is `async (params) => new CreateCabinetCommand({ template: 'baseCabinet', params, opfs }).apply()` with `opfs = await Opfs.forNavigator()`.

Imports to add: `OpenCabinetDialogCommand`, `CreateCabinetCommand`, `BaseCabinetParams`. Keep all existing Panel + Cut List wiring intact.

The full file body:

```tsx
import type { BaseCabinetParams, PanelFeature } from '@zilventor/shared';
import { PanelIcon } from '@zilventor/icons';
import RibbonPanel from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';
import { OpenPanelDialogCommand } from '../../commands/OpenPanelDialogCommand';
import { OpenCabinetDialogCommand } from '../../commands/OpenCabinetDialogCommand';
import { AddPanelFeatureCommand } from '../../commands/AddPanelFeatureCommand';
import { CreateAndPlacePanelCommand } from '../../commands/CreateAndPlacePanelCommand';
import { CreateCabinetCommand } from '../../commands/CreateCabinetCommand';
import { OpenCutListTabCommand } from '../../commands/OpenCutListTabCommand';
import { RenumberCutListCommand } from '../../commands/RenumberCutListCommand';
import { ExportCutListCsvCommand } from '../../commands/ExportCutListCsvCommand';
import { useCutListResult } from '../useCutListResult';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function FurnitureTab() {
  const activePart = useAppStore((s) => s.activePart);
  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const disabled = !activePart && !activeAssembly;
  const cabinetDisabled = !activeAssembly;
  const cutListResult = useCutListResult();

  const handlePanel = async () => {
    const onSubmit = async (panel: PanelFeature) => {
      const state = useAppStore.getState();
      if (state.activePart) {
        await new AddPanelFeatureCommand(panel).apply();
      } else if (state.activeAssembly) {
        const opfs = await Opfs.forNavigator();
        const partName = `Panel-${panel.id}`;
        const partPath = `parts/${partName}.zipt`;
        await new CreateAndPlacePanelCommand({
          partName, partPath, panel,
          partMaterials: state.activeAssembly.materials,
          opfs,
        }).apply();
      }
    };
    await new OpenPanelDialogCommand({ onSubmit }).apply();
  };

  const handleCabinet = async () => {
    const onSubmit = async (params: BaseCabinetParams) => {
      const opfs = await Opfs.forNavigator();
      await new CreateCabinetCommand({ template: 'baseCabinet', params, opfs }).apply();
    };
    await new OpenCabinetDialogCommand({ template: 'baseCabinet', onSubmit }).apply();
  };

  return (
    <div className="flex gap-2 px-3 py-2">
      <RibbonPanel title="Create">
        <button
          className="text-xs hover:text-white disabled:text-neutral-500 flex items-center gap-1"
          disabled={disabled}
          onClick={() => { void handlePanel(); }}
          aria-label="Panel"
        >
          <PanelIcon width={14} height={14} />
          Panel
        </button>
      </RibbonPanel>
      <div aria-label="Cabinets panel">
        <RibbonPanel title="Cabinets">
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleCabinet(); }}
            aria-label="Base Cabinet"
            title={cabinetDisabled ? 'Open or create an assembly first' : ''}
          >
            Base Cabinet
          </button>
        </RibbonPanel>
      </div>
      <div aria-label="Cut List panel">
        <RibbonPanel title="Cut List">
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new OpenCutListTabCommand().apply()}>Cut List</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new RenumberCutListCommand({ result: cutListResult }).apply()}>Renumber</button>
          <button type="button" className="text-xs hover:text-white"
            onClick={() => void new ExportCutListCsvCommand({
              result: cutListResult,
              suggestedName: `${activeAssembly?.name ?? 'assembly'}-cutlist.csv`,
            }).apply()}>Export CSV</button>
        </RibbonPanel>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck + app tests**

Run: `pnpm --filter @zilventor/app typecheck && pnpm --filter @zilventor/app test`. Expected: `Done` + all PASS.

- [ ] **Step 3: Commit**

`feat(app): Cabinets ribbon panel + Base Cabinet button` — body: "Adds the third Furniture-tab RibbonPanel between Create and Cut List. Disabled with tooltip when no assembly is active. Click → OpenCabinetDialogCommand → CabinetDialog → CreateCabinetCommand." Footer required.

---

### Task 18: Empty-registry inline hint

**Files:**
- Modify: `packages/app/src/shell/CabinetDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/CabinetDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

Append to the spec:

```tsx
describe('CabinetDialog — empty registry', () => {
  beforeEach(() => {
    useAppStore.getState().setActiveDocument(null);
    useAppStore.getState().setCabinetDialog(null);
  });

  it('renders an inline "No materials yet" hint when the registry is empty', () => {
    seedAsm([]);
    useAppStore.getState().setCabinetDialog({
      template: 'baseCabinet',
      onSubmit: vi.fn(),
      onCancel: () => useAppStore.getState().setCabinetDialog(null),
    });
    render(<CabinetDialog />);
    expect(screen.getByText(/No materials yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL `No materials yet not in document`.

- [ ] **Step 3: Add the hint**

In `CabinetDialog.tsx` find the `<div style={sectionHeading}>Materials</div>` block and prepend before the carcass `<div style={fieldRow}>`:

```tsx
{asm.materials.length === 0 && (
  <div style={{ ...errStyle, color: '#ffd6a3', marginLeft: 0 }}>
    No materials yet — close this dialog, click <b>Manage materials</b>, then re-open Base Cabinet.
  </div>
)}
```

(Inline quick-add is deferred to a 5b follow-up F-item.)

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

`feat(app): CabinetDialog empty-registry hint` — body: "When the active assembly has no materials, the dialog shows an amber hint pointing to Manage materials and keeps OK disabled. Inline quick-add is deferred to a 5b follow-up." Footer required.

---

## Phase 4 — End-to-end and perf coverage

### Task 19: E2E happy path — create a base cabinet from the ribbon

**Files:**
- Create: `tests/e2e/furniture/cabinet-base-create.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5b-1 — create a base cabinet from Furniture → Cabinets → Base Cabinet', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });

  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Base Cabinet' }).click();

  await expect(page.getByRole('dialog', { name: 'Cabinet' })).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Cabinet' })).toHaveCount(0);

  const counts = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    const componentCount = w.__zilventorStore.getState().activeAssembly.components.length;
    const root = await navigator.storage.getDirectory();
    let fileCount = 0;
    // @ts-expect-error iterator typing
    for await (const [name] of root.entries()) {
      if (name.startsWith('Base Cabinet 1')) fileCount++;
    }
    return { componentCount, fileCount };
  });
  expect(counts.componentCount).toBe(1);
  expect(counts.fileCount).toBe(8);
});
```

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm --filter @zilventor/e2e e2e -- cabinet-base-create`. Expected: 1 PASS.

- [ ] **Step 3: Commit**

`test(e2e): T-5b-1 create base cabinet via ribbon` — body: "Default-params happy path: opens the dialog, clicks OK, asserts 8 files in OPFS and 1 placed component in the active assembly." Footer required.

---

### Task 20: E2E — cut list integration after cabinet creation

**Files:**
- Create: `tests/e2e/furniture/cabinet-base-cut-list.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5b-2 — cut list shows 7 panel rows after cabinet creation', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Base Cabinet' }).click();
  await page.getByRole('button', { name: 'OK' }).click();

  await page.getByRole('button', { name: 'Cut List' }).first().click();

  const rows = page.locator('[data-cutlist-row]');
  await expect(rows).toHaveCount(7);
});
```

- [ ] **Step 2: Run** — Expected: 1 PASS.

Run: `pnpm --filter @zilventor/e2e e2e -- cabinet-base-cut-list`.

- [ ] **Step 3: Commit**

`test(e2e): T-5b-2 cut list picks up base cabinet panels` — body: "After Base Cabinet → OK, the 5d aggregator emits 7 distinct rows (one per panel role). Verifies 5b → 5d wiring with no aggregator changes." Footer required.

---

### Task 21: E2E — undo round-trips a cabinet creation

**Files:**
- Create: `tests/e2e/furniture/cabinet-base-undo.spec.ts`

- [ ] **Step 1: Write the e2e test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5b-3 — Ctrl+Z removes the cabinet and deletes its 8 files', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });
  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { addMaterial(m: unknown): void } } };
    w.__zilventorStore.getState().addMaterial({ id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
    w.__zilventorStore.getState().addMaterial({ id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
  });
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Base Cabinet' }).click();
  await page.getByRole('button', { name: 'OK' }).click();

  const before = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    const root = await navigator.storage.getDirectory();
    let n = 0;
    // @ts-expect-error iterator typing
    for await (const [name] of root.entries()) if (name.startsWith('Base Cabinet 1')) n++;
    return { components: w.__zilventorStore.getState().activeAssembly.components.length, files: n };
  });
  expect(before).toEqual({ components: 1, files: 8 });

  await page.keyboard.press('Control+z');

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    return w.__zilventorStore.getState().activeAssembly.components.length === 0;
  });

  const after = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let n = 0;
    // @ts-expect-error iterator typing
    for await (const [name] of root.entries()) if (name.startsWith('Base Cabinet 1')) n++;
    return n;
  });
  expect(after).toBe(0);
});
```

- [ ] **Step 2: Run** — Expected: 1 PASS.

Run: `pnpm --filter @zilventor/e2e e2e -- cabinet-base-undo`.

- [ ] **Step 3: Commit**

`test(e2e): T-5b-3 Ctrl+Z round-trips a cabinet creation` — body: "Pre: 1 component + 8 files. After Ctrl+Z: 0 components + 0 files. Pins the spec §1.4.8 success criterion." Footer required.

---

### Task 22: Perf — cabinet creation under 600ms p95

**Files:**
- Create: `tests/perf/cabinet-create.spec.ts`

- [ ] **Step 1: Write the perf test**

Pattern matches the existing `tests/perf/panel-create-and-render.spec.ts`. The harness:
1. Boots the app, waits for kernel.
2. Seeds an assembly + 2 materials via `__zilventorStore`.
3. Loops 20 times: `performance.now()` → invoke the command end-to-end via the page (either through a window-exposed test util or via the UI fast path) → record elapsed.
4. Sort, take p95, assert `< 600`.

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

test('perf-5b — Base Cabinet create p95 under 600ms', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { setActiveDocument(d: unknown): void } } };
    const doc = {
      id: 'A1', name: 'Project', units: 'mm',
      parameters: {}, properties: {},
      components: [], constraints: [], groundedComponentPaths: [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [
        { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' },
        { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' },
      ],
    };
    w.__zilventorStore.getState().setActiveDocument({ kind: 'assembly', document: doc });
  });

  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const ms = await page.evaluate(async (n) => {
      const t0 = performance.now();
      // Adapt to project's existing perf-test harness for invoking commands.
      // The reference shape: import { CreateCabinetCommand } and invoke .apply().
      // See tests/perf/panel-create-and-render.spec.ts for the exact import path.
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const { Opfs } = await import('/src/../../kernel/src/storage/Opfs.ts');
      const opfs = await Opfs.forNavigator();
      await new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: `Perf Cabinet ${n}`,
          width: 600, depth: 560, height: 720,
          toekickHeight: 100, toekickSetback: 50, shelfCount: 1,
          carcassMaterialId: 'm-birch-18',
          backMaterialId: 'm-hb-6',
          bandMaterialId: null,
        },
        opfs,
      }).apply();
      return performance.now() - t0;
    }, i);
    samples.push(ms);
  }

  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(0.95 * samples.length)];
  console.log(`perf-5b cabinet-create p95: ${p95.toFixed(1)}ms over ${samples.length} runs`);
  expect(p95).toBeLessThan(600);
});
```

> **Implementer note:** The dynamic `import('/src/...')` shape mirrors `panel-create-and-render.spec.ts`. If the project's perf harness uses a different mechanism (e.g. `window.__zilventorTestUtils`), adapt accordingly — the goal is "20 timed apply() calls, sort, p95 < 600ms".

- [ ] **Step 2: Run** — Expected: PASS, p95 logged.

Run: `pnpm --filter @zilventor/e2e perf -- cabinet-create`.

- [ ] **Step 3: Commit**

`test(perf): perf-5b cabinet-create p95 under 600ms` — body: "20-sample harness: 8 file writes + place + autosave-trigger must complete under the 600ms spec budget." Footer required.

---

## Phase 5 — Manual smoke checklist

### Task 23: Manual-smoke doc

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-5b.md`

- [ ] **Step 1: Write the smoke checklist**

The doc should cover, in order: setup (launch fresh, new assembly named "Kitchen Run", add Birch 18mm + Hardboard 6mm via Manage Materials); T1 default base cabinet (Furniture → Cabinets → Base Cabinet → OK with defaults; verify viewport shows a 600×560×720mm cabinet, BrowserPane shows it as a child); T2 cut list integration (Furniture → Cut List → 7 distinct rows); T3 edge bands (re-open dialog, set Edge band material to a non-None entry, verify name auto-bumps to "Base Cabinet 2", verify band totals footer non-empty); T4 undo (Ctrl+Z removes cabinets); T5 validation (set width to 30 → inline error visible, OK greyed; set shelf count to 99 → inline error); T6 no-active-assembly state (File → New Part, Furniture tab, Base Cabinet button greyed with the tooltip).

Each step ends with a clear pass/fail criterion. Final section asks the implementer to report pass/fail per T1..T6.

- [ ] **Step 2: Commit**

`docs(manual-tests): T1..T6 base-cabinet smoke checklist` — body: "Six pass/fail steps covering happy path, cut-list integration, edge bands, undo, validation, and the no-assembly state." Footer required.

---

## Phase 6 — Final verification

### Task 24: Full workspace green

**Files:** (verification only — no edits)

- [ ] **Step 1: Run the full typecheck + test sweep**

Run: `pnpm -r typecheck && pnpm -r test`. Expected: all packages `Done` and all unit/integration tests PASS.

- [ ] **Step 2: Run e2e (chromium) and perf**

Run: `pnpm --filter @zilventor/e2e e2e` then `pnpm --filter @zilventor/e2e perf`. Expected: all PASS, including the 3 new e2e specs (`cabinet-base-create`, `cabinet-base-cut-list`, `cabinet-base-undo`) and the 1 new perf spec (`cabinet-create`).

- [ ] **Step 3: Eyeball the diff**

Run `git log --oneline 'HEAD~24..HEAD'` and `git diff 'HEAD~24..HEAD' --stat`.

Confirm:
- 23 commits, all with the `Co-Authored-By` footer.
- Roughly: `packages/shared` ~9 files, `packages/app` ~6 files, `tests/e2e` 3 files, `tests/perf` 1 file, `docs` 2 files (spec + smoke checklist).

- [ ] **Step 4: No commit** — verification phase only.

---

## Spec coverage map

| Spec section | Task(s) |
|---|---|
| §1.4 SC#1 (defaults populate dialog) | T15, T19 |
| §1.4 SC#2 (8 files written + place) | T11, T12, T19 |
| §1.4 SC#3 (origin frame) | T2, T3 |
| §1.4 SC#4 (panel positions) | T3, T4, T5 |
| §1.4 SC#5 (cut list + BOM integration) | T20 |
| §1.4 SC#6 (edge bands template) | T7 |
| §1.4 SC#7 (validation rejections) | T6, T16 |
| §1.4 SC#8 (Ctrl+Z round-trips) | T13, T21 |
| §1.4 SC#9 (typecheck + suites pass) | T24 |
| §2.1 (BaseCabinetParams type) | T1 |
| §2.2 (panel orientation table) | T3, T4, T5 |
| §2.3 (file naming + collision) | T11, T19 |
| §3.1 (Cabinets ribbon panel) | T17 |
| §3.2 (CabinetDialog form) | T15, T16, T18 |
| §3.3 (open/submit flow) | T17 |
| §3.4 (cancel/failure flow) | T14, T15 |
| §4.2 (buildBaseCabinet pure fn) | T2..T8 |
| §4.3 (CreateCabinetCommand) | T11..T14 |
| §4.4 (reuse existing infra) | T11 (PlaceComponentCommand), T17 (Opfs.forNavigator) |
| §4.5 (origin frame placement) | T11 |
| §5.1 (validation errors) | T6, T16 |
| §5.2 (runtime errors) | T14, T11 (NO_ACTIVE_ASSEMBLY) |
| §5.3 (edge cases) | T5, T12, T17, T18 |
| §6 (testing strategy) | T2..T8, T11..T14, T19..T21, T22 |
| §8 (build sequencing) | This plan's phases 1..6 |



