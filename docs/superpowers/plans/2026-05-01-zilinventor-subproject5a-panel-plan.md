# Sub-project 5a — Panel primitive + edge banding metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation of the Furniture plug-in layer by introducing a parametric `Panel` base feature, a per-project material registry, edge-band metadata on the panel's four top-rim edges, a Furniture-tab Panel command + dialog, and a viewport edge-band highlight — all wired into the existing OCCT kernel, manifest format (bumped v9 → v10), assembly placement flow, and test/perf harness.

**Architecture:** A new `PanelFeature` variant joins the existing `Feature` union in `packages/shared`; a new kernel feature class (`packages/kernel/src/adapter/features/PanelFeature.ts`) calls a new OCCT op (`packages/kernel/src/occt/PanelOps.ts`) that builds an axis-aligned tagged box. `PartDocument` enforces "Panel must be at index 0, at most one." Manifest v9→v10 adds a `materials: MaterialEntry[]` array to part- and assembly-kind documents. App-side gains `OpenPanelDialogCommand` + `AddPanelFeatureCommand` + `CreateAndPlacePanelCommand` + `EditPanelFeatureCommand` + material CRUD commands + `ToggleShowEdgeBandsCommand`; UI delivers `PanelDialog`, `MaterialRegistryEditor`, an active `FurnitureTab`, a `ViewTab` checkbox, and a viewport `THREE.LineSegments` overlay. Material reconciliation between part-scratchpad and assembly registries runs in `PlaceComponentCommand`.

**Tech Stack:** TypeScript / pnpm workspace; React + Zustand UI; three.js viewport; OCCT (`opencascade.js`) kernel via Comlink RPC; Vitest unit + integration; Playwright e2e + perf.

**Spec:** `docs/superpowers/specs/2026-05-01-subproject-5a-panel-design.md`

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Shared types (`MaterialEntry`, `PanelFeature`, manifest v10)

### Task 1: Add `MaterialEntry` and `MaterialRegistry` types

**Files:**
- Create: `packages/shared/src/material.ts`
- Test: `packages/shared/src/__tests__/material.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/material.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isMaterialEntry, type MaterialEntry, type MaterialRegistry } from '../material';

describe('isMaterialEntry', () => {
  it('accepts a well-formed entry', () => {
    const entry: MaterialEntry = {
      id: '01HX0000000000000000000001',
      name: 'Birch Plywood 18mm',
      defaultThickness: 18,
      color: '#d8c896',
    };
    expect(isMaterialEntry(entry)).toBe(true);
  });

  it('rejects negative defaultThickness', () => {
    const entry = { id: 'm1', name: 'X', defaultThickness: -1, color: '#000' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('rejects empty name', () => {
    const entry = { id: 'm1', name: '', defaultThickness: 18, color: '#000' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('rejects non-hex color', () => {
    const entry = { id: 'm1', name: 'X', defaultThickness: 18, color: 'red' };
    expect(isMaterialEntry(entry)).toBe(false);
  });

  it('typed registry is an array of entries', () => {
    const reg: MaterialRegistry = [];
    expect(Array.isArray(reg)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test src/__tests__/material.spec.ts`
Expected: FAIL — `Cannot find module '../material'`.

- [ ] **Step 3: Implement `material.ts`**

Create `packages/shared/src/material.ts`:

```ts
export type MaterialId = string;

export interface MaterialEntry {
  readonly id: MaterialId;
  readonly name: string;
  readonly defaultThickness: number;
  readonly color: string;
}

export type MaterialRegistry = readonly MaterialEntry[];

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isMaterialEntry(v: unknown): v is MaterialEntry {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.id === 'string' && m.id.length > 0
    && typeof m.name === 'string' && m.name.length > 0
    && typeof m.defaultThickness === 'number' && Number.isFinite(m.defaultThickness) && m.defaultThickness > 0
    && typeof m.color === 'string' && HEX_COLOR_RE.test(m.color);
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Modify `packages/shared/src/index.ts` — append:

```ts
export * from './material';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zilventor/shared test src/__tests__/material.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/material.ts packages/shared/src/__tests__/material.spec.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): T1 add MaterialEntry/MaterialRegistry types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add `PanelFeature` to the shared `Feature` union

**Files:**
- Create: `packages/shared/src/panel-feature.ts`
- Modify: `packages/shared/src/types.ts` (add `PanelFeature` to the `Feature` union)
- Test: `packages/shared/src/__tests__/panel-feature.spec.ts`
- Modify: `packages/shared/src/index.ts` (re-export)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/panel-feature.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPanelFeature, type PanelFeature } from '../panel-feature';
import type { Feature } from '../types';

