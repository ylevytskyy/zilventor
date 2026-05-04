# Sub-project 5c — Hardware Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-project hardware library (hinges + shelf pins) surfaced via a Furniture tab dialog and a new Hardware section in the cut list / BOM, mirroring the 5a registry + 5b dialog/command + 5d aggregator/CSV patterns. Manifest bumps v11→v12 with a built-in 7-entry catalog seed.

**Architecture:** New `HardwareFeature` discriminant + per-document `HardwareRegistry` (mirrors 5a). `AddHardwareCommand` lazily writes `hardware/<sku>.zipt` then delegates to `PlaceComponentCommand`. Parallel `aggregateHardwareRecursive` walker feeds a new Hardware CSV section + `HardwareTable` UI block. v11→v12 migration seeds the built-in 7-entry catalog into `AssemblyDocument.hardware`.

**Tech Stack:** TypeScript / Vitest / Playwright / pnpm workspaces. Same toolchain as 5a/5b/5d.

---

**Spec:** `docs/superpowers/specs/2026-05-04-subproject-5c-hardware-library-design.md`

**Validation per task:** `pnpm -r typecheck` and the affected package's vitest must remain green at every commit. E2E + perf at the corresponding phase boundaries.

**Commit footer (every commit):**

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Phase 1 — Domain types (shared)

### Task 1: Failing tests + implementation of `HardwareEntry` / `HardwareCategory` / `HardwareFeature` + `isHardwareFeature`

Implements spec §2.1 + §2.2.

**Files:**
- Create: `packages/shared/src/hardware-feature.ts`
- Create: `packages/shared/src/hardware-feature.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/hardware-feature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isHardwareFeature,
  type HardwareFeature,
  type HardwareEntry,
} from './hardware-feature';

const validFeature: HardwareFeature = {
  kind: 'hardware',
  id: 'hf-1',
  hardwareSkuId: 'hinge-35mm-cup-full',
  bboxMm: { l: 48, w: 35, h: 12 },
  attachPoints: [
    { name: 'cup-center', position: { x: 0, y: 17.5, z: 0 } },
    { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
  ],
};

describe('isHardwareFeature', () => {
  it('returns true for a valid HardwareFeature', () => {
    expect(isHardwareFeature(validFeature)).toBe(true);
  });

  it('returns false for a PanelFeature-shaped object', () => {
    expect(isHardwareFeature({ kind: 'panel', id: 'pf-1' })).toBe(false);
  });

  it('returns false for null and non-objects', () => {
    expect(isHardwareFeature(null)).toBe(false);
    expect(isHardwareFeature('hardware')).toBe(false);
    expect(isHardwareFeature(42)).toBe(false);
  });

  it('returns false when kind is missing', () => {
    expect(isHardwareFeature({ id: 'hf-1', hardwareSkuId: 'x', bboxMm: {}, attachPoints: [] })).toBe(false);
  });
});

describe('HardwareEntry shape', () => {
  it('compiles and accepts a valid entry', () => {
    const entry: HardwareEntry = {
      id: 'hinge-35mm-cup-full',
      name: '35mm Cup Hinge — Full Overlay',
      category: 'hinges',
      vendor: 'Blum',
      notes: 'Requires 35mm Forstner bit',
    };
    expect(entry.category).toBe('hinges');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/shared test -- hardware-feature.test`. Expected: import error / module-not-found.

- [ ] **Step 3: Implement `packages/shared/src/hardware-feature.ts`**

```ts
export type HardwareCategory = 'hinges' | 'shelfPins';

export type HardwareRegistry = readonly HardwareEntry[];

export interface HardwareEntry {
  readonly id: string;
  readonly name: string;
  readonly category: HardwareCategory;
  readonly vendor: string;
  readonly notes: string;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AttachPoint {
  readonly name: string;
  readonly position: Vec3;
  readonly normal?: Vec3;
}

export interface HardwareFeature {
  readonly kind: 'hardware';
  readonly id: string;
  readonly hardwareSkuId: string;
  readonly bboxMm: { readonly l: number; readonly w: number; readonly h: number };
  readonly attachPoints: readonly AttachPoint[];
}

export function isHardwareFeature(f: unknown): f is HardwareFeature {
  return (
    f !== null &&
    typeof f === 'object' &&
    (f as Record<string, unknown>).kind === 'hardware'
  );
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter @zilventor/shared test -- hardware-feature.test`. Expected: 5 PASS.

- [ ] **Step 5: Re-export from barrel**

Add to `packages/shared/src/index.ts`:

```ts
export type {
  HardwareCategory,
  HardwareEntry,
  HardwareFeature,
  HardwareRegistry,
  AttachPoint,
  Vec3,
} from './hardware-feature';
export { isHardwareFeature } from './hardware-feature';
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @zilventor/shared typecheck`. Expected: Done.

- [ ] **Step 7: Commit**

```
git add packages/shared/src/hardware-feature.ts packages/shared/src/hardware-feature.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): HardwareFeature discriminant + HardwareEntry registry type + isHardwareFeature guard

Implements spec §2.1 + §2.2. Parallel to PanelFeature / isPanelFeature pattern from 5a.
AttachPoint metadata stored but not consumed by solver (deferred F4).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Failing tests + implementation of `builtinCatalog.ts` (7 entries)

Implements spec §3.1 + §3.2 + §2.3.

**Files:**
- Create: `packages/shared/src/hardware/builtinCatalog.ts`
- Create: `packages/shared/src/hardware/builtinCatalog.test.ts`
- Create: `packages/shared/src/hardware/index.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/hardware/builtinCatalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_CATALOG } from './builtinCatalog';

describe('BUILTIN_CATALOG', () => {
  it('has exactly 7 entries', () => {
    expect(BUILTIN_CATALOG).toHaveLength(7);
  });

  it('all ids are unique', () => {
    const ids = BUILTIN_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(7);
  });

  it('has 4 hinge entries and 3 shelf-pin entries', () => {
    const hinges = BUILTIN_CATALOG.filter((e) => e.category === 'hinges');
    const pins   = BUILTIN_CATALOG.filter((e) => e.category === 'shelfPins');
    expect(hinges).toHaveLength(4);
    expect(pins).toHaveLength(3);
  });

  it('every entry has a non-empty name and non-empty notes', () => {
    for (const e of BUILTIN_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.notes.length).toBeGreaterThan(0);
    }
  });

  it('all bbox dims are positive numbers', () => {
    for (const e of BUILTIN_CATALOG) {
      expect(e.bboxMm.l).toBeGreaterThan(0);
      expect(e.bboxMm.w).toBeGreaterThan(0);
      expect(e.bboxMm.h).toBeGreaterThan(0);
    }
  });

  it('all attach-point positions are finite numbers', () => {
    for (const e of BUILTIN_CATALOG) {
      for (const ap of e.attachPoints) {
        expect(Number.isFinite(ap.position.x)).toBe(true);
        expect(Number.isFinite(ap.position.y)).toBe(true);
        expect(Number.isFinite(ap.position.z)).toBe(true);
      }
    }
  });

  it('hinge-35mm-cup-full has 2 attach points: cup-center and arm-mount', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'hinge-35mm-cup-full')!;
    expect(entry.attachPoints.map((a) => a.name)).toEqual(['cup-center', 'arm-mount']);
    expect(entry.attachPoints[0].position).toEqual({ x: 0, y: 17.5, z: 0 });
    expect(entry.attachPoints[1].position).toEqual({ x: 48, y: 17.5, z: 0 });
  });

  it('shelf-pin-5mm-steel has 1 attach point: tip at z=14', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'shelf-pin-5mm-steel')!;
    expect(entry.attachPoints).toHaveLength(1);
    expect(entry.attachPoints[0].name).toBe('tip');
    expect(entry.attachPoints[0].position).toEqual({ x: 0, y: 0, z: 14 });
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/shared test -- builtinCatalog.test`. Expected: import error / module-not-found.

- [ ] **Step 3: Implement `packages/shared/src/hardware/builtinCatalog.ts`**

```ts
import type { HardwareEntry } from '../hardware-feature';

interface CatalogEntry extends HardwareEntry {
  readonly bboxMm: { readonly l: number; readonly w: number; readonly h: number };
  readonly attachPoints: ReadonlyArray<{
    readonly name: string;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly normal?: { readonly x: number; readonly y: number; readonly z: number };
  }>;
}

