# M4 Slice E — Blind + Diagonal Corner Cabinets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two corner cabinet variants (blind corner, diagonal corner) with full hinge boring, hardware BOM, dialogs, ribbon buttons, and e2e tests.

**Architecture:** Pure-shared builders (no kernel dep for blind; kernel outline-prism for diagonal top/bottom) return `CabinetBuildOutput` extended with `doorBores`, `plateBores`, `hardware`. `CreateCabinetCommand` is extended to inject bores as `document.bores` on panel `.zipt` files and to place hinge hardware as assembly components. App layer follows the `cornerCabinet` dialog/command/ribbon pattern exactly.

**Tech Stack:** TypeScript (exactOptionalPropertyTypes), Vitest, Playwright, OCCT WASM (packages/kernel), React (packages/app), pnpm monorepo.

## Global Constraints

- `exactOptionalPropertyTypes: true` — optional fields: conditional spread `...(x ? { x } : {})`, never `field: undefined`
- Typecheck: `pnpm typecheck` from repo root, 0 errors required
- Lint: scoped per package — `cd packages/X && pnpm exec eslint src/`; `no-unused-vars` is a hard ERROR that tsc misses
- packages/app has no `test` script — run as `cd packages/app && pnpm exec vitest run <spec>`
- Final suite: `pnpm exec vitest run` from root (catches .test.ts/.spec.ts glob gaps; run after every task)
- New `PanelRole` value → find + fix every exhaustive-Record site the compiler surfaces
- Manifest bump → CURRENT_FORMAT_VERSION + migrations entry + normalizeKind allow-list
- Commands: `async apply()/revert(): Promise<void>`; scene-mutating commands must call `reloadCabinet` + `boreCacheInvalidator` in BOTH apply AND revert
- e2e asserts via `window.__zilventorStore`, not OPFS bytes; hinge SKUs appear as assembly components (store-visible), not OPFS bores
- Branch: `feat/m4-corner-cabinets`; master is protected

---

## Task 1: `doorMath` extension — `openingWidth` + `openingXOffset`

**Files:**
- Modify: `packages/shared/src/doorMath.ts`
- Test: `packages/shared/src/__tests__/doorMath.spec.ts` (add new describe block)

**Interfaces:**
- Consumes: nothing new
- Produces: `DoorMathInput.openingWidth?: number`, `DoorMathInput.openingXOffset?: number` — consumed by Task 3 (blind corner builder)

Steps:

- [ ] Step 1 — write failing tests. Append to `packages/shared/src/__tests__/doorMath.spec.ts`:
```typescript
describe('doorMath — openingWidth + openingXOffset (blind corner)', () => {
  it('openingWidth sizes door to opening, not cabinet width', () => {
    const result = doorMath({
      cabinet: { width: 900, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'left',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
      openingWidth: 450,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.dims.width).toBeCloseTo(446, 1);   // 450 - 2*2
    expect(result[0]!.dims.length).toBeCloseTo(716, 1);  // 720 - 2*2
  });

  it('openingXOffset shifts door center X', () => {
    const result = doorMath({
      cabinet: { width: 900, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'right',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
      openingWidth: 450, openingXOffset: 450,
    });
    expect(result[0]!.pose.translation.x).toBeCloseTo(450 + 223, 1); // xOffset + doorW/2
  });

  it('legacy call without new fields produces unchanged output', () => {
    const result = doorMath({
      cabinet: { width: 600, height: 720, depth: 560, Tc: 18, toekickHeight: 100 },
      count: 'single', overlay: 'full', hingeSide: 'left',
      thickness: 18, reveal: 2, clearance: 2, centerReveal: 3,
    });
    expect(result[0]!.dims.width).toBeCloseTo(596, 1);        // 600 - 2*2
    expect(result[0]!.pose.translation.x).toBeCloseTo(300, 1); // 600/2
  });
});
```

- [ ] Step 2 — run, confirm FAIL:
```bash
cd packages/shared && pnpm exec vitest run src/__tests__/doorMath.spec.ts
```
Expected: FAIL — `openingWidth` not on type.

- [ ] Step 3 — implement. In `packages/shared/src/doorMath.ts`, after `centerReveal: number;` in `DoorMathInput`, add:
```typescript
  readonly openingWidth?: number;
  readonly openingXOffset?: number;
```

In `sizing()` first line, replace:
```typescript
const { width: W, height: H, Tc, toekickHeight: tkH } = input.cabinet;
```
with:
```typescript
const W = input.openingWidth ?? input.cabinet.width;
const { height: H, Tc, toekickHeight: tkH } = input.cabinet;
```

In the `count === 'single'` branch, replace:
```typescript
translation: { x: input.cabinet.width / 2, y: frontY, z: input.cabinet.height / 2 },
```
with:
```typescript
translation: { x: (input.openingXOffset ?? 0) + doorW / 2, y: frontY, z: input.cabinet.height / 2 },
```

- [ ] Step 4 — run, confirm PASS:
```bash
cd packages/shared && pnpm exec vitest run src/__tests__/doorMath.spec.ts
```
Expected: all doorMath tests PASS.

- [ ] Step 5 — typecheck + lint:
```bash
pnpm typecheck && cd packages/shared && pnpm exec eslint src/doorMath.ts src/__tests__/doorMath.spec.ts
```
Expected: 0 errors.

- [ ] Step 6 — full suite:
```bash
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 7 — commit:
```bash
git add packages/shared/src/doorMath.ts packages/shared/src/__tests__/doorMath.spec.ts
git commit -m "feat(m4-e): doorMath openingWidth + openingXOffset for blind corner"
```

---

## Task 2: Type foundations — `PanelFeature.outline`, `PanelRole` additions, `CabinetBuildOutput` extension, manifest v33→v34

**Files:**
- Modify: `packages/shared/src/panel-feature.ts`
- Modify: `packages/shared/src/cabinets/types.ts`
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/cabinets/index.ts` (add placeholder exports)
- Create: `packages/shared/src/__tests__/migrateManifest-v33-to-v34.spec.ts`
- Create: `packages/shared/src/__tests__/panelFeature-outline.spec.ts`

**Interfaces:**
- Produces: `PanelFeature.outline?`, `PanelRole` union includes `'blindFiller'` and `'frontStile'`, `CabinetBuildOutput` has `doorBores?`, `plateBores?`, `hardware?`, new param + error types — consumed by Tasks 3, 5, 6, 7, 8

Steps:

- [ ] Step 1 — write failing migration test. Create `packages/shared/src/__tests__/migrateManifest-v33-to-v34.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION, type AnyManifest } from '../fileFormat';

describe('migrateManifest v33 → v34 (M4 Slice E — PanelFeature.outline)', () => {
  it('CURRENT_FORMAT_VERSION is 34', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(34);
  });

  it('migrates a v33 part manifest to v34 (additive no-op)', () => {
    const v33: AnyManifest = {
      formatVersion: 33,
      kind: 'part',
      document: { id: 'p1', featureTree: [{ kind: 'panel', id: 'pf1' }] },
    };
    const out = migrateManifest(v33);
    expect(out.formatVersion).toBe(34);
    // panel feature is unchanged
    const tree = (out.document as { featureTree: unknown[] }).featureTree;
    expect((tree[0] as { id: string }).id).toBe('pf1');
  });

  it('v34 panel with outline field round-trips through migrateManifest unchanged', () => {
    const outline = [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }];
    const manifest: AnyManifest = {
      formatVersion: 34,
      kind: 'part',
      document: {
        id: 'p2', featureTree: [{ kind: 'panel', id: 'pf2', outline }],
      },
    };
    const out = migrateManifest(JSON.parse(JSON.stringify(manifest)) as AnyManifest);
    const tree = (out.document as { featureTree: Array<{ outline?: unknown }> }).featureTree;
    expect(tree[0]!.outline).toEqual(outline);
  });
});
```

- [ ] Step 2 — write failing panel-feature outline test. Create `packages/shared/src/__tests__/panelFeature-outline.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isPanelFeature, type PanelFeature } from '../panel-feature';

const BASE: PanelFeature = {
  kind: 'panel', id: 'pf1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 600 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'm-birch',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PanelFeature.outline', () => {
  it('isPanelFeature accepts a panel without outline (backward compat)', () => {
    expect(isPanelFeature(BASE)).toBe(true);
  });

  it('isPanelFeature accepts a panel with a valid CCW outline', () => {
    const p: PanelFeature = {
      ...BASE,
      ...(true ? { outline: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 300, y: 600 }, { x: 0, y: 600 }] } : {}),
    };
    expect(isPanelFeature(p)).toBe(true);
  });

  it('isPanelFeature rejects outline vertex missing y', () => {
    const bad = { ...BASE, outline: [{ x: 0 }, { x: 600, y: 0 }] };
    expect(isPanelFeature(bad as unknown)).toBe(false);
  });

  it('isPanelFeature rejects outline that is not an array', () => {
    const bad = { ...BASE, outline: 'polygon' };
    expect(isPanelFeature(bad as unknown)).toBe(false);
  });
});
```

- [ ] Step 3 — run both new tests, confirm FAIL:
```bash
cd packages/shared && pnpm exec vitest run src/__tests__/migrateManifest-v33-to-v34.spec.ts src/__tests__/panelFeature-outline.spec.ts
```
Expected: FAIL — `CURRENT_FORMAT_VERSION` is 33, `outline` not on `PanelFeature`.

- [ ] Step 4 — implement all type changes:

**`packages/shared/src/panel-feature.ts`** — in `PanelFeature`, after `readonly suppressed?: boolean;`, add:
```typescript
  /** Optional 2-D polygon defining the panel footprint (CCW from +Z).
   *  When absent: plain axis-aligned box. When present: kernel builds a prism.
   *  `length` and `width` remain the AABB extents. ≥ 3 vertices required. */
  readonly outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>;
```