const PANEL: PanelFeature = {
  kind: 'panel',
  id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-birch-18',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PanelFeature', () => {
  it('isPanelFeature accepts a well-formed feature', () => {
    expect(isPanelFeature(PANEL)).toBe(true);
  });

  it('isPanelFeature rejects another feature kind', () => {
    expect(isPanelFeature({ ...PANEL, kind: 'extrude' } as unknown)).toBe(false);
  });

  it('rejects unknown grain value', () => {
    expect(isPanelFeature({ ...PANEL, grain: 'diagonal' } as unknown)).toBe(false);
  });

  it('typechecks as Feature', () => {
    const f: Feature = PANEL;
    expect(f.kind).toBe('panel');
  });

  it('edge band slot accepts null and {materialId}', () => {
    const banded: PanelFeature = {
      ...PANEL,
      edgeBands: {
        front: { materialId: 'mat-pvc-1' },
        back: null,
        left: { materialId: 'mat-pvc-1' },
        right: null,
      },
    };
    expect(isPanelFeature(banded)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test src/__tests__/panel-feature.spec.ts`
Expected: FAIL — `Cannot find module '../panel-feature'`.

- [ ] **Step 3: Implement `panel-feature.ts`**

Create `packages/shared/src/panel-feature.ts`:

```ts
import type { ParamOrLiteral } from './types';
import type { MaterialId } from './material';

export type PanelEdgeKey = 'front' | 'back' | 'left' | 'right';
export type GrainDirection = 'length' | 'width' | 'none';

export interface EdgeBand {
  readonly materialId: MaterialId;
}

export interface PanelFeature {
  readonly kind: 'panel';
  readonly id: string;
  readonly length: ParamOrLiteral;
  readonly width: ParamOrLiteral;
  readonly thickness: ParamOrLiteral;
  readonly thicknessFromMaterial: boolean;
  readonly materialId: MaterialId;
  readonly grain: GrainDirection;
  readonly edgeBands: { readonly [K in PanelEdgeKey]: EdgeBand | null };
  readonly suppressed?: boolean;
}

const GRAIN_VALUES = new Set<GrainDirection>(['length', 'width', 'none']);
const EDGE_KEYS: readonly PanelEdgeKey[] = ['front', 'back', 'left', 'right'];

function isParamOrLiteral(v: unknown): v is ParamOrLiteral {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  if (k === 'param') return typeof (v as { paramName?: unknown }).paramName === 'string';
  if (k === 'literal') return typeof (v as { value?: unknown }).value === 'number';
  return false;
}

function isEdgeBandSlot(v: unknown): boolean {
  if (v === null) return true;
  if (!v || typeof v !== 'object') return false;
  return typeof (v as { materialId?: unknown }).materialId === 'string';
}

export function isPanelFeature(v: unknown): v is PanelFeature {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  if (f.kind !== 'panel') return false;
  if (typeof f.id !== 'string') return false;
  if (!isParamOrLiteral(f.length) || !isParamOrLiteral(f.width) || !isParamOrLiteral(f.thickness)) return false;
  if (typeof f.thicknessFromMaterial !== 'boolean') return false;
  if (typeof f.materialId !== 'string') return false;
  if (!GRAIN_VALUES.has(f.grain as GrainDirection)) return false;
  const eb = f.edgeBands;
  if (!eb || typeof eb !== 'object') return false;
  for (const k of EDGE_KEYS) {
    if (!isEdgeBandSlot((eb as Record<string, unknown>)[k])) return false;
  }
  return true;
}
```

- [ ] **Step 4: Add `PanelFeature` to the `Feature` union in `types.ts`**

Modify `packages/shared/src/types.ts` line 38–52 — append `| PanelFeature` to the union and add an import at the top:

```ts
import type { PanelFeature } from './panel-feature';
```

Inside the `Feature` union, after `| ImportedFeature;` change to:

```ts
  | ImportedFeature
  | PanelFeature;
```

- [ ] **Step 5: Re-export from `index.ts`**

Append to `packages/shared/src/index.ts`:

```ts
export * from './panel-feature';
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @zilventor/shared test src/__tests__/panel-feature.spec.ts`
Expected: PASS, 5 tests.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/panel-feature.ts packages/shared/src/__tests__/panel-feature.spec.ts packages/shared/src/types.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): T2 add PanelFeature variant to Feature union

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `materials: MaterialEntry[]` to `PartDocument` and `AssemblyDocument`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/material-on-document.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/material-on-document.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PartDocument, AssemblyDocument } from '../types';
import type { MaterialEntry } from '../material';

const MAT: MaterialEntry = {
  id: 'mat-1', name: 'Birch 18', defaultThickness: 18, color: '#cfa84b',
};

describe('materials on documents', () => {
  it('PartDocument carries materials array', () => {
    const part: PartDocument = {
      id: 'p1', name: 'Side', units: 'mm',
      parameters: {}, featureTree: [],
      properties: {}, materials: [MAT],
    };
    expect(part.materials).toHaveLength(1);
  });

  it('AssemblyDocument carries materials array', () => {
    const asm: AssemblyDocument = {
      id: 'a1', name: 'Box', units: 'mm',
      parameters: {}, components: [], constraints: [],
      groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
      colorOverrides: {}, properties: {}, materials: [MAT],
    };
    expect(asm.materials).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test src/__tests__/material-on-document.spec.ts`
Expected: FAIL — typecheck error: `Property 'materials' is missing in type ...`.

- [ ] **Step 3: Add `materials` field to `PartDocument` and `AssemblyDocument`**

Modify `packages/shared/src/types.ts`:

In `PartDocument` (after `properties: Record<...>`), add:

```ts
  materials: MaterialEntry[];
```

In `AssemblyDocument` (after `properties: Record<...>`), add:

```ts
  materials: MaterialEntry[];
```

Add import near the top of `types.ts`:

```ts
import type { MaterialEntry } from './material';
```

- [ ] **Step 4: Update `ProjectFile` to include formatVersion 10**

In `packages/shared/src/types.ts`, the `ProjectFile` union — change `formatVersion: 7 | 8 | 9` to `formatVersion: 7 | 8 | 9 | 10` for both branches.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @zilventor/shared test src/__tests__/material-on-document.spec.ts`
Expected: PASS.

Run: `pnpm -r typecheck`
Expected: many errors at every callsite that constructs a `PartDocument` or `AssemblyDocument` literal — these are the callers that will be fixed in Task 4.

- [ ] **Step 6: Don't commit yet**

Wait until Task 4 fills in `materials: []` at every constructor call site. The failing typecheck is intentional to drive Task 4's coverage.

---

### Task 4: Fill `materials: []` at every existing construction site

**Files:**
- Modify: every `.ts`/`.tsx` file that constructs a `PartDocument` or `AssemblyDocument` literal — discoverable with `pnpm -r typecheck` from Task 3 step 5.

- [ ] **Step 1: List all callers**

Run: `pnpm -r typecheck 2>&1 | grep "Property 'materials' is missing" | sort -u`
Expected: a deduplicated list of file:line locations.

- [ ] **Step 2: For each location, append `materials: [],` to the literal**

For every `PartDocument` constructor and every `AssemblyDocument` constructor, add `materials: []` as the last field. Check tests, command files, fixtures, importers, packers, walkers.

Concrete locations expected (verify against the actual grep output — this list is illustrative, not exhaustive):

- `packages/app/src/import/buildPartDocument.ts`
- `packages/app/src/import/buildAssemblyDocument.ts`
- `packages/app/src/commands/CreatePartCommand.ts`
- `packages/app/src/commands/NewAssemblyCommand.ts`
- `packages/kernel/src/adapter/PartDocument.ts` (the empty-doc constructor and any test fixtures)
- `tests/e2e/helpers/seedKernelPart.ts`, `seedAssemblyPart.ts`, `seedSubAssembly.ts`, `buildBox.ts`, `seedAssemblyCylinderPart.ts`
- All `__tests__/*.spec.ts` and `*.spec.tsx` literal constructors

- [ ] **Step 3: Run typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 4: Run all unit suites**

Run: `pnpm -r test --run`
Expected: clean. Existing tests don't reference `materials`, so adding `[]` is benign.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(shared): T3-T4 add materials registry to PartDocument and AssemblyDocument

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Manifest migration v9 → v10

### Task 5: Implement `v9 → v10` migration adding `materials: []`

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Test: `packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts` (create)
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts` (extend)

- [ ] **Step 1: Write the failing migration test**

Create `packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateManifest, CURRENT_FORMAT_VERSION } from '../fileFormat';

describe('migrateManifest v9 → v10', () => {
  it('adds empty materials to a v9 part', () => {
    const v9 = {
      formatVersion: 9, kind: 'part', createdAt: '2026-01-01', appVersion: '0',
      document: { id: 'p', name: 'X', units: 'mm', parameters: {}, featureTree: [], properties: {} },
    };
    const out = migrateManifest(v9 as never);
    expect(out.formatVersion).toBe(10);
    expect((out.document as { materials: unknown }).materials).toEqual([]);
  });

  it('adds empty materials to a v9 assembly', () => {
    const v9 = {
      formatVersion: 9, kind: 'assembly', createdAt: '2026-01-01', appVersion: '0',
      document: {
        id: 'a', name: 'X', units: 'mm', parameters: {}, components: [], constraints: [],
        groundedComponentPaths: [], colors: {}, bomItemNumbers: {}, colorOverrides: {}, properties: {},
      },
    };
    const out = migrateManifest(v9 as never);
    expect(out.formatVersion).toBe(10);
    expect((out.document as { materials: unknown }).materials).toEqual([]);
  });

  it('preserves a populated materials array when already v10', () => {
    const v10 = {
      formatVersion: 10, kind: 'part', createdAt: '2026-01-01', appVersion: '0',
      document: {
        id: 'p', name: 'X', units: 'mm', parameters: {}, featureTree: [],
        properties: {},
        materials: [{ id: 'm1', name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }],
      },
    };
    const out = migrateManifest(v10 as never);
    expect((out.document as { materials: { id: string }[] }).materials[0].id).toBe('m1');
  });

  it('CURRENT_FORMAT_VERSION === 10', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/shared test src/__tests__/migrateManifest-v9-to-v10.spec.ts`
Expected: FAIL — `expected 9 to be 10` (CURRENT_FORMAT_VERSION constant) and `expected undefined to equal []`.

- [ ] **Step 3: Implement the migration**

Modify `packages/shared/src/fileFormat.ts`:

Change `export const CURRENT_FORMAT_VERSION = 9 as const;` to:

```ts
export const CURRENT_FORMAT_VERSION = 10 as const;
```

Inside the `migrations` map, after the `8: (mIn) => { ... }` entry, add:

```ts
  // v9 → v10: additive — add `materials: []` array to part- and assembly-kind
  // documents (sub-project 5a). Empty default; populated by Panel-creating
  // commands and material-registry editor.
  9: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: { materials?: unknown } };
    if (anyM.document && anyM.document.materials == null) {
      anyM.document.materials = [];
    }
    return { ...m, formatVersion: 10 };
  },
```

Then update the `normalizeKind` function (around line 148) — change the version check from `9` to `10`:

```ts
  if (m.formatVersion === 10 && (m as any).kind === undefined) {
    return { ...m, kind: 'part' } as AnyManifest;
  }
```

- [ ] **Step 4: Update `fileFormat.spec.ts`**

In `packages/shared/src/__tests__/fileFormat.spec.ts`, find any test asserting `formatVersion === 9` for newly-saved files and bump to `10`. If a test enumerates supported versions, ensure 10 is included.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @zilventor/shared test`
Expected: clean.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/__tests__/migrateManifest-v9-to-v10.spec.ts packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): T5 manifest migration v9->v10 adds materials array

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Kernel: `PanelOps`

### Task 6: Implement `buildPanelBox` in OCCT

**Files:**
- Create: `packages/kernel/src/occt/PanelOps.ts`
- Test: `packages/kernel/src/occt/__tests__/PanelOps.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/src/occt/__tests__/PanelOps.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildPanelBox } from '../PanelOps';

let occt: Awaited<ReturnType<typeof loadOcct>>;
beforeAll(async () => { occt = await loadOcct(); });

describe('buildPanelBox', () => {
  it('creates an axis-aligned box of the requested L x W x T', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    expect(r.bbox).toEqual([
      -300, -200, 0,
       300,  200, 18,
    ]);
  });

  it('produces 6 faces and 12 edges', () => {
    const r = buildPanelBox(occt, { length: 100, width: 50, thickness: 10 });
    expect(r.faceNames).toHaveProperty('Top');
    expect(r.faceNames).toHaveProperty('Bottom');
    expect(r.faceNames).toHaveProperty('Front');
    expect(r.faceNames).toHaveProperty('Back');
    expect(r.faceNames).toHaveProperty('Left');
    expect(r.faceNames).toHaveProperty('Right');
    expect(Object.keys(r.edgeNames)).toEqual(
      expect.arrayContaining(['front', 'back', 'left', 'right'])
    );
  });

  it('rejects non-positive dimensions', () => {
    expect(() => buildPanelBox(occt, { length: 0, width: 100, thickness: 10 }))
      .toThrow(/positive/);
    expect(() => buildPanelBox(occt, { length: 100, width: -1, thickness: 10 }))
      .toThrow(/positive/);
  });

  it('top-rim edge ids map to four distinct OCCT edges', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    const ids = Object.values(r.edgeNames);
    expect(new Set(ids).size).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/kernel test src/occt/__tests__/PanelOps.spec.ts`
Expected: FAIL — `Cannot find module '../PanelOps'`.

- [ ] **Step 3: Implement `PanelOps.ts`**

Create `packages/kernel/src/occt/PanelOps.ts`:

```ts
import type { OccModule } from './occtLoader';
import type { FaceName, EdgeName } from '@zilventor/shared';
import type { PanelEdgeKey } from '@zilventor/shared';

export interface PanelBoxResult {
  shape: unknown; // OCCT TopoDS_Solid handle
  bbox: [number, number, number, number, number, number];
  faceNames: Record<'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right', FaceName>;
  edgeNames: Record<PanelEdgeKey, EdgeName>;
}

export function buildPanelBox(
  occt: OccModule,
  dims: { length: number; width: number; thickness: number },
): PanelBoxResult {
  const { length: L, width: W, thickness: T } = dims;
  if (L <= 0 || W <= 0 || T <= 0) {
    throw new Error(`Panel dimensions must be positive (got L=${L}, W=${W}, T=${T})`);
  }

  // Box centered on origin in X/Y; bottom face on Z=0.
  // OCCT MakeBox(p1, p2) produces a solid spanning corners p1..p2.
  const halfL = L / 2;
  const halfW = W / 2;
  const p1 = new occt.gp_Pnt_3(-halfL, -halfW, 0);
  const p2 = new occt.gp_Pnt_3( halfL,  halfW, T);
  const builder = new occt.BRepPrimAPI_MakeBox_4(p1, p2);
  builder.Build(new occt.Message_ProgressRange_1());
  const shape = builder.Solid();

  // Tag faces by inspecting normals.
  // (Implementation detail: walk TopExp_Explorer faces, classify by normal vector.)
  const faceNames = classifyPanelFaces(occt, shape);
  const edgeNames = classifyPanelEdges(occt, shape, faceNames);

  return {
    shape,
    bbox: [-halfL, -halfW, 0, halfL, halfW, T],
    faceNames,
    edgeNames,
  };
}

function classifyPanelFaces(occt: OccModule, shape: unknown): PanelBoxResult['faceNames'] {
  // Implementation: TopExp_Explorer over TopAbs_FACE; for each, evaluate
  // BRepGProp surface normal at parametric center; match to one of ±X/±Y/±Z.
  // Throw if any normal is unmatched (defensive — should never happen for an
  // axis-aligned MakeBox output).
  // Reference pattern: see classifyBoxFaces helper in BooleanOps.ts.
  // Returns canonical FaceName objects (faceUid + readable label).
  const result = {} as PanelBoxResult['faceNames'];
  // ... (see implementation notes below)
  return result;
}

function classifyPanelEdges(
  occt: OccModule,
  shape: unknown,
  faceNames: PanelBoxResult['faceNames'],
): PanelBoxResult['edgeNames'] {
  // For each PanelEdgeKey, find the unique edge shared by face Top and face
  // {Front|Back|Left|Right} respectively. Return canonical EdgeName values.
  return {} as PanelBoxResult['edgeNames'];
}
```

For `classifyPanelFaces` / `classifyPanelEdges` use the same patterns as the existing helpers in `packages/kernel/src/occt/BooleanOps.ts` and `packages/kernel/src/occt/FaceNaming.ts`. The unique thing about a panel is that classification is purely geometric (no user-picked entities), so use surface-normal sign for faces and shared-face-pair for edges.

- [ ] **Step 4: Run test**

Run: `pnpm --filter @zilventor/kernel test src/occt/__tests__/PanelOps.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/occt/PanelOps.ts packages/kernel/src/occt/__tests__/PanelOps.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T6 PanelOps.buildPanelBox with face/edge naming

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: `PanelOps` integration test — face-name persistence across re-solve

**Files:**
- Test: `packages/kernel/src/occt/__tests__/PanelOps.integration.spec.ts` (create)

- [ ] **Step 1: Write the integration test**

Create `packages/kernel/src/occt/__tests__/PanelOps.integration.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildPanelBox } from '../PanelOps';

let occt: Awaited<ReturnType<typeof loadOcct>>;
beforeAll(async () => { occt = await loadOcct(); });

describe('PanelOps integration', () => {
  it('face/edge names are stable across rebuild with different dimensions', () => {
    const a = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    const b = buildPanelBox(occt, { length: 800, width: 500, thickness: 19 });

    // Same canonical name strings for both.
    for (const k of ['Top', 'Bottom', 'Front', 'Back', 'Left', 'Right'] as const) {
      expect(a.faceNames[k]).toEqual(b.faceNames[k]);
    }
    for (const k of ['front', 'back', 'left', 'right'] as const) {
      expect(a.edgeNames[k]).toEqual(b.edgeNames[k]);
    }
  });

  it('edge mapping matches spec convention: front=top∧+Y, back=top∧-Y, left=top∧-X, right=top∧+X', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    // Inspect a known vertex of the front edge and verify Y > 0.
    // (Use occt edge geometry API — see helpers in WorkFeatureOps for pattern.)
    // ... assert edge midpoint y > 0 for front, y < 0 for back, x < 0 for left, x > 0 for right.
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @zilventor/kernel test:integration src/occt/__tests__/PanelOps.integration.spec.ts`
Expected: PASS, 2 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/occt/__tests__/PanelOps.integration.spec.ts
git commit -m "$(cat <<'EOF'
test(kernel): T7 PanelOps integration — face/edge naming stability

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Kernel: `PanelFeature`

### Task 8: Implement `PanelFeature` evaluator

**Files:**
- Create: `packages/kernel/src/adapter/features/PanelFeature.ts`
- Test: `packages/kernel/src/adapter/features/__tests__/PanelFeature.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kernel/src/adapter/features/__tests__/PanelFeature.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { evaluatePanel } from '../PanelFeature';
import type { PanelFeature } from '@zilventor/shared';

let occt: Awaited<ReturnType<typeof loadOcct>>;
beforeAll(async () => { occt = await loadOcct(); });

const mkPanel = (over: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width:  { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...over,
});

describe('evaluatePanel', () => {
  it('returns a tagged shape with bbox matching L x W x T', () => {
    const r = evaluatePanel(occt, mkPanel(), { parameters: {} });
    expect(r.bbox).toEqual([-300, -200, 0, 300, 200, 18]);
  });

  it('throws PANEL_NOT_BASE_FEATURE when index !== 0', () => {
    expect(() => evaluatePanel(occt, mkPanel(), { parameters: {}, featureIndex: 2 }))
      .toThrow(/PANEL_NOT_BASE_FEATURE/);
  });

  it('throws on non-positive dimension after parameter resolution', () => {
    const f = mkPanel({ length: { kind: 'literal', value: -1 } });
    expect(() => evaluatePanel(occt, f, { parameters: {} })).toThrow(/positive/);
  });

  it('skipped when suppressed', () => {
    const r = evaluatePanel(occt, mkPanel({ suppressed: true }), { parameters: {} });
    expect(r.skipped).toBe(true);
  });

  it('resolves param-typed dimensions', () => {
    const f = mkPanel({ length: { kind: 'param', paramName: 'L' } });
    const r = evaluatePanel(occt, f, { parameters: { L: { value: 1000, expression: '1000', units: 'mm' } } });
    expect(r.bbox?.[3]).toBe(500);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/kernel test src/adapter/features/__tests__/PanelFeature.spec.ts`
Expected: FAIL — `Cannot find module '../PanelFeature'`.

- [ ] **Step 3: Implement `PanelFeature.ts`**

Create `packages/kernel/src/adapter/features/PanelFeature.ts`:

```ts
import type { PanelFeature } from '@zilventor/shared';
import type { OccModule } from '../../occt/occtLoader';
import { buildPanelBox } from '../../occt/PanelOps';
import { resolveParamOrLiteral } from '../ParameterResolver';

export interface EvaluatePanelCtx {
  parameters: Record<string, { value: number; expression: string; units: string }>;
  featureIndex?: number;
}

export interface PanelEvalResult {
  shape?: unknown;
  bbox?: [number, number, number, number, number, number];
  faceNames?: ReturnType<typeof buildPanelBox>['faceNames'];
  edgeNames?: ReturnType<typeof buildPanelBox>['edgeNames'];
  skipped?: boolean;
}

export function evaluatePanel(
  occt: OccModule,
  feature: PanelFeature,
  ctx: EvaluatePanelCtx,
): PanelEvalResult {
  if (ctx.featureIndex != null && ctx.featureIndex !== 0) {
    throw new Error(`PANEL_NOT_BASE_FEATURE: panel feature ${feature.id} at index ${ctx.featureIndex} (must be 0)`);
  }
  if (feature.suppressed) return { skipped: true };

  const length = resolveParamOrLiteral(feature.length, ctx.parameters);
  const width  = resolveParamOrLiteral(feature.width,  ctx.parameters);
  const thickness = resolveParamOrLiteral(feature.thickness, ctx.parameters);

  const r = buildPanelBox(occt, { length, width, thickness });
  return { shape: r.shape, bbox: r.bbox, faceNames: r.faceNames, edgeNames: r.edgeNames };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @zilventor/kernel test src/adapter/features/__tests__/PanelFeature.spec.ts`
Expected: PASS, 5 tests.

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/PanelFeature.ts packages/kernel/src/adapter/features/__tests__/PanelFeature.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T8 PanelFeature evaluator with index-0 guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: `PanelFeature` integration test — round-trip save/reload

**Files:**
- Test: `packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts` (create)

- [ ] **Step 1: Write the integration test**

Create `packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts`:

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { PartDocument } from '../../PartDocument';
import { ProjectPacker } from '../../../storage/ProjectPacker';
import type { PanelFeature } from '@zilventor/shared';

let occt: Awaited<ReturnType<typeof loadOcct>>;
beforeAll(async () => { occt = await loadOcct(); });

describe('PanelFeature integration', () => {
  it('save → reload preserves panel and produces identical body', async () => {
    const panel: PanelFeature = {
      kind: 'panel', id: 'pf-1',
      length: { kind: 'literal', value: 600 },
      width: { kind: 'literal', value: 400 },
      thickness: { kind: 'literal', value: 18 },
      thicknessFromMaterial: true,
      materialId: 'mat-1',
      grain: 'length',
      edgeBands: { front: null, back: null, left: null, right: null },
    };

    const doc = PartDocument.empty(occt);
    doc.addFeature(panel, 0);
    await doc.solve();
    const bbox1 = doc.getCachedGeometry()!.boundingBox;

    const packed = await ProjectPacker.pack(doc);
    const reloaded = await ProjectPacker.unpack(packed, occt);
    await reloaded.solve();
    const bbox2 = reloaded.getCachedGeometry()!.boundingBox;

    expect(bbox1).toEqual(bbox2);
    expect(reloaded.featureTree[7]).toMatchObject({ kind: 'panel', id: 'pf-1' });
  });
});
```

(Adjust `featureTree[7]` index based on whether `PartDocument.empty` includes origin features at indexes 0..6; check the existing `Imported` integration test for the convention used.)

- [ ] **Step 2: Run integration test**

Run: `pnpm --filter @zilventor/kernel test:integration src/adapter/features/__tests__/PanelFeature.integration.spec.ts`
Expected: FAIL — `addFeature` doesn't recognise `kind: 'panel'`. Will be fixed in Task 10.

- [ ] **Step 3: Don't commit yet**

Move to Task 10.

---

## Phase 5 — `FeatureTree` wiring + `PartDocument` validation

### Task 10: Register `PanelFeature` in `FeatureTree` dispatch

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`

- [ ] **Step 1: Add `panel` case to the feature-kind dispatch**

In `packages/kernel/src/adapter/FeatureTree.ts`, locate the `applyFeature(feature, ctx)` switch. Add a `case 'panel'` that calls `evaluatePanel`. Mirror the structure of the existing `'imported'` case.

```ts
import { evaluatePanel } from './features/PanelFeature';

// inside applyFeature switch:
case 'panel': {
  const r = evaluatePanel(this.occt, feature, { parameters: this.parameters, featureIndex: index });
  if (r.skipped) return;
  this.body = r.shape;
  this.recordFaceNames(r.faceNames);
  this.recordEdgeNames(r.edgeNames);
  return;
}
```

(`recordFaceNames` / `recordEdgeNames` are placeholders for whatever the existing tagging hook is named — read the file to find the exact names.)

- [ ] **Step 2: Re-run Task 9's integration test**

Run: `pnpm --filter @zilventor/kernel test:integration src/adapter/features/__tests__/PanelFeature.integration.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run all kernel tests**

Run: `pnpm --filter @zilventor/kernel test --run && pnpm --filter @zilventor/kernel test:integration --run`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/adapter/features/__tests__/PanelFeature.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T9-T10 register PanelFeature in FeatureTree dispatch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `PartDocument.validatePanelInvariant`

**Files:**
- Modify: `packages/kernel/src/adapter/PartDocument.ts`
- Test: `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Add to `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`:

```ts
import { PartDocument, INVALID_PANEL_PLACEMENT } from '../PartDocument';
import type { PanelFeature } from '@zilventor/shared';

const PANEL: PanelFeature = {
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('PartDocument panel invariant', () => {
  it('accepts panel at index 0', () => {
    const doc = PartDocument.empty(/* occt mock */);
    expect(() => doc.addFeature(PANEL, 0)).not.toThrow();
  });

  it('rejects panel at non-zero index', () => {
    const doc = PartDocument.empty(/* occt mock */);
    expect(() => doc.addFeature(PANEL, 5)).toThrow(INVALID_PANEL_PLACEMENT);
  });

  it('rejects a second panel', () => {
    const doc = PartDocument.empty(/* occt mock */);
    doc.addFeature(PANEL, 0);
    expect(() => doc.addFeature({ ...PANEL, id: 'pf-2' }, 0)).toThrow(INVALID_PANEL_PLACEMENT);
  });

  it('rejects reorder that pushes panel out of index 0', () => {
    const doc = PartDocument.empty(/* occt mock */);
    doc.addFeature(PANEL, 0);
    expect(() => doc.reorderFeatures([1, 0])).toThrow(INVALID_PANEL_PLACEMENT);
  });
});
```

(Adjust `addFeature(PANEL, 0)` index for whatever PartDocument.empty's index 0 currently looks like — origin features are typically at indexes 0..6, so "panel must be at index 0" is in the user-feature subarray, not absolute. Read PartDocument.ts to confirm and adjust both the implementation and the test accordingly. The spec convention is "first feature in the user-mutable feature tree.")

- [ ] **Step 2: Implement `validatePanelInvariant`**

Modify `packages/kernel/src/adapter/PartDocument.ts`:

```ts
export const INVALID_PANEL_PLACEMENT = 'INVALID_PANEL_PLACEMENT' as const;