export const BUILTIN_CATALOG: readonly CatalogEntry[] = [
  {
    id: 'hinge-35mm-cup-full',
    name: '35mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Full overlay; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-35mm-cup-half',
    name: '35mm Cup Hinge — Half Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Half overlay; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-35mm-cup-inset',
    name: '35mm Cup Hinge — Inset',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Inset door; requires 35mm Forstner bit',
    bboxMm: { l: 48, w: 35, h: 12 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 17.5, z: 0 } },
      { name: 'arm-mount',  position: { x: 48, y: 17.5, z: 0 } },
    ],
  },
  {
    id: 'hinge-26mm-cup-full',
    name: '26mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Generic',
    notes: 'Full overlay; requires 26mm Forstner bit',
    bboxMm: { l: 40, w: 26, h: 10 },
    attachPoints: [
      { name: 'cup-center', position: { x: 0,  y: 13, z: 0 } },
      { name: 'arm-mount',  position: { x: 40, y: 13, z: 0 } },
    ],
  },
  {
    id: 'shelf-pin-5mm-steel',
    name: '5mm Shelf Pin — Steel',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Press-fit into 5mm shelf-pin hole; steel',
    bboxMm: { l: 5, w: 5, h: 28 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 14 } },
    ],
  },
  {
    id: 'shelf-pin-5mm-clear',
    name: '5mm Shelf Pin — Clear',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Press-fit into 5mm shelf-pin hole; clear plastic',
    bboxMm: { l: 5, w: 5, h: 28 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 14 } },
    ],
  },
  {
    id: 'shelf-pin-7mm-sleeve',
    name: '7mm Shelf Pin — Steel Sleeve',
    category: 'shelfPins',
    vendor: 'Generic',
    notes: 'Sleeve style; requires 7mm hole',
    bboxMm: { l: 7, w: 7, h: 32 },
    attachPoints: [
      { name: 'tip', position: { x: 0, y: 0, z: 18 } },
    ],
  },
];
```

- [ ] **Step 4: Create `packages/shared/src/hardware/index.ts`**

```ts
export { BUILTIN_CATALOG } from './builtinCatalog';
```

- [ ] **Step 5: Run the tests — should pass**

Run: `pnpm --filter @zilventor/shared test -- builtinCatalog.test`. Expected: 7 PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @zilventor/shared typecheck`. Expected: Done.

- [ ] **Step 7: Commit**

```
git add packages/shared/src/hardware/builtinCatalog.ts packages/shared/src/hardware/builtinCatalog.test.ts packages/shared/src/hardware/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): built-in hardware catalog — 4 hinges + 3 shelf pins (spec §3.1/§3.2/§2.3)

7 CatalogEntry objects with bbox dims and attach points. Tests pin uniqueness,
category counts, bbox positivity, attach-point positions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Document type extension + migration

### Task 3: Failing tests for `PartDocument.hardware` / `AssemblyDocument.hardware` + v11→v12 migration

Implements spec §2.4 + §6.1 + §6.2 + §8.3.

**Files:**
- Modify: `packages/shared/src/fileFormat.test.ts` (append new cases)

- [ ] **Step 1: Append the failing migration tests**

Locate `packages/shared/src/fileFormat.test.ts` and append:

```ts
import { BUILTIN_CATALOG } from './hardware/builtinCatalog';