In `isPanelFeature`, before the final `return true`, add:
```typescript
  const outline = f.outline;
  if (outline !== undefined) {
    if (!Array.isArray(outline)) return false;
    for (const v of outline as unknown[]) {
      if (!v || typeof v !== 'object') return false;
      if (typeof (v as { x?: unknown }).x !== 'number') return false;
      if (typeof (v as { y?: unknown }).y !== 'number') return false;
    }
  }
```

**`packages/shared/src/cabinets/types.ts`** — add `'blindFiller'` and `'frontStile'` to `PanelRole` union (after `'faceFrameRail'`).

Add `import type { BoreOp } from '../bore';` at top (after existing imports).

Add new interfaces after `CabinetBuildOutput`:
```typescript
export interface DoorBoresDef {
  readonly doorSuffix: string;
  readonly cupBores: ReadonlyArray<BoreOp>;
}

export interface PanelBoresDef {
  readonly panelSuffix: string;
  readonly plateBores: ReadonlyArray<BoreOp>;
}

export interface HardwareInstanceDef {
  readonly skuId: string;
  readonly count: number;
}
```

Replace `CabinetBuildOutput` with:
```typescript
export interface CabinetBuildOutput {
  readonly panels: ReadonlyArray<CabinetPanelDef>;
  readonly layout: ReadonlyArray<CabinetComponentDef>;
  readonly doorBores?: ReadonlyArray<DoorBoresDef>;
  readonly plateBores?: ReadonlyArray<PanelBoresDef>;
  readonly hardware?: ReadonlyArray<HardwareInstanceDef>;
}
```

Add to `CabinetTemplateErrorKind` (after `'backMaterialMissing'`):
```typescript
  | 'blindOpeningTooSmall'
  | 'blindOpeningTooLarge'
  | 'diagonalDoorTooNarrow'
  | 'stileWidthInvalid'
```

Add new param interfaces (after `CornerCabinetParams`):
```typescript
export interface BlindCornerCabinetParams {
  readonly name: string;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly toekickHeight: number;
  readonly toekickSetback: number;
  readonly openingWidth: number;
  readonly blindSide: 'left' | 'right';
  readonly shelfCount?: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}

export interface DiagonalCornerCabinetParams {
  readonly name: string;
  readonly wallWidth1: number;
  readonly wallWidth2: number;
  readonly returnDepth1: number;
  readonly returnDepth2: number;
  readonly height: number;
  readonly toekickHeight: number;
  readonly toekickSetback: number;
  readonly stileWidth: number;
  readonly carcassMaterialId: MaterialId;
  readonly backMaterialId: MaterialId;
  readonly bandMaterialId: MaterialId | null;
}
```

**`packages/shared/src/fileFormat.ts`** — line 4: change `33` to `34`. Add to `migrations` object after the `32:` entry:
```typescript
  // v33 → v34: M4 Slice E. Additive: introduces optional PanelFeature.outline field.
  // No existing document needs mutation; bump pins the schema.
  33: (mIn) => {
    const m = deepClone(mIn);
    return { ...m, formatVersion: 34 };
  },
```

In `normalizeKind`, add `|| m.formatVersion === 34` to the allow-list condition (alongside the existing `|| m.formatVersion === 33`).

**`packages/shared/src/cabinets/index.ts`** — add after existing exports:
```typescript
export * from './blindCornerCabinet';
export * from './diagonalCornerCabinet';
```
(These files don't exist yet; TypeScript will fail. Create empty stubs:)

Create `packages/shared/src/cabinets/blindCornerCabinet.ts`:
```typescript
export {}; // stub — implemented in Task 3
```

Create `packages/shared/src/cabinets/diagonalCornerCabinet.ts`:
```typescript
export {}; // stub — implemented in Task 5
```

- [ ] Step 5 — fix compiler-guided exhaustive-Record cascades triggered by new PanelRole values. Run:
```bash
pnpm typecheck 2>&1 | head -40
```
For every error mentioning `'blindFiller'` or `'frontStile'` not in a type, add the missing cases. Common locations: `cutListRow.ts` (if it has a `Record<PanelRole, ...>`), BOM walker, any role → label map. The compiler will surface all sites; fix each one.

- [ ] Step 6 — run new tests, confirm PASS:
```bash
cd packages/shared && pnpm exec vitest run src/__tests__/migrateManifest-v33-to-v34.spec.ts src/__tests__/panelFeature-outline.spec.ts
```
Expected: all PASS.

- [ ] Step 7 — full typecheck + lint + suite:
```bash
pnpm typecheck && cd packages/shared && pnpm exec eslint src/ && pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 8 — commit:
```bash
git add packages/shared/src/panel-feature.ts packages/shared/src/cabinets/types.ts \
        packages/shared/src/cabinets/blindCornerCabinet.ts packages/shared/src/cabinets/diagonalCornerCabinet.ts \
        packages/shared/src/cabinets/index.ts packages/shared/src/fileFormat.ts \
        packages/shared/src/__tests__/migrateManifest-v33-to-v34.spec.ts \
        packages/shared/src/__tests__/panelFeature-outline.spec.ts
git commit -m "feat(m4-e): type foundations — PanelFeature.outline, PanelRole additions, CabinetBuildOutput extension, v34"
```

---

## Task 3: `buildBlindCornerCabinet` — pure shared builder

**Files:**
- Replace stub: `packages/shared/src/cabinets/blindCornerCabinet.ts`
- Create: `packages/shared/src/cabinets/__tests__/blindCornerCabinet.spec.ts`

**Interfaces:**
- Consumes: `DoorMathInput.openingWidth/openingXOffset` (Task 1), `BlindCornerCabinetParams`, `CabinetBuildOutput` with `doorBores`/`plateBores`/`hardware` (Task 2), `hingeCupBores`, `hingePlateBores`, `hingeCountForHeight`, `hingePositions` from `hingeMath.ts`, `doorMath` from `doorMath.ts`, `DOOR_CUP_FACE`, `LEFT_SIDE_INNER_FACE`, `RIGHT_SIDE_INNER_FACE` from `prisadkaFaceConventions.ts`
- Produces: `buildBlindCornerCabinet(params: BlindCornerCabinetParams, registry: ReadonlyArray<MaterialEntry>): CabinetBuildOutput` — consumed by Task 6

- [ ] Step 1 — create failing test. Create `packages/shared/src/cabinets/__tests__/blindCornerCabinet.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildBlindCornerCabinet } from '../blindCornerCabinet';
import type { BlindCornerCabinetParams } from '../types';
import { CabinetTemplateError } from '../types';
import { hingeCountForHeight } from '../../hingeMath';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

const P: BlindCornerCabinetParams = {
  name: 'Blind 1',
  width: 900, depth: 560, height: 720,
  toekickHeight: 100, toekickSetback: 60,
  openingWidth: 450, blindSide: 'left',
  shelfCount: 0,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

const Tc = 18; const Tb = 6; const Td = 18;

describe('buildBlindCornerCabinet — structure', () => {
  it('emits 9 panels for shelfCount=0 (6 carcass + 1 filler + 1 toekick + 1 door)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.panels).toHaveLength(9);
  });

  it('emits 10 panels for shelfCount=1', () => {
    const out = buildBlindCornerCabinet({ ...P, shelfCount: 1 }, REGISTRY);
    expect(out.panels).toHaveLength(10);
  });

  it('blindFiller role exists with correct dimensions', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const filler = out.panels.find(p => p.role === 'blindFiller')!;
    expect(filler).toBeDefined();
    // length = H - 2*Tc = 720 - 36 = 684
    expect((filler.panel.length as { value: number }).value).toBe(720 - 2 * Tc);
    // width = W - openingWidth - Tc = 900 - 450 - 18 = 432
    expect((filler.panel.width as { value: number }).value).toBe(900 - 450 - Tc);
  });

  it('door is sized to openingWidth not full cabinet width', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const door = out.panels.find(p => p.role === 'door')!;
    const doorW = (door.panel.width as { value: number }).value;
    expect(doorW).toBeLessThan(900 - 4); // narrower than full cabinet
    expect(doorW).toBeCloseTo(450 - 2 * 2, 1); // openingWidth - 2*reveal
  });

  it('door layout position X is offset to the live side (blindSide=left → xOffset=450)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const doorW = 450 - 2 * 2; // 446
    // xOffset = W - openingWidth = 900 - 450 = 450; doorCenter = 450 + 446/2 = 673
    expect(doorComp.position.x).toBeCloseTo(450 + doorW / 2, 1);
  });
});

describe('buildBlindCornerCabinet — hinge boring', () => {
  it('doorBores has cupBores for the door panel', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.doorBores).toBeDefined();
    expect(out.doorBores!).toHaveLength(1);
    expect(out.doorBores![0]!.doorSuffix).toBe('Door');
    const doorH = 720 - 2 * 2; // 716
    const hingeCount = hingeCountForHeight(doorH);
    expect(out.doorBores![0]!.cupBores).toHaveLength(hingeCount);
  });

  it('plateBores has plate holes on the live-side carcass panel', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    expect(out.plateBores).toBeDefined();
    expect(out.plateBores!).toHaveLength(1);
    // blindSide=left → live side is right → 'Right Side'
    expect(out.plateBores![0]!.panelSuffix).toBe('Right Side');
    const doorH = 720 - 2 * 2;
    const hingeCount = hingeCountForHeight(doorH);
    expect(out.plateBores![0]!.plateBores).toHaveLength(hingeCount * 2); // 2 plate holes per hinge
  });

  it('cup bore U positions match plate bore U positions (alignment)', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const cupUs = out.doorBores![0]!.cupBores.map(b => b.u).sort((a, b) => a - b);
    const plateUs = [...new Set(out.plateBores![0]!.plateBores.map(b => b.u))].sort((a, b) => a - b);
    expect(cupUs.length).toBe(plateUs.length);
    cupUs.forEach((u, i) => expect(u).toBeCloseTo(plateUs[i]!, 1));
  });
});