private validatePanelInvariant(): void {
  const userFeatures = this.featureTree.filter(f => !this.isOriginFeature(f));
  const panels = userFeatures.filter(f => f.kind === 'panel');
  if (panels.length === 0) return;
  if (panels.length > 1) {
    throw new Error(`${INVALID_PANEL_PLACEMENT}: at most one panel per part (found ${panels.length})`);
  }
  if (userFeatures[0].kind !== 'panel') {
    throw new Error(`${INVALID_PANEL_PLACEMENT}: panel must be the first user feature`);
  }
}
```

Call `validatePanelInvariant()` at the end of `addFeature`, `removeFeature`, and `reorderFeatures`.

- [ ] **Step 3: Run test**

Run: `pnpm --filter @zilventor/kernel test src/adapter/__tests__/PartDocument.spec.ts`
Expected: PASS, 4 new tests.

- [ ] **Step 4: Run all kernel tests + typecheck**

Run: `pnpm -r typecheck && pnpm --filter @zilventor/kernel test --run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/PartDocument.ts packages/kernel/src/adapter/__tests__/PartDocument.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): T11 PartDocument.validatePanelInvariant

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — Storage roundtrip

### Task 12: AssemblyPacker round-trips materials registry

**Files:**
- Test: `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts` (extend)