// ---------------------------------------------------------------------------
// v11 → v12: hardware field + built-in catalog seed
// ---------------------------------------------------------------------------
describe('migration v11→v12', () => {
  it('v11 PartDocument gains hardware: []', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'part',
      document: {
        id: 'p1', name: 'Part', units: 'mm', parameters: {}, featureTree: [],
        properties: {}, materials: [],
      },
    };
    const result = migrateManifest(manifest);
    expect(result.formatVersion).toBe(12);
    expect((result.document as { hardware?: unknown }).hardware).toEqual([]);
  });

  it('v11 AssemblyDocument gains hardware with 7 built-in entries', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'assembly',
      document: {
        id: 'a1', name: 'Asm', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {}, materials: [],
      },
    };
    const result = migrateManifest(manifest);
    expect(result.formatVersion).toBe(12);
    const hw = (result.document as { hardware?: unknown[] }).hardware;
    expect(hw).toHaveLength(7);
    expect(hw!.map((e: unknown) => (e as { id: string }).id)).toEqual(
      BUILTIN_CATALOG.map((e) => e.id),
    );
  });

  it('v12 AssemblyDocument that already has hardware entries is not duplicated', () => {
    const manifest = {
      formatVersion: 11,
      kind: 'assembly',
      document: {
        id: 'a2', name: 'Asm2', units: 'mm', parameters: {},
        components: [], constraints: [], groundedComponentPaths: [],
        colors: {}, bomItemNumbers: {}, cutListItemNumbers: {},
        colorOverrides: {}, properties: {}, materials: [],
        hardware: [BUILTIN_CATALOG[0]],
      },
    };
    const result = migrateManifest(manifest);
    const hw = (result.document as { hardware?: unknown[] }).hardware;
    // Should have all 7, not 1 + 7.
    expect(hw).toHaveLength(7);
    const ids = hw!.map((e: unknown) => (e as { id: string }).id);
    expect(new Set(ids).size).toBe(7);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/shared test -- fileFormat`. Expected: 3 FAIL — migration v11→v12 does not exist yet.

- [ ] **Step 3: Commit stub (tests only)**

```
git add packages/shared/src/fileFormat.test.ts
git commit -m "$(cat <<'EOF'
test(shared): failing migration tests for v11→v12 hardware field + catalog seed

Three cases: part gains hardware:[], assembly gains 7 entries, idempotent on re-seed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Extend `types.ts` + implement v11→v12 migration in `fileFormat.ts`

Implements spec §2.4 + §6.1 + §6.2.

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/fileFormat.ts`

- [ ] **Step 1: Add `hardware` field to both document types in `types.ts`**

In `packages/shared/src/types.ts`, find the `PartDocument` type (around line 65) and add:

```ts
  hardware: HardwareEntry[];
```

after the `materials: MaterialEntry[];` line. Do the same for `AssemblyDocument` (around line 89). Add the import at the top of the file:

```ts
import type { HardwareEntry } from './hardware-feature';
```

- [ ] **Step 2: Add migration helpers + v11→v12 case in `fileFormat.ts`**

Add the import near the top of `packages/shared/src/fileFormat.ts`:

```ts
import { BUILTIN_CATALOG } from './hardware/builtinCatalog';
```

Add two helper functions before the `migrations` record:

```ts
function addHardwareField(doc: Record<string, unknown>): void {
  if (doc.hardware == null) {
    doc.hardware = [];
  }
}

function seedBuiltinHardware(doc: Record<string, unknown>): void {
  const existing = (doc.hardware as Array<{ id: string }> | undefined) ?? [];
  const existingIds = new Set(existing.map((e) => e.id));
  for (const entry of BUILTIN_CATALOG) {
    if (!existingIds.has(entry.id)) {
      existing.push({ ...entry });
    }
  }
  doc.hardware = existing;
}
```

Then append to the `migrations` record (after the `10:` case):

```ts
  // v11 → v12: additive — add `hardware: []` to part- and assembly-kind
  // documents (sub-project 5c). Seeds the 7 built-in catalog entries into
  // AssemblyDocument.hardware on first migration (idempotent by id).
  11: (mIn) => {
    const m = deepClone(mIn);
    const anyM = m as { kind?: string; document?: Record<string, unknown> };
    if (anyM.document) {
      addHardwareField(anyM.document);
      if (anyM.kind === 'assembly') {
        seedBuiltinHardware(anyM.document);
      }
    }
    return { ...m, formatVersion: 12 };
  },
```

Also bump line 3:

```ts
export const CURRENT_FORMAT_VERSION = 12 as const;
```

- [ ] **Step 3: Run the migration tests — should pass**

Run: `pnpm --filter @zilventor/shared test -- fileFormat`. Expected: all PASS (including the 3 new ones).

- [ ] **Step 4: Run full shared typecheck**

Run: `pnpm --filter @zilventor/shared typecheck`. Expected: Done.

- [ ] **Step 5: Commit**

```
git add packages/shared/src/types.ts packages/shared/src/fileFormat.ts
git commit -m "$(cat <<'EOF'
feat(shared): v11→v12 migration — hardware field + built-in catalog seed on AssemblyDocument

Bumps CURRENT_FORMAT_VERSION to 12. Adds hardware:[] to PartDocument and
AssemblyDocument types. Migration seeds 7 built-in entries (idempotent by id).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Aggregator + spec resolver

### Task 5: Failing tests + implementation of `resolveHardwareSpec`

Implements spec §5.4 + §8.1 (cases 6–7).

**Files:**
- Create: `packages/app/src/shell/resolveHardwareSpec.ts`
- Create: `packages/app/src/shell/resolveHardwareSpec.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/shell/resolveHardwareSpec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveHardwareSpec } from './resolveHardwareSpec';
import type { HardwareFeature, HardwareRegistry } from '@zilventor/shared';

const registry: HardwareRegistry = [
  {
    id: 'hinge-35mm-cup-full',
    name: '35mm Cup Hinge — Full Overlay',
    category: 'hinges',
    vendor: 'Blum',
    notes: 'Requires 35mm Forstner bit',
  },
];

const hardwareFeature: HardwareFeature = {
  kind: 'hardware',
  id: 'hf-1',
  hardwareSkuId: 'hinge-35mm-cup-full',
  bboxMm: { l: 48, w: 35, h: 12 },
  attachPoints: [],
};

const panelLike = { kind: 'panel', id: 'pf-1', hardwareSkuId: undefined };

describe('resolveHardwareSpec', () => {
  it('returns null when featureTree is empty', () => {
    const part = { featureTree: [] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns null when featureTree has no HardwareFeature', () => {
    const part = { featureTree: [panelLike] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns null when SKU is not found in registry', () => {
    const unknownFeature: HardwareFeature = { ...hardwareFeature, hardwareSkuId: 'unknown-sku' };
    const part = { featureTree: [unknownFeature] } as never;
    expect(resolveHardwareSpec(part, registry)).toBeNull();
  });

  it('returns { entry, feature } for a valid HardwareFeature + matching SKU', () => {
    const part = { featureTree: [hardwareFeature] } as never;
    const result = resolveHardwareSpec(part, registry);
    expect(result).not.toBeNull();
    expect(result!.feature).toBe(hardwareFeature);
    expect(result!.entry.id).toBe('hinge-35mm-cup-full');
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- resolveHardwareSpec.test`. Expected: import error.

- [ ] **Step 3: Implement `resolveHardwareSpec.ts`**

```ts
import { isHardwareFeature, type HardwareEntry, type HardwareFeature, type HardwareRegistry } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

export function resolveHardwareSpec(
  part: Pick<PartDocument, 'featureTree'>,
  registry: HardwareRegistry,
): { entry: HardwareEntry; feature: HardwareFeature } | null {
  const feature = (part.featureTree as unknown[]).find(
    (f): f is HardwareFeature => isHardwareFeature(f),
  );
  if (!feature) return null;
  const entry = registry.find((e) => e.id === feature.hardwareSkuId);
  if (!entry) return null;
  return { entry, feature };
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- resolveHardwareSpec.test`. Expected: 4 PASS.

- [ ] **Step 5: Commit**

```
git add packages/app/src/shell/resolveHardwareSpec.ts packages/app/src/shell/resolveHardwareSpec.test.ts
git commit -m "$(cat <<'EOF'
feat(app): resolveHardwareSpec — finds HardwareFeature + registry lookup (spec §5.4)

Parallel to resolvePanelSpec. Returns null on empty tree, non-hardware feature, or unknown SKU.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Failing tests + implementation of `aggregateHardwareRecursive`

Implements spec §5.3 + §8.2.

**Files:**
- Create: `packages/app/src/assembly/walkers/aggregateHardwareRecursive.ts`
- Create: `packages/app/src/assembly/walkers/aggregateHardwareRecursive.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/assembly/walkers/aggregateHardwareRecursive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateHardwareRecursive } from './aggregateHardwareRecursive';
import type { AssemblyDocument } from '@zilventor/shared';
import type { HardwareRegistry } from '@zilventor/shared';

const registry: HardwareRegistry = [
  { id: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges',    vendor: 'Blum',    notes: 'Requires 35mm Forstner bit' },
  { id: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',         category: 'shelfPins', vendor: 'Generic', notes: 'Press-fit into 5mm shelf-pin hole; steel' },
];

function makeHardwarePart(skuId: string) {
  return {
    kind: 'part' as const,
    document: {
      featureTree: [
        { kind: 'hardware', id: 'hf-1', hardwareSkuId: skuId, bboxMm: { l: 48, w: 35, h: 12 }, attachPoints: [] },
      ],
    },
  };
}

function makePanelPart() {
  return {
    kind: 'part' as const,
    document: {
      featureTree: [
        { kind: 'panel', id: 'pf-1' },
      ],
    },
  };
}

type DocumentCache = Map<string, { kind: 'ok'; doc: AssemblyDocument } | { kind: 'part'; document: { featureTree: unknown[] } }>;

function makeCache(entries: Record<string, ReturnType<typeof makeHardwarePart> | ReturnType<typeof makePanelPart>>): DocumentCache {
  return new Map(Object.entries(entries)) as unknown as DocumentCache;
}

function makeAsm(components: Array<{ id: string; partPath: string }>): AssemblyDocument {
  return {
    id: 'asm-1',
    name: 'Test',
    units: 'mm',
    parameters: {},
    components: components.map((c) => ({
      ...c,
      position: { x: 0, y: 0, z: 0 },
      rotation: { rx: 0, ry: 0, rz: 0 },
      visible: true,
    })),
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [...registry],
  };
}

describe('aggregateHardwareRecursive', () => {
  it('assembly with 0 hardware components returns rows: []', () => {
    const asm = makeAsm([]);
    const result = aggregateHardwareRecursive(asm, new Map(), registry);
    expect(result.rows).toEqual([]);
  });

  it('2 instances of same SKU → 1 row with qty=2', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      { id: 'c2', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
    ]);
    const cache = makeCache({
      'hardware/hinge-35mm-cup-full.zipt': makeHardwarePart('hinge-35mm-cup-full'),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].skuId).toBe('hinge-35mm-cup-full');
    expect(result.rows[0].qty).toBe(2);
  });

  it('1 hinge + 1 shelf pin → 2 rows sorted by category then name', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      { id: 'c2', partPath: 'hardware/shelf-pin-5mm-steel.zipt' },
    ]);
    const cache = makeCache({
      'hardware/hinge-35mm-cup-full.zipt': makeHardwarePart('hinge-35mm-cup-full'),
      'hardware/shelf-pin-5mm-steel.zipt': makeHardwarePart('shelf-pin-5mm-steel'),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toHaveLength(2);
    // hinges < shelfPins alphabetically
    expect(result.rows[0].category).toBe('hinges');
    expect(result.rows[1].category).toBe('shelfPins');
  });

  it('hardware in a nested sub-assembly is counted in the parent walk', () => {
    const subAsm: AssemblyDocument = makeAsm([
      { id: 'c1', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
    ]);
    const parentAsm = makeAsm([
      { id: 'sub1', partPath: 'cabinet.ziasm' },
    ]);
    const cache = new Map([
      ['cabinet.ziasm', { kind: 'ok' as const, doc: subAsm }],
      ['hardware/hinge-35mm-cup-full.zipt', makeHardwarePart('hinge-35mm-cup-full')],
    ]);
    const result = aggregateHardwareRecursive(parentAsm, cache as never, registry);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].qty).toBe(1);
  });

  it('panel components are not included in hardware rows', () => {
    const asm = makeAsm([
      { id: 'c1', partPath: 'parts/panel.zipt' },
    ]);
    const cache = makeCache({
      'parts/panel.zipt': makePanelPart(),
    });
    const result = aggregateHardwareRecursive(asm, cache as never, registry);
    expect(result.rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- aggregateHardwareRecursive.test`. Expected: import error.

- [ ] **Step 3: Implement `aggregateHardwareRecursive.ts`**

```ts
import type { AssemblyDocument } from '@zilventor/shared';
import type { HardwareCategory, HardwareRegistry } from '@zilventor/shared';
import { isHardwareFeature } from '@zilventor/shared';

export interface HardwareRow {
  skuId: string;
  name: string;
  category: HardwareCategory;
  qty: number;
  notes: string;
}

export interface HardwareAggregateResult {
  rows: HardwareRow[];
}

type PartLike = { kind: 'part'; document: { featureTree: unknown[] } };
type CacheEntry = { kind: 'ok'; doc: AssemblyDocument } | PartLike;
type DocumentCache = Map<string, CacheEntry>;

export function aggregateHardwareRecursive(
  activeDoc: AssemblyDocument,
  cache: DocumentCache,
  hardwareRegistry: HardwareRegistry,
): HardwareAggregateResult {
  const acc = new Map<string, HardwareRow>();

  function walk(doc: AssemblyDocument): void {
    for (const c of doc.components) {
      if (c.partPath.endsWith('.ziasm')) {
        const entry = cache.get(c.partPath);
        if (entry && entry.kind === 'ok') walk(entry.doc);
        continue;
      }
      const entry = cache.get(c.partPath);
      if (!entry || entry.kind !== 'part') continue;
      const hwFeature = (entry.document.featureTree as unknown[]).find(
        (f): f is ReturnType<typeof isHardwareFeature> extends true ? Parameters<typeof isHardwareFeature>[0] : never =>
          isHardwareFeature(f),
      );
      if (!hwFeature || !isHardwareFeature(hwFeature)) continue;
      const regEntry = hardwareRegistry.find((e) => e.id === hwFeature.hardwareSkuId);
      if (!regEntry) continue;
      const existing = acc.get(regEntry.id);
      if (existing) {
        existing.qty += 1;
      } else {
        acc.set(regEntry.id, {
          skuId: regEntry.id,
          name: regEntry.name,
          category: regEntry.category,
          qty: 1,
          notes: regEntry.notes,
        });
      }
    }
  }

  walk(activeDoc);

  const rows = [...acc.values()].sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return { rows };
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- aggregateHardwareRecursive.test`. Expected: 5 PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 6: Commit**

```
git add packages/app/src/assembly/walkers/aggregateHardwareRecursive.ts packages/app/src/assembly/walkers/aggregateHardwareRecursive.test.ts
git commit -m "$(cat <<'EOF'
feat(app): aggregateHardwareRecursive walker — groups hardware by SKU across nested assemblies

Parallel to aggregateCutListRecursive. Sorts by category then name. Ignores panel parts.
5 unit tests covering empty, grouping, mixed, nested, and panel-exclusion cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Commands

### Task 7: Failing test + implementation of `OpenHardwareDialogCommand`

Implements spec §4.1 + §5.7 (dialog pattern). Mirrors `OpenCabinetDialogCommand`.

**Files:**
- Create: `packages/app/src/commands/OpenHardwareDialogCommand.ts`
- Create: `packages/app/src/commands/OpenHardwareDialogCommand.test.ts`

- [ ] **Step 1: Add `hardwareDialog` slot to `useAppStore`**

In `packages/app/src/store/useAppStore.ts`, add the following type after `CabinetDialogState`:

```ts
export type HardwareDialogState = {
  onSubmit: (skuId: string, qty: number) => void;
  onCancel: () => void;
};
```

In the `AppState` type, after `cabinetDialog: CabinetDialogState | null;`, add:

```ts
  hardwareDialog: HardwareDialogState | null;
  setHardwareDialog(s: HardwareDialogState | null): void;
```

In the `create(...)` initializer, add `hardwareDialog: null` to the initial state and implement `setHardwareDialog`:

```ts
hardwareDialog: null,
setHardwareDialog: (s) => set({ hardwareDialog: s }),
```

- [ ] **Step 2: Write the failing test**

In `packages/app/src/commands/OpenHardwareDialogCommand.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHardwareDialogCommand } from './OpenHardwareDialogCommand';
import { useAppStore } from '../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({ hardwareDialog: null, activeAssembly: null });
});

describe('OpenHardwareDialogCommand', () => {
  it('apply() throws NO_ACTIVE_ASSEMBLY when no assembly is active', async () => {
    const cmd = new OpenHardwareDialogCommand({ onSubmit: vi.fn(), onCancel: vi.fn() });
    await expect(cmd.apply()).rejects.toThrow('NO_ACTIVE_ASSEMBLY');
  });

  it('apply() sets hardwareDialog slot in store when assembly is active', async () => {
    useAppStore.setState({
      activeAssembly: { id: 'a1', name: 'Asm', units: 'mm', parameters: {}, components: [],
        constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
        cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [] },
    });
    const onSubmit = vi.fn();
    const cmd = new OpenHardwareDialogCommand({ onSubmit, onCancel: vi.fn() });
    await cmd.apply();
    expect(useAppStore.getState().hardwareDialog).not.toBeNull();
    expect(useAppStore.getState().hardwareDialog?.onSubmit).toBe(onSubmit);
  });

  it('revert() is a no-op', async () => {
    const cmd = new OpenHardwareDialogCommand({ onSubmit: vi.fn(), onCancel: vi.fn() });
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- OpenHardwareDialogCommand.test`. Expected: import error.

- [ ] **Step 4: Implement `OpenHardwareDialogCommand.ts`**

```ts
import type { Command } from './Command';
import { useAppStore, type HardwareDialogState } from '../store/useAppStore';

export type OpenHardwareDialogOpts = {
  onSubmit: (skuId: string, qty: number) => void;
  onCancel?: () => void;
};

export class OpenHardwareDialogCommand implements Command {
  readonly name = 'OpenHardwareDialog';
  constructor(private readonly opts: OpenHardwareDialogOpts) {}

  async apply(): Promise<void> {
    if (!useAppStore.getState().activeAssembly) throw new Error('NO_ACTIVE_ASSEMBLY');
    const slot: HardwareDialogState = {
      onSubmit: this.opts.onSubmit,
      onCancel: this.opts.onCancel ?? (() => useAppStore.getState().setHardwareDialog(null)),
    };
    useAppStore.getState().setHardwareDialog(slot);
  }

  async revert(): Promise<void> {
    // No-op: dialog state is not undoable.
  }
}
```

- [ ] **Step 5: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- OpenHardwareDialogCommand.test`. Expected: 3 PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 7: Commit**

```
git add packages/app/src/commands/OpenHardwareDialogCommand.ts packages/app/src/commands/OpenHardwareDialogCommand.test.ts packages/app/src/store/useAppStore.ts
git commit -m "$(cat <<'EOF'
feat(app): OpenHardwareDialogCommand + hardwareDialog store slot (spec §4.1)

Mirrors OpenCabinetDialogCommand pattern. Guards NO_ACTIVE_ASSEMBLY. revert() is a no-op.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Failing tests for `AddHardwareCommand`

Implements spec §5.2 + §7.1 + §8.3 (command symmetry, file-reuse, project-wide refcount delete).

**Files:**
- Create: `packages/app/src/commands/AddHardwareCommand.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/app/src/commands/AddHardwareCommand.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddHardwareCommand } from './AddHardwareCommand';
import { useAppStore } from '../store/useAppStore';

// Minimal MemOpfs for tests.
function makeOpfs(initial: Record<string, Uint8Array> = {}) {
  const store = new Map<string, Uint8Array>(Object.entries(initial));
  return {
    exists: async (p: string) => store.has(p),
    read:   async (p: string) => store.get(p) ?? new Uint8Array(),
    write:  async (p: string, b: Uint8Array) => { store.set(p, b); },
    delete: async (p: string) => { store.delete(p); },
    list:   async () => [...store.keys()],
    store,
  };
}

function makeActiveAssembly(components: Array<{ id: string; partPath: string }> = []) {
  return {
    id: 'a1', name: 'Asm', units: 'mm' as const, parameters: {}, components: components.map((c) => ({
      ...c, position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true,
    })),
    constraints: [], groundedComponentPaths: [], colors: {}, bomItemNumbers: {},
    cutListItemNumbers: {}, colorOverrides: {}, properties: {}, materials: [], hardware: [],
  };
}

beforeEach(() => {
  useAppStore.setState({ activeAssembly: makeActiveAssembly(), hardwareDialog: null });
});

describe('AddHardwareCommand', () => {
  it('apply() throws on unknown SKU', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'unknown-sku', opfs, store: useAppStore });
    await expect(cmd.apply()).rejects.toThrow(/HardwareSkuNotFound|unknown-sku/i);
  });

  it('apply() writes hardware/<sku>.zipt when file does not exist', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });

  it('apply() reuses existing file without re-writing when file already exists', async () => {
    const existing = new Uint8Array([1, 2, 3]);
    const opfs = makeOpfs({ 'hardware/hinge-35mm-cup-full.zipt': existing });
    const writeSpy = vi.spyOn(opfs, 'write');
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(writeSpy).not.toHaveBeenCalledWith('hardware/hinge-35mm-cup-full.zipt', expect.anything());
  });

  it('apply() places a component into the active assembly', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    const asm = useAppStore.getState().activeAssembly!;
    expect(asm.components.length).toBeGreaterThan(0);
    expect(asm.components[0].partPath).toBe('hardware/hinge-35mm-cup-full.zipt');
  });

  it('revert() removes the placed component', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(1);
    await cmd.revert();
    expect(useAppStore.getState().activeAssembly!.components).toHaveLength(0);
  });

  it('revert() deletes the .zipt file when no other component references it', async () => {
    const opfs = makeOpfs();
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    await cmd.revert();
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(false);
  });

  it('revert() retains the .zipt file when another component still references it', async () => {
    // Pre-populate an assembly with an existing reference.
    useAppStore.setState({
      activeAssembly: makeActiveAssembly([
        { id: 'pre-existing', partPath: 'hardware/hinge-35mm-cup-full.zipt' },
      ]),
    });
    const existing = new Uint8Array([1, 2, 3]);
    const opfs = makeOpfs({ 'hardware/hinge-35mm-cup-full.zipt': existing });
    const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs, store: useAppStore });
    await cmd.apply();
    await cmd.revert();
    // The pre-existing component still references the file → should not be deleted.
    expect(await opfs.exists('hardware/hinge-35mm-cup-full.zipt')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- AddHardwareCommand.test`. Expected: import error (no implementation yet).

- [ ] **Step 3: Commit tests only**

```
git add packages/app/src/commands/AddHardwareCommand.test.ts
git commit -m "$(cat <<'EOF'
test(app): failing tests for AddHardwareCommand — write/reuse/place/revert/refcount

7 cases covering unknown SKU, first-write, file-reuse, component placement,
symmetric revert, file deletion, and reference-count retention.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Implementation of `AddHardwareCommand`

Implements spec §5.2 + §7.1.

**Files:**
- Create: `packages/app/src/commands/AddHardwareCommand.ts`

- [ ] **Step 1: Implement `AddHardwareCommand.ts`**

```ts
import type { Command } from './Command';
import type { HardwareFeature } from '@zilventor/shared';
import { CURRENT_FORMAT_VERSION } from '@zilventor/shared';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import { newPart, addFeature } from '@zilventor/kernel/src/adapter/PartDocument';
import { writeTarGz } from '@zilventor/kernel/src/storage/tarGzipUtil';
import { PlaceComponentCommand } from './PlaceComponentCommand';
import { useAppStore, type AppStore } from '../store/useAppStore';

interface OpfsForHardware {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  delete(path: string): Promise<void>;
  list(): Promise<string[]>;
}

export class HardwareSkuNotFoundError extends Error {
  constructor(skuId: string) {
    super(`HardwareSkuNotFound: ${skuId}`);
    this.name = 'HardwareSkuNotFoundError';
  }
}

export type AddHardwareOpts = {
  skuId: string;
  opfs: OpfsForHardware;
  store?: typeof useAppStore;
};

export class AddHardwareCommand implements Command {
  readonly name = 'AddHardware';
  private didWriteFile = false;
  private placeCommand: PlaceComponentCommand | null = null;
  private readonly store: typeof useAppStore;

  constructor(private readonly opts: AddHardwareOpts) {
    this.store = opts.store ?? useAppStore;
  }

  private get path(): string {
    return `hardware/${this.opts.skuId}.zipt`;
  }

  async apply(): Promise<void> {
    const catalogEntry = BUILTIN_CATALOG.find((e) => e.id === this.opts.skuId);
    if (!catalogEntry) throw new HardwareSkuNotFoundError(this.opts.skuId);

    const { path } = this;

    if (!(await this.opts.opfs.exists(path))) {
      const bytes = await this.synthesizePart(catalogEntry);
      await this.opts.opfs.write(path, bytes);
      this.didWriteFile = true;
    }

    try {
      this.placeCommand = new PlaceComponentCommand({ partPath: path, opfs: this.opts.opfs as never });
      await this.placeCommand.apply();
    } catch (err) {
      if (this.didWriteFile) {
        await this.opts.opfs.delete(path);
        this.didWriteFile = false;
      }
      throw err;
    }
  }

  async revert(): Promise<void> {
    if (this.placeCommand) {
      await this.placeCommand.revert();
      this.placeCommand = null;
    }
    if (this.didWriteFile) {
      const stillReferenced = await this.isFileReferenced(this.path);
      if (!stillReferenced) {
        await this.opts.opfs.delete(this.path);
      }
      this.didWriteFile = false;
    }
  }

  private async isFileReferenced(filePath: string): Promise<boolean> {
    const asm = this.store.getState().activeAssembly;
    if (!asm) return false;
    return asm.components.some((c) => c.partPath === filePath);
  }

  private async synthesizePart(
    entry: typeof BUILTIN_CATALOG[number],
  ): Promise<Uint8Array> {
    const partDoc = newPart(`hardware-${entry.id}`);
    const hwFeature: HardwareFeature = {
      kind: 'hardware',
      id: `hf-${entry.id}`,
      hardwareSkuId: entry.id,
      bboxMm: entry.bboxMm,
      attachPoints: entry.attachPoints,
    };
    const withFeature = addFeature(partDoc, hwFeature as never);
    const manifest = {
      formatVersion: CURRENT_FORMAT_VERSION,
      kind: 'part' as const,
      document: withFeature,
    };
    return writeTarGz('manifest.json', JSON.stringify(manifest));
  }
}
```

- [ ] **Step 2: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- AddHardwareCommand.test`. Expected: 7 PASS.

- [ ] **Step 3: Full typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 4: Commit**

```
git add packages/app/src/commands/AddHardwareCommand.ts
git commit -m "$(cat <<'EOF'
feat(app): AddHardwareCommand — lazy .zipt synthesis + PlaceComponentCommand delegate (spec §5.2)

Checks OPFS before writing (file-reuse). revert() removes placed component;
deletes .zipt only when no surviving reference exists in active assembly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 5 — UI

### Task 10: Failing render test + implementation of `HardwareDialog`

Implements spec §4.2 + §4.3 + §4.4.

**Files:**
- Create: `packages/app/src/shell/HardwareDialog.tsx`
- Create: `packages/app/src/shell/HardwareDialog.test.tsx`

- [ ] **Step 1: Write the failing render tests**

In `packages/app/src/shell/HardwareDialog.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HardwareDialog } from './HardwareDialog';
import { useAppStore } from '../store/useAppStore';

beforeEach(() => {
  useAppStore.setState({ hardwareDialog: null });
});

function openDialog(onSubmit = vi.fn(), onCancel = vi.fn()) {
  useAppStore.setState({ hardwareDialog: { onSubmit, onCancel } });
}

describe('HardwareDialog', () => {
  it('renders nothing when hardwareDialog is null', () => {
    render(<HardwareDialog />);
    expect(screen.queryByRole('dialog', { name: /hardware/i })).toBeNull();
  });

  it('renders when hardwareDialog is set', () => {
    openDialog();
    render(<HardwareDialog />);
    expect(screen.getByRole('dialog', { name: /hardware/i })).toBeTruthy();
  });

  it('shows category dropdown defaulting to Hinges', () => {
    openDialog();
    render(<HardwareDialog />);
    const select = screen.getByRole('combobox', { name: /category/i });
    expect((select as HTMLSelectElement).value).toBe('hinges');
  });

  it('variant grid shows 4 hinge entries by default', () => {
    openDialog();
    render(<HardwareDialog />);
    // Each variant is a radio or button with the hinge name.
    const items = screen.getAllByRole('radio');
    expect(items).toHaveLength(4);
  });

  it('switching category to Shelf Pins shows 3 SKUs', () => {
    openDialog();
    render(<HardwareDialog />);
    const select = screen.getByRole('combobox', { name: /category/i });
    fireEvent.change(select, { target: { value: 'shelfPins' } });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('Esc key calls onCancel', () => {
    const onCancel = vi.fn();
    openDialog(vi.fn(), onCancel);
    render(<HardwareDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('OK calls onSubmit with selected SKU and qty=1 by default', () => {
    const onSubmit = vi.fn();
    openDialog(onSubmit);
    render(<HardwareDialog />);
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onSubmit).toHaveBeenCalledWith('hinge-35mm-cup-full', 1);
  });

  it('incrementing qty to 2 passes qty=2 to onSubmit', () => {
    const onSubmit = vi.fn();
    openDialog(onSubmit);
    render(<HardwareDialog />);
    fireEvent.click(screen.getByRole('button', { name: /increment qty/i }));
    fireEvent.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(onSubmit).toHaveBeenCalledWith('hinge-35mm-cup-full', 2);
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- HardwareDialog.test`. Expected: import error.

- [ ] **Step 3: Implement `HardwareDialog.tsx`**

```tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';
import { BUILTIN_CATALOG } from '@zilventor/shared/src/hardware/builtinCatalog';
import type { HardwareCategory } from '@zilventor/shared';

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const panelStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6, padding: 16,
  width: 440, color: '#eee', fontSize: 12, maxHeight: '90vh', overflowY: 'auto',
};
const btnStyle: React.CSSProperties = {
  background: '#2a2a2a', color: '#eee', border: '1px solid #444',
  padding: '4px 10px', cursor: 'pointer', fontSize: 11,
};
const okBtnStyle: React.CSSProperties = { ...btnStyle, background: '#3b5a8a', borderColor: '#6a8ec4' };

export function HardwareDialog(): JSX.Element | null {
  const dialog = useAppStore((s) => s.hardwareDialog);
  const [category, setCategory] = React.useState<HardwareCategory>('hinges');
  const [selectedSkuId, setSelectedSkuId] = React.useState<string>('hinge-35mm-cup-full');
  const [qty, setQty] = React.useState(1);

  const filtered = BUILTIN_CATALOG.filter((e) => e.category === category);

  React.useEffect(() => {
    if (!dialog) return;
    setCategory('hinges');
    setSelectedSkuId('hinge-35mm-cup-full');
    setQty(1);
  }, [dialog]);

  React.useEffect(() => {
    const first = filtered[0];
    if (first && !filtered.find((e) => e.id === selectedSkuId)) {
      setSelectedSkuId(first.id);
    }
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog) dialog.onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [dialog]);

  if (!dialog) return null;

  const handleOk = () => {
    dialog.onSubmit(selectedSkuId, qty);
    useAppStore.getState().setHardwareDialog(null);
  };

  return (
    <div style={overlayStyle} onClick={dialog.onCancel} role="dialog" aria-label="Hardware">
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Add Hardware</div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, marginRight: 6 }} id="hw-cat-label">Category</label>
          <select
            aria-labelledby="hw-cat-label"
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value as HardwareCategory)}
            style={{ background: '#222', color: '#eee', border: '1px solid #444', fontSize: 11 }}
          >
            <option value="hinges">Hinges</option>
            <option value="shelfPins">Shelf Pins</option>
          </select>
        </div>

        <div style={{ marginBottom: 8 }}>
          {filtered.map((entry) => (
            <label key={entry.id} style={{ display: 'block', marginBottom: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="hw-variant"
                value={entry.id}
                checked={selectedSkuId === entry.id}
                onChange={() => setSelectedSkuId(entry.id)}
                style={{ marginRight: 6 }}
              />
              <span style={{ fontWeight: selectedSkuId === entry.id ? 600 : 400 }}>{entry.name}</span>
              <span style={{ color: '#888', marginLeft: 8 }}>
                {entry.bboxMm.l}×{entry.bboxMm.w}×{entry.bboxMm.h}mm
              </span>
              {entry.notes && (
                <span style={{ color: '#aaa', marginLeft: 8, fontSize: 10 }}>{entry.notes}</span>
              )}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 11 }}>Qty:</span>
          <button
            type="button"
            aria-label="Decrement qty"
            style={btnStyle}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
          >−</button>
          <span style={{ minWidth: 24, textAlign: 'center' }}>{qty}</span>
          <button
            type="button"
            aria-label="Increment qty"
            style={btnStyle}
            onClick={() => setQty((q) => Math.min(100, q + 1))}
          >+</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <button type="button" style={btnStyle} onClick={dialog.onCancel} aria-label="Cancel">Cancel</button>
          <button type="button" style={okBtnStyle} onClick={handleOk} aria-label="OK">OK</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- HardwareDialog.test`. Expected: 8 PASS.

- [ ] **Step 5: Commit**

```
git add packages/app/src/shell/HardwareDialog.tsx packages/app/src/shell/HardwareDialog.test.tsx
git commit -m "$(cat <<'EOF'
feat(app): HardwareDialog — category dropdown + variant grid + qty stepper (spec §4.2)

Store-driven singleton portal mirroring CabinetDialog pattern. Esc cancels.
Default category=Hinges; switching category updates grid without close/reopen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Wire Hardware `RibbonPanel` into `FurnitureTab` + mount `HardwareDialog` in App shell

Implements spec §4.1.

**Files:**
- Modify: `packages/app/src/shell/tabs/FurnitureTab.tsx`
- Modify: `packages/app/src/App.tsx` (or wherever `CabinetDialog` is mounted)

- [ ] **Step 1: Add Hardware RibbonPanel to `FurnitureTab.tsx`**

In `packages/app/src/shell/tabs/FurnitureTab.tsx`:

Add imports at the top:

```ts
import { OpenHardwareDialogCommand } from '../../commands/OpenHardwareDialogCommand';
import { AddHardwareCommand } from '../../commands/AddHardwareCommand';
```

Add a `handleHardware` function after `handleCabinet`:

```ts
  const handleHardware = async () => {
    const onSubmit = async (skuId: string, qty: number) => {
      const opfs = await Opfs.forNavigator();
      for (let i = 0; i < qty; i++) {
        await useAppStore.getState().bus.execute(
          new AddHardwareCommand({ skuId, opfs }),
        );
      }
    };
    await new OpenHardwareDialogCommand({ onSubmit }).apply();
  };
```

Add the Hardware `RibbonPanel` after the Cabinets panel (before the Cut List panel):

```tsx
      <div aria-label="Hardware panel">
        <RibbonPanel title="Hardware">
          <button
            type="button"
            className="text-xs hover:text-white disabled:text-neutral-500"
            disabled={cabinetDisabled}
            onClick={() => { void handleHardware(); }}
            aria-label="Add Hardware"
            title={cabinetDisabled ? 'Open or create an assembly first' : ''}
          >
            Add Hardware
          </button>
        </RibbonPanel>
      </div>
```

- [ ] **Step 2: Mount `HardwareDialog` in the app shell**

Find where `<CabinetDialog />` is rendered in `packages/app/src/App.tsx` (or the shell root). Add `<HardwareDialog />` immediately after it:

```tsx
import { HardwareDialog } from './shell/HardwareDialog';
// ...
<CabinetDialog />
<HardwareDialog />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 4: Commit**

```
git add packages/app/src/shell/tabs/FurnitureTab.tsx packages/app/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(app): Hardware RibbonPanel on Furniture tab — Add Hardware button + HardwareDialog mount

Dispatches OpenHardwareDialogCommand → AddHardwareCommand × qty.
Button disabled when no active assembly (same guard as Base Cabinet).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Failing render test + implementation of `HardwareTable` + wire into `BrowserPane`

Implements spec §5.6 + §1.4 (SC3).

**Files:**
- Create: `packages/app/src/shell/HardwareTable.tsx`
- Create: `packages/app/src/shell/HardwareTable.test.tsx`
- Modify: `packages/app/src/shell/BrowserPane.tsx`

- [ ] **Step 1: Write the failing render tests**

In `packages/app/src/shell/HardwareTable.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HardwareTable } from './HardwareTable';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

const rows: HardwareRow[] = [
  { skuId: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges', qty: 2, notes: 'Requires 35mm Forstner bit' },
  { skuId: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',          category: 'shelfPins', qty: 8, notes: 'Press-fit' },
];

describe('HardwareTable', () => {
  it('renders "No hardware" placeholder when rows is empty', () => {
    render(<HardwareTable rows={[]} />);
    expect(screen.getByText(/no hardware/i)).toBeTruthy();
  });

  it('renders a row for each hardware entry', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('35mm Cup Hinge — Full Overlay')).toBeTruthy();
    expect(screen.getByText('5mm Shelf Pin — Steel')).toBeTruthy();
  });

  it('displays Qty correctly', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
  });

  it('renders column headers: SKU, Name, Category, Qty, Notes', () => {
    render(<HardwareTable rows={rows} />);
    expect(screen.getByText('SKU')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Qty')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- HardwareTable.test`. Expected: import error.

- [ ] **Step 3: Implement `HardwareTable.tsx`**

```tsx
import React from 'react';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

interface Props {
  rows: HardwareRow[];
}

export function HardwareTable({ rows }: Props): JSX.Element {
  if (rows.length === 0) {
    return <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>No hardware</div>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>Hardware</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {['SKU', 'Name', 'Category', 'Qty', 'Notes'].map((h) => (
              <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '2px 4px', color: '#aaa' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.skuId}>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.skuId}</td>
              <td style={{ padding: '2px 4px' }}>{r.name}</td>
              <td style={{ padding: '2px 4px', color: '#aaa' }}>{r.category}</td>
              <td style={{ padding: '2px 4px', textAlign: 'right' }}>{r.qty}</td>
              <td style={{ padding: '2px 4px', color: '#888' }}>{r.notes || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- HardwareTable.test`. Expected: 4 PASS.

- [ ] **Step 5: Wire `HardwareTable` into `BrowserPane.tsx`**

In `packages/app/src/shell/BrowserPane.tsx`, in the `if (cutListTabActive)` branch (around line 209), after `<CutListTable ... />`, add:

```tsx
import { HardwareTable } from './HardwareTable';
import { aggregateHardwareRecursive } from '../assembly/walkers/aggregateHardwareRecursive';
// ...
// Inside the cutListTabActive branch, after CutListTable:
        <HardwareTable
          rows={aggregateHardwareRecursive(
            asm,
            // reuse the existing SubAssemblyCache as a DocumentCache
            new Map(
              Object.entries(useAppStore.getState().subAssemblyDocs).map(([k, doc]) => [k, { kind: 'ok' as const, doc }]),
            ),
            asm.hardware,
          ).rows}
        />
```

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 7: Commit**

```
git add packages/app/src/shell/HardwareTable.tsx packages/app/src/shell/HardwareTable.test.tsx packages/app/src/shell/BrowserPane.tsx
git commit -m "$(cat <<'EOF'
feat(app): HardwareTable component + Cut List tab integration (spec §5.6)

Renders SKU/Name/Category/Qty/Notes columns. Empty state shows 'No hardware' placeholder.
Aggregates from subAssemblyDocs cache on each Cut List tab render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Extend `buildCutListCsv` with Hardware section + unit test

Implements spec §5.5 + §1.4 (SC4).

**Files:**
- Modify: `packages/app/src/commands/buildCutListCsv.ts`
- Modify: `packages/app/src/commands/buildCutListCsv.test.ts` (or create if missing)

- [ ] **Step 1: Write the failing test**

Locate or create `packages/app/src/commands/buildCutListCsv.test.ts` and append:

```ts
import { describe, it, expect } from 'vitest';
import { buildCutListCsv } from './buildCutListCsv';
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

const hardwareRows: HardwareRow[] = [
  { skuId: 'hinge-35mm-cup-full', name: '35mm Cup Hinge — Full Overlay', category: 'hinges',    qty: 2, notes: 'Requires 35mm Forstner bit' },
  { skuId: 'shelf-pin-5mm-steel', name: '5mm Shelf Pin — Steel',          category: 'shelfPins', qty: 8, notes: 'Press-fit into 5mm shelf-pin hole; steel' },
];

const emptyResult = { rows: [], bandTotals: [], excluded: { componentCount: 0, partCount: 0 } };

describe('buildCutListCsv — hardware section', () => {
  it('produces 4 sections: panel rows, edge-band totals, hardware, excluded summary', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    const sections = csv.split('\n\n');
    // sections[0] = panel header + rows (possibly just header)
    // sections[1] = band header + rows
    // sections[2] = hardware header + rows
    // sections[3] = excluded line
    expect(sections.length).toBeGreaterThanOrEqual(4);
  });

  it('hardware section starts with "# Hardware"', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('# Hardware');
  });

  it('hardware section header row is SKU,Name,Category,Qty,Notes', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('SKU,Name,Category,Qty,Notes');
  });

  it('hardware data rows contain SKU id and qty', () => {
    const csv = buildCutListCsv(emptyResult, hardwareRows);
    expect(csv).toContain('hinge-35mm-cup-full');
    expect(csv).toContain(',2,');
    expect(csv).toContain('shelf-pin-5mm-steel');
    expect(csv).toContain(',8,');
  });

  it('empty hardwareRows produces a hardware section with header but no data rows', () => {
    const csv = buildCutListCsv(emptyResult, []);
    expect(csv).toContain('# Hardware');
    // Only the header row, no data.
    const hwIdx = csv.indexOf('# Hardware');
    const hwSection = csv.slice(hwIdx);
    const lines = hwSection.split('\n').filter((l) => l.trim());
    expect(lines).toHaveLength(2); // "# Hardware" + column header
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run: `pnpm --filter @zilventor/app test -- buildCutListCsv.test`. Expected: 5 FAIL — `buildCutListCsv` does not accept hardware rows yet.

- [ ] **Step 3: Extend `buildCutListCsv.ts`**

Update the function signature and add the hardware section:

```ts
import type { HardwareRow } from '../assembly/walkers/aggregateHardwareRecursive';

// ... existing helpers unchanged ...

function hardwareRowLine(r: HardwareRow): string {
  return [
    csvCell(r.skuId),
    csvCell(r.name),
    r.category,
    String(r.qty),
    csvCell(r.notes),
  ].join(',');
}

export function buildCutListCsv(
  result: CutListResult,
  hardwareRows: HardwareRow[] = [],
): string {
  const out: string[] = [];
  out.push('Item#,QTY,Material,L (mm),W (mm),T (mm),Grain,Front,Back,Left,Right,Part Name,Part Path');
  for (const r of result.rows) out.push(rowLine(r));
  out.push('');
  out.push('Edge Band Material,Total Length (mm),Total Length (m)');
  for (const b of result.bandTotals) out.push(bandLine(b));
  out.push('');
  out.push('# Hardware');
  out.push('SKU,Name,Category,Qty,Notes');
  for (const r of hardwareRows) out.push(hardwareRowLine(r));
  out.push('');
  out.push(
    `Excluded from cut list,${result.excluded.componentCount} components,${result.excluded.partCount} distinct parts`,
  );
  return out.join('\n') + '\n';
}
```

- [ ] **Step 4: Fix all callers of `buildCutListCsv`**

Find all call sites with `grep -r 'buildCutListCsv' packages/` and update them — the new second param defaults to `[]` so existing callers without it continue to compile.

- [ ] **Step 5: Run the tests — should pass**

Run: `pnpm --filter @zilventor/app test -- buildCutListCsv.test`. Expected: all PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm -r typecheck`. Expected: Done.

- [ ] **Step 7: Commit**

```
git add packages/app/src/commands/buildCutListCsv.ts packages/app/src/commands/buildCutListCsv.test.ts
git commit -m "$(cat <<'EOF'
feat(app): buildCutListCsv — add '# Hardware' section as 3rd block (spec §5.5)

4-section output: panel rows, edge-band totals, hardware rows, excluded summary.
Second param defaults to [] for backwards-compatible callers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 6 — E2E + Perf

### Task 14: E2E T1 — happy path (open dialog, place hinge, check cut list)

Implements spec §8.4 T1 + §1.4 SC1/SC2/SC3.

**Files:**
- Create: `tests/e2e/furniture/hardware-add.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('T-5c-1 — Add Hardware: place 35mm cup hinge, verify OPFS file + cut list row', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  // 1. New assembly.
  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeDocument?: { kind: string } } } };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  // 2. Open Furniture → Hardware → Add Hardware.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();

  // 3. Dialog opens; default is Hinges, first SKU selected.
  await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();
  const radioFull = page.getByRole('radio', { name: /35mm Cup Hinge.*Full Overlay/i });
  await expect(radioFull).toBeChecked();

  // 4. Click OK.
  await page.getByRole('button', { name: /^ok$/i }).click();
  await expect(page.getByRole('dialog', { name: /hardware/i })).toHaveCount(0);

  // 5. Wait for component to appear.
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // 6. Assert OPFS file exists.
  const fileExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      // @ts-expect-error iterator typing
      for await (const [name] of root.entries()) {
        if (name === 'hardware') return true;
      }
    } catch { /* */ }
    return false;
  });
  expect(fileExists).toBe(true);

  // 7. Open Cut List tab and verify Hardware section shows 1 row.
  await page.getByRole('button', { name: /cut list/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { cutListTabActive: boolean } } };
    return w.__zilventorStore.getState().cutListTabActive;
  });
  await expect(page.getByText('35mm Cup Hinge — Full Overlay')).toBeVisible();
  await expect(page.getByText('1')).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test:e2e -- hardware-add`. Expected: PASS.

- [ ] **Step 3: Commit**

```
git add tests/e2e/furniture/hardware-add.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T-5c-1 happy path — place hinge via dialog, verify OPFS + cut list row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: E2E T2 — grouping (same SKU twice → Qty=2)

Implements spec §8.4 T2 + §1.4 SC5.

**Files:**
- Modify: `tests/e2e/furniture/hardware-add.spec.ts`

- [ ] **Step 1: Append the grouping test**

```ts
test('T-5c-2 — same SKU placed twice → Hardware table shows 1 row with Qty=2', async ({ page }) => {
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

  // Add hinge twice via Qty stepper set to 2.
  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();
  await expect(page.getByRole('dialog', { name: /hardware/i })).toBeVisible();
  await page.getByRole('button', { name: /increment qty/i }).click();
  await page.getByRole('button', { name: /^ok$/i }).click();

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 2;
  });

  // Open Cut List tab.
  await page.getByRole('button', { name: /cut list/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { cutListTabActive: boolean } } };
    return w.__zilventorStore.getState().cutListTabActive;
  });

  // Exactly 1 row for the hinge SKU with Qty=2.
  const rows = await page.getByRole('row').all();
  const hingeRows = rows.filter(async (r) => (await r.textContent())?.includes('35mm Cup Hinge'));
  expect(hingeRows).toHaveLength(1);
  await expect(page.getByText('2')).toBeVisible();
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test:e2e -- hardware-add`. Expected: both T1 + T2 PASS.

- [ ] **Step 3: Commit**

```
git add tests/e2e/furniture/hardware-add.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T-5c-2 grouping — same SKU qty=2 produces 1 hardware row with Qty=2

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: E2E T3 — undo round-trip (Ctrl+Z removes component + deletes file)

Implements spec §8.4 T3 + §1.4 SC7.

**Files:**
- Modify: `tests/e2e/furniture/hardware-add.spec.ts`

- [ ] **Step 1: Append the undo test**

```ts
test('T-5c-3 — Ctrl+Z round-trips a hardware placement', async ({ page }) => {
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

  await page.getByRole('tab', { name: 'Furniture' }).click();
  await page.getByRole('button', { name: 'Add Hardware' }).click();
  await page.getByRole('button', { name: /^ok$/i }).click();

  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } | null } } };
    return (w.__zilventorStore.getState().activeAssembly?.components.length ?? 0) === 1;
  });

  // Verify file exists before undo.
  const beforeUndo = await page.evaluate(async () => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    return { components: w.__zilventorStore.getState().activeAssembly.components.length };
  });
  expect(beforeUndo.components).toBe(1);

  // Ctrl+Z.
  await page.keyboard.press('Control+z');
  await page.waitForFunction(() => {
    const w = window as unknown as { __zilventorStore: { getState(): { activeAssembly: { components: unknown[] } } } };
    return w.__zilventorStore.getState().activeAssembly.components.length === 0;
  });

  // Verify file deleted.
  const hardwareDirExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    try {
      await root.getDirectoryHandle('hardware', { create: false });
      // If we get here, directory exists; check if it has files.
      const dir = await root.getDirectoryHandle('hardware');
      let count = 0;
      // @ts-expect-error iterator typing
      for await (const _ of dir.entries()) count++;
      return count;
    } catch {
      return 0;
    }
  });
  expect(hardwareDirExists).toBe(0);

  // Hardware table should show 0 rows.
  await page.getByRole('button', { name: /cut list/i }).click();
  await expect(page.getByText(/no hardware/i)).toBeVisible();
});
```

- [ ] **Step 2: Run all 3 e2e tests**

Run: `pnpm test:e2e -- hardware-add`. Expected: T1 + T2 + T3 PASS.

- [ ] **Step 3: Commit**

```
git add tests/e2e/furniture/hardware-add.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): T-5c-3 Ctrl+Z round-trips a hardware placement — file deleted, table empty

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Perf — `hardware-add` p95 under 600ms

Implements spec §8.5.

**Files:**
- Create: `tests/perf/hardware-add.spec.ts`

- [ ] **Step 1: Write the perf test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../e2e/helpers/buildBox';

/**
 * Perf T23 (5c): AddHardwareCommand.apply() end-to-end p95 < 600 ms.
 *
 * 20 timed apply() calls. First call synthesizes and writes the .zipt file
 * (the expensive path). Subsequent calls reuse the existing file (cheaper).
 * The budget covers the first-placement path; the test uses iteration 0 as
 * the hot path and confirms p95 across all 20 is within the 600ms budget.
 */
test('Perf T23: AddHardwareCommand.apply() p95 < 600 ms over 20 runs', async ({ page }) => {
  page.on('console', (m) => console.log('BROWSER:', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('/');
  await waitForKernelReady(page);

  await page.getByRole('tab', { name: 'File' }).click();
  await page.getByRole('button', { name: /new assembly/i }).click();
  await page.waitForFunction(() => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { activeDocument?: { kind: string } } };
    };
    return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
  });

  const times: number[] = await page.evaluate(async () => {
    const w = window as unknown as {
      __zilventorStore: { getState(): { bus: { execute(cmd: unknown): Promise<void> } } };
      __zilventorGetOpfs(): Promise<{
        exists(p: string): Promise<boolean>;
        read(p: string): Promise<Uint8Array>;
        write(p: string, b: Uint8Array): Promise<void>;
        delete(p: string): Promise<void>;
        list(): Promise<string[]>;
      }>;
    };

    const { AddHardwareCommand } = await import(
      /* @vite-ignore */ '/src/commands/AddHardwareCommand.ts'
    );

    const opfs = await w.__zilventorGetOpfs();
    const bus = w.__zilventorStore.getState().bus;

    const RUNS = 20;
    const results: number[] = [];

    for (let n = 0; n < RUNS; n++) {
      const cmd = new AddHardwareCommand({ skuId: 'hinge-35mm-cup-full', opfs });
      const t0 = performance.now();
      await bus.execute(cmd);
      results.push(performance.now() - t0);
    }

    return results;
  });

  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0;

  console.log(JSON.stringify({
    metric: 'hardware-add-p95-ms',
    runs: times.length,
    p95Ms: Math.round(p95),
    maxMs: Math.round(Math.max(...times)),
    minMs: Math.round(Math.min(...times)),
  }));

  expect(p95).toBeLessThan(600);
});
```

- [ ] **Step 2: Run the perf test**

Run: `pnpm test:perf -- hardware-add`. Expected: PASS, p95 < 600ms.

- [ ] **Step 3: Commit**

```
git add tests/perf/hardware-add.spec.ts
git commit -m "$(cat <<'EOF'
test(perf): perf-5c hardware-add p95 under 600ms (spec §8.5)

20 runs of AddHardwareCommand.apply() including first-placement synthesis path.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 7 — Manual smoke + verification

### Task 18: Write manual smoke checklist `docs/superpowers/manual-tests/subproject-5c.md`

Implements spec §8.6 + §1.4 SC1–SC10.

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-5c.md`

- [ ] **Step 1: Write the manual smoke checklist**

```markdown
# Sub-project 5c — Hardware Library smoke test

User-run checklist. Six scenarios covering the hardware library feature:
dialog, catalog, cut-list integration, grouping, undo, and migration.
Passing all tests gates sub-project 5c as shipped.

Prereqs once per machine:

- ZilInventor running locally (`pnpm --filter @zilventor/app dev`) or a
  deployed URL accessible from a recent Chrome/Edge.
- A clean OPFS root for these scenarios. To wipe: open DevTools →
  Application → Storage → "Clear site data".

---

## Test Setup

- [ ] Step 1: Open ZilInventor in a fresh browser tab.
- [ ] Step 2: **File** tab → **New Assembly**. Name the assembly "Hardware Test".
      Browser pane shows the empty assembly node.

---

## T1 — Dialog opens with correct defaults

- [ ] Step 1: **Furniture** → **Hardware** → **Add Hardware**. A dialog opens.
- [ ] Step 2: Verify **Category** dropdown defaults to **Hinges**.
- [ ] Step 3: Verify the variant grid shows **4 entries** (35mm Full, Half, Inset; 26mm Full).
- [ ] Step 4: Verify the first entry "35mm Cup Hinge — Full Overlay" is selected by default.
- [ ] Step 5: Verify Qty stepper shows **1**.

**Pass criterion:** Dialog opens, 4 hinge variants listed, first selected, Qty=1.

---

## T2 — Place a hinge

- [ ] Step 1: From T1, click **OK** with defaults.
- [ ] Step 2: Browser pane shows 1 component in the assembly.
- [ ] Step 3: 3D viewport shows a box-shaped solid (bounding-box proxy ~48×35×12mm).
- [ ] Step 4: **Furniture** → **Cut List**. The **Hardware** section appears below the panel cut list.
      Verify 1 row: `hinge-35mm-cup-full | 35mm Cup Hinge — Full Overlay | hinges | 1 | Requires 35mm Forstner bit`.

**Pass criterion:** Component placed, hardware row visible in cut list.

---

## T3 — Category switch shows Shelf Pins

- [ ] Step 1: Open **Add Hardware** again.
- [ ] Step 2: Change **Category** dropdown to **Shelf Pins**.
- [ ] Step 3: Verify the grid updates to show **3 entries**
      (5mm Steel, 5mm Clear, 7mm Sleeve). No dialog close/reopen needed.

**Pass criterion:** Grid updates immediately on category change; 3 shelf-pin SKUs visible.

---

## T4 — Grouping: same SKU twice → Qty=2

- [ ] Step 1: Open **Add Hardware**, confirm Hinges / Full Overlay selected.
- [ ] Step 2: Click the **+** Qty button once (Qty → 2). Click **OK**.
- [ ] Step 3: Browser pane shows **2 components**.
- [ ] Step 4: **Cut List** Hardware section shows **1 row** with Qty = **2** (not 2 rows).

**Pass criterion:** Hardware table groups by SKU; Qty accumulates correctly.

---

## T5 — Undo removes component and deletes file

- [ ] Step 1: Starting from a fresh assembly, place 1 hinge (T2 procedure).
- [ ] Step 2: Press **Ctrl+Z**.
- [ ] Step 3: Browser pane shows **0 components** in the assembly.
- [ ] Step 4: DevTools → Application → Storage → Origin private file system:
      confirm `hardware/hinge-35mm-cup-full.zipt` **no longer exists**.
- [ ] Step 5: **Cut List** Hardware section shows "No hardware".

**Pass criterion:** Undo removes component; file cleaned from OPFS; hardware row gone.

---

## T6 — Migration: v11 project opens cleanly

- [ ] Step 1: Open DevTools → Console. Run:
      ```js
      window.__zilventorStore.getState().activeAssembly?.hardware
      ```
- [ ] Step 2: Verify the result is an array of **7 entries** (4 hinges + 3 shelf pins).
- [ ] Step 3: Verify the `formatVersion` of the active project manifest is **12**.

**Pass criterion:** v11→v12 migration ran; assembly has 7 hardware entries in registry.

---
```

- [ ] **Step 2: Commit**

```
git add docs/superpowers/manual-tests/subproject-5c.md
git commit -m "$(cat <<'EOF'
docs(manual-tests): T1..T6 hardware-library smoke checklist (spec §8.6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Full verification gate

Implements spec §1.4 SC10 + final green-light.

**Files:** None created. Run commands only.

- [ ] **Step 1: Full typecheck across all packages**

Run: `pnpm -r typecheck`. Expected: Done for all packages.

- [ ] **Step 2: All unit tests**

Run: `pnpm -r test:unit`. Expected: all PASS. New test counts:
- `packages/shared`: +10 (hardware-feature: 5, builtinCatalog: 7, fileFormat: 3)
- `packages/app`: +4+5+3+8+4+5 = 29 new tests

- [ ] **Step 3: All integration tests**

Run: `pnpm -r test:integration`. Expected: all PASS, no regressions.

- [ ] **Step 4: E2E suite — hardware-add**

Run: `pnpm test:e2e -- hardware-add`. Expected: T-5c-1, T-5c-2, T-5c-3 PASS.

- [ ] **Step 5: Perf suite — hardware-add**

Run: `pnpm test:perf -- hardware-add`. Expected: PASS, p95 < 600ms.

- [ ] **Step 6: Run full E2E suite to check no regressions**

Run: `pnpm test:e2e`. Expected: all pre-existing tests PASS alongside the new 5c tests.

- [ ] **Step 7: Note on memory update**

The memory file at `docs/superpowers/memory/next_session_resume.md` and `docs/superpowers/memory/project_subproject_5c_execution_state.md` should be updated to reflect that 5c is SHIPPED. **Do not update memory files here — defer to the user via the `superpowers:finishing-a-development-branch` skill.** Present the completion report and wait for the user to confirm before updating persistent state.

- [ ] **Step 8: Completion commit (if any stray files remain unstaged)**

```
git status
# If clean: nothing to do.
# If stray: git add <file> && git commit -m "chore(5c): final cleanup"
```

---

## Spec coverage checklist (SC1–SC10)

| SC | Task(s) |
|---|---|
| SC1 — Add Hardware dialog opens with Hinges default | T10, T11, T14 |
| SC2 — Placing hinge creates `hardware/hinge-35mm-cup-full.zipt` with correct `HardwareFeature` | T9, T14 |
| SC3 — Cut List tab shows Hardware section with 1 row Qty=1 | T12, T14 |
| SC4 — CSV export produces 4 sections; Hardware section has 1 data row | T13 |
| SC5 — Same SKU placed twice → 1 row Qty=2 (grouping) | T6, T15 |
| SC6 — Hinge + shelf pin → 2 rows | T6 (aggregator test case 3) |
| SC7 — Ctrl+Z removes component; file deleted if no other reference | T9, T16 |
| SC8 — Switching to Shelf Pins in dialog shows 3 SKUs | T10 |
| SC9 — Migrating v11 project opens cleanly; assembly gains 7 hardware entries | T3, T4 |
| SC10 — All automated suites pass | T19 |

All 10 success criteria are covered. No gaps.