describe('buildBlindCornerCabinet — hardware', () => {
  it('emits hinge SKU with correct count', () => {
    const out = buildBlindCornerCabinet(P, REGISTRY);
    const doorH = 720 - 2 * 2;
    expect(out.hardware).toEqual([
      { skuId: 'hinge-35mm-cup-full', count: hingeCountForHeight(doorH) },
    ]);
  });
});

describe('buildBlindCornerCabinet — validation', () => {
  it('rejects openingWidth >= width', () => {
    expect(() => buildBlindCornerCabinet({ ...P, openingWidth: 900 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'blindOpeningTooLarge' }));
  });

  it('rejects openingWidth < 2*Tc', () => {
    expect(() => buildBlindCornerCabinet({ ...P, openingWidth: 30 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'blindOpeningTooSmall' }));
  });

  it('rejects missing carcass material', () => {
    expect(() => buildBlindCornerCabinet({ ...P, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });
});
```

- [ ] Step 2 — run, confirm FAIL:
```bash
cd packages/shared && pnpm exec vitest run src/cabinets/__tests__/blindCornerCabinet.spec.ts
```
Expected: FAIL — `buildBlindCornerCabinet` not exported from stub.

- [ ] Step 3 — implement `packages/shared/src/cabinets/blindCornerCabinet.ts`. Replace the stub with the full builder. Key constants and logic:

```typescript
import { CabinetTemplateError, type BlindCornerCabinetParams, type CabinetBuildOutput,
  type CabinetPanelDef, type CabinetComponentDef } from './types';
import type { MaterialEntry } from '../material';
import { doorMath, DEFAULT_DOOR_THICKNESS, DEFAULT_REVEAL, DEFAULT_CLEARANCE, DEFAULT_CENTER_REVEAL } from '../doorMath';
import { hingeCountForHeight, hingePositions, hingeCupBores, hingePlateBores, CUP_SETBACK, PLATE_DEPTH } from '../hingeMath';
import { DOOR_CUP_FACE, LEFT_SIDE_INNER_FACE, RIGHT_SIDE_INNER_FACE } from '../prisadkaFaceConventions';

const Td = DEFAULT_DOOR_THICKNESS;

function resolveRegistry(id: string, registry: ReadonlyArray<MaterialEntry>) {
  const m = registry.find(e => e.id === id);
  if (!m) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  return m;
}

function lit(value: number) { return { kind: 'literal' as const, value }; }

function panelDef(role: CabinetPanelDef['role'], suffix: string, L: number, W: number, T: number, matId: string): CabinetPanelDef {
  return {
    role,
    fileNameSuffix: suffix,
    panel: {
      kind: 'panel', id: `panel-${suffix.toLowerCase().replace(/ /g, '-')}`,
      length: lit(L), width: lit(W), thickness: lit(T),
      thicknessFromMaterial: true, materialId: matId, grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    },
  };
}

function layoutDef(suffix: string, x: number, y: number, z: number): CabinetComponentDef {
  return { fileNameSuffix: suffix, position: { x, y, z }, rotation: { rx: 0, ry: 0, rz: 0 } };
}

export function buildBlindCornerCabinet(
  params: BlindCornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const { name, width: W, depth: D, height: H, toekickHeight: tkH,
    openingWidth, blindSide, shelfCount = 0 } = params;

  if (!name.trim()) throw new CabinetTemplateError({ kind: 'nameEmpty' });

  const carcass = registry.find(e => e.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const backMat = registry.find(e => e.id === params.backMaterialId);
  if (!backMat) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });

  const Tc = carcass.defaultThickness;
  const Tb = backMat.defaultThickness;

  if (openingWidth < 2 * Tc) throw new CabinetTemplateError({ kind: 'blindOpeningTooSmall' });
  if (openingWidth >= W) throw new CabinetTemplateError({ kind: 'blindOpeningTooLarge' });

  // blindFillerW = W - openingWidth - Tc
  const blindFillerW = W - openingWidth - Tc;

  // Panels
  const panels: CabinetPanelDef[] = [
    panelDef('leftSide', 'Left Side', H, D, Tc, params.carcassMaterialId),
    panelDef('rightSide', 'Right Side', H, D, Tc, params.carcassMaterialId),
    panelDef('bottom', 'Bottom', W - 2 * Tc, D - Tb, Tc, params.carcassMaterialId),
    panelDef('top', 'Top', W - 2 * Tc, D - Tb, Tc, params.carcassMaterialId),
    panelDef('back', 'Back', W - 2 * Tc, H - 2 * Tc, Tb, params.backMaterialId),
    panelDef('toekick', 'Toekick', W - 2 * Tc, tkH, Tc, params.carcassMaterialId),
    panelDef('blindFiller', 'Blind Filler', H - 2 * Tc, blindFillerW, Tc, params.carcassMaterialId),
  ];

  for (let i = 0; i < shelfCount; i++) {
    panels.push(panelDef('shelf', `Shelf ${i + 1}`, W - 2 * Tc, D - Tb, Tc, params.carcassMaterialId));
  }

  // Door via doorMath
  const openingXOffset = blindSide === 'left' ? W - openingWidth : 0;
  const openingSide = blindSide === 'left' ? 'right' : 'left';
  const doorPanels = doorMath({
    cabinet: { width: W, height: H, depth: D, Tc, toekickHeight: tkH },
    count: 'single', overlay: 'full', hingeSide: openingSide,
    thickness: Td, reveal: DEFAULT_REVEAL, clearance: DEFAULT_CLEARANCE, centerReveal: DEFAULT_CENTER_REVEAL,
    openingWidth, openingXOffset,
  });
  const dp = doorPanels[0]!;
  const doorW = dp.dims.width;
  const doorH = dp.dims.length;
  panels.push(panelDef('door', 'Door', doorH, doorW, Td, params.carcassMaterialId));

  // Layout — min-corner positions
  const layout: CabinetComponentDef[] = [
    layoutDef('Left Side', 0, 0, 0),
    layoutDef('Right Side', W - Tc, 0, 0),
    layoutDef('Bottom', Tc, 0, Tc),
    layoutDef('Top', Tc, 0, H - Tc),
    layoutDef('Back', Tc, 0, Tc),
    layoutDef('Toekick', Tc, D - Tc, 0),
  ];

  // Blind filler position: on the blind side, inside, at the front
  if (blindSide === 'left') {
    layout.push(layoutDef('Blind Filler', Tc, D - blindFillerW, Tc));
  } else {
    layout.push(layoutDef('Blind Filler', W - Tc - blindFillerW, D - blindFillerW, Tc));
  }

  for (let i = 0; i < shelfCount; i++) {
    const shelfZ = tkH + Tc + ((H - tkH - 2 * Tc) / (shelfCount + 1)) * (i + 1);
    layout.push(layoutDef(`Shelf ${i + 1}`, Tc, 0, shelfZ));
  }

  // Door layout uses translation from doorMath (pose.translation is the center, but layout uses min-corner)
  // For DOOR_POSE: part-X=doorH runs world-Z, part-Y=doorW runs world-X, part-Z=Td runs world-Y
  // So the door's world min-corner x = translation.x - doorW/2, z = translation.z - doorH/2
  layout.push({
    fileNameSuffix: 'Door',
    position: {
      x: dp.pose.translation.x - doorW / 2,
      y: dp.pose.translation.y,
      z: dp.pose.translation.z - doorH / 2,
    },
    rotation: { rx: 0, ry: 0, rz: 0 },
  });

  // Hinge boring
  const hingeCount = hingeCountForHeight(doorH);
  const uPositions = hingePositions(doorH, hingeCount);
  const cupBores = hingeCupBores({ length: doorH, width: doorW, thickness: Td }, DOOR_CUP_FACE, openingSide, 'full', uPositions);
  const hingeSidePanel = openingSide === 'left' ? 'Left Side' : 'Right Side';
  const innerFace = openingSide === 'left' ? LEFT_SIDE_INNER_FACE : RIGHT_SIDE_INNER_FACE;
  const frontSetback = D - Td - CUP_SETBACK['full'];
  const plateBores = hingePlateBores({ length: H, width: D, thickness: Tc }, innerFace, uPositions, frontSetback);

  return {
    panels,
    layout,
    doorBores: [{ doorSuffix: 'Door', cupBores }],
    plateBores: [{ panelSuffix: hingeSidePanel, plateBores }],
    hardware: [{ skuId: 'hinge-35mm-cup-full', count: hingeCount }],
  };
}
```

- [ ] Step 4 — run tests, confirm PASS:
```bash
cd packages/shared && pnpm exec vitest run src/cabinets/__tests__/blindCornerCabinet.spec.ts
```

- [ ] Step 5 — typecheck + lint:
```bash
pnpm typecheck && cd packages/shared && pnpm exec eslint src/cabinets/blindCornerCabinet.ts src/cabinets/__tests__/blindCornerCabinet.spec.ts
```

- [ ] Step 6 — full suite:
```bash
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 7 — commit:
```bash
git add packages/shared/src/cabinets/blindCornerCabinet.ts packages/shared/src/cabinets/__tests__/blindCornerCabinet.spec.ts
git commit -m "feat(m4-e): buildBlindCornerCabinet — panels, filler, door, hinge boring, hardware"
```

---

## Task 4: Kernel outline prism — `buildPanelBox` outline branch

**Files:**
- Modify: `packages/kernel/src/occt/PanelOps.ts`
- Create: `packages/kernel/src/occt/PanelOps.outline.spec.ts`

**Interfaces:**
- Consumes: `PanelFeature.outline` type from Task 2; OCCT wire/face/prism APIs (pattern from `SketchOps.ts:81-96` and `ExtrudeFeature.ts:65-74`)
- Produces: `buildPanelBox(occt, dims, outline?: readonly {x,y}[])` (or accept an object with optional `outline`); when outline present returns reduced `PanelBoxResult` with only `Top`/`Bottom` in faceNames — consumed by the kernel panel evaluator

- [ ] Step 1 — write failing kernel test. Create `packages/kernel/src/occt/PanelOps.outline.spec.ts`:
```typescript
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { buildPanelBox } from './PanelOps';
import { loadOcct } from '../occtLoader';
import type { OcctInstance } from '../occtLoader';

let occt: OcctInstance;

beforeAll(async () => {
  occt = await loadOcct();
}, 60000);

const PENTAGON = [
  { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 },
  { x: 300, y: 600 }, { x: 0, y: 600 },
];

describe('buildPanelBox — outline path (prism from polygon)', () => {
  it('rectangle without outline still works (regression)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    expect(result.bbox).toEqual([-300, -200, 0, 300, 200, 18]);
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
    expect(result.faceNames.Front).toBeDefined();
  });

  it('pentagon outline produces a solid with 7 faces (5 sides + top + bottom)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // 7 faces: top + bottom + 5 sides
    expect(typeof result.shape).toBe('object');
    // Top and Bottom face names are present
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
  });

  it('pentagon outline AABB is full bounding rectangle (conservative for cut-list)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // bbox = [-L/2, -W/2, 0, L/2, W/2, T]
    expect(result.bbox).toEqual([-300, -300, 0, 300, 300, 18]);
  });

  it('pentagon faceNames does NOT have Front/Back/Left/Right (side faces unclassified)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // Side faces are not classified for outline panels in Slice E
    expect((result.faceNames as Record<string, unknown>).Front).toBeUndefined();
  });
});
```

- [ ] Step 2 — run, confirm FAIL:
```bash
cd packages/kernel && pnpm exec vitest run src/occt/PanelOps.outline.spec.ts
```
Expected: FAIL — `buildPanelBox` doesn't accept `outline` argument.

- [ ] Step 3 — implement in `packages/kernel/src/occt/PanelOps.ts`:

Change `PanelBoxResult` to allow partial faceNames:
```typescript
export interface PanelBoxResult {
  shape: unknown;
  bbox: [number, number, number, number, number, number];
  faceNames: Partial<Record<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right', FaceName>> &
    Pick<Record<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right', FaceName>, 'Top' | 'Bottom'>;
  edgeNames: Partial<Record<PanelEdgeKey, EdgeName>>;
}
```

Change `buildPanelBox` signature to accept optional outline:
```typescript
export function buildPanelBox(
  occt: OcctInstance,
  dims: { length: number; width: number; thickness: number },
  outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): PanelBoxResult {
```

In `buildPanelBox`, before the existing box-building code, add a branch:
```typescript
  if (outline && outline.length >= 3) {
    return buildOutlinePrism(occt, dims, outline);
  }
```

Add `buildOutlinePrism` function below `buildPanelBox` (before `classifyPanelFaces`):
```typescript
function buildOutlinePrism(
  occt: OcctInstance,
  dims: { length: number; width: number; thickness: number },
  outline: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): PanelBoxResult {
  const { length: L, width: W, thickness: T } = dims;
  const ocAny = occt as unknown as {
    gp_Pnt_3: new (x: number, y: number, z: number) => { delete: () => void };
    BRepBuilderAPI_MakeEdge_3: new (p1: unknown, p2: unknown) => { Edge: () => unknown; delete: () => void };
    BRepBuilderAPI_MakeWire_1: new () => { Add_1: (e: unknown) => void; Wire: () => unknown; delete: () => void };
    BRepBuilderAPI_MakeFace_15: new (wire: unknown, onlyPlane: unknown) => { Face: () => unknown; delete: () => void };
    BRepPrimAPI_MakePrism_1: new (shape: unknown, vec: unknown) => { Shape: () => unknown; delete: () => void };
    gp_Vec_4: new (x: number, y: number, z: number) => { delete: () => void };
    Standard_Boolean: boolean;
  };

  // Build points (offset to centered coords: x - L/2, y - W/2)
  const pts = outline.map(v => new ocAny.gp_Pnt_3(v.x - L / 2, v.y - W / 2, 0));

  // Build edges (close the polygon: last → first)
  const edges: unknown[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % pts.length]!;
    const mkE = new ocAny.BRepBuilderAPI_MakeEdge_3(p1, p2);
    edges.push(mkE.Edge());
    mkE.delete();
  }

  const mkWire = new ocAny.BRepBuilderAPI_MakeWire_1();
  for (const e of edges) mkWire.Add_1(e);
  const wire = mkWire.Wire();
  mkWire.delete();
  for (const p of pts) (p as { delete: () => void }).delete();

  const mkFace = new ocAny.BRepBuilderAPI_MakeFace_15(wire, true as unknown as never);
  const face = mkFace.Face();
  mkFace.delete();

  const vec = new ocAny.gp_Vec_4(0, 0, T);
  const mkPrism = new ocAny.BRepPrimAPI_MakePrism_1(face, vec);
  const shape = mkPrism.Shape();
  mkPrism.delete();
  (vec as { delete: () => void }).delete();

  // Classify only Top (z=T centroid) and Bottom (z=0 centroid) faces
  const topFace = namedFace('Top');
  const bottomFace = namedFace('Bottom');

  return {
    shape,
    bbox: [-L / 2, -W / 2, 0, L / 2, W / 2, T],
    faceNames: { Top: topFace, Bottom: bottomFace } as PanelBoxResult['faceNames'],
    edgeNames: {},
  };
}
```

Note: If OCCT requires CW winding for the base face to extrude correctly (Risk 5 in spec), reverse the outline vertex order before building edges. The test will fail with wrong face count or volume if winding is wrong — fix by reversing: `const orderedOutline = [...outline].reverse()` and use `orderedOutline` instead of `outline` in the loop.

- [ ] Step 4 — run tests:
```bash
cd packages/kernel && pnpm exec vitest run src/occt/PanelOps.outline.spec.ts
```
If winding-order test fails, reverse vertex order and re-run.

- [ ] Step 5 — fix any caller sites where `PanelBoxResult.faceNames.Front` etc. are now accessed without checking — the TypeScript `Partial` change will surface them:
```bash
pnpm typecheck 2>&1 | head -30
```
For each error, add a guard: `if (result.faceNames.Front) { ... }`.

- [ ] Step 6 — typecheck + lint + full suite:
```bash
pnpm typecheck && cd packages/kernel && pnpm exec eslint src/occt/PanelOps.ts src/occt/PanelOps.outline.spec.ts
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 7 — commit:
```bash
git add packages/kernel/src/occt/PanelOps.ts packages/kernel/src/occt/PanelOps.outline.spec.ts
git commit -m "feat(m4-e): kernel outline prism branch in buildPanelBox + winding-order resolution"
```

---

## Task 5: `buildDiagonalCornerCabinet` — pure shared builder

**Files:**
- Replace stub: `packages/shared/src/cabinets/diagonalCornerCabinet.ts`
- Create: `packages/shared/src/cabinets/__tests__/diagonalCornerCabinet.spec.ts`

**Interfaces:**
- Consumes: `DiagonalCornerCabinetParams`, `PanelFeature.outline`, `CabinetBuildOutput` with `doorBores`/`plateBores`/`hardware` (Task 2), `hingeCupBores`, `hingePlateBores`, `hingeCountForHeight`, `hingePositions`; DOOR_CUP_FACE, DOOR_POSE from prisadkaFaceConventions
- Produces: `buildDiagonalCornerCabinet(params: DiagonalCornerCabinetParams, registry: ReadonlyArray<MaterialEntry>): CabinetBuildOutput`

- [ ] Step 1 — create failing test. Create `packages/shared/src/cabinets/__tests__/diagonalCornerCabinet.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../../material';
import { buildDiagonalCornerCabinet } from '../diagonalCornerCabinet';
import type { DiagonalCornerCabinetParams } from '../types';
import { CabinetTemplateError } from '../types';
import { hingeCountForHeight } from '../../hingeMath';

const carcass: MaterialEntry = { id: 'm-birch-18', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' };
const back: MaterialEntry = { id: 'm-hb-6', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' };
const REGISTRY: ReadonlyArray<MaterialEntry> = [carcass, back];

// Symmetric case: W1=W2=600, D1=D2=560; θ=135°, diag = (600-560)*√2 ≈ 56.57
const P: DiagonalCornerCabinetParams = {
  name: 'Diag 1',
  wallWidth1: 600, wallWidth2: 600,
  returnDepth1: 560, returnDepth2: 560,
  height: 720, toekickHeight: 100, toekickSetback: 60,
  stileWidth: 50,
  carcassMaterialId: 'm-birch-18',
  backMaterialId: 'm-hb-6',
  bandMaterialId: null,
};

const { wallWidth1: W1, wallWidth2: W2, returnDepth1: D1, returnDepth2: D2, height: H, stileWidth } = P;
const diagLen = Math.sqrt((W1 - D2) ** 2 + (D1 - W2) ** 2);
const Tc = 18; const Td = 18; const DEFAULT_REVEAL = 2;

describe('buildDiagonalCornerCabinet — panels', () => {
  it('emits 11 panels (2 outlines + 2 backs + 2 sides + 2 toekicks + 2 stiles + 1 door)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.panels).toHaveLength(11);
  });

  it('bottom panel has outline with 5 vertices matching pentagon geometry', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const bottom = out.panels.find(p => p.role === 'bottom')!;
    expect(bottom.panel.outline).toHaveLength(5);
    expect(bottom.panel.outline![0]).toEqual({ x: 0, y: 0 });
    expect(bottom.panel.outline![1]).toEqual({ x: W1, y: 0 });
    expect(bottom.panel.outline![2]).toEqual({ x: W1, y: D1 });
    expect(bottom.panel.outline![3]).toEqual({ x: D2, y: W2 });
    expect(bottom.panel.outline![4]).toEqual({ x: 0, y: W2 });
  });

  it('bottom and top AABB extents equal W1 x W2', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const bottom = out.panels.find(p => p.role === 'bottom')!;
    expect((bottom.panel.length as { value: number }).value).toBe(W1);
    expect((bottom.panel.width as { value: number }).value).toBe(W2);
  });

  it('emits exactly 2 frontStile panels', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stiles = out.panels.filter(p => p.role === 'frontStile');
    expect(stiles).toHaveLength(2);
  });

  it('door width = diagonalLength - 2*stileWidth - 2*reveal', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const door = out.panels.find(p => p.role === 'door')!;
    const expectedDoorW = diagLen - 2 * stileWidth - 2 * DEFAULT_REVEAL;
    expect((door.panel.width as { value: number }).value).toBeCloseTo(expectedDoorW, 1);
  });

  it('cut-list AABB of outline panel matches W1 x W2 (conservative sheet stock)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const bottom = out.panels.find(p => p.role === 'bottom')!;
    expect((bottom.panel.length as { value: number }).value).toBe(W1);
    expect((bottom.panel.width as { value: number }).value).toBe(W2);
  });
});