- [ ] **Step 1: Add round-trip test for `materials` array**

Append to `packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts`:

```ts
describe('AssemblyPacker materials roundtrip', () => {
  it('preserves a populated materials array on assembly', async () => {
    const asm = makeAssembly({ /* existing helper */ });
    asm.materials = [
      { id: 'm1', name: 'Birch 18', defaultThickness: 18, color: '#d8c896' },
      { id: 'm2', name: 'PVC 1mm white', defaultThickness: 1, color: '#ffffff' },
    ];
    const packed = await AssemblyPacker.pack(asm);
    const reloaded = await AssemblyPacker.unpack(packed);
    expect(reloaded.materials).toEqual(asm.materials);
  });

  it('migrates a v9 assembly to v10 with empty materials', async () => {
    const v9 = legacyV9AssemblyTar({ /* existing helper, no materials field */ });
    const reloaded = await AssemblyPacker.unpack(v9);
    expect(reloaded.materials).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @zilventor/kernel test src/storage/__tests__/AssemblyPacker.spec.ts`
Expected: PASS — `AssemblyPacker` already serialises the manifest verbatim, so this is a read-back validation. If the legacy fixture isn't yet writeable, build a small inline v9 manifest tar in the test.

- [ ] **Step 3: Add an analogous test for `ProjectPacker` (parts)**

Append to `packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts`:

```ts
it('round-trips a panel-bearing part with scratchpad materials', async () => {
  const doc = PartDocument.empty(occt);
  doc.materials = [{ id: 'm1', name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }];
  doc.addFeature(SOME_PANEL_FEATURE, 0);
  const packed = await ProjectPacker.pack(doc);
  const reloaded = await ProjectPacker.unpack(packed, occt);
  expect(reloaded.materials).toEqual(doc.materials);
  expect(reloaded.featureTree.find(f => f.kind === 'panel')).toMatchObject({ kind: 'panel' });
});
```

- [ ] **Step 4: Run all storage tests**

Run: `pnpm --filter @zilventor/kernel test src/storage`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/storage/__tests__/AssemblyPacker.spec.ts packages/kernel/src/storage/__tests__/ProjectPacker.spec.ts
git commit -m "$(cat <<'EOF'
test(kernel): T12 AssemblyPacker/ProjectPacker materials roundtrip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Material reconciliation

### Task 13: `reconcileMaterials` pure function

**Files:**
- Create: `packages/app/src/assembly/reconcileMaterials.ts`
- Test: `packages/app/src/assembly/__tests__/reconcileMaterials.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/src/assembly/__tests__/reconcileMaterials.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reconcileMaterials } from '../reconcileMaterials';
import type { MaterialEntry } from '@zilventor/shared';

const ent = (id: string, name: string, t = 18, color = '#000000'): MaterialEntry =>
  ({ id, name, defaultThickness: t, color });

describe('reconcileMaterials', () => {
  it('empty registries → no rewrites, no copies', () => {
    const r = reconcileMaterials([], [], []);
    expect(r.updatedAssemblyMaterials).toEqual([]);
    expect(r.updatedPartFeatures).toEqual([]);
    expect(r.updatedPartMaterials).toEqual([]);
  });

  it('exact-match merge: rewrites part→assembly id', () => {
    const part = [ent('p1', 'Birch 18', 18, '#d8c896')];
    const asm  = [ent('a1', 'Birch 18', 18, '#d8c896')];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toEqual(asm);
    expect(r.updatedPartFeatures).toEqual([
      { panelFeatureId: 'pf-1', fieldKey: 'materialId', newMaterialId: 'a1' },
    ]);
  });

  it('no-match copy: copies part entry into assembly registry', () => {
    const part = [ent('p1', 'MDF 12', 12)];
    const asm: MaterialEntry[] = [];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toEqual([ent('p1', 'MDF 12', 12)]);
    // ID stays the same — no rewrite needed.
    expect(r.updatedPartFeatures).toEqual([]);
  });

  it('case-insensitive name matching', () => {
    const part = [ent('p1', 'BIRCH 18', 18)];
    const asm  = [ent('a1', 'birch 18', 18)];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedPartFeatures[0].newMaterialId).toBe('a1');
  });

  it('same-name-different-thickness treated as distinct', () => {
    const part = [ent('p1', 'Birch', 18)];
    const asm  = [ent('a1', 'Birch', 19)];  // different T
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toHaveLength(2);
    expect(r.updatedPartFeatures).toEqual([]);
  });

  it('multi-panel mixed exact + copy', () => {
    const part = [ent('p1', 'Birch', 18), ent('p2', 'PVC', 1)];
    const asm  = [ent('a1', 'Birch', 18)];
    const refs = [
      { panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' },
      { panelFeatureId: 'pf-2', fieldKey: 'materialId' as const, materialId: 'p2' },
    ];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedAssemblyMaterials).toHaveLength(2);
    expect(r.updatedAssemblyMaterials.find(m => m.name === 'PVC')?.id).toBe('p2');
    expect(r.updatedPartFeatures).toEqual([
      { panelFeatureId: 'pf-1', fieldKey: 'materialId', newMaterialId: 'a1' },
    ]);
  });

  it('drops orphan entries from updatedPartMaterials', () => {
    const part = [ent('p1', 'Used', 18), ent('p2', 'Orphan', 12)];
    const asm: MaterialEntry[] = [];
    const refs = [{ panelFeatureId: 'pf-1', fieldKey: 'materialId' as const, materialId: 'p1' }];
    const r = reconcileMaterials(part, asm, refs);
    expect(r.updatedPartMaterials.map(m => m.id)).toEqual(['p1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zilventor/app test src/assembly/__tests__/reconcileMaterials.spec.ts`