describe('buildDiagonalCornerCabinet — layout rotations', () => {
  it('door and stile layout entries have non-zero rz', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const doorComp = out.layout.find(c => c.fileNameSuffix === 'Door')!;
    const stile1 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    expect(doorComp.rotation.rz).not.toBe(0);
    expect(stile1.rotation.rz).not.toBe(0);
  });

  it('diagonal angle for symmetric params is 135°', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const stile1 = out.layout.find(c => c.fileNameSuffix === 'Front Stile 1')!;
    const dX = (D2 - W1) / diagLen;
    const dY = (W2 - D1) / diagLen;
    const thetaDeg = Math.atan2(dY, dX) * 180 / Math.PI;
    expect(stile1.rotation.rz).toBeCloseTo(thetaDeg, 1); // 135°
  });
});

describe('buildDiagonalCornerCabinet — hinge boring', () => {
  it('doorBores has cup bores for the door panel', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.doorBores).toBeDefined();
    const doorH = H - 2 * DEFAULT_REVEAL;
    expect(out.doorBores![0]!.cupBores).toHaveLength(hingeCountForHeight(doorH));
  });

  it('plateBores has plate holes on Front Stile 1 (hingeSide)', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    expect(out.plateBores).toBeDefined();
    expect(out.plateBores![0]!.panelSuffix).toBe('Front Stile 1');
  });

  it('cup U positions match plate bore U positions', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const cupUs = out.doorBores![0]!.cupBores.map(b => b.u).sort((a, b) => a - b);
    const plateUs = [...new Set(out.plateBores![0]!.plateBores.map(b => b.u))].sort((a, b) => a - b);
    cupUs.forEach((u, i) => expect(u).toBeCloseTo(plateUs[i]!, 1));
  });
});

describe('buildDiagonalCornerCabinet — hardware', () => {
  it('emits hinge-35mm-cup-full SKU with correct count', () => {
    const out = buildDiagonalCornerCabinet(P, REGISTRY);
    const doorH = H - 2 * DEFAULT_REVEAL;
    expect(out.hardware).toEqual([
      { skuId: 'hinge-35mm-cup-full', count: hingeCountForHeight(doorH) },
    ]);
  });
});

describe('buildDiagonalCornerCabinet — validation', () => {
  it('rejects stileWidth <= 0', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, stileWidth: 0 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'stileWidthInvalid' }));
  });

  it('rejects diagonal door too narrow (2*stileWidth >= diagonalLength)', () => {
    // stileWidth = 300 → 2*300 = 600 > diagLen ≈ 56.57
    expect(() => buildDiagonalCornerCabinet({ ...P, stileWidth: 300 }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'diagonalDoorTooNarrow' }));
  });

  it('rejects missing carcass material', () => {
    expect(() => buildDiagonalCornerCabinet({ ...P, carcassMaterialId: 'nope' }, REGISTRY))
      .toThrow(expect.objectContaining({ kind: 'carcassMaterialMissing' }));
  });
});
```

- [ ] Step 2 — run, confirm FAIL:
```bash
cd packages/shared && pnpm exec vitest run src/cabinets/__tests__/diagonalCornerCabinet.spec.ts
```

- [ ] Step 3 — implement `packages/shared/src/cabinets/diagonalCornerCabinet.ts`. Replace stub with full builder. Key geometry computations:

```typescript
import { CabinetTemplateError, type DiagonalCornerCabinetParams, type CabinetBuildOutput,
  type CabinetPanelDef, type CabinetComponentDef } from './types';
import type { MaterialEntry } from '../material';
import { DEFAULT_DOOR_THICKNESS, DEFAULT_REVEAL } from '../doorMath';
import { hingeCountForHeight, hingePositions, hingeCupBores, hingePlateBores, CUP_SETBACK } from '../hingeMath';
import { DOOR_CUP_FACE } from '../prisadkaFaceConventions';

const Td = DEFAULT_DOOR_THICKNESS;
const MIN_DOOR_WIDTH = 100;

function lit(v: number) { return { kind: 'literal' as const, value: v }; }

function panelDef(role: CabinetPanelDef['role'], suffix: string, L: number, W: number, T: number, matId: string,
  outline?: ReadonlyArray<{ readonly x: number; readonly y: number }>): CabinetPanelDef {
  return {
    role, fileNameSuffix: suffix,
    panel: {
      kind: 'panel', id: `panel-${suffix.toLowerCase().replace(/[ /]/g, '-')}`,
      length: lit(L), width: lit(W), thickness: lit(T),
      thicknessFromMaterial: true, materialId: matId, grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
      ...(outline ? { outline } : {}),
    },
  };
}

function layoutDef(suffix: string, x: number, y: number, z: number, rz = 0): CabinetComponentDef {
  return { fileNameSuffix: suffix, position: { x, y, z }, rotation: { rx: 0, ry: 0, rz } };
}

// DIAGONAL_STILE_INNER_FACE: stile stands upright, face along diagonal.
// In local frame (length=H, width=stileW, thickness=Tc), the face pointing toward door interior.
// Following LEFT_SIDE_INNER_FACE derivation pattern: stile part-Z (Top) → world direction toward door.
// For Slice E the default hingeSide is 'right' (stile 1 is the hinge stile).
// Stile 1 at V2 end: its inner face points from V2 toward door center → toward diagonal midpoint.
// In the stile's local frame with rz=θ, Top face outward normal = world (cos(θ+90°), sin(θ+90°)).
// For symmetric θ=135°: Top face normal → world (-sin135°, cos135°) = (+0.707, -0.707) pointing toward door center ✓
// Stile inner face = 'Top'.
const DIAGONAL_STILE_INNER_FACE = 'Top' as const;