Expected: FAIL — `Cannot find module '../reconcileMaterials'`.

- [ ] **Step 3: Implement `reconcileMaterials.ts`**

Create `packages/app/src/assembly/reconcileMaterials.ts`:

```ts
import type { MaterialEntry, MaterialRegistry } from '@zilventor/shared';

export interface PanelMaterialRef {
  readonly panelFeatureId: string;
  readonly fieldKey: 'materialId' | `edgeBands.${'front' | 'back' | 'left' | 'right'}.materialId`;
  readonly materialId: string;
}

export interface PanelFeatureRefRewrite {
  readonly panelFeatureId: string;
  readonly fieldKey: PanelMaterialRef['fieldKey'];
  readonly newMaterialId: string;
}

export interface ReconcileResult {
  readonly updatedAssemblyMaterials: MaterialEntry[];
  readonly updatedPartFeatures: PanelFeatureRefRewrite[];
  readonly updatedPartMaterials: MaterialEntry[];
}

const matKey = (m: MaterialEntry) => `${m.name.trim().toLowerCase()}|${m.defaultThickness}`;

export function reconcileMaterials(
  partRegistry: MaterialRegistry,
  assemblyRegistry: MaterialRegistry,
  refs: readonly PanelMaterialRef[],
): ReconcileResult {
  const assemblyByKey = new Map<string, MaterialEntry>(
    assemblyRegistry.map(m => [matKey(m), m]),
  );
  const partById = new Map<string, MaterialEntry>(partRegistry.map(m => [m.id, m]));

  const rewrites: PanelFeatureRefRewrite[] = [];
  const newAssemblyEntries: MaterialEntry[] = [];
  const usedPartIds = new Set<string>();

  for (const ref of refs) {
    const partEntry = partById.get(ref.materialId);
    if (!partEntry) continue; // stale ref, skip
    usedPartIds.add(partEntry.id);
    const existing = assemblyByKey.get(matKey(partEntry));
    if (existing) {
      if (existing.id !== partEntry.id) {
        rewrites.push({
          panelFeatureId: ref.panelFeatureId,
          fieldKey: ref.fieldKey,
          newMaterialId: existing.id,
        });
      }
    } else {
      // Copy part entry into assembly registry, preserving id.
      newAssemblyEntries.push(partEntry);
      assemblyByKey.set(matKey(partEntry), partEntry);
    }
  }

  return {
    updatedAssemblyMaterials: [...assemblyRegistry, ...newAssemblyEntries],
    updatedPartFeatures: rewrites,
    updatedPartMaterials: partRegistry.filter(m => usedPartIds.has(m.id)),
  };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @zilventor/app test src/assembly/__tests__/reconcileMaterials.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/assembly/reconcileMaterials.ts packages/app/src/assembly/__tests__/reconcileMaterials.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T13 reconcileMaterials pure function

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 8 — Icon

### Task 14: `PanelIcon` SVG icon

**Files:**
- Create: `packages/icons/src/PanelIcon.tsx`
- Modify: `packages/icons/src/index.ts`

- [ ] **Step 1: Implement the icon**

Create `packages/icons/src/PanelIcon.tsx`:

```tsx
import * as React from 'react';

export function PanelIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
      {...props}
    >
      {/* simple parallelogram representing a board */}
      <path d="M3 8 L21 4 L21 16 L3 20 Z" />
      {/* edge band hint */}
      <path d="M3 8 L21 4" strokeWidth="2.5" />
    </svg>
  );
}
```

- [ ] **Step 2: Re-export**

Append to `packages/icons/src/index.ts`:

```ts
export { PanelIcon } from './PanelIcon';
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/icons/src/PanelIcon.tsx packages/icons/src/index.ts
git commit -m "$(cat <<'EOF'
feat(icons): T14 PanelIcon

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 9 — Commands

### Task 15: `useAppStore.showEdgeBands` flag

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Test: `packages/app/src/store/__tests__/useAppStore.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `packages/app/src/store/__tests__/useAppStore.spec.ts`:

```ts
describe('showEdgeBands', () => {
  it('default is true', () => {
    expect(useAppStore.getState().showEdgeBands).toBe(true);
  });
  it('toggle flips the flag', () => {
    useAppStore.getState().setShowEdgeBands(false);
    expect(useAppStore.getState().showEdgeBands).toBe(false);
    useAppStore.getState().setShowEdgeBands(true);
  });
});
```

- [ ] **Step 2: Add the field + setter**

Modify `packages/app/src/store/useAppStore.ts` — add:

```ts
showEdgeBands: boolean;
setShowEdgeBands: (v: boolean) => void;
```

In the create() body:

```ts
showEdgeBands: localStorage.getItem('showEdgeBands') !== 'false',
setShowEdgeBands: (v) => {
  localStorage.setItem('showEdgeBands', String(v));
  set({ showEdgeBands: v });
},
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter @zilventor/app test src/store/__tests__/useAppStore.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T15 store flag showEdgeBands (default true, persisted)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: `ToggleShowEdgeBandsCommand`

**Files:**
- Create: `packages/app/src/commands/ToggleShowEdgeBandsCommand.ts`
- Test: `packages/app/src/commands/__tests__/ToggleShowEdgeBandsCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ToggleShowEdgeBandsCommand } from '../ToggleShowEdgeBandsCommand';
import { useAppStore } from '../../store/useAppStore';

describe('ToggleShowEdgeBandsCommand', () => {
  it('flips the flag', () => {
    useAppStore.getState().setShowEdgeBands(true);
    new ToggleShowEdgeBandsCommand().execute();
    expect(useAppStore.getState().showEdgeBands).toBe(false);
    new ToggleShowEdgeBandsCommand().execute();
    expect(useAppStore.getState().showEdgeBands).toBe(true);
  });
});
```

- [ ] **Step 2: Implement command**

Create `packages/app/src/commands/ToggleShowEdgeBandsCommand.ts`:

```ts
import { useAppStore } from '../store/useAppStore';
import type { Command } from './Command';

export class ToggleShowEdgeBandsCommand implements Command {
  readonly id = 'toggle-show-edge-bands';
  execute(): void {
    const s = useAppStore.getState();
    s.setShowEdgeBands(!s.showEdgeBands);
  }
}
```

- [ ] **Step 3: Run test + commit**

Run: `pnpm --filter @zilventor/app test src/commands/__tests__/ToggleShowEdgeBandsCommand.spec.ts`
Expected: PASS.

```bash
git add packages/app/src/commands/ToggleShowEdgeBandsCommand.ts packages/app/src/commands/__tests__/ToggleShowEdgeBandsCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T16 ToggleShowEdgeBandsCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Material CRUD commands

**Files:**
- Create: `packages/app/src/commands/AddMaterialCommand.ts`
- Create: `packages/app/src/commands/EditMaterialCommand.ts`
- Create: `packages/app/src/commands/DeleteMaterialCommand.ts`
- Test: `packages/app/src/commands/__tests__/material-commands.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { AddMaterialCommand } from '../AddMaterialCommand';
import { EditMaterialCommand } from '../EditMaterialCommand';
import { DeleteMaterialCommand } from '../DeleteMaterialCommand';