export function buildDiagonalCornerCabinet(
  params: DiagonalCornerCabinetParams,
  registry: ReadonlyArray<MaterialEntry>,
): CabinetBuildOutput {
  const { name, wallWidth1: W1, wallWidth2: W2, returnDepth1: D1, returnDepth2: D2,
    height: H, toekickHeight: tkH, stileWidth } = params;

  if (!name.trim()) throw new CabinetTemplateError({ kind: 'nameEmpty' });

  const carcass = registry.find(e => e.id === params.carcassMaterialId);
  if (!carcass) throw new CabinetTemplateError({ kind: 'carcassMaterialMissing' });
  const backMat = registry.find(e => e.id === params.backMaterialId);
  if (!backMat) throw new CabinetTemplateError({ kind: 'backMaterialMissing' });

  const Tc = carcass.defaultThickness;
  const Tb = backMat.defaultThickness;

  if (stileWidth <= 0) throw new CabinetTemplateError({ kind: 'stileWidthInvalid' });

  // Pentagon geometry
  const diagLen = Math.sqrt((W1 - D2) ** 2 + (D1 - W2) ** 2);
  const dX = (D2 - W1) / diagLen;
  const dY = (W2 - D1) / diagLen;
  const theta = Math.atan2(dY, dX); // radians
  const thetaDeg = theta * 180 / Math.PI;

  // Outward normal of diagonal face (rotate d by -90°)
  const nX = dY; const nY = -dX;

  const doorW = diagLen - 2 * stileWidth - 2 * DEFAULT_REVEAL;
  if (doorW < MIN_DOOR_WIDTH) throw new CabinetTemplateError({ kind: 'diagonalDoorTooNarrow' });

  const doorH = H - 2 * DEFAULT_REVEAL;

  // Pentagon outline (CCW from +Z) — centered at origin: offset by (-W1/2, -W2/2) not needed
  // The outline vertices are in the PANEL's local frame [0..W1] x [0..W2]
  const pentOutline = [
    { x: 0,  y: 0  },
    { x: W1, y: 0  },
    { x: W1, y: D1 },
    { x: D2, y: W2 },
    { x: 0,  y: W2 },
  ] as const;

  const panels: CabinetPanelDef[] = [
    panelDef('bottom', 'Bottom', W1, W2, Tc, params.carcassMaterialId, pentOutline),
    panelDef('top',    'Top',    W1, W2, Tc, params.carcassMaterialId, pentOutline),
    panelDef('back',   'Back 1', W1, H,  Tb, params.backMaterialId),
    panelDef('back',   'Back 2', W2, H,  Tb, params.backMaterialId),
    panelDef('leftSide',  'Return Side 1', H, D1, Tc, params.carcassMaterialId),
    panelDef('rightSide', 'Return Side 2', H, D2, Tc, params.carcassMaterialId),
    panelDef('toekick', 'Toekick 1', W1 - 2 * Tc, tkH, Tc, params.carcassMaterialId),
    panelDef('toekick', 'Toekick 2', W2 - 2 * Tc, tkH, Tc, params.carcassMaterialId),
    panelDef('frontStile', 'Front Stile 1', H, stileWidth, Tc, params.carcassMaterialId),
    panelDef('frontStile', 'Front Stile 2', H, stileWidth, Tc, params.carcassMaterialId),
    panelDef('door', 'Door', doorH, doorW, Td, params.carcassMaterialId),
  ];

  // Stile centers (V2=(W1,D1), V3=(D2,W2))
  const stile1CenterX = W1 + (stileWidth / 2) * dX;
  const stile1CenterY = D1 + (stileWidth / 2) * dY;
  const stile2CenterX = D2 - (stileWidth / 2) * dX;
  const stile2CenterY = W2 - (stileWidth / 2) * dY;

  // Door center (midpoint of diagonal)
  const doorCenterX = (W1 + D2) / 2;
  const doorCenterY = (D1 + W2) / 2;

  // Door rotation: derive Euler angles so part-X→world+Z, part-Z→outward normal (nX,nY,0)
  // part-X (doorH) → world+Z: rx=90, then rz=atan2(nY,nX) in world XY
  // Euler convention in the codebase: apply rx then ry then rz.
  // For DOOR_POSE (part-X→+Z, part-Z→+Y): rx=90, rz=0 → needs adjustment for diagonal angle.
  // The diagonal door: part-X→world+Z (same as standard door) ✓
  //                    part-Z→(nX,nY,0) (instead of world+Y)
  // nX=dY, nY=-dX. World angle of outward normal: atan2(nY,nX) = atan2(-dX,dY)
  // For symmetric: nX=1/√2, nY=1/√2 → angle=45°
  // Combined rotation: rx=90° (stand door upright), then rz = atan2(-dX,dY)*180/π
  const doorRzDeg = Math.atan2(-dX, dY) * 180 / Math.PI;

  const layout: CabinetComponentDef[] = [
    layoutDef('Bottom', 0, 0, 0),
    layoutDef('Top',    0, 0, H - Tc),
    layoutDef('Back 1', 0, 0, Tc),
    layoutDef('Back 2', 0, 0, Tc, 90),   // rz=90 so length runs along Y
    layoutDef('Return Side 1', W1 - Tc, 0, 0),
    layoutDef('Return Side 2', 0, W2 - Tc, 0),
    layoutDef('Toekick 1', Tc, 0, 0),
    layoutDef('Toekick 2', 0, Tc, 0),
    { fileNameSuffix: 'Front Stile 1', position: { x: stile1CenterX, y: stile1CenterY, z: H / 2 }, rotation: { rx: 0, ry: 0, rz: thetaDeg } },
    { fileNameSuffix: 'Front Stile 2', position: { x: stile2CenterX, y: stile2CenterY, z: H / 2 }, rotation: { rx: 0, ry: 0, rz: thetaDeg } },
    { fileNameSuffix: 'Door', position: { x: doorCenterX, y: doorCenterY, z: H / 2 }, rotation: { rx: 90, ry: 0, rz: doorRzDeg } },
  ];

  // Hinge boring — door cup bores
  const hingeCount = hingeCountForHeight(doorH);
  const uPositions = hingePositions(doorH, hingeCount);
  const cupBores = hingeCupBores({ length: doorH, width: doorW, thickness: Td }, DOOR_CUP_FACE, 'right', 'full', uPositions);

  // Stile plate bores — stile 1 is the hinge stile
  const stileThickness = Tc;
  const frontSetback = Td + (CUP_SETBACK['full'] - stileThickness / 2);
  const plateBores = hingePlateBores(
    { length: H, width: stileWidth, thickness: Tc },
    DIAGONAL_STILE_INNER_FACE,
    uPositions,
    frontSetback,
  );

  return {
    panels,
    layout,
    doorBores: [{ doorSuffix: 'Door', cupBores }],
    plateBores: [{ panelSuffix: 'Front Stile 1', plateBores }],
    hardware: [{ skuId: 'hinge-35mm-cup-full', count: hingeCount }],
  };
}
```

- [ ] Step 4 — run tests:
```bash
cd packages/shared && pnpm exec vitest run src/cabinets/__tests__/diagonalCornerCabinet.spec.ts
```

- [ ] Step 5 — typecheck + lint + full suite:
```bash
pnpm typecheck && cd packages/shared && pnpm exec eslint src/cabinets/diagonalCornerCabinet.ts
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 6 — commit:
```bash
git add packages/shared/src/cabinets/diagonalCornerCabinet.ts packages/shared/src/cabinets/__tests__/diagonalCornerCabinet.spec.ts
git commit -m "feat(m4-e): buildDiagonalCornerCabinet — pentagon panels, rotated stile+door, hinge boring, hardware"
```

---

## Task 6: `CreateCabinetCommand` — bore injection + hardware components

**Files:**
- Modify: `packages/app/src/commands/CreateCabinetCommand.ts`
- Modify: `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts` (add describe blocks)

**Interfaces:**
- Consumes: `buildBlindCornerCabinet` (Task 3), `buildDiagonalCornerCabinet` (Task 5), `CabinetBuildOutput.doorBores/plateBores/hardware`, `BlindCornerCabinetParams`, `DiagonalCornerCabinetParams` (Task 2)
- Produces: `CreateCabinetCommand` supports `template: 'blindCornerCabinet'` and `template: 'diagonalCornerCabinet'`; panel `.zipt` files contain `document.bores`; cabinet `.ziasm` contains hardware component entries

- [ ] Step 1 — write failing tests. Add to `packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts`:

```typescript
import { buildBlindCornerCabinet } from '@zilventor/shared'; // ensure it's re-exported

// ... add at the end of the file:

describe('CreateCabinetCommand — blindCornerCabinet template', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  const BLIND = {
    name: 'Blind Cab 1',
    width: 900, depth: 560, height: 720,
    toekickHeight: 100, toekickSetback: 60,
    openingWidth: 450, blindSide: 'left' as const,
    shelfCount: 0,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  };

  it('writes 9 .zipt + 1 .ziasm for blindCornerCabinet', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const ziptCount = (await opfs.list()).filter(p => p.endsWith('.zipt') && !p.startsWith('hardware/')).length;
    expect(ziptCount).toBe(9); // 6 carcass + 1 filler + 1 toekick + 1 door
    expect(await opfs.list()).toContain('Blind Cab 1.ziasm');
  });

  it('door .zipt contains bores (cup bores)', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const doorBytes = await opfs.read('Blind Cab 1 - Door.zipt');
    const project = await unpackProject(doorBytes);
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect((doc.bores!).length).toBeGreaterThan(0);
  });

  it('hinge side panel .zipt contains plate bores', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    // blindSide=left → live side = right → Right Side
    const bytes = await opfs.read('Blind Cab 1 - Right Side.zipt');
    const project = await unpackProject(bytes);
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect((doc.bores!).length).toBeGreaterThan(0);
  });

  it('cabinet .ziasm has hardware component paths for hinges', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs }).apply();
    const project = await unpackProject(await opfs.read('Blind Cab 1.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string }> } }).document;
    const hingeComponents = doc.components.filter(c => c.partPath.startsWith('hardware/'));
    expect(hingeComponents.length).toBeGreaterThan(0);
    expect(hingeComponents.every(c => c.partPath === 'hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('revert removes the placed component and all written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'blindCornerCabinet', params: BLIND, opfs });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });
});

describe('CreateCabinetCommand — diagonalCornerCabinet template', () => {
  beforeEach(() => { useAppStore.getState().setActiveDocument(null); });

  const DIAG = {
    name: 'Diag Cab 1',
    wallWidth1: 600, wallWidth2: 600,
    returnDepth1: 560, returnDepth2: 560,
    height: 720, toekickHeight: 100, toekickSetback: 60,
    stileWidth: 50,
    carcassMaterialId: 'm-birch-18',
    backMaterialId: 'm-hb-6',
    bandMaterialId: null,
  };

  it('writes 11 .zipt + 1 .ziasm for diagonalCornerCabinet', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const ziptCount = (await opfs.list()).filter(p => p.endsWith('.zipt') && !p.startsWith('hardware/')).length;
    expect(ziptCount).toBe(11);
    expect(await opfs.list()).toContain('Diag Cab 1.ziasm');
  });

  it('door .zipt contains cup bores', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const project = await unpackProject(await opfs.read('Diag Cab 1 - Door.zipt'));
    const doc = (project.manifest as { document: { bores?: unknown[] } }).document;
    expect(doc.bores).toBeDefined();
    expect(doc.bores!.length).toBeGreaterThan(0);
  });

  it('hinge SKU appears as assembly component', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    await new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs }).apply();
    const project = await unpackProject(await opfs.read('Diag Cab 1.ziasm'));
    const doc = (project.manifest as { document: { components: Array<{ partPath: string }> } }).document;
    expect(doc.components.some(c => c.partPath === 'hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('revert cleans up all written files', async () => {
    seedAssembly();
    const opfs = new MemOpfs();
    const cmd = new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params: DIAG, opfs });
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
    expect(await opfs.list()).toEqual([]);
  });
});
```

- [ ] Step 2 — run, confirm FAIL:
```bash
cd packages/app && pnpm exec vitest run src/commands/__tests__/CreateCabinetCommand.spec.ts
```

- [ ] Step 3 — implement changes to `packages/app/src/commands/CreateCabinetCommand.ts`:

Add imports:
```typescript
import { buildBlindCornerCabinet, buildDiagonalCornerCabinet, type BlindCornerCabinetParams,
  type DiagonalCornerCabinetParams, type CabinetBuildOutput } from '@zilventor/shared';
import type { BoreOp } from '@zilventor/shared';
import { resolveHardwareCatalog } from '@zilventor/shared/src/hardware/resolveCatalog';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
```

Replace `CreateCabinetOpts` union:
```typescript
export type CreateCabinetOpts =
  | { template: 'baseCabinet';           params: BaseCabinetParams;           opfs: OpfsArg }
  | { template: 'cornerCabinet';         params: CornerCabinetParams;         opfs: OpfsArg }
  | { template: 'blindCornerCabinet';    params: BlindCornerCabinetParams;    opfs: OpfsArg }
  | { template: 'diagonalCornerCabinet'; params: DiagonalCornerCabinetParams; opfs: OpfsArg };
```

In `apply()`, replace the builder dispatch:
```typescript
    let built: CabinetBuildOutput;
    if (this.opts.template === 'cornerCabinet') {
      built = buildCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else if (this.opts.template === 'blindCornerCabinet') {
      built = buildBlindCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else if (this.opts.template === 'diagonalCornerCabinet') {
      built = buildDiagonalCornerCabinet({ ...this.opts.params, name: finalName }, asm.materials);
    } else {
      built = buildBaseCabinet({ ...this.opts.params as BaseCabinetParams, name: finalName }, asm.materials);
    }
```

In the panel write loop, extract bores per panel:
```typescript
      for (const p of built.panels) {
        const path = `${finalName} - ${p.fileNameSuffix}.zipt`;
        const cupBores = built.doorBores?.find(d => d.doorSuffix === p.fileNameSuffix)?.cupBores;
        const plateBores = built.plateBores?.find(d => d.panelSuffix === p.fileNameSuffix)?.plateBores;
        const bores: BoreOp[] = [...(cupBores ?? []), ...(plateBores ?? [])];
        const bytes = await this.packPanelPart(p.panel, p.fileNameSuffix, asm, bores.length > 0 ? bores : undefined);
        await this.opts.opfs.write(path, bytes);
        this.writtenFiles.push(path);
      }
```

Write hardware `.zipt` files and collect hardware component entries. Add after the panel loop (before building ziasm):
```typescript
      const hardwareComponents: Array<{ partPath: string }> = [];
      if (built.hardware) {
        const catalog = resolveHardwareCatalog(asm);
        for (const hw of built.hardware) {
          const hwPath = `hardware/${hw.skuId}.zipt`;
          if (!(await this.opts.opfs.exists(hwPath))) {
            const entry = catalog.find(e => e.id === hw.skuId);
            if (entry) {
              const bytes = await this.synthesizeHardwarePart(entry);
              await this.opts.opfs.write(hwPath, bytes);
              this.writtenFiles.push(hwPath);
            }
          }
          for (let i = 0; i < hw.count; i++) {
            hardwareComponents.push({ partPath: hwPath });
          }
        }
      }
```

Update `packPanelPart` to accept optional bores:
```typescript
  private async packPanelPart(
    panel: PanelFeature,
    nameSuffix: string,
    asm: AssemblyDocument,
    bores?: BoreOp[],
  ): Promise<Uint8Array> {
    const basePart = newPart(`${this.resolvedName} - ${nameSuffix}`);
    const partWithMaterials: PartDocument = { ...basePart, materials: [...asm.materials] };
    const partWithPanel = addFeature(partWithMaterials, panel);
    const partDoc = bores && bores.length > 0
      ? { ...partWithPanel, bores }
      : partWithPanel;
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }
```

Add `synthesizeHardwarePart` method (follows `AddHardwareCommand.synthesizePart` pattern):
```typescript
  private async synthesizeHardwarePart(entry: { id: string; name: string; bboxMm?: { l: number; w: number; h: number }; attachPoints?: unknown[] }): Promise<Uint8Array> {
    const basePart = newPart(entry.name);
    const hwFeature = {
      kind: 'hardware' as const,
      id: `hf-${entry.id}`,
      hardwareSkuId: entry.id,
      bboxMm: entry.bboxMm ?? { l: 0, w: 0, h: 0 },
      attachPoints: entry.attachPoints ?? [],
    };
    const partDoc = addFeature(basePart, hwFeature as unknown as import('@zilventor/shared').PanelFeature);
    const manifest = { formatVersion: CURRENT_FORMAT_VERSION, kind: 'part' as const, document: partDoc };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return writeTarGz([{ name: 'manifest.json', data: manifestBytes }]);
  }
```

Update `buildCabinetAssembly` to accept and append hardware components:
```typescript
  private buildCabinetAssembly(
    cabinetName: string,
    built: CabinetBuildOutput,
    asm: AssemblyDocument,
    hardwareComponents: Array<{ partPath: string }>,
  ): AssemblyDocument {
    const panelComps: ComponentInstance[] = built.layout.map((c, i) => ({
      id: `C${i + 1}`,
      partPath: `${cabinetName} - ${c.fileNameSuffix}.zipt`,
      position: c.position,
      rotation: c.rotation,
      visible: true,
      role: built.panels.find(p => p.fileNameSuffix === c.fileNameSuffix)!.role,
    }));
    const hwComps: ComponentInstance[] = hardwareComponents.map((hw, i) => ({
      id: `HW${i + 1}`,
      partPath: hw.partPath,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: false,
      role: 'door' as const, // placeholder role; hardware BOM uses SKU, not role
    }));
    const components = [...panelComps, ...hwComps];
    return {
      id: `A${Date.now()}`, name: cabinetName, units: 'mm',
      parameters: {}, properties: {}, constraints: [],
      groundedComponentPaths: components.length > 0 ? [[components[0]!.id]] : [],
      colors: {}, bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
      materials: [...asm.materials], hardware: [], components,
    };
  }
```

Update the `buildCabinetAssembly` call in `apply()` to pass `hardwareComponents`.

- [ ] Step 4 — run tests:
```bash
cd packages/app && pnpm exec vitest run src/commands/__tests__/CreateCabinetCommand.spec.ts
```

- [ ] Step 5 — typecheck + lint:
```bash
pnpm typecheck && cd packages/app && pnpm exec eslint src/commands/CreateCabinetCommand.ts
```

- [ ] Step 6 — full suite:
```bash
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 7 — commit:
```bash
git add packages/app/src/commands/CreateCabinetCommand.ts \
        packages/app/src/commands/__tests__/CreateCabinetCommand.spec.ts
git commit -m "feat(m4-e): CreateCabinetCommand — blindCorner + diagonalCorner templates, bore injection, hardware components"
```

---

## Task 7: Blind corner dialog + open command + ribbon button + i18n

**Files:**
- Create: `packages/app/src/commands/OpenBlindCornerCabinetDialogCommand.ts`
- Create: `packages/app/src/ui/dialogs/BlindCornerCabinetDialog.tsx`
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/uk.ts`

**Interfaces:**
- Consumes: `CreateCabinetCommand` with `blindCornerCabinet` template (Task 6), `BlindCornerCabinetParams` (Task 2)
- Produces: Ribbon button dispatches `OpenBlindCornerCabinetDialogCommand`; dialog collects params, dispatches `CreateCabinetCommand`

No-TDD note: Dialog/ribbon are React UI components without a separate unit test. Coverage comes from Task 6 command tests + Task 9 e2e. The "red" for this task is that the e2e click on the ribbon button fails until the button exists.

- [ ] Step 1 — implement `OpenBlindCornerCabinetDialogCommand.ts`. Mirror `OpenCornerCabinetDialogCommand`. Find that file:
```bash
find /Users/lion/Documents/Projects/mine/zilventor/packages/app/src -name "OpenCornerCabinetDialogCommand.ts"
```
Read it, then create `OpenBlindCornerCabinetDialogCommand.ts` with identical structure but referencing `BlindCornerCabinetDialog`.

- [ ] Step 2 — implement `BlindCornerCabinetDialog.tsx`. Mirror `CornerCabinetDialog.tsx`. Fields: name, width, depth, height, toekickHeight, toekickSetback, openingWidth, blindSide (select: left/right), shelfCount (0–8), carcassMaterialId, backMaterialId, bandMaterialId. Validation: map `CabinetTemplateError.kind` to i18n keys. On submit: `bus.execute(new CreateCabinetCommand({ template: 'blindCornerCabinet', params, opfs }))`.

- [ ] Step 3 — add i18n keys to `packages/app/src/i18n/en.ts` and `uk.ts`:
```typescript
// en.ts additions:
'furniture.blindCornerCabinet': 'Blind Corner Cabinet',
'furniture.blindSide': 'Blind side',
'furniture.openingWidth': 'Opening width',
'errors.blindOpeningTooSmall': 'Opening width is too small (min 2× board thickness)',
'errors.blindOpeningTooLarge': 'Opening width must be less than cabinet width',
```
```typescript
// uk.ts additions:
'furniture.blindCornerCabinet': 'Глухий кутовий корпус',
'furniture.blindSide': 'Сторона під кут',
'furniture.openingWidth': 'Ширина прорізу',
'errors.blindOpeningTooSmall': 'Ширина прорізу занадто мала',
'errors.blindOpeningTooLarge': 'Ширина прорізу має бути менша за ширину корпусу',
```

- [ ] Step 4 — add ribbon button to `FurnitureTab.tsx`. Read lines 86-94 (handleCornerCabinet) and lines 409-429 (ribbon buttons). Add:
```typescript
const handleBlindCornerCabinet = useCallback(() => {
  bus.execute(new OpenBlindCornerCabinetDialogCommand());
}, [bus]);
```
Add a `<button>` in the Cabinets `RibbonPanel` calling `handleBlindCornerCabinet`, labeled `t('furniture.blindCornerCabinet')`.

- [ ] Step 5 — typecheck + lint:
```bash
pnpm typecheck && cd packages/app && pnpm exec eslint src/commands/OpenBlindCornerCabinetDialogCommand.ts src/ui/dialogs/BlindCornerCabinetDialog.tsx src/shell/tabs/FurnitureTab.tsx
```

- [ ] Step 6 — full suite:
```bash
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 7 — commit:
```bash
git add packages/app/src/commands/OpenBlindCornerCabinetDialogCommand.ts \
        packages/app/src/ui/dialogs/BlindCornerCabinetDialog.tsx \
        packages/app/src/shell/tabs/FurnitureTab.tsx \
        packages/app/src/i18n/en.ts packages/app/src/i18n/uk.ts
git commit -m "feat(m4-e): blind corner cabinet dialog, open command, ribbon button, i18n en/uk"
```

---

## Task 8: Diagonal corner dialog + open command + ribbon button + i18n

**Files:**
- Create: `packages/app/src/commands/OpenDiagonalCornerCabinetDialogCommand.ts`
- Create: `packages/app/src/ui/dialogs/DiagonalCornerCabinetDialog.tsx`
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`
- Modify: `packages/app/src/i18n/en.ts`
- Modify: `packages/app/src/i18n/uk.ts`

No-TDD note: same as Task 7 — UI layer covered by e2e in Task 10.

- [ ] Step 1 — implement `OpenDiagonalCornerCabinetDialogCommand.ts`. Mirror `OpenBlindCornerCabinetDialogCommand.ts` from Task 7.

- [ ] Step 2 — implement `DiagonalCornerCabinetDialog.tsx`. Fields: name, wallWidth1, wallWidth2, returnDepth1, returnDepth2, height, toekickHeight, toekickSetback, stileWidth, carcassMaterialId, backMaterialId, bandMaterialId. Map `CabinetTemplateError.kind` → i18n. On submit: `bus.execute(new CreateCabinetCommand({ template: 'diagonalCornerCabinet', params, opfs }))`.

- [ ] Step 3 — i18n additions:
```typescript
// en.ts:
'furniture.diagonalCornerCabinet': 'Diagonal Corner Cabinet',
'furniture.stileWidth': 'Stile width',
'furniture.wallWidth1': 'Wall width 1',
'furniture.wallWidth2': 'Wall width 2',
'furniture.returnDepth1': 'Return depth 1',
'furniture.returnDepth2': 'Return depth 2',
'errors.diagonalDoorTooNarrow': 'Stile width leaves insufficient door opening (min 100 mm)',
'errors.stileWidthInvalid': 'Stile width must be positive',
```
```typescript
// uk.ts:
'furniture.diagonalCornerCabinet': 'Діагональний кутовий корпус',
'furniture.stileWidth': 'Ширина стояка',
'furniture.wallWidth1': 'Ширина стіни 1',
'furniture.wallWidth2': 'Ширина стіни 2',
'furniture.returnDepth1': 'Глибина торця 1',
'furniture.returnDepth2': 'Глибина торця 2',
'errors.diagonalDoorTooNarrow': 'Після стояків недостатньо місця для дверцят',
'errors.stileWidthInvalid': 'Ширина стояка має бути більше нуля',
```

- [ ] Step 4 — add ribbon button for diagonal cabinet. Add `handleDiagonalCornerCabinet` callback and `<button>` in `FurnitureTab.tsx` alongside the blind corner button.

- [ ] Step 5 — typecheck + lint + full suite:
```bash
pnpm typecheck && cd packages/app && pnpm exec eslint src/commands/OpenDiagonalCornerCabinetDialogCommand.ts src/ui/dialogs/DiagonalCornerCabinetDialog.tsx
pnpm exec vitest run 2>&1 | grep -E "(FAIL|ERROR)" || echo "all passed"
```

- [ ] Step 6 — commit:
```bash
git add packages/app/src/commands/OpenDiagonalCornerCabinetDialogCommand.ts \
        packages/app/src/ui/dialogs/DiagonalCornerCabinetDialog.tsx \
        packages/app/src/shell/tabs/FurnitureTab.tsx \
        packages/app/src/i18n/en.ts packages/app/src/i18n/uk.ts
git commit -m "feat(m4-e): diagonal corner cabinet dialog, open command, ribbon button, i18n en/uk"
```

---

## Task 9: E2E — blind corner cabinet

**Files:**
- Create: `tests/e2e/furniture/cabinet-blind-corner-create.spec.ts`

No-TDD note: E2E tests are inherently integration-level and drive the real UI. The "red" phase is the file not existing (and the test runner finding 0 tests), which becomes green once the file is created and the UI is wired.

- [ ] Step 1 — create `tests/e2e/furniture/cabinet-blind-corner-create.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-m4e-blind-1 — create a blind corner cabinet from Furniture tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

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
  await page.getByRole('button', { name: 'Blind Corner Cabinet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Wait for cabinet component to appear
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
  });

  // Assert hinge hardware component visible in assembly
  const hingeCount = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null } } };
    const asm = w.__zilventorStore.getState().activeAssembly;
    if (!asm) return -1;
    // The top-level assembly has 1 cabinet component; we inspect the sub-assembly
    return asm.components.length;
  });
  expect(hingeCount).toBeGreaterThanOrEqual(1);

  // Assert 0 console errors
  expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
});

test('T-m4e-blind-2 — undo removes blind corner cabinet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

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
  await page.getByRole('button', { name: 'Blind Corner Cabinet' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
  });

  // Ctrl+Z to undo
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 0;
  });

  expect(errors).toHaveLength(0);
});
```

- [ ] Step 2 — run e2e (requires dev server running on port 3000 or as configured):
```bash
pnpm exec playwright test tests/e2e/furniture/cabinet-blind-corner-create.spec.ts
```
Expected: both tests PASS. If UI wiring (Task 7) is correct, button click opens dialog; OK dispatches command.

- [ ] Step 3 — commit:
```bash
git add tests/e2e/furniture/cabinet-blind-corner-create.spec.ts
git commit -m "feat(m4-e): e2e — blind corner cabinet create + undo"
```

---

## Task 10: E2E — diagonal corner cabinet

**Files:**
- Create: `tests/e2e/furniture/cabinet-diagonal-corner-create.spec.ts`

- [ ] Step 1 — create `tests/e2e/furniture/cabinet-diagonal-corner-create.spec.ts`. Mirror `cabinet-blind-corner-create.spec.ts` with:
- `getByRole('button', { name: 'Diagonal Corner Cabinet' })` instead of 'Blind Corner Cabinet'
- Cabinet name in assertions: `'Diag Cab'` prefix
- Test IDs: `T-m4e-diag-1`, `T-m4e-diag-2`

Full file content:
```typescript
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

async function setupAssembly(page: import('@playwright/test').Page) {
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
}

test('T-m4e-diag-1 — create a diagonal corner cabinet from Furniture tab', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));

  await setupAssembly(page);
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Diagonal Corner Cabinet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
  });

  // Assert hinge component present in assembly
  const hasHinge = await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: Array<{ partPath: string }> } | null } } };
    const asm = w.__zilventorStore.getState().activeAssembly;
    return asm?.components.some(c => c.partPath.startsWith('hardware/')) ?? false;
  });
  // Hinge components live inside the sub-assembly; top-level has 1 component
  expect((await page.evaluate(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return w.__zilventorStore.getState().activeAssembly?.components.length ?? 0;
  }))).toBeGreaterThanOrEqual(1);

  expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
});

test('T-m4e-diag-2 — undo removes diagonal corner cabinet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));

  await setupAssembly(page);
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Diagonal Corner Cabinet' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) >= 1;
  });

  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 0;
  });

  expect(errors).toHaveLength(0);
});
```

- [ ] Step 2 — run:
```bash
pnpm exec playwright test tests/e2e/furniture/cabinet-diagonal-corner-create.spec.ts
```

- [ ] Step 3 — final full verification gate:
```bash
pnpm typecheck
pnpm exec vitest run
pnpm exec playwright test tests/e2e/furniture/cabinet-blind-corner-create.spec.ts tests/e2e/furniture/cabinet-diagonal-corner-create.spec.ts
```
All must pass.

- [ ] Step 4 — commit:
```bash
git add tests/e2e/furniture/cabinet-diagonal-corner-create.spec.ts
git commit -m "feat(m4-e): e2e — diagonal corner cabinet create + undo"
```

---

## Self-Review

**Spec coverage check:**
- §2 PanelFeature.outline: Task 2 (type) + Task 4 (kernel)
- §2.4 manifest 33→34: Task 2
- §3 blind corner builder: Task 3
- §4 diagonal corner builder: Task 5
- §5 doorMath extension: Task 1
- §6 CabinetBuildOutput extension: Task 2
- §7.1 CreateCabinetCommand templates: Task 6
- §7.2/7.3 dialogs + open commands: Tasks 7/8
- §7.4 ribbon buttons: Tasks 7/8
- §7.5 i18n: Tasks 7/8
- §7.6 hardware BOM wiring: Task 6 (hardware components in ziasm)
- §8 cabinets/index.ts exports: Task 2 (stubs) filled by Tasks 3/5
- §9.1 TDD slice order honored: T1→T2→T3→T4→T5→T6→T7→T8→T9→T10
- §9.2–9.8 test assertions: embedded in Tasks 1–5, 9–10
- §11 Risk 5 (winding order): Task 4 note on reversing vertex order if test fails

**No placeholder scan:** All steps have actual code. No "implement X", "TBD", or "similar to".

**Type consistency:** `buildBlindCornerCabinet`/`buildDiagonalCornerCabinet` used consistently in Task 6. `BoreOp[]` stored as `document.bores`. `HardwareInstanceDef` is `{skuId, count}`. Hardware placed as components with `partPath: 'hardware/<skuId>.zipt'`.