describe('Material commands', () => {
  beforeEach(() => { /* reset active document */ });

  it('Add appends a new material with a generated id', () => {
    new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }).execute();
    // Read the active document and assert one material exists with the right name.
  });

  it('Edit changes name/thickness/color', () => { /* ... */ });

  it('Delete rejects when referenced by a panel', () => {
    // Place a panel that references material id m1, then attempt delete.
    expect(() => new DeleteMaterialCommand('m1').execute())
      .toThrow(/MATERIAL_IN_USE/);
  });

  it('Delete succeeds when no references', () => { /* ... */ });

  it('Add rejects duplicate name', () => {
    new AddMaterialCommand({ name: 'Birch 18', defaultThickness: 18, color: '#d8c896' }).execute();
    expect(() => new AddMaterialCommand({ name: 'birch 18', defaultThickness: 18, color: '#000' }).execute())
      .toThrow(/DUPLICATE_NAME/);
  });
});
```

- [ ] **Step 2: Implement commands**

Each command operates on the active assembly's `materials` array if an assembly is active; otherwise on the active part's scratchpad `materials` array. Both commands push undo entries via the existing CommandBus undo stack.

Generate IDs with the existing ULID helper used elsewhere (search `packages/shared` for `generateId` / `ulid`; reuse that).

`DeleteMaterialCommand` must walk the active document's panels (and if assembly, recursively walk components' parts) collecting any reference to the material id; if any found, throw `MATERIAL_IN_USE` with the list of referencing panel feature ids.

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/commands/{Add,Edit,Delete}MaterialCommand.ts packages/app/src/commands/__tests__/material-commands.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T17 material registry CRUD commands

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: `AddPanelFeatureCommand`

**Files:**
- Create: `packages/app/src/commands/AddPanelFeatureCommand.ts`
- Test: `packages/app/src/commands/__tests__/AddPanelFeatureCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { AddPanelFeatureCommand } from '../AddPanelFeatureCommand';
import type { PanelFeature } from '@zilventor/shared';

const PANEL: PanelFeature = {
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
};

describe('AddPanelFeatureCommand', () => {
  it('inserts panel at user-feature index 0 of an empty part', () => {
    /* setup empty part, run command, assert featureTree contains panel */
  });
  it('rejects when part already has features', () => {
    /* add a sketch first, then attempt — expect throw */
  });
  it('undo removes the panel', () => {
    /* run + undo, assert removal */
  });
});
```

- [ ] **Step 2: Implement command**

Create `packages/app/src/commands/AddPanelFeatureCommand.ts`:

```ts
import type { PanelFeature } from '@zilventor/shared';
import type { Command } from './Command';
import { useAppStore } from '../store/useAppStore';

export class AddPanelFeatureCommand implements Command {
  readonly id = 'add-panel-feature';
  constructor(private readonly panel: PanelFeature) {}

  execute(): void {
    const doc = useAppStore.getState().activePart;
    if (!doc) throw new Error('NO_ACTIVE_PART');
    const userFeatures = doc.featureTree.filter(f => !isOriginFeature(f));
    if (userFeatures.length > 0) throw new Error('PART_NOT_EMPTY');
    doc.addFeature(this.panel, /* user-feature index */ 0);
    /* push undo entry */
  }

  undo(): void {
    const doc = useAppStore.getState().activePart;
    if (!doc) return;
    doc.removeFeature(this.panel.id);
  }
}
```

(Use the existing `isOriginFeature` helper from `@zilventor/shared` if exported; otherwise import from wherever the existing code defines it — check `useAppStore` or `PartDocument`.)

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/commands/AddPanelFeatureCommand.ts packages/app/src/commands/__tests__/AddPanelFeatureCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T18 AddPanelFeatureCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: `EditPanelFeatureCommand`

**Files:**
- Create: `packages/app/src/commands/EditPanelFeatureCommand.ts`
- Test: `packages/app/src/commands/__tests__/EditPanelFeatureCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

Mirror `EditComponentCommand`'s test shape: setup a part with a Panel, run the edit command with a new shape (different L, different material), assert: featureTree has the new panel; undo restores the original.

- [ ] **Step 2: Implement command**

Create `packages/app/src/commands/EditPanelFeatureCommand.ts` — replace-in-place semantics. Stash the old PanelFeature for undo.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/commands/EditPanelFeatureCommand.ts packages/app/src/commands/__tests__/EditPanelFeatureCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T19 EditPanelFeatureCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: `CreateAndPlacePanelCommand`

**Files:**
- Create: `packages/app/src/commands/CreateAndPlacePanelCommand.ts`
- Test: `packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('CreateAndPlacePanelCommand', () => {
  it('creates a new .zipt with a Panel feature, runs material reconciliation, and places into the active assembly', async () => {
    /* setup active assembly + a stub File System Access save target;
       run command with a complete PanelFeature payload + filename;
       assert: a new component appears in the assembly, the assembly
       manifest carries the material entry, and the panel references
       the assembly-side material id. */
  });
  it('undo removes the placement and the saved file', () => {
    /* assert atomicity */
  });
});
```

- [ ] **Step 2: Implement command**

Create `packages/app/src/commands/CreateAndPlacePanelCommand.ts`:

Composes:
1. New `PartDocument`.
2. Add the `PanelFeature` at user-feature index 0.
3. Save via File System Access (use existing `FileSystemAccess` helper) — capture filename from caller.
4. Call `reconcileMaterials` with the part's scratchpad registry vs active assembly's registry.
5. Apply rewrites to the part's `PanelFeature` materialId fields and assembly's `materials`.
6. Run existing `PlaceComponentCommand` to insert the new part into the active assembly at origin.

Wrap everything in a single CommandBus transaction so undo unwinds atomically.

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/commands/CreateAndPlacePanelCommand.ts packages/app/src/commands/__tests__/CreateAndPlacePanelCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T20 CreateAndPlacePanelCommand with material reconciliation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: `OpenPanelDialogCommand`

**Files:**
- Create: `packages/app/src/commands/OpenPanelDialogCommand.ts`
- Test: `packages/app/src/commands/__tests__/OpenPanelDialogCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('OpenPanelDialogCommand', () => {
  it('Part-mode (empty part active) opens dialog with insert-feature submit handler', () => { /* ... */ });
  it('Assembly-mode (assembly active, no part) opens dialog with create-and-place submit handler', () => { /* ... */ });
  it('rejects when a non-empty part is active', () => {
    expect(() => new OpenPanelDialogCommand().execute()).toThrow(/PART_NOT_EMPTY/);
  });
});
```

- [ ] **Step 2: Implement command**

Resolves context, then sets the dialog open flag in `useAppStore.dialogs.panel = { mode: 'part' | 'assembly', initial: PanelDialogInitial }`. Submit handlers in the dialog dispatch either `AddPanelFeatureCommand` or `CreateAndPlacePanelCommand`.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/commands/OpenPanelDialogCommand.ts packages/app/src/commands/__tests__/OpenPanelDialogCommand.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T21 OpenPanelDialogCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Wire material reconciliation into `PlaceComponentCommand`

**Files:**
- Modify: `packages/app/src/commands/PlaceComponentCommand.ts`
- Test: `packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append a test "places a panel-bearing part with scratchpad materials, the assembly registry receives the material entry and the panel's id is rewritten" — assert the post-place state.

- [ ] **Step 2: Modify `PlaceComponentCommand`**

Just before adding the component to the assembly, if the placed part contains any `PanelFeature`, call `reconcileMaterials`, apply rewrites:

```ts
import { reconcileMaterials } from '../assembly/reconcileMaterials';

// inside execute(), after loading partDoc:
const panelRefs = collectPanelMaterialRefs(partDoc);
if (panelRefs.length > 0) {
  const result = reconcileMaterials(partDoc.materials, asm.materials, panelRefs);
  applyRewritesInPlace(partDoc, result.updatedPartFeatures);
  partDoc.materials = result.updatedPartMaterials;
  asm.materials = result.updatedAssemblyMaterials;
  await ProjectPacker.repack(partDoc); // persist rewritten part
}
```

(`collectPanelMaterialRefs` and `applyRewritesInPlace` are tiny helpers — implement inline or as a private function in `reconcileMaterials.ts`.)

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/commands/PlaceComponentCommand.ts packages/app/src/commands/__tests__/PlaceComponentCommand.spec.ts packages/app/src/assembly/reconcileMaterials.ts
git commit -m "$(cat <<'EOF'
feat(app): T22 wire reconcileMaterials into PlaceComponentCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 10 — UI: dialog + material editor

### Task 23: `MaterialRegistryEditor` component

**Files:**
- Create: `packages/app/src/shell/MaterialRegistryEditor.tsx`
- Test: `packages/app/src/shell/__tests__/MaterialRegistryEditor.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MaterialRegistryEditor } from '../MaterialRegistryEditor';

describe('MaterialRegistryEditor', () => {
  it('renders rows from the active registry', () => {
    /* render with a 2-entry registry, assert both rows visible */
  });
  it('Add appends new row with default values', () => { /* ... */ });
  it('Edit updates row in place', () => { /* ... */ });
  it('Delete confirms inline with reference count', () => { /* ... */ });
  it('rejects duplicate name (case-insensitive)', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement `MaterialRegistryEditor`**

Plain React component. Reads from `useAppStore` (active registry); on add/edit/delete dispatches the corresponding command from Task 17.

Layout: a `<table>` with columns Name | Default Thickness | Color | Actions (row hover shows Edit / Delete affordances). `+ Add` button at the bottom opens a small inline form.

For color: use `<input type="color" />` constrained to the available palette (or accept any hex; per spec §4.6).

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/shell/MaterialRegistryEditor.tsx packages/app/src/shell/__tests__/MaterialRegistryEditor.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T23 MaterialRegistryEditor component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: `PanelDialog` component

**Files:**
- Create: `packages/app/src/shell/PanelDialog.tsx`
- Test: `packages/app/src/shell/__tests__/PanelDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe('PanelDialog', () => {
  it('renders all field groups: Dimensions, Material, Grain, Edge Bands', () => { /* ... */ });
  it('Material picker pre-fills Thickness with material defaultThickness; flag remains true', () => { /* ... */ });
  it('typing into Thickness clears thicknessFromMaterial flag', () => { /* ... */ });
  it('changing material while thicknessFromMaterial=true re-fills thickness', () => { /* ... */ });
  it('changing material while thicknessFromMaterial=false leaves thickness untouched', () => { /* ... */ });
  it('grain radios are exclusive', () => { /* ... */ });
  it('edge band rows accept material picks independently', () => { /* ... */ });
  it('OK submit produces a complete PanelFeature payload', () => { /* ... */ });
  it('Esc cancels without submitting', () => { /* ... */ });
  it('clicking outside dismisses', () => { /* ... */ });
  it('shows broken-material-ref error when materialId does not resolve', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement `PanelDialog`**

Mirror existing dialog patterns (`HoleDialog`, `ExtrudeDialog`, `WorkPlaneDialog`). Layout per spec §4.3.

Internal state: `length`, `width`, `thickness`, `thicknessFromMaterial`, `materialId`, `grain`, `edgeBands`. On material change, if `thicknessFromMaterial` true, update `thickness` and re-render the "(from material)" badge; if false, leave alone. On Thickness blur, if value differs from current material's `defaultThickness`, set flag false.

Submit (OK): construct the `PanelFeature` payload and dispatch via the dialog's mode-specific submit callback (provided by `OpenPanelDialogCommand`).

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/shell/PanelDialog.tsx packages/app/src/shell/__tests__/PanelDialog.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T24 PanelDialog with material/thickness override semantics

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Mount `PanelDialog` in the dialog host

**Files:**
- Modify: `packages/app/src/shell/WorkFeatureDialogsHost.tsx` (or whichever component currently hosts feature dialogs — read first to confirm)

- [ ] **Step 1: Mount conditional render**

Where other dialogs are mounted (`HoleDialog`, `ExtrudeDialog`, etc.), add:

```tsx
{dialogs.panel && (
  <PanelDialog
    mode={dialogs.panel.mode}
    initial={dialogs.panel.initial}
    onSubmit={dialogs.panel.onSubmit}
    onCancel={dialogs.panel.onCancel}
  />
)}
```

- [ ] **Step 2: Typecheck + run app dialog tests**

Run: `pnpm -r typecheck && pnpm --filter @zilventor/app test src/shell/__tests__/PanelDialog.spec.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/shell/WorkFeatureDialogsHost.tsx
git commit -m "$(cat <<'EOF'
feat(app): T25 mount PanelDialog in dialog host

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 11 — UI: ribbon + tabs + browser

### Task 26: Activate `FurnitureTab` with Panel button

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx` (replace stub)
- Test: `packages/app/src/shell/tabs/__tests__/FurnitureTab.spec.tsx` (create)

- [ ] **Step 1: Write the failing test**

```tsx
describe('FurnitureTab', () => {
  it('renders the Create panel with a Panel button', () => {
    render(<FurnitureTab />);
    expect(screen.getByRole('button', { name: /Panel/i })).toBeInTheDocument();
  });
  it('clicking Panel dispatches OpenPanelDialogCommand', () => { /* ... */ });
  it('Panel button disabled when no part and no assembly is active', () => { /* ... */ });
});
```

- [ ] **Step 2: Replace the stub**

Replace `packages/app/src/shell/tabs/FurnitureTab.tsx`:

```tsx
import { CommandBus } from '../../commands/CommandBus';
import { OpenPanelDialogCommand } from '../../commands/OpenPanelDialogCommand';
import { PanelIcon } from '@zilventor/icons';
import { RibbonPanel } from '../RibbonPanel';
import { useAppStore } from '../../store/useAppStore';

export default function FurnitureTab() {
  const hasContext = useAppStore(s => !!s.activePart || !!s.activeAssembly);
  return (
    <RibbonPanel title="Create">
      <button
        type="button"
        disabled={!hasContext}
        onClick={() => CommandBus.dispatch(new OpenPanelDialogCommand())}
        aria-label="Panel"
      >
        <PanelIcon />
        <span>Panel</span>
      </button>
    </RibbonPanel>
  );
}
```

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/shell/tabs/__tests__/FurnitureTab.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T26 activate FurnitureTab with Panel button

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: `ViewTab` "Show edge bands" checkbox

**Files:**
- Modify: `packages/app/src/shell/tabs/ViewTab.tsx`
- Test: `packages/app/src/shell/tabs/__tests__/ViewTab.spec.tsx` (extend)

- [ ] **Step 1: Add checkbox**

In `ViewTab.tsx`, add to the Display panel:

```tsx
<label>
  <input
    type="checkbox"
    checked={showEdgeBands}
    onChange={() => CommandBus.dispatch(new ToggleShowEdgeBandsCommand())}
  />
  Show edge bands
</label>
```

- [ ] **Step 2: Test**

Append a test asserting the checkbox is rendered and toggling it dispatches the command.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/shell/tabs/ViewTab.tsx packages/app/src/shell/tabs/__tests__/ViewTab.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T27 ViewTab Show edge bands checkbox

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: `BrowserPane` renders `PanelFeature` rows

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Test: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx` (extend)

- [ ] **Step 1: Add panel feature row rendering**

In the feature-row dispatch in `BrowserPane.tsx`, add a `case 'panel'` that:
- shows label "Panel"
- icon = `PanelIcon`
- on double-click dispatches `EditPanelFeatureCommand`
- right-click context menu has Suppress / Delete (reuse existing handlers)

- [ ] **Step 2: Test**

Append a `BrowserPane.spec.tsx` test asserting Panel row, double-click handler, suppress/delete from context menu.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "$(cat <<'EOF'
feat(app): T28 BrowserPane renders PanelFeature rows

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 12 — Viewport edge-band overlay

### Task 29: Edge-band overlay subsystem in `SceneManager`

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Test: `packages/app/src/viewport/__tests__/SceneManager.spec.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `SceneManager.spec.ts`:

```ts
describe('edge-band overlay', () => {
  it('builds LineSegments overlay for each banded edge when showEdgeBands=true', () => { /* ... */ });
  it('removes overlay when showEdgeBands=false', () => { /* ... */ });
  it('uses material color from registry', () => { /* ... */ });
  it('falls back to warning color #cfa84b when band materialId is unresolved', () => { /* ... */ });
  it('rebuilds on parameter cascade', () => { /* ... */ });
});
```

- [ ] **Step 2: Implement overlay**

In `SceneManager.ts`, add a new private method `rebuildEdgeBandOverlays()` invoked when:
- `useAppStore.showEdgeBands` changes
- a panel-bearing part's geometry is rebuilt (subscribe to the existing geometry-update event bus)

For each visible part with a `PanelFeature`:
1. Read tessellated edges by `PanelEdgeKey` from the part's cached geometry (existing tessellator output already includes per-edge polylines).
2. Skip edges where the corresponding `edgeBands[key]` is null.
3. For each banded edge, look up the material in the active registry; resolve color or fall back to `#cfa84b` if missing.
4. Build a `THREE.LineSegments` with `LineBasicMaterial({ color, linewidth: 2 })`.
5. Add as a child of the part's mesh group; tag with `userData.kind = 'edgeBand'`.

Toggling `showEdgeBands` off removes all groups tagged `edgeBand`; toggling on rebuilds them via the same path.

- [ ] **Step 3: Run test + commit**

```bash
git add packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/__tests__/SceneManager.spec.ts
git commit -m "$(cat <<'EOF'
feat(app): T29 viewport edge-band highlight overlay

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 30: SceneManager subscribes to `showEdgeBands` flag

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`

- [ ] **Step 1: Subscribe to store**

In `SceneManager.attach()` (or wherever the existing flag subscriptions live, e.g. for `showColors`), add:

```ts
this.unsubscribers.push(
  useAppStore.subscribe(
    (s) => s.showEdgeBands,
    (v) => this.rebuildEdgeBandOverlays(v),
    { fireImmediately: true },
  ),
);
```

- [ ] **Step 2: Verify the toggle e2e via the existing dev server**

Run: `pnpm --filter @zilventor/app dev` and toggle the View-tab checkbox; observe overlays appear/disappear.

(This is a manual verification only — automated test arrives in Task 35 e2e.)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts
git commit -m "$(cat <<'EOF'
feat(app): T30 SceneManager subscribes to showEdgeBands flag

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 13 — End-to-end tests

### Task 31: e2e — create panel in empty part

**Files:**
- Create: `tests/e2e/furniture/create-panel-in-empty-part.spec.ts`
- Modify: `tests/e2e/helpers/seedKernelPart.ts` (add panel-seed helper if needed)

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test';

test('create panel in empty part — happy path', async ({ page }) => {
  await page.goto('/');
  // New part
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  // Furniture → Panel
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Panel' }).click();
  // Fill dialog
  await page.getByLabel('Length').fill('600');
  await page.getByLabel('Width').fill('400');
  // Manage Materials → add Birch Plywood 18mm
  await page.getByRole('button', { name: 'Manage…' }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByLabel('Name').fill('Birch Plywood 18mm');
  await page.getByLabel('Default Thickness').fill('18');
  await page.getByLabel('Color').fill('#d8c896');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // Material picker should show + select; thickness fills 18.
  await page.getByLabel('Material').selectOption({ label: 'Birch Plywood 18mm' });
  await expect(page.getByLabel('Thickness')).toHaveValue('18');
  // Grain
  await page.getByLabel('Length', { exact: true }).check();
  // Add a second material for edge bands
  await page.getByRole('button', { name: 'Manage…' }).click();
  await page.getByRole('button', { name: '+ Add' }).click();
  await page.getByLabel('Name').fill('PVC 1mm white');
  await page.getByLabel('Default Thickness').fill('1');
  await page.getByLabel('Color').fill('#ffffff');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // Band all four edges
  for (const edge of ['Front', 'Back', 'Left', 'Right']) {
    await page.getByRole('row', { name: edge }).getByRole('combobox').selectOption({ label: 'PVC 1mm white' });
  }
  // OK
  await page.getByRole('button', { name: 'OK' }).click();
  // Verify feature tree
  await expect(page.getByRole('tree').getByText('Panel')).toBeVisible();
  // Toggle View → Show edge bands; assert overlay layer count
  await page.getByRole('tab', { name: 'View' }).click();
  await expect(page.getByLabel('Show edge bands')).toBeChecked();
});
```

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test tests/e2e/furniture/create-panel-in-empty-part.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/furniture/create-panel-in-empty-part.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T31 create panel in empty part

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 32: e2e — place panel into assembly

**Files:**
- Create: `tests/e2e/furniture/place-panel-into-assembly.spec.ts`

- [ ] **Step 1: Write the spec**

Create new assembly → Furniture → Panel → fill dimensions + material → Save As (use Playwright's File System Access mock; see `tests/e2e/assembly/place-component.spec.ts` for the pattern) → assert: new component in browser pane, viewport mesh, manifest carries the material registry, panel references it by id.

- [ ] **Step 2: Run + commit**

```bash
git add tests/e2e/furniture/place-panel-into-assembly.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T32 place panel into assembly with reconciliation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 33: e2e — material registry edit

**Files:**
- Create: `tests/e2e/furniture/material-registry-edit.spec.ts`

- [ ] **Step 1: Write the spec**

Open assembly with a panel using "Birch Plywood 18mm". Open Manage Materials → add 3 materials → edit one's thickness → attempt delete on referenced one (assert inline error listing referencing panel). Save/reopen assembly: registry preserved.

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/furniture/material-registry-edit.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T33 material registry CRUD with reference guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 34: e2e — panel parametric cascade

**Files:**
- Create: `tests/e2e/furniture/panel-parametric-cascade.spec.ts`

- [ ] **Step 1: Write the spec**

Create a panel driven by parameters `panelL = 600`, `panelW = 400`. Assert bbox in viewport (read via `evaluateHandle` on the canvas-attached SceneManager) reflects 600×400. Change parameters via Parameters panel → 800×500. Assert bbox updated AND edge-band overlay rebuilt at the new dimensions.

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/furniture/panel-parametric-cascade.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T34 panel parametric cascade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 35: e2e — edge-band toggle persistence

**Files:**
- Create: `tests/e2e/furniture/edge-band-toggle.spec.ts`

- [ ] **Step 1: Write the spec**

Open a panel-bearing assembly. Toggle the View-tab "Show edge bands" checkbox off. Assert overlay LineSegments count drops to 0 (read via SceneManager handle). Reload the page. Assert checkbox still off, overlays still 0. Toggle on, reload, assert overlays restored.

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/furniture/edge-band-toggle.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T35 edge-band toggle persistence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 14 — Performance

### Task 36: Perf — 50-panel place + overlay rebuild

**Files:**
- Create: `tests/perf/panel-create-and-render.spec.ts`

- [ ] **Step 1: Write the perf spec**

```ts
import { test, expect } from '@playwright/test';

test('50-panel placement + overlay toggle perf', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New Assembly' }).click();
  // Place 50 panels via direct command dispatch (bypass UI for the perf path).
  const placeTimes: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = Date.now();
    await page.evaluate((i) => (window as any).__zil__placeTestPanel(i), i);
    placeTimes.push(Date.now() - t0);
  }
  const p95Place = percentile(placeTimes, 0.95);
  expect(p95Place).toBeLessThanOrEqual(12_000);

  // Now measure overlay toggle.
  const toggleTimes: number[] = [];
  for (let n = 0; n < 5; n++) {
    const t0 = Date.now();
    await page.getByLabel('Show edge bands').click();
    await page.waitForFunction(() => (window as any).__zil__overlayBuildDone === true);
    toggleTimes.push(Date.now() - t0);
  }
  const p95Toggle = percentile(toggleTimes, 0.95);
  expect(p95Toggle).toBeLessThanOrEqual(80);
});

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)];
}
```

(Provide `window.__zil__placeTestPanel` and `window.__zil__overlayBuildDone` as test-only hooks injected by the dev build behind a `IS_PLAYWRIGHT` flag — same pattern as existing perf specs use, e.g. `tests/perf/import-batch.spec.ts`.)

- [ ] **Step 2: Run**

Run: `pnpm exec playwright test --project=perf tests/perf/panel-create-and-render.spec.ts`
Expected: PASS within budgets.

- [ ] **Step 3: Commit**

```bash
git add tests/perf/panel-create-and-render.spec.ts packages/app/src/test-setup.ts
git commit -m "$(cat <<'EOF'
test(perf): T36 50-panel place + overlay toggle within budgets

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 15 — Manual smoke + final verification

### Task 37: Manual smoke checklist

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-5a.md`

- [ ] **Step 1: Write the checklist**

Create with three scenarios from spec §6.4:

1. **Hello-Panel:** New part → Furniture → Panel → fill 600×400×18 with "Birch 18" → save as `Side.zipt`. Reopen — feature tree shows Panel; dimensions intact.
2. **Cabinet-prep:** New assembly → 5 Panels (Top, Bottom, Left, Right, Back) for a small box; band 4 uprights' top edges; save assembly. Reopen — registry + bands persisted; toggle View → "Show edge bands" — highlights visible.
3. **Material-edit-cascade:** With (2) loaded, edit "Birch Plywood 18mm" `defaultThickness` → 19. Confirm panels using it without override update; explicitly-overridden panels do not.

For each scenario, list:
- Step-by-step user actions
- Expected results
- Failure indicators
- Recovery steps

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-5a.md
git commit -m "$(cat <<'EOF'
docs(manual-tests): T37 sub-project 5a smoke checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 38: Final verification — typecheck + every test suite + workspace smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `pnpm -r typecheck`
Expected: clean across all 5 packages.

- [ ] **Step 2: Unit tests**

Run: `pnpm -r test --run`
Expected: clean.

- [ ] **Step 3: Integration tests**

Run: `pnpm --filter @zilventor/kernel test:integration --run`
Expected: clean.

- [ ] **Step 4: E2E**

Run: `pnpm exec playwright test`
Expected: clean (5 new specs in `tests/e2e/furniture/` + all existing specs).

- [ ] **Step 5: Perf**

Run: `pnpm exec playwright test --project=perf`
Expected: clean within budgets.

- [ ] **Step 6: Workspace smoke shell script**

Run: `bash tests/workspace-smoke.sh`
Expected: clean.

- [ ] **Step 7: Update memory**

Append to `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/MEMORY.md`:

```
- [Sub-project 5a execution state (2026-05-XX)](project_subproject_5a_execution_state.md) — SHIPPED at <commit>; 38 tasks; Panel base feature + per-project material registry + edge-band metadata + Furniture tab activation; F1–F7 follow-ups deferred
```

And create `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/project_subproject_5a_execution_state.md` with: shipped commit, task count, test count summary, the 7 deferred follow-ups (F1–F7 from spec §7.3), and the manual-smoke status.

- [ ] **Step 8: Final commit (memory only — no code change)**

If any code-touching changes are still uncommitted, commit them first. The verification task itself produces no commit.

---

## Self-review checklist (run before claiming the plan is done)

- Every spec section in `docs/superpowers/specs/2026-05-01-subproject-5a-panel-design.md` is covered by at least one task. Specifically:
  - §2.1 MaterialEntry → T1
  - §2.2 PanelFeature → T2 + T3 (materials field on docs)
  - §2.2.1 face/edge naming → T6 + T7
  - §2.2.2 origin convention → T6 (bottom face on Z=0)
  - §2.3 manifest v9→v10 → T5
  - §2.4 reconciliation algorithm → T13
  - §2.5 validation rules (panel index 0, broken refs) → T11 + T18 + T22
  - §3.1 PanelOps → T6 + T7
  - §3.2 PanelFeature → T8 + T9
  - §3.3 FeatureTree wiring → T10 + T11
  - §3.4 v9→v10 migration tests → T5
  - §3.5 worker API surface → T8 (no new RPC; main resolves thickness)
  - §4.1 Furniture tab activation → T26
  - §4.2 commands → T16 + T17 + T18 + T19 + T20 + T21
  - §4.3 PanelDialog → T24 + T25
  - §4.4 BrowserPane → T28
  - §4.5 viewport edge-band overlay → T29 + T30
  - §4.6 MaterialRegistryEditor → T23
  - §4.7 ViewTab toggle → T15 + T16 + T27
  - §5.1 ProjectPacker / AssemblyPacker → T12
  - §5.2 migration test fixtures → T5
  - §5.3 reconciliation on placement → T13 + T22
  - §5.4 stale scratchpad cleanup → T13 (`updatedPartMaterials` filter)
  - §5.5 backward-compat → T5
  - §6.1 test inventory → T1, T2, T3, T5, T6, T7, T8, T9, T11, T12, T13, T15, T16, T17, T18, T19, T20, T21, T22, T23, T24, T26, T27, T28, T29
  - §6.2 e2e specs (5) → T31, T32, T33, T34, T35
  - §6.3 perf spec → T36
  - §6.4 manual-smoke checklist → T37
  - §6.5 CI/build verification → T38
- No placeholders in any task.
- Every task has exact file paths, exact commands, and exact commit messages with the co-author footer.
- Field names and types are consistent across tasks: `thicknessFromMaterial: boolean`, `PanelEdgeKey = 'front' | 'back' | 'left' | 'right'`, `MaterialEntry { id, name, defaultThickness, color }`, `INVALID_PANEL_PLACEMENT`, `PANEL_NOT_BASE_FEATURE`, `BROKEN_MATERIAL_REF`, `MATERIAL_IN_USE`, `DUPLICATE_NAME`.
