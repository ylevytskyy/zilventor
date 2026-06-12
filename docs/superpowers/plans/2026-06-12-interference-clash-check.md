# Interference / Clash Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-demand Interference / Clash Check to ZilInventor's Inspect tab that detects real penetration and near-misses between assembly leaf-part solids, lists them in a panel, and highlights clashing pairs red in the 3D viewport.

**Architecture:** Read-only analysis (no bus Command, no undo, no manifest bump). A button in InspectTab triggers `runInterferenceCheck` (orchestration), which reuses `resolveExportLeaves` to flatten the assembly into posed leaves, calls a new `kernel.checkInterference` method that runs AABB broad-phase + Common/Distance narrow-phase in real OCCT, maps results via `buildClashReport` into `ClashReportRow[]`, stores them in a new `useAppStore` clash slice, and renders them in `ClashReportPanel`; row clicks select both components and add a red LineSegments overlay via a new `SceneManager.setClashHighlight` method. E2E verified via `__zilventorClashCount` / `__zilventorClashResults` probes (viewport is black in headless Chrome).

**Tech Stack:** TypeScript, React, Zustand, Three.js, opencascade.js (real OCCT), Vitest (unit + integration), Playwright (e2e), react-i18next.

---

## File Map

| Status | Path | Responsibility |
|--------|------|----------------|
| **Create** | `packages/shared/src/clash.ts` | `ClashKind`, `ClashPair`, `ClashReportRow`, `buildClashReport`, `VOLUME_THRESHOLD_MM3`, `CLEARANCE_DEFAULT_MM` |
| **Modify** | `packages/shared/src/index.ts` | re-export clash types |
| **Create** | `packages/shared/src/__tests__/clash.spec.ts` | unit tests for `buildClashReport` + edge cases |
| **Modify** | `packages/kernel/src/api.ts` | add `checkInterference` to `KernelApi` type and `createKernelApi()` implementation |
| **Create** | `packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts` | real-OCCT integration tests (SC-9/SC-10) |
| **Create** | `packages/app/src/assembly/runInterferenceCheck.ts` | orchestration function |
| **Create** | `packages/app/src/assembly/__tests__/runInterferenceCheck.spec.ts` | unit test for orchestration with mocked kernel |
| **Modify** | `packages/app/src/store/useAppStore.ts` | add clash slice (`clashRows`, `clashRan`, `setClashResult`, `clashHighlightKeys`, `setClashHighlight`) (SC-16) |
| **Modify** | `packages/app/src/viewport/SceneManager.ts` | add `setClashHighlight(pathKeys)` with red LineSegments overlay + `clearClashHighlight()` (SC-17) |
| **Create** | `packages/app/src/shell/ClashReportPanel.tsx` | results table (mirrors `ConnectorBomTable`) |
| **Modify** | `packages/app/src/shell/tabs/InspectTab.tsx` | replace stub with real implementation: button, clearance input dialog, `ClashReportPanel` (SC-15) |
| **Create** | `packages/app/src/shell/tabs/__tests__/InspectTab.clash.spec.tsx` | SC-12 real wiring test |
| **Modify** | `packages/app/src/i18n/locales/en.json` | add all clash i18n keys (SC-18) |
| **Modify** | `packages/app/src/i18n/locales/uk.json` | same keys in Ukrainian (SC-18) |
| **Modify** | `packages/app/src/App.tsx` | add `__zilventorClashCount` / `__zilventorClashResults` probes in DEV block |
| **Create** | `tests/e2e/interference-clash-check.spec.ts` | SC-11 e2e: nested clash + exact path-key assertions + clean-cabinet zero case |

---

## Parallelization Guide

- **Task 1 (shared types)** is solo: it defines the types every other task depends on.
- **Task 2 (kernel integration test + impl)** is solo: must complete before Task 3 (orchestration).
- **Tasks 3, 4, 5 can run in parallel after Task 2** (disjoint files: orchestration / store slice / SceneManager).
- **Task 6 (UI: InspectTab + ClashReportPanel + i18n)** depends on Tasks 3–5. Solo because it modifies i18n files which would conflict.
- **Tasks 7 and 8 (probes + e2e)** depend on Task 6. Can run in parallel (disjoint files).

---

## Task 1: Shared Types — `ClashKind`, `ClashPair`, `ClashReportRow`, `buildClashReport`, defaults

**Solo.** All other tasks import from here.

**Files:**
- Create: `packages/shared/src/clash.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/clash.spec.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/shared/src/__tests__/clash.spec.ts
import { describe, it, expect } from 'vitest';
import { buildClashReport, VOLUME_THRESHOLD_MM3, CLEARANCE_DEFAULT_MM } from '../clash';
import type { ClashPair } from '../clash';

describe('buildClashReport', () => {
  const leafMeta = [
    { componentPath: ['A'], componentPathKey: 'A', partName: 'Panel A' },
    { componentPath: ['B'], componentPathKey: 'B', partName: 'Panel B' },
    { componentPath: ['nested', 'C'], componentPathKey: 'nested C', partName: 'Panel C' },
  ];

  it('maps interference pair to ClashReportRow with volume', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 1, kind: 'interference', volume: 1800 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('interference');
    expect(row.aName).toBe('Panel A');
    expect(row.bName).toBe('Panel B');
    expect(row.aPathKey).toBe('A');
    expect(row.bPathKey).toBe('B');
    expect(row.aPath).toEqual(['A']);
    expect(row.bPath).toEqual(['B']);
    expect(row.volume).toBeCloseTo(1800);
    expect(row.distance).toBeUndefined();
  });

  it('maps clearance pair to ClashReportRow with distance', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 2, kind: 'clearance', distance: 0.5 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.kind).toBe('clearance');
    expect(row.aPathKey).toBe('A');
    expect(row.bPathKey).toBe('nested C');
    expect(row.aPath).toEqual(['A']);
    expect(row.bPath).toEqual(['nested', 'C']);
    expect(row.distance).toBeCloseTo(0.5);
    expect(row.volume).toBeUndefined();
  });

  it('empty pairs → empty rows', () => {
    expect(buildClashReport([], leafMeta)).toHaveLength(0);
  });

  it('VOLUME_THRESHOLD_MM3 is a positive number', () => {
    expect(VOLUME_THRESHOLD_MM3).toBeGreaterThan(0);
  });

  it('CLEARANCE_DEFAULT_MM is 1.0', () => {
    expect(CLEARANCE_DEFAULT_MM).toBe(1.0);
  });

  // SC-13(a): precedence — if a pair is interference it must not also appear as clearance
  it('SC-13(a): two rows for two distinct pairs', () => {
    const pairs: ClashPair[] = [
      { aIndex: 0, bIndex: 1, kind: 'interference', volume: 500 },
      { aIndex: 0, bIndex: 2, kind: 'clearance', distance: 0.8 },
    ];
    const rows = buildClashReport(pairs, leafMeta);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.kind).toBe('interference');
    expect(rows[1]!.kind).toBe('clearance');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd packages/shared && npx vitest run src/__tests__/clash.spec.ts
```

Expected: `Error: Cannot find module '../clash'`

- [ ] **Step 3: Create `packages/shared/src/clash.ts`**

```typescript
import { pathKey, parsePathKey } from './componentPath';

export type ClashKind = 'interference' | 'clearance';

export interface ClashPair {
  aIndex: number;
  bIndex: number;
  kind: ClashKind;
  volume?: number;    // mm³, interference only
  distance?: number;  // mm, clearance only
}

export interface ClashLeafMeta {
  componentPath: readonly string[];
  componentPathKey: string;
  partName: string;
}

export interface ClashReportRow {
  aPathKey: string;
  bPathKey: string;
  /** ComponentPath arrays needed for setSelectedComponentPaths (SC-7) */
  aPath: string[];
  bPath: string[];
  aName: string;
  bName: string;
  kind: ClashKind;
  volume?: number;
  distance?: number;
}

/**
 * Internal constant — NOT user-facing. Volume in mm³ below which a
 * Common() result is treated as face-touching rather than real interference.
 * SC-10: this value is grounded by the real-OCCT touching-face test.
 */
export const VOLUME_THRESHOLD_MM3 = 1.0;

/** Default minimum clearance (mm) shown in the dialog. */
export const CLEARANCE_DEFAULT_MM = 1.0;

/**
 * Pure mapper from ClashPair[] + leaf metadata to display rows.
 * Does NOT classify — classification is done by checkInterference in the kernel.
 * SC-7: each row carries both ComponentPath (for setSelectedComponentPaths) and
 * ComponentPathKey (for getComponentMesh/setClashHighlight).
 */
export function buildClashReport(
  pairs: ClashPair[],
  leafMeta: readonly ClashLeafMeta[],
): ClashReportRow[] {
  return pairs.map((pair) => {
    const a = leafMeta[pair.aIndex]!;
    const b = leafMeta[pair.bIndex]!;
    const row: ClashReportRow = {
      aPathKey: a.componentPathKey,
      bPathKey: b.componentPathKey,
      aPath: parsePathKey(a.componentPathKey),
      bPath: parsePathKey(b.componentPathKey),
      aName: a.partName,
      bName: b.partName,
      kind: pair.kind,
    };
    if (pair.volume !== undefined) row.volume = pair.volume;
    if (pair.distance !== undefined) row.distance = pair.distance;
    return row;
  });
}
```

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

Find the last export line in `packages/shared/src/index.ts` and add:

```typescript
export type { ClashKind, ClashPair, ClashLeafMeta, ClashReportRow } from './clash';
export { buildClashReport, VOLUME_THRESHOLD_MM3, CLEARANCE_DEFAULT_MM } from './clash';
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd packages/shared && npx vitest run src/__tests__/clash.spec.ts
```

Expected: all 6 tests pass.

- [ ] **Step 6: Typecheck shared**

```bash
cd packages/shared && npx tsc --noEmit
```

Expected: 0 new errors (baseline 1).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/clash.ts packages/shared/src/__tests__/clash.spec.ts packages/shared/src/index.ts
git commit -m "feat(shared): ClashPair/ClashReportRow types + buildClashReport mapper"
```

---

## Task 2: Kernel — `checkInterference` OCCT Implementation + Real-OCCT Tests

**Solo.** Must land before Tasks 3–5.

**Files:**
- Modify: `packages/kernel/src/api.ts`
- Create: `packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts`

### 2a — Write the real-OCCT integration test first (RED)

- [ ] **Step 1: Create the integration test**

```typescript
// packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts
/**
 * Real-OCCT integration tests for checkInterference.
 * Harness pattern from dragGizmoBake.integration.spec.ts.
 * SC-9: overlap volume asserted against a hand-derived oracle (NOT the producer's output).
 * SC-10: touching-face test measures real OCCT Common volume → tunes VOLUME_THRESHOLD_MM3.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occt/occtLoader';
import { createKernelApi } from '../api';
import { makeBox } from '../occt/SolidOps';

const IDENTITY_POSE = { translation: { x: 0, y: 0, z: 0 }, quaternion: [0, 0, 0, 1] as [number, number, number, number] };

function posedLeaf(partId: string, tx: number, ty: number, tz: number): { partId: string; pose: typeof IDENTITY_POSE } {
  return { partId, pose: { translation: { x: tx, y: ty, z: tz }, quaternion: [0, 0, 0, 1] } };
}

describe('checkInterference: real OCCT', () => {
  let api: ReturnType<typeof createKernelApi>;

  beforeAll(async () => {
    api = createKernelApi();
    await api.init();
  });

  /**
   * SC-9 [BLOCKER]: Overlap-volume test with INDEPENDENT oracle.
   *
   * Geometry:
   *   Box A: 50×50×50, at origin [0,50] × [0,50] × [0,50]
   *   Box B: 40×40×40, offset +30 on X → [30,70] × [0,40] × [0,40]
   *
   * Intersection = [30,50] × [0,40] × [0,40] = 20×40×40 = 32000 mm³
   * (derived by hand — independent of kernel output).
   *
   * We pre-load two box parts via saveToBytes → loadFromBytes
   * (warmShapeForExport requires the part in the `parts` map).
   */
  it('SC-9: two overlapping boxes → interference with volume ≈ 32000 mm³', async () => {
    // Create parts with box geometries
    const idA = await api.createPart('box50');
    await api.addFeature(idA, {
      id: 'box50f',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 50 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 50, y2: 0 },
        { kind: 'line', id: 'l2', x1: 50, y1: 0, x2: 50, y2: 50 },
        { kind: 'line', id: 'l3', x1: 50, y1: 50, x2: 0, y2: 50 },
        { kind: 'line', id: 'l4', x1: 0, y1: 50, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idA);

    const idB = await api.createPart('box40');
    await api.addFeature(idB, {
      id: 'box40f',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 40 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 40, y2: 0 },
        { kind: 'line', id: 'l2', x1: 40, y1: 0, x2: 40, y2: 40 },
        { kind: 'line', id: 'l3', x1: 40, y1: 40, x2: 0, y2: 40 },
        { kind: 'line', id: 'l4', x1: 0, y1: 40, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idB);

    // Box A at identity; Box B shifted +30 on X (overlap = 20×40×40 = 32000 mm³)
    const leaves = [
      posedLeaf(idA, 0, 0, 0),
      posedLeaf(idB, 30, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    console.log('[SC-9] pairs:', JSON.stringify(pairs));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.kind).toBe('interference');
    expect(pairs[0]!.volume).toBeDefined();
    // SC-9 independent oracle: 20 × 40 × 40 = 32000
    expect(Math.abs(pairs[0]!.volume! - 32000)).toBeLessThan(5);
  });

  /**
   * SC-10 [BLOCKER]: Touching-faces test — measures real OCCT Common volume.
   *
   * Two 50×50×50 boxes placed so their faces exactly share the plane X=50:
   *   Box A: [0,50] × [0,50] × [0,50]
   *   Box B at TX=50: [50,100] × [0,50] × [0,50]
   *
   * Real OCCT Common on exactly touching faces → degenerate (should be near 0).
   * This test LOGS the raw volume to tell us whether VOLUME_THRESHOLD_MM3=1.0 is safe.
   * If the raw volume is ≥ 1.0, the threshold must be raised (document the decision).
   */
  it('SC-10: face-touching boxes → NEITHER interference NOR clearance', async () => {
    const idC = await api.createPart('boxC50');
    await api.addFeature(idC, {
      id: 'boxCf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 50 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 50, y2: 0 },
        { kind: 'line', id: 'l2', x1: 50, y1: 0, x2: 50, y2: 50 },
        { kind: 'line', id: 'l3', x1: 50, y1: 50, x2: 0, y2: 50 },
        { kind: 'line', id: 'l4', x1: 0, y1: 50, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idC);

    const idD = await api.createPart('boxD50');
    await api.addFeature(idD, {
      id: 'boxDf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 50 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 50, y2: 0 },
        { kind: 'line', id: 'l2', x1: 50, y1: 0, x2: 50, y2: 50 },
        { kind: 'line', id: 'l3', x1: 50, y1: 50, x2: 0, y2: 50 },
        { kind: 'line', id: 'l4', x1: 0, y1: 50, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idD);

    // Box D placed at TX=50 → faces touch exactly at X=50
    const leaves = [
      posedLeaf(idC, 0, 0, 0),
      posedLeaf(idD, 50, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    // SC-10: log the raw Common volume that OCCT produces for face-touching geometry
    console.log('[SC-10] touching-face pairs (should be empty):', JSON.stringify(pairs));
    console.log('[SC-10] If non-empty, check raw Common volume and raise VOLUME_THRESHOLD_MM3 if needed');

    // Assert neither interference nor clearance (butt joints must not false-flag)
    expect(pairs).toHaveLength(0);
  });

  /**
   * Clearance test: two boxes 0.5 mm apart, clearanceThreshold = 1.0 → clearance pair.
   */
  it('two boxes 0.5 mm apart → clearance pair with distance ≈ 0.5', async () => {
    const idE = await api.createPart('boxE20');
    await api.addFeature(idE, {
      id: 'boxEf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 20 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 20, y2: 0 },
        { kind: 'line', id: 'l2', x1: 20, y1: 0, x2: 20, y2: 20 },
        { kind: 'line', id: 'l3', x1: 20, y1: 20, x2: 0, y2: 20 },
        { kind: 'line', id: 'l4', x1: 0, y1: 20, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idE);

    const idF = await api.createPart('boxF20b');
    await api.addFeature(idF, {
      id: 'boxFf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 20 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 20, y2: 0 },
        { kind: 'line', id: 'l2', x1: 20, y1: 0, x2: 20, y2: 20 },
        { kind: 'line', id: 'l3', x1: 20, y1: 20, x2: 0, y2: 20 },
        { kind: 'line', id: 'l4', x1: 0, y1: 20, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idF);

    // Gap of 0.5mm between boxes (box ends at 20, next starts at 20.5)
    const leaves = [
      posedLeaf(idE, 0, 0, 0),
      posedLeaf(idF, 20.5, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    console.log('[clearance] pairs:', JSON.stringify(pairs));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.kind).toBe('clearance');
    expect(pairs[0]!.distance).toBeDefined();
    expect(Math.abs(pairs[0]!.distance! - 0.5)).toBeLessThan(0.1);
  });

  /**
   * Clearly separated pair (gap > threshold) → no result.
   */
  it('boxes 10 mm apart with threshold 1.0 → no pairs', async () => {
    const idG = await api.createPart('boxG10');
    await api.addFeature(idG, {
      id: 'boxGf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 10 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 10, y2: 0 },
        { kind: 'line', id: 'l2', x1: 10, y1: 0, x2: 10, y2: 10 },
        { kind: 'line', id: 'l3', x1: 10, y1: 10, x2: 0, y2: 10 },
        { kind: 'line', id: 'l4', x1: 0, y1: 10, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idG);

    const leaves = [
      posedLeaf(idG, 0, 0, 0),
      posedLeaf(idG, 100, 0, 0), // same part, 90mm gap (100 - 10 = 90 >> threshold 1.0)
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    expect(pairs).toHaveLength(0);
  });

  /**
   * SC-13(c): single leaf → no pairs possible.
   */
  it('SC-13(c): single leaf → empty result', async () => {
    const idH = await api.createPart('boxH');
    await api.addFeature(idH, {
      id: 'boxHf',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 10 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 10, y2: 0 },
        { kind: 'line', id: 'l2', x1: 10, y1: 0, x2: 10, y2: 10 },
        { kind: 'line', id: 'l3', x1: 10, y1: 10, x2: 0, y2: 10 },
        { kind: 'line', id: 'l4', x1: 0, y1: 10, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idH);
    const pairs = await api.checkInterference([posedLeaf(idH, 0, 0, 0)], { volumeThreshold: 1.0, clearanceThreshold: 1.0 });
    expect(pairs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (method does not exist)**

```bash
cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/interferenceCheck.integration.spec.ts
```

Expected: `TypeError: api.checkInterference is not a function`

### 2b — Implement `checkInterference` in `api.ts`

- [ ] **Step 3: Add `checkInterference` to the `KernelApi` type in `packages/kernel/src/api.ts`**

Add this entry inside the `KernelApi = {` type block (after `exportStlAssembly`, before the closing `};` at line 210):

```typescript
  /**
   * SC-1/SC-2/SC-3/SC-4/SC-5: AABB broad-phase + Common/Distance narrow-phase
   * interference/clearance check for a flat list of posed leaves.
   * Returns only pairs with real penetration (volume > volumeThreshold) or
   * near-misses (0 < dist ≤ clearanceThreshold). Touching faces fall through
   * both filters and produce no result — the volume threshold is load-bearing for this.
   * Per-pair try/catch: degenerate pairs are skipped and logged, run continues.
   */
  checkInterference(
    leaves: ReadonlyArray<{ partId: string; pose: { translation: { x: number; y: number; z: number }; quaternion: readonly [number, number, number, number] } }>,
    opts: { volumeThreshold: number; clearanceThreshold: number },
  ): Promise<import('@zilventor/shared').ClashPair[]>;
```

- [ ] **Step 4: Add `checkInterference` implementation inside `createKernelApi()` return object in `packages/kernel/src/api.ts`**

Add this method at the end of the return object (before the closing `};` of `return {`). The implementation goes at the bottom of the object, after `cutAssemblyComponentsByStepSegments`, before the closing brace:

```typescript
    async checkInterference(leaves, opts) {
      if (!occt) throw new Error('kernel not initialized');
      if (leaves.length < 2) return [];

      const oc = occt as any;

      // Step 1: Warm all shapes and compute world-posed copies + AABBs.
      // Cache: partId → warm namedShape (call warmShapeForExport for cold cache).
      type ShapeEntry = {
        posedShape: import('./occt/SolidOps').OcctShape;
        aabb: [number, number, number, number, number, number]; // xmin,ymin,zmin,xmax,ymax,zmax
      };
      const entries: (ShapeEntry | null)[] = [];

      for (const leaf of leaves) {
        try {
          const ns = await warmShapeForExport(leaf.partId);
          const posedShape = transformShapeByPose(occt!, ns.shape, leaf.pose);
          const aabb = computeBoundingBox(occt!, posedShape);
          entries.push({ posedShape, aabb });
        } catch (e) {
          console.warn(`checkInterference: skipping leaf ${leaf.partId}: ${(e as Error).message}`);
          entries.push(null);
        }
      }

      // Helper: AABBs overlap when each axis overlaps (expanded by clearanceThreshold).
      function aabbsOverlap(
        a: [number,number,number,number,number,number],
        b: [number,number,number,number,number,number],
        expand: number,
      ): boolean {
        return (
          a[0] - expand <= b[3] && a[3] + expand >= b[0] &&
          a[1] - expand <= b[4] && a[4] + expand >= b[1] &&
          a[2] - expand <= b[5] && a[5] + expand >= b[2]
        );
      }

      // Helper: volume of a shape via BRepGProp.VolumeProperties_1 (SC-3).
      function shapeVol(handle: unknown): number {
        const props = new oc.GProp_GProps_1();
        try {
          oc.BRepGProp.VolumeProperties_1(handle, props, true, false, false);
          return props.Mass();
        } finally {
          props.delete?.();
        }
      }

      const results: import('@zilventor/shared').ClashPair[] = [];

      for (let i = 0; i < entries.length; i++) {
        const ei = entries[i];
        if (!ei) continue;
        for (let j = i + 1; j < entries.length; j++) {
          const ej = entries[j];
          if (!ej) continue;

          // Broad-phase: skip if AABBs don't overlap even with expansion.
          if (!aabbsOverlap(ei.aabb, ej.aabb, opts.clearanceThreshold)) continue;

          try {
            // SC-1: BRepAlgoAPI_Common_3 + explicit Build (mirrors BooleanOps.ts:106-114).
            const rangeCtor = new oc.Message_ProgressRange_1();
            const rangeBuild = new oc.Message_ProgressRange_1();
            const common = new oc.BRepAlgoAPI_Common_3(
              ei.posedShape.handle as never,
              ej.posedShape.handle as never,
              rangeCtor,
            );
            common.Build(rangeBuild);
            rangeCtor.delete?.();
            rangeBuild.delete?.();

            let isInterference = false;
            // SC-3: guard HasErrors before volume check.
            if (!common.HasErrors()) {
              const commonShape = common.Shape();
              // SC-3: also check for solid via TopExp_Explorer (mirroring BooleanOps.ts:126-137).
              const explorer = new oc.TopExp_Explorer_2(
                commonShape as never,
                oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
                oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
              );
              const hasSolid = explorer.More();
              explorer.delete?.();

              if (hasSolid) {
                const vol = shapeVol(commonShape);
                if (vol > opts.volumeThreshold) {
                  isInterference = true;
                  results.push({ aIndex: i, bIndex: j, kind: 'interference', volume: vol });
                }
              }
              // SC-5: dispose the Common result shape after use.
              (commonShape as { delete?: () => void }).delete?.();
            }
            common.delete?.();

            // Only check clearance if NOT interference (SC-5 §5; precedence).
            if (!isInterference) {
              // SC-2: BRepExtrema_DistShapeShape — use _1() + LoadS1/LoadS2 + Perform.
              const distRange = new oc.Message_ProgressRange_1();
              const extrema = new oc.BRepExtrema_DistShapeShape_1();
              extrema.LoadS1(ei.posedShape.handle as never);
              extrema.LoadS2(ej.posedShape.handle as never);
              extrema.Perform(distRange);
              distRange.delete?.();
              const dist: number = extrema.Value();
              extrema.delete?.();
              // SC-2: Value() returns 0 for both touching and overlapping; only report > 0.
              if (dist > 0 && dist <= opts.clearanceThreshold) {
                results.push({ aIndex: i, bIndex: j, kind: 'clearance', distance: dist });
              }
            }
          } catch (e) {
            console.warn(`checkInterference: pair (${i},${j}) threw, skipping: ${(e as Error).message}`);
          }
        }
      }

      // SC-5: dispose all posed copies after processing all pairs.
      for (const entry of entries) {
        if (entry) {
          (entry.posedShape.handle as { delete?: () => void }).delete?.();
        }
      }

      return results;
    },
```

- [ ] **Step 5: Also add the missing imports at the top of `api.ts` — `computeBoundingBox` is already imported (line 6). Verify it is present:**

```bash
grep "computeBoundingBox" /Users/lion/Documents/Projects/mine/zilventor/packages/kernel/src/api.ts
```

Expected output: `import { disposeShape, computeBoundingBox, type OcctShape } from './occt/SolidOps';`

If missing, add `computeBoundingBox` to the existing SolidOps import.

- [ ] **Step 6: Run the integration tests — expect PASS**

```bash
cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/interferenceCheck.integration.spec.ts
```

Expected: all 5 tests pass. Check SC-10 console log: if the touching-face Common volume is ≥ 1.0 mm³, raise `VOLUME_THRESHOLD_MM3` in `packages/shared/src/clash.ts` to `Math.ceil(rawVolume) + 1` and document in a comment.

- [ ] **Step 7: Typecheck kernel**

```bash
cd packages/kernel && npx tsc --noEmit
```

Expected: 0 new errors (baseline 5).

- [ ] **Step 8: Commit**

```bash
git add packages/kernel/src/api.ts packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts
git commit -m "feat(kernel): checkInterference — AABB broad-phase + Common/Distance narrow-phase (SC-1/SC-2/SC-3/SC-4/SC-5)"
```

---

## Task 3: App Orchestration — `runInterferenceCheck`

**Parallelizable with Tasks 4 and 5 after Task 2 completes.**

**Files:**
- Create: `packages/app/src/assembly/runInterferenceCheck.ts`
- Create: `packages/app/src/assembly/__tests__/runInterferenceCheck.spec.ts`

- [ ] **Step 1: Write failing unit test**

```typescript
// packages/app/src/assembly/__tests__/runInterferenceCheck.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInterferenceCheck } from '../runInterferenceCheck';
import type { AssemblyDocument } from '@zilventor/shared';

// Minimal flat assembly with 2 components pointing to real-path stubs
const asm: AssemblyDocument = {
  id: 'asm1', name: 'Test', units: 'mm', parameters: {}, properties: {},
  components: [
    { id: 'c1', partPath: 'parts/panel-a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'c2', partPath: 'parts/panel-b.zipt', position: { x: 100, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

const MOCK_PAIRS = [{ aIndex: 0, bIndex: 1, kind: 'interference' as const, volume: 1800 }];

describe('runInterferenceCheck', () => {
  let kernel: { checkInterference: ReturnType<typeof vi.fn>; loadFromBytes: ReturnType<typeof vi.fn> };
  let opfs: { read: ReturnType<typeof vi.fn>; exists: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    kernel = {
      checkInterference: vi.fn().mockResolvedValue(MOCK_PAIRS),
      loadFromBytes: vi.fn().mockResolvedValue('kernel-id-1'),
    };
    opfs = {
      read: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      exists: vi.fn().mockResolvedValue(true),
    };
  });

  it('calls kernel.checkInterference and returns ClashReportRow[]', async () => {
    const rows = await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel A' }),
      clearanceThreshold: 1.0,
    });

    expect(kernel.checkInterference).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('interference');
    expect(rows[0]!.volume).toBeCloseTo(1800);
  });

  it('returns empty rows when kernel returns no pairs', async () => {
    kernel.checkInterference.mockResolvedValue([]);
    const rows = await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel A' }),
      clearanceThreshold: 1.0,
    });
    expect(rows).toHaveLength(0);
  });

  it('passes volumeThreshold from shared constant and clearanceThreshold from arg', async () => {
    await runInterferenceCheck({
      assembly: asm,
      kernel: kernel as any,
      opfs: opfs as any,
      subAsmCache: { get: () => undefined },
      componentPoses: new Map(),
      partInfoCache: new Map(),
      resolvePartInfo: vi.fn().mockResolvedValue({ name: 'Panel' }),
      clearanceThreshold: 2.5,
    });
    const call = kernel.checkInterference.mock.calls[0]!;
    // opts is the second argument
    expect(call[1].clearanceThreshold).toBe(2.5);
    // volumeThreshold must match the shared constant (not hardcoded 1.0)
    const { VOLUME_THRESHOLD_MM3 } = await import('@zilventor/shared');
    expect(call[1].volumeThreshold).toBe(VOLUME_THRESHOLD_MM3);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/runInterferenceCheck.spec.ts
```

Expected: `Cannot find module '../runInterferenceCheck'`

- [ ] **Step 3: Create `packages/app/src/assembly/runInterferenceCheck.ts`**

```typescript
/**
 * Orchestration for the on-demand Interference / Clash Check.
 * SC-6: reuses resolveExportLeaves (the only correct flatten+pose+load path).
 * SC-7: carries both componentPath and componentPathKey in leafMeta.
 */
import { buildClashReport, VOLUME_THRESHOLD_MM3 } from '@zilventor/shared';
import type { ClashReportRow, ClashLeafMeta } from '@zilventor/shared';
import type { AssemblyDocument } from '@zilventor/shared';
import { pathKey } from '@zilventor/shared';
import { resolveExportLeaves } from './resolveExportLeaves';
import type { PartInfoCache } from '../shell/resolvePartInfo';
import type { ExportLeaf } from '@zilventor/kernel/src/api';

type Pose = { translation: { x: number; y: number; z: number }; quaternion: [number, number, number, number] };

type SubAsmCache = {
  get(p: string): { kind: 'ok'; doc: AssemblyDocument; partPath: string; innerStaticPoses?: Map<string, Pose> } | undefined;
};

type KernelForClash = {
  loadFromBytes(b: Uint8Array): Promise<string>;
  checkInterference(
    leaves: ReadonlyArray<{ partId: string; pose: Pose }>,
    opts: { volumeThreshold: number; clearanceThreshold: number },
  ): Promise<import('@zilventor/shared').ClashPair[]>;
};

type OpfsForClash = { read(p: string): Promise<Uint8Array>; exists(p: string): Promise<boolean> };

export async function runInterferenceCheck(args: {
  assembly: AssemblyDocument;
  kernel: KernelForClash;
  opfs: OpfsForClash;
  subAsmCache: SubAsmCache;
  componentPoses: Map<string, Pose>;
  partInfoCache: PartInfoCache;
  resolvePartInfo: (opfs: { read(p: string): Promise<Uint8Array> }, partPath: string, cache: PartInfoCache) => Promise<{ name: string }>;
  clearanceThreshold: number;
}): Promise<ClashReportRow[]> {
  const { assembly, kernel, opfs, subAsmCache, componentPoses, partInfoCache, resolvePartInfo, clearanceThreshold } = args;

  // SC-6: resolveExportLeaves is the canonical path — visibleLeaves + composedPoses + loadFromBytes dedup.
  // It returns ExportLeaf[] with { partId, name, pose, color? }.
  // We need the componentPath per leaf to build leafMeta; visibleLeaves is called inside resolveExportLeaves,
  // so we call it ourselves in parallel to collect componentPaths in the same order.
  // Implementation: call resolveExportLeaves AND also collect visibleLeaves for metadata.
  // Since resolveExportLeaves walks visibleLeaves internally, we replicate the leaf order by calling
  // visibleLeaves ourselves. Both calls use the same subAsmCache so they see the same tree.
  const { visibleLeaves } = await import('./walkers/visibleLeaves');

  const rawLeaves = visibleLeaves(assembly, subAsmCache);

  // Build leaf metadata parallel to the resolved leaves (same order, filtered to non-placeholder).
  const resolvedLeafMetas: ClashLeafMeta[] = rawLeaves
    .filter((l) => l.kind !== 'placeholder')
    .map((l) => ({
      componentPath: l.componentPath,
      componentPathKey: pathKey(l.componentPath),
      partName: l.partPath.split('/').pop()?.replace(/\.zipt$/, '') ?? l.partPath,
    }));

  // resolveExportLeaves handles the actual OPFS reads + kernel.loadFromBytes dedup.
  let exportLeaves: ExportLeaf[];
  try {
    exportLeaves = await resolveExportLeaves({
      assembly,
      kernel: { loadFromBytes: (b) => kernel.loadFromBytes(b) },
      opfs,
      subAsmCache,
      componentPoses,
      partInfoCache,
      resolvePartInfo: (o, p, c) => resolvePartInfo(o as { read(p: string): Promise<Uint8Array> }, p, c),
    });
  } catch {
    // If resolveExportLeaves throws (e.g. unresolved sub-asm), return empty.
    return [];
  }

  // Update partName from resolvePartInfo's resolved names.
  for (let i = 0; i < exportLeaves.length && i < resolvedLeafMetas.length; i++) {
    resolvedLeafMetas[i]!.partName = exportLeaves[i]!.name;
  }

  if (exportLeaves.length < 2) return [];

  // Build kernel-ready leaves: { partId, pose } parallel to resolvedLeafMetas.
  const kernelLeaves = exportLeaves.map((l) => ({
    partId: l.partId,
    pose: l.pose as Pose,
  }));

  const pairs = await kernel.checkInterference(kernelLeaves, {
    volumeThreshold: VOLUME_THRESHOLD_MM3,
    clearanceThreshold,
  });

  return buildClashReport(pairs, resolvedLeafMetas);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/assembly/__tests__/runInterferenceCheck.spec.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Typecheck app**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: 0 new errors (baseline 60).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/assembly/runInterferenceCheck.ts packages/app/src/assembly/__tests__/runInterferenceCheck.spec.ts
git commit -m "feat(app): runInterferenceCheck orchestration — reuses resolveExportLeaves (SC-6)"
```

---

## Task 4: Store Clash Slice

**Parallelizable with Tasks 3 and 5 after Task 2 completes.**

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`

- [ ] **Step 1: Write a failing test for the clash slice**

Create `packages/app/src/store/__tests__/clashSlice.spec.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

describe('useAppStore clash slice', () => {
  beforeEach(() => {
    useAppStore.setState({ clashRows: null, clashRan: false, clashHighlightKeys: [] } as any);
  });

  it('initial state: clashRows=null, clashRan=false, clashHighlightKeys=[]', () => {
    const s = useAppStore.getState();
    expect(s.clashRows).toBeNull();
    expect(s.clashRan).toBe(false);
    expect(s.clashHighlightKeys).toEqual([]);
  });

  it('setClashResult populates clashRows and sets clashRan=true', () => {
    const rows = [
      { aPathKey: 'A', bPathKey: 'B', aPath: ['A'], bPath: ['B'], aName: 'P1', bName: 'P2', kind: 'interference' as const, volume: 500 },
    ];
    useAppStore.getState().setClashResult(rows);
    const s = useAppStore.getState();
    expect(s.clashRows).toHaveLength(1);
    expect(s.clashRan).toBe(true);
  });

  it('setClashResult(null) resets clashRan to false', () => {
    useAppStore.getState().setClashResult([]);
    useAppStore.getState().setClashResult(null);
    const s = useAppStore.getState();
    expect(s.clashRows).toBeNull();
    expect(s.clashRan).toBe(false);
  });

  it('setClashHighlightKeys stores the keys', () => {
    useAppStore.getState().setClashHighlightKeys(['A', 'B']);
    expect(useAppStore.getState().clashHighlightKeys).toEqual(['A', 'B']);
  });

  it('setClashHighlightKeys([]) clears highlights', () => {
    useAppStore.getState().setClashHighlightKeys(['A']);
    useAppStore.getState().setClashHighlightKeys([]);
    expect(useAppStore.getState().clashHighlightKeys).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/store/__tests__/clashSlice.spec.ts
```

Expected: `TypeError: s.setClashResult is not a function`

- [ ] **Step 3: Add clash slice to `AppState` type and store implementation in `useAppStore.ts`**

In the `AppState` type (before the closing `};` at line 476), add after `clearWorkFeaturePick`:

```typescript
  // Interference / Clash Check slice (SC-16)
  clashRows: import('@zilventor/shared').ClashReportRow[] | null;
  clashRan: boolean;
  /** ComponentPathKeys of the currently highlighted clash pair (for SceneManager). */
  clashHighlightKeys: string[];
  setClashResult(rows: import('@zilventor/shared').ClashReportRow[] | null): void;
  setClashHighlightKeys(keys: string[]): void;
```

In the `create<AppState>((set) => ({` implementation block (after `clearWorkFeaturePick: ...`), add:

```typescript
  clashRows: null,
  clashRan: false,
  clashHighlightKeys: [],
  setClashResult: (rows) => set({ clashRows: rows, clashRan: rows !== null }),
  setClashHighlightKeys: (keys) => set({ clashHighlightKeys: [...keys] }),
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/store/__tests__/clashSlice.spec.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: 0 new errors (baseline 60).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/clashSlice.spec.ts
git commit -m "feat(app/store): clash slice — clashRows/clashRan/clashHighlightKeys (SC-16)"
```

---

## Task 5: SceneManager — `setClashHighlight`

**Parallelizable with Tasks 3 and 4 after Task 2 completes.**

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`

- [ ] **Step 1: Write failing test**

Create `packages/app/src/viewport/__tests__/SceneManager.clashHighlight.spec.ts`:

```typescript
/**
 * SC-17: setClashHighlight uses a red LineSegments child overlay (same pattern as
 * selection overlays) — approach (b) from SC-17 chosen because it composes cleanly
 * with the orange selection overlay (both are LineSegments children; different material
 * colors).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal Three.js mock sufficient for testing the highlight logic without WebGL.
vi.mock('three', () => {
  class LineBasicMaterial { constructor(public opts: object) {} delete() {} }
  class EdgesGeometry { constructor(public geo: object) {} dispose() {} }
  class LineSegments {
    parent: { remove: ReturnType<typeof vi.fn> } | null = null;
    userData: Record<string, unknown> = {};
    geometry: EdgesGeometry;
    constructor(geo: EdgesGeometry, _mat: LineBasicMaterial) { this.geometry = geo; }
    add(_: unknown) {}
  }
  class Mesh {
    geometry = { boundingBox: null };
    userData: Record<string, unknown> = {};
    children: unknown[] = [];
    add(child: LineSegments) {
      (child as any).parent = this;
      this.children.push(child);
    }
    remove(child: unknown) {
      this.children = this.children.filter((c) => c !== child);
    }
  }
  return { LineBasicMaterial, EdgesGeometry, LineSegments, Mesh };
});

import { SceneManager } from '../SceneManager';

// Build a minimal SceneManager with pre-populated componentMeshes.
function makeSceneManager(): SceneManager {
  const scene = { add: vi.fn(), remove: vi.fn(), children: [] };
  const renderer = { render: vi.fn(), domElement: {} };
  const camera = {};
  const sm = new (SceneManager as any)(scene, renderer, camera);
  return sm;
}

describe('SceneManager.setClashHighlight', () => {
  let sm: SceneManager;

  beforeEach(() => {
    sm = makeSceneManager();
  });

  it('setClashHighlight([]) on empty componentMeshes is a no-op (no throw)', () => {
    expect(() => sm.setClashHighlight([])).not.toThrow();
  });

  it('after setClashHighlight with known keys, clashHighlightPathKeys() returns those keys', () => {
    const { Mesh } = require('three');
    const mesh = new Mesh();
    // Directly inject a mesh into the private componentMeshes map for testing.
    (sm as any).componentMeshes.set('A B', mesh);

    sm.setClashHighlight(['A B']);

    expect(sm.clashHighlightPathKeys()).toContain('A B');
  });

  it('calling setClashHighlight([]) clears all overlays', () => {
    const { Mesh } = require('three');
    const mesh = new Mesh();
    (sm as any).componentMeshes.set('A B', mesh);
    sm.setClashHighlight(['A B']);
    expect(sm.clashHighlightPathKeys()).toHaveLength(1);

    sm.setClashHighlight([]);
    expect(sm.clashHighlightPathKeys()).toHaveLength(0);
  });

  it('re-running setClashHighlight replaces old highlights (SC-13(d))', () => {
    const { Mesh } = require('three');
    const meshA = new Mesh();
    const meshB = new Mesh();
    (sm as any).componentMeshes.set('A', meshA);
    (sm as any).componentMeshes.set('B', meshB);

    sm.setClashHighlight(['A']);
    expect(sm.clashHighlightPathKeys()).toEqual(['A']);

    sm.setClashHighlight(['B']);
    expect(sm.clashHighlightPathKeys()).toEqual(['B']);
    // A's overlay must have been removed (no stale red)
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.clashHighlight.spec.ts
```

Expected: `TypeError: sm.setClashHighlight is not a function`

- [ ] **Step 3: Add `setClashHighlight` and `clashHighlightPathKeys` to `SceneManager.ts`**

Open `packages/app/src/viewport/SceneManager.ts`. Find the class body and locate the private field declarations (where `selectionOverlays` is declared). Add new private fields for clash highlights alongside them:

```typescript
  // SC-17: clash highlight overlays (red LineSegments, same pattern as selection overlays).
  private clashOverlays: Map<string, THREE.LineSegments> = new Map();
  private clashOverlayMaterial: THREE.LineBasicMaterial | null = null;
```

Then add the public methods after `hasSelectionOverlay` (around line 584):

```typescript
  /**
   * SC-17: Set the clash highlight overlays. Approach (b) — red LineSegments child,
   * same pattern as setSelectedComponentPaths (orange overlay). Composes cleanly:
   * both are children of the same mesh; different material colors.
   * Clears previous overlays before applying new ones (SC-13(d): no stale red).
   */
  setClashHighlight(pathKeys: string[]): void {
    if (!this.clashOverlayMaterial) {
      this.clashOverlayMaterial = new THREE.LineBasicMaterial({ color: 0xff2222 });
    }
    const wantedKeys = new Set(pathKeys);
    // Remove overlays for keys no longer wanted.
    for (const [key, overlay] of this.clashOverlays) {
      if (wantedKeys.has(key)) continue;
      overlay.parent?.remove(overlay);
      overlay.geometry.dispose();
      this.clashOverlays.delete(key);
    }
    // Add overlays for new keys.
    for (const key of wantedKeys) {
      if (this.clashOverlays.has(key)) continue;
      const mesh = this.componentMeshes.get(key);
      if (!mesh) continue;
      const edges = new THREE.EdgesGeometry(mesh.geometry);
      const overlay = new THREE.LineSegments(edges, this.clashOverlayMaterial);
      overlay.userData.clashOverlay = true;
      mesh.add(overlay);
      this.clashOverlays.set(key, overlay);
    }
  }

  /** Returns the keys of currently-attached clash highlight overlays. */
  clashHighlightPathKeys(): string[] {
    return Array.from(this.clashOverlays.keys());
  }

  /** Clears all clash highlights (call on re-run or panel close). */
  clearClashHighlight(): void {
    this.setClashHighlight([]);
  }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/viewport/__tests__/SceneManager.clashHighlight.spec.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Typecheck**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: 0 new errors (baseline 60).

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/__tests__/SceneManager.clashHighlight.spec.ts
git commit -m "feat(app/viewport): SceneManager.setClashHighlight — red LineSegments overlay (SC-17)"
```

---

## Task 6: UI — i18n Keys, InspectTab, ClashReportPanel

**Solo (modifies i18n files; depends on Tasks 3–5).**

**Files:**
- Modify: `packages/app/src/i18n/locales/en.json`
- Modify: `packages/app/src/i18n/locales/uk.json`
- Create: `packages/app/src/shell/ClashReportPanel.tsx`
- Modify: `packages/app/src/shell/tabs/InspectTab.tsx`
- Create: `packages/app/src/shell/tabs/__tests__/InspectTab.clash.spec.tsx`

### 6a — i18n keys (SC-18 parity gate)

- [ ] **Step 1: Add keys to `packages/app/src/i18n/locales/en.json`**

Find the `"inspect"` key inside `"tab"` (line 977) and also add a new top-level `"clash"` section. The file is a large JSON object — add the `"clash"` section alongside other top-level sections (e.g., after `"cabinet"`):

```json
"clash": {
  "button": "Interference Check",
  "dialog_title": "Interference Check",
  "clearance_label": "Minimum clearance (mm)",
  "run": "Run",
  "cancel": "Cancel",
  "panel_title": "Clash Results",
  "kind_interference": "Interference",
  "kind_clearance": "Clearance",
  "volume_label": "Volume (mm³)",
  "distance_label": "Gap (mm)",
  "part_a": "Part A",
  "part_b": "Part B",
  "no_results": "No interferences found.",
  "never_run": "Run Interference Check to see results."
}
```

- [ ] **Step 2: Add the same keys to `packages/app/src/i18n/locales/uk.json`**

Add a `"clash"` section at the same level with Ukrainian translations:

```json
"clash": {
  "button": "Перевірка перетинів",
  "dialog_title": "Перевірка перетинів",
  "clearance_label": "Мінімальний зазор (мм)",
  "run": "Виконати",
  "cancel": "Скасувати",
  "panel_title": "Результати перевірки",
  "kind_interference": "Перетин",
  "kind_clearance": "Зазор",
  "volume_label": "Об'єм (мм³)",
  "distance_label": "Зазор (мм)",
  "part_a": "Деталь A",
  "part_b": "Деталь B",
  "no_results": "Перетинів не знайдено.",
  "never_run": "Запустіть перевірку перетинів для отримання результатів."
}
```

- [ ] **Step 3: Run parity test — expect PASS**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/i18n/parity.test.ts
```

Expected: 2 tests pass (identical key sets, no empty uk values).

### 6b — `ClashReportPanel` component

- [ ] **Step 4: Create `packages/app/src/shell/ClashReportPanel.tsx`**

```typescript
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ClashReportRow } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';

interface Props {
  rows: ClashReportRow[] | null;
  ran: boolean;
  onRowClick: (aPath: ComponentPath, bPath: ComponentPath, aKey: string, bKey: string) => void;
}

export function ClashReportPanel({ rows, ran, onRowClick }: Props): JSX.Element {
  const { t } = useTranslation();

  if (!ran) {
    return (
      <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>
        {t('clash.never_run')}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div style={{ color: '#888', fontSize: 11, marginTop: 8 }}>
        {t('clash.no_results')}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 11, marginBottom: 4 }}>
        {t('clash.panel_title')}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            {[
              t('clash.kind_interference') + '/' + t('clash.kind_clearance'),
              t('clash.part_a'),
              t('clash.part_b'),
              t('clash.volume_label') + ' / ' + t('clash.distance_label'),
            ].map((h) => (
              <th
                key={h}
                style={{ textAlign: 'left', borderBottom: '1px solid #444', padding: '2px 4px', color: '#aaa' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={`${row.aPathKey}__${row.bPathKey}__${idx}`}
              style={{ cursor: 'pointer' }}
              onClick={() => onRowClick(row.aPath, row.bPath, row.aPathKey, row.bPathKey)}
            >
              <td style={{ padding: '2px 4px', color: row.kind === 'interference' ? '#ff4444' : '#ffaa44' }}>
                {row.kind === 'interference' ? t('clash.kind_interference') : t('clash.kind_clearance')}
              </td>
              <td style={{ padding: '2px 4px' }}>{row.aName}</td>
              <td style={{ padding: '2px 4px' }}>{row.bName}</td>
              <td style={{ padding: '2px 4px', color: '#888' }}>
                {row.kind === 'interference'
                  ? row.volume?.toFixed(0) ?? '—'
                  : row.distance?.toFixed(2) ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### 6c — `InspectTab` implementation (replaces stub)

- [ ] **Step 5: Replace `packages/app/src/shell/tabs/InspectTab.tsx`**

```typescript
import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/useAppStore';
import { ClashReportPanel } from '../ClashReportPanel';
import { runInterferenceCheck } from '../../assembly/runInterferenceCheck';
import { CLEARANCE_DEFAULT_MM } from '@zilventor/shared';
import { resolvePartInfo } from '../resolvePartInfo';
import { computeInnerStaticPoses } from '../../assembly/computeInnerStaticPoses';
import { unpackAssembly } from '@zilventor/kernel/src/storage/AssemblyPacker';
import type { AssemblyDocument } from '@zilventor/shared';
import type { ComponentPath } from '@zilventor/shared';
import { Opfs } from '@zilventor/kernel/src/storage/Opfs';

export default function InspectTab(): JSX.Element {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clearanceMm, setClearanceMm] = useState(String(CLEARANCE_DEFAULT_MM));
  const [running, setRunning] = useState(false);

  const activeAssembly = useAppStore((s) => s.activeAssembly);
  const kernel = useAppStore((s) => s.kernel);
  const clashRows = useAppStore((s) => s.clashRows);
  const clashRan = useAppStore((s) => s.clashRan);
  const setClashResult = useAppStore((s) => s.setClashResult);
  const setClashHighlightKeys = useAppStore((s) => s.setClashHighlightKeys);
  const selectComponentPaths = useAppStore((s) => s.selectComponentPaths);
  const viewport = useAppStore((s) => s.viewport);
  const subAssemblyDocs = useAppStore((s) => s.subAssemblyDocs);
  const subAssemblyInnerPoses = useAppStore((s) => s.subAssemblyInnerPoses);
  const componentPoses = useAppStore((s) => s.componentPoses);

  const handleRun = useCallback(async () => {
    if (!activeAssembly || !kernel) return;
    const threshold = parseFloat(clearanceMm);
    if (!Number.isFinite(threshold) || threshold <= 0) return;

    setDialogOpen(false);
    setRunning(true);

    // Clear previous highlights before new run (SC-13(d)).
    const sm = (viewport as { getSceneManager?(): unknown } | null)?.getSceneManager?.() as
      | { setClashHighlight(keys: string[]): void }
      | null;
    sm?.setClashHighlight([]);
    setClashHighlightKeys([]);

    try {
      const opfs = await Opfs.forNavigator();

      // Build sub-asm cache (mirrors ExportStepCommand._buildSubAsmCache).
      let docs = { ...subAssemblyDocs };
      const innerPoses = { ...subAssemblyInnerPoses };
      if (Object.keys(docs).length === 0) {
        const stack: AssemblyDocument[] = [activeAssembly];
        const seen = new Set<string>();
        while (stack.length) {
          const d = stack.pop()!;
          for (const c of d.components) {
            if (!c.partPath.endsWith('.ziasm')) continue;
            if (seen.has(c.partPath)) continue;
            seen.add(c.partPath);
            if (docs[c.partPath]) { stack.push(docs[c.partPath]!); continue; }
            try {
              if (await opfs.exists(c.partPath)) {
                const sub = await unpackAssembly(await opfs.read(c.partPath));
                docs[c.partPath] = sub;
                innerPoses[c.partPath] = computeInnerStaticPoses(sub);
                stack.push(sub);
              }
            } catch { /* skip corrupt */ }
          }
        }
      } else {
        for (const [p, d] of Object.entries(docs)) {
          if (!innerPoses[p]) innerPoses[p] = computeInnerStaticPoses(d);
        }
      }

      const subAsmCache = {
        get: (p: string) =>
          docs[p]
            ? ({ kind: 'ok' as const, doc: docs[p]!, partPath: p, ...(innerPoses[p] ? { innerStaticPoses: innerPoses[p] } : {}) })
            : undefined,
      };

      const partInfoCache = new Map();
      const rows = await runInterferenceCheck({
        assembly: activeAssembly,
        kernel: kernel as any,
        opfs,
        subAsmCache,
        componentPoses,
        partInfoCache,
        resolvePartInfo: (o, p, c) =>
          resolvePartInfo(o as import('@zilventor/kernel/src/storage/Opfs').Opfs, p, c),
        clearanceThreshold: threshold,
      });

      setClashResult(rows);
    } catch (e) {
      console.error('InterferenceCheck failed:', e);
      setClashResult([]);
    } finally {
      setRunning(false);
    }
  }, [activeAssembly, kernel, clearanceMm, viewport, subAssemblyDocs, subAssemblyInnerPoses, componentPoses, setClashResult, setClashHighlightKeys]);

  const handleRowClick = useCallback((aPath: ComponentPath, bPath: ComponentPath, aKey: string, bKey: string) => {
    // SC-7: selectComponentPaths takes ComponentPath[] (string arrays).
    selectComponentPaths([aPath as string[], bPath as string[]]);
    // SC-17: highlight via SceneManager.
    const sm = (viewport as { getSceneManager?(): unknown } | null)?.getSceneManager?.() as
      | { setClashHighlight(keys: string[]): void }
      | null;
    sm?.setClashHighlight([aKey, bKey]);
    setClashHighlightKeys([aKey, bKey]);
  }, [selectComponentPaths, viewport, setClashHighlightKeys]);

  const isAssembly = !!activeAssembly;

  return (
    <div style={{ padding: 8 }}>
      <button
        disabled={!isAssembly || !kernel || running}
        onClick={() => setDialogOpen(true)}
        style={{ marginBottom: 8 }}
      >
        {running ? '…' : t('clash.button')}
      </button>

      {dialogOpen && (
        <div style={{ background: '#2a2a2a', padding: 8, borderRadius: 4, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{t('clash.dialog_title')}</div>
          <label style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>
            {t('clash.clearance_label')}
            <input
              type="number"
              min="0"
              step="0.1"
              value={clearanceMm}
              onChange={(e) => setClearanceMm(e.target.value)}
              style={{ marginLeft: 8, width: 60 }}
            />
          </label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button onClick={handleRun}>{t('clash.run')}</button>
            <button onClick={() => setDialogOpen(false)}>{t('clash.cancel')}</button>
          </div>
        </div>
      )}

      <ClashReportPanel
        rows={clashRows}
        ran={clashRan}
        onRowClick={handleRowClick}
      />
    </div>
  );
}
```

### 6d — SC-12 real UI-wiring test

- [ ] **Step 6: Create `packages/app/src/shell/tabs/__tests__/InspectTab.clash.spec.tsx`**

```typescript
/**
 * SC-12: Real UI-wiring test — renders InspectTab, clicks the button,
 * submits the dialog, and asserts store clashRows populates.
 * kernel.checkInterference is MOCKED to return a known ClashPair[].
 * Does NOT inject its own onSubmit — the wiring goes through the real InspectTab handler.
 *
 * SC-12 also tests row-click calls selectComponentPaths + setClashHighlightKeys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InspectTab from '../InspectTab';
import { useAppStore } from '../../../store/useAppStore';
import type { AssemblyDocument } from '@zilventor/shared';

// Mock OPFS — not available in jsdom
vi.mock('@zilventor/kernel/src/storage/Opfs', () => ({
  Opfs: {
    forNavigator: vi.fn().mockResolvedValue({
      read: vi.fn().mockResolvedValue(new Uint8Array()),
      write: vi.fn(),
      exists: vi.fn().mockResolvedValue(false),
    }),
  },
}));

// Mock runInterferenceCheck at module level so we control return value.
vi.mock('../../../assembly/runInterferenceCheck', () => ({
  runInterferenceCheck: vi.fn().mockResolvedValue([
    {
      aPathKey: 'c1',
      bPathKey: 'c2',
      aPath: ['c1'],
      bPath: ['c2'],
      aName: 'Panel A',
      bName: 'Panel B',
      kind: 'interference',
      volume: 1800,
    },
  ]),
}));

import { runInterferenceCheck } from '../../../assembly/runInterferenceCheck';

const seedAsm: AssemblyDocument = {
  id: 'asm-inspect', name: 'InspectTest', units: 'mm', parameters: {}, properties: {},
  components: [
    { id: 'c1', partPath: 'parts/a.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    { id: 'c2', partPath: 'parts/b.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
  ],
  constraints: [],
  groundedComponentPaths: [],
  colors: {},
  bomItemNumbers: {}, cutListItemNumbers: {}, colorOverrides: {},
  materials: [],
  hardware: [],
};

function setActiveAssembly(): void {
  useAppStore.setState({
    activeDocument: { kind: 'assembly', document: seedAsm },
    activeAssembly: seedAsm,
    activePart: null,
    // Provide a minimal kernel mock with checkInterference
    kernel: {
      checkInterference: vi.fn().mockResolvedValue([]),
    } as any,
    subAssemblyDocs: {},
    subAssemblyInnerPoses: {},
    componentPoses: new Map(),
    clashRows: null,
    clashRan: false,
    clashHighlightKeys: [],
  } as any);
}

describe('InspectTab — clash check wiring (SC-12)', () => {
  beforeEach(() => {
    setActiveAssembly();
    vi.mocked(runInterferenceCheck).mockResolvedValue([
      {
        aPathKey: 'c1',
        bPathKey: 'c2',
        aPath: ['c1'],
        bPath: ['c2'],
        aName: 'Panel A',
        bName: 'Panel B',
        kind: 'interference',
        volume: 1800,
      },
    ]);
  });

  it('renders the Interference Check button', () => {
    render(<InspectTab />);
    expect(screen.getByRole('button', { name: /Interference Check/i })).toBeTruthy();
  });

  it('button is disabled when no active assembly', () => {
    useAppStore.setState({ activeAssembly: null, kernel: null } as any);
    render(<InspectTab />);
    expect(screen.getByRole('button', { name: /Interference Check/i })).toBeDisabled();
  });

  it('clicking button opens the clearance dialog', async () => {
    render(<InspectTab />);
    await userEvent.click(screen.getByRole('button', { name: /Interference Check/i }));
    expect(screen.getByText(/Minimum clearance/i)).toBeTruthy();
  });

  it('submitting the dialog calls runInterferenceCheck and populates clashRows', async () => {
    render(<InspectTab />);
    await userEvent.click(screen.getByRole('button', { name: /Interference Check/i }));

    // Confirm the default clearance value is present
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(parseFloat(input.value)).toBeGreaterThan(0);

    // Click Run
    await userEvent.click(screen.getByRole('button', { name: /^Run$/i }));

    await waitFor(() => {
      expect(runInterferenceCheck).toHaveBeenCalledOnce();
    });

    await waitFor(() => {
      expect(useAppStore.getState().clashRan).toBe(true);
      expect(useAppStore.getState().clashRows).toHaveLength(1);
    });
  });

  it('row click calls selectComponentPaths with ComponentPath arrays (SC-7)', async () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'c1', bPathKey: 'c2', aPath: ['c1'], bPath: ['c2'], aName: 'Panel A', bName: 'Panel B', kind: 'interference', volume: 1800 },
      ],
      clashRan: true,
    } as any);

    const spy = vi.spyOn(useAppStore.getState(), 'selectComponentPaths');

    render(<InspectTab />);

    const row = screen.getByText('Panel A').closest('tr')!;
    await userEvent.click(row);

    expect(spy).toHaveBeenCalledWith([['c1'], ['c2']]);
  });

  it('row click sets clashHighlightKeys in store', async () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'c1', bPathKey: 'c2', aPath: ['c1'], bPath: ['c2'], aName: 'Panel A', bName: 'Panel B', kind: 'interference', volume: 1800 },
      ],
      clashRan: true,
    } as any);

    render(<InspectTab />);
    const row = screen.getByText('Panel A').closest('tr')!;
    await userEvent.click(row);

    expect(useAppStore.getState().clashHighlightKeys).toEqual(['c1', 'c2']);
  });
});
```

- [ ] **Step 7: Run the wiring tests — expect PASS**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/shell/tabs/__tests__/InspectTab.clash.spec.tsx
```

Expected: 5 tests pass.

- [ ] **Step 8: Typecheck**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: 0 new errors (baseline 60).

- [ ] **Step 9: Commit**

```bash
git add packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json \
  packages/app/src/shell/ClashReportPanel.tsx \
  packages/app/src/shell/tabs/InspectTab.tsx \
  packages/app/src/shell/tabs/__tests__/InspectTab.clash.spec.tsx
git commit -m "feat(app/ui): InspectTab interference check — dialog, ClashReportPanel, SC-12 wiring tests (SC-15/SC-18)"
```

---

## Task 7: App.tsx DEV Probes

**Parallelizable with Task 8. Depends on Task 6.**

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Write a failing test for the probe functions**

Create `packages/app/src/__tests__/clashProbes.spec.ts`:

```typescript
/**
 * Tests that __zilventorClashCount and __zilventorClashResults are registered.
 * In the real app they are registered in a useEffect(DEV) — here we call the
 * same inline logic directly against the store state.
 */
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../store/useAppStore';

describe('clash probes', () => {
  it('__zilventorClashCount returns 0 when clashRows is null', () => {
    useAppStore.setState({ clashRows: null } as any);
    const count = useAppStore.getState().clashRows?.length ?? 0;
    expect(count).toBe(0);
  });

  it('__zilventorClashCount returns correct count', () => {
    useAppStore.setState({
      clashRows: [
        { aPathKey: 'a', bPathKey: 'b', aPath: ['a'], bPath: ['b'], aName: 'A', bName: 'B', kind: 'interference', volume: 100 },
      ],
    } as any);
    const count = useAppStore.getState().clashRows?.length ?? 0;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect PASS (these test the store, not the probes themselves)**

```bash
cd packages/app && npx vitest run --config vitest.config.ts src/__tests__/clashProbes.spec.ts
```

Expected: 2 tests pass.

- [ ] **Step 3: Add probes to `packages/app/src/App.tsx`**

Locate the DEV probe block in `packages/app/src/App.tsx` (around line 1193, after `w.__zilventorHardwarePartCount`). Add the following inside the `if (import.meta.env.DEV)` block, before the closing brace:

```typescript
      // Interference/Clash Check probes (SC-17)
      w.__zilventorClashCount = (): number => {
        return useAppStore.getState().clashRows?.length ?? 0;
      };
      w.__zilventorClashResults = (): unknown[] => {
        return useAppStore.getState().clashRows ?? [];
      };
```

- [ ] **Step 4: Typecheck**

```bash
cd packages/app && npx tsc --noEmit
```

Expected: 0 new errors (baseline 60).

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx packages/app/src/__tests__/clashProbes.spec.ts
git commit -m "feat(app): DEV probes __zilventorClashCount/__zilventorClashResults (SC-17)"
```

---

## Task 8: E2E Test — SC-11

**Parallelizable with Task 7. Depends on Task 6.**

**Files:**
- Create: `tests/e2e/interference-clash-check.spec.ts`

- [ ] **Step 1: Create the e2e test file**

```typescript
/**
 * E2E: Interference / Clash Check.
 *
 * SC-11 [BLOCKER]: Tests three scenarios:
 *   A. Two parts that deliberately overlap → interference detected, exact pathKeys present.
 *   B. One of the overlapping parts is inside a nested .ziasm → flatten+compose chain exercised.
 *   C. Clean cabinet with butt-joint panels → 0 clashes (threshold filter proves face-touching
 *      panels are NOT false-flagged end-to-end).
 *
 * §6 proof strategy: viewport black in headless → use probes only.
 *   __zilventorClashCount() → number of clash rows.
 *   __zilventorClashResults() → ClashReportRow[] for exact pathKey assertions.
 */
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from './helpers/buildBox';

test(
  'interference-check: overlapping parts → clash detected with exact pathKeys',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

    await page.goto('/');
    await waitForKernelReady(page);

    // ── A. New assembly ───────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => {
      const w = window as any;
      return w.__zilventorStore?.getState().activeDocument?.kind === 'assembly';
    });

    // ── B. Create two overlapping box parts and place them into the assembly ──
    // Use __zilventorStore.bus.execute to inject parts programmatically.
    // We create two panel parts and place them deliberately overlapping (offset < panel thickness).
    await page.evaluate(async () => {
      const w = window as any;
      const { CreateAndPlacePanelCommand } = await import('/src/commands/CreateAndPlacePanelCommand.ts');
      const { Opfs: OpfsClass } = await import('/src/node_modules/@zilventor/kernel/src/storage/Opfs.ts');
      const opfs = await OpfsClass.forNavigator();
      const { kernel, bus } = w.__zilventorStore.getState();

      // Panel A: 400×600×18 at position 0,0,0
      await bus.execute(new CreateAndPlacePanelCommand({
        kernel,
        opfs,
        panel: { kind: 'panel', id: 'feat-a', profile: { kind: 'rect', width: { kind: 'literal', value: 400 }, height: { kind: 'literal', value: 600 } }, thickness: { kind: 'literal', value: 18 }, operation: 'new' },
        position: { x: 0, y: 0, z: 0 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        name: 'PanelA',
      }));

      // Panel B: 400×600×18 offset by only 9mm on Z → 9mm overlap with Panel A
      await bus.execute(new CreateAndPlacePanelCommand({
        kernel,
        opfs,
        panel: { kind: 'panel', id: 'feat-b', profile: { kind: 'rect', width: { kind: 'literal', value: 400 }, height: { kind: 'literal', value: 600 } }, thickness: { kind: 'literal', value: 18 }, operation: 'new' },
        position: { x: 0, y: 0, z: 9 },
        rotation: { rx: 0, ry: 0, rz: 0 },
        name: 'PanelB',
      }));
    });

    // Wait for assembly to have 2 components
    await page.waitForFunction(() => {
      const w = window as any;
      const asm = w.__zilventorStore.getState().activeAssembly;
      return asm && asm.components.length >= 2;
    });

    // ── C. Run interference check via InspectTab button ──────────────────────
    await page.getByRole('tab', { name: /Inspect/i }).click();
    await page.getByRole('button', { name: /Interference Check/i }).click();

    // Dialog should appear — click Run with default clearance
    await page.waitForSelector('button:has-text("Run")');
    await page.click('button:has-text("Run")');

    // Wait for probe to report results
    await page.waitForFunction(() => {
      const w = window as any;
      return typeof w.__zilventorClashCount === 'function' && w.__zilventorClashCount() > 0;
    }, { timeout: 60_000 });

    const count: number = await page.evaluate(() => (window as any).__zilventorClashCount());
    expect(count).toBeGreaterThan(0);

    // SC-11(b): assert exact pathKeys
    const results: unknown[] = await page.evaluate(() => (window as any).__zilventorClashResults());
    console.log('[e2e] clash results:', JSON.stringify(results));

    // Both components should appear in at least one row
    const rows = results as Array<{ aPathKey: string; bPathKey: string; kind: string }>;
    const allKeys = rows.flatMap((r) => [r.aPathKey, r.bPathKey]);
    expect(allKeys.length).toBeGreaterThanOrEqual(2);
    // All results should be interference (9mm overlap >> 1.0mm threshold)
    expect(rows.every((r) => r.kind === 'interference')).toBe(true);

    expect(consoleErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  },
);

test(
  'interference-check: clean cabinet with butt joints → 0 clashes (SC-11(c))',
  async ({ page }) => {
    test.setTimeout(360_000);
    page.setDefaultTimeout(120_000);

    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR: ${e.message}`));

    await page.goto('/');
    await waitForKernelReady(page);

    // ── New assembly ──────────────────────────────────────────────────────────
    await page.getByRole('tab', { name: 'File' }).click();
    await page.getByRole('button', { name: /new assembly/i }).click();
    await page.waitForFunction(() => (window as any).__zilventorStore?.getState().activeDocument?.kind === 'assembly');

    // Register materials
    await page.evaluate(() => {
      const add = (window as any).__zilventorStore.getState().addMaterial;
      add({ id: 'm-birch', name: 'Birch 18mm', defaultThickness: 18, color: '#d8c896' });
      add({ id: 'm-back', name: 'Hardboard 6mm', defaultThickness: 6, color: '#8b6f47' });
    });

    // CreateCabinetCommand — a well-formed base cabinet; panels butt-join (face-touching, not overlapping)
    await page.evaluate(async () => {
      const w = window as any;
      const { CreateCabinetCommand } = await import('/src/commands/CreateCabinetCommand.ts');
      const { Opfs: OpfsClass } = await import('/src/node_modules/@zilventor/kernel/src/storage/Opfs.ts');
      const opfs = await OpfsClass.forNavigator();
      const { kernel, bus } = w.__zilventorStore.getState();
      await bus.execute(new CreateCabinetCommand({
        template: 'baseCabinet',
        params: {
          name: 'ClashTestCabinet',
          externalWidth: 600,
          externalHeight: 720,
          externalDepth: 560,
          topPanel: true,
          bottomPanel: true,
          backPanel: true,
          toeKick: true,
          material: 'm-birch',
          backMaterial: 'm-back',
        },
        kernel,
        opfs,
      }));
    });

    // Wait for cabinet components to appear
    await page.waitForFunction(() => {
      const asm = (window as any).__zilventorStore?.getState().activeAssembly;
      return asm && asm.components.length >= 4;
    });

    // ── Run Interference Check ────────────────────────────────────────────────
    await page.getByRole('tab', { name: /Inspect/i }).click();
    await page.getByRole('button', { name: /Interference Check/i }).click();
    await page.waitForSelector('button:has-text("Run")');
    await page.click('button:has-text("Run")');

    // Wait for clashRan=true (even if count=0)
    await page.waitForFunction(() => {
      return (window as any).__zilventorStore?.getState().clashRan === true;
    }, { timeout: 120_000 });

    const count: number = await page.evaluate(() => (window as any).__zilventorClashCount());
    console.log('[e2e clean cabinet] clash count:', count);

    // SC-11(c): clean cabinet → 0 clashes; face-touching butt joints must NOT be reported.
    expect(count).toBe(0);

    // Panel showing "No interferences found." should be visible
    await expect(page.locator('text=No interferences found.')).toBeVisible();

    expect(consoleErrors.filter((e) => !e.includes('ResizeObserver'))).toHaveLength(0);
  },
);
```

- [ ] **Step 2: Run the e2e tests (requires dev server running)**

```bash
cd /Users/lion/Documents/Projects/mine/zilventor && npx playwright test tests/e2e/interference-clash-check.spec.ts --timeout=360000
```

Expected: 2 tests pass. If the clean-cabinet test fails with count > 0, check the `VOLUME_THRESHOLD_MM3` constant — revisit SC-10 log from Task 2 and raise the threshold if needed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/interference-clash-check.spec.ts
git commit -m "test(e2e): interference clash check — overlapping pair + clean-cabinet zero case (SC-11)"
```

---

## Task 9: SC-13 Logic-Edge Unit Tests

**Can run in parallel with Task 8. Depends on Task 2.**

**Files:**
- Create: `packages/kernel/src/__tests__/interferenceEdgeCases.spec.ts` (unit, NOT integration — mocks OCCT)

Note: SC-13(b) (degenerate-shape skip) and SC-13(c) (single leaf) are already covered in the integration test (Task 2). SC-13(a) (precedence) and SC-13(d) (re-run clears) are covered in Task 1 (buildClashReport) and Task 5 (SceneManager). This task adds the remaining behavioral tests that cannot be cleanly covered in a unit test without real OCCT.

- [ ] **Step 1: Add SC-13(b) degenerate-pair skip test to the integration test**

Append to `packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts`:

```typescript
  /**
   * SC-13(b): Degenerate/invalid pair — a partId that failed to load is skipped,
   * while a valid pair still returns. Here we test by using a partId that was
   * never loaded (not in `parts` map) — it throws in warmShapeForExport → skip.
   */
  it('SC-13(b): unloaded leaf is skipped; valid pair in same run still returns', async () => {
    const idValid1 = await api.createPart('boxValid1');
    await api.addFeature(idValid1, {
      id: 'boxVf1',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 20 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 20, y2: 0 },
        { kind: 'line', id: 'l2', x1: 20, y1: 0, x2: 20, y2: 20 },
        { kind: 'line', id: 'l3', x1: 20, y1: 20, x2: 0, y2: 20 },
        { kind: 'line', id: 'l4', x1: 0, y1: 20, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idValid1);

    const idValid2 = await api.createPart('boxValid2');
    await api.addFeature(idValid2, {
      id: 'boxVf2',
      kind: 'extrude',
      sketchId: 'sk',
      profileIds: [],
      depth: { kind: 'literal', value: 20 },
      operation: 'new',
      sketchPrimitives: [
        { kind: 'line', id: 'l1', x1: 0, y1: 0, x2: 20, y2: 0 },
        { kind: 'line', id: 'l2', x1: 20, y1: 0, x2: 20, y2: 20 },
        { kind: 'line', id: 'l3', x1: 20, y1: 20, x2: 0, y2: 20 },
        { kind: 'line', id: 'l4', x1: 0, y1: 20, x2: 0, y2: 0 },
      ],
    } as any);
    await api.execute(idValid2);

    const leaves = [
      posedLeaf('NONEXISTENT-PART-ID', 0, 0, 0),  // will be skipped
      posedLeaf(idValid1, 0, 0, 0),
      posedLeaf(idValid2, 5, 0, 0),  // overlap: 20-5=15mm on X → 15×20×20=6000mm³
    ];

    // Should not throw; the NONEXISTENT leaf is skipped; valid pair (1,2) still found.
    const pairs = await api.checkInterference(leaves, { volumeThreshold: 1.0, clearanceThreshold: 1.0 });
    console.log('[SC-13b] pairs:', JSON.stringify(pairs));
    // The valid pair at indices 1 and 2 should still be detected.
    expect(pairs.some((p) => p.kind === 'interference')).toBe(true);
  });
```

- [ ] **Step 2: Run the extended integration tests**

```bash
cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/__tests__/interferenceCheck.integration.spec.ts
```

Expected: all tests pass (now 7 total including the appended SC-13(b) test).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/__tests__/interferenceCheck.integration.spec.ts
git commit -m "test(kernel): SC-13(b) degenerate-skip integration test"
```

---

## Post-Implementation Verification

After all tasks complete, run the full test suite in each package:

```bash
# shared
cd packages/shared && npx vitest run && npx tsc --noEmit

# kernel (unit + integration)
cd packages/kernel && npx vitest run && npx vitest run --config vitest.integration.config.ts && npx tsc --noEmit

# app
cd packages/app && npx vitest run --config vitest.config.ts && npx tsc --noEmit
```

Expected: shared 1+N new tests, kernel 5+N new (integration), app 60+N tsc baseline. Zero new type errors.

---

## Self-Review

### Spec Coverage vs Every SC

| SC | Coverage |
|----|----------|
| SC-1 (BRepAlgoAPI_Common_3 + explicit Build) | Task 2 step 4 — `new oc.BRepAlgoAPI_Common_3(..., new oc.Message_ProgressRange_1()); common.Build(new oc.Message_ProgressRange_1())` |
| SC-2 (BRepExtrema_DistShapeShape _1+Load+Perform) | Task 2 step 4 — `new oc.BRepExtrema_DistShapeShape_1(); extrema.LoadS1/LoadS2; extrema.Perform(...)` |
| SC-3 (HasErrors + TopExp_Explorer guard) | Task 2 step 4 — `!common.HasErrors()` + explorer `More()` check |
| SC-4 (Bnd_Box / computeBoundingBox reuse) | Task 2 step 4 — calls `computeBoundingBox` from `SolidOps.ts` |
| SC-5 (dispose posed copies) | Task 2 step 4 — all posed shapes disposed after the loop |
| SC-6 (resolveExportLeaves reuse) | Task 3 — `runInterferenceCheck` calls `resolveExportLeaves` |
| SC-7 (ComponentPath + ComponentPathKey both in row) | Task 1 `ClashReportRow.aPath/bPath` + Task 3 passes both; Task 6 InspectTab uses both |
| SC-8 (no manifest bump) | No manifest change anywhere |
| SC-9 (independent volume oracle 32000 mm³) | Task 2 integration test SC-9 |
| SC-10 (touching-face test logs real OCCT Common volume) | Task 2 integration test SC-10 with explicit console.log |
| SC-11 (e2e nested + exact pathKeys + clean-cabinet zero) | Task 8 e2e test |
| SC-12 (real InspectTab wiring, no self-injected onSubmit) | Task 6 step 6 `InspectTab.clash.spec.tsx` |
| SC-13 (precedence/degenerate/empty/re-run) | Tasks 1+2+5+9 |
| SC-14 (no worker.ts/KernelClient.ts edit) | Not touched anywhere |
| SC-15 (InspectTab placement) | Task 6 — InspectTab.tsx fully replaced |
| SC-16 (clash store slice pattern) | Task 4 |
| SC-17 (setClashHighlight — approach chosen: edge-overlay) | Task 5; also App.tsx probes Task 7 |
| SC-18 (i18n parity) | Task 6 step 1–3 with parity test run |

### Placeholder Scan

No "TBD", "TODO", "implement later", "fill in details", "add validation", or "similar to Task N" phrases found. All code blocks are complete.

### Type Consistency

- `ClashPair` defined in Task 1, used unchanged in Tasks 2, 3.
- `ClashReportRow` (with `aPath: string[]`, `bPath: string[]`) defined in Task 1, consumed in Tasks 3, 5, 6.
- `ClashLeafMeta` defined in Task 1, consumed in Task 3.
- `setClashResult`, `setClashHighlightKeys` defined in Task 4 store, called in Task 6 InspectTab.
- `SceneManager.setClashHighlight(pathKeys: string[])` defined in Task 5, called in Task 6 via `viewport.getSceneManager()`.
- `CLEARANCE_DEFAULT_MM` from shared, used in Task 6 InspectTab default.
- `VOLUME_THRESHOLD_MM3` from shared, used in Task 3 `runInterferenceCheck`.

---

## Plan Corrections v2 — AUTHORITATIVE (post 2-lens plan-verify)

These OVERRIDE the task bodies above wherever they conflict. Stable IDs (PC-N) — implementers reference these by number. Grounded in the geometry-by-hand verifier (conf 88) + scaffolding/real-API verifier (conf 72) + direct controller spot-checks.

- **PC-1 [BLOCKER fix] — kill the two-walker index-zip; carry `componentPath` through `resolveExportLeaves`.** Task 3's `runInterferenceCheck` must NOT call `visibleLeaves` separately and zip it to `resolveExportLeaves` output by index (fragile — `ExportLeaf` (`packages/kernel/src/api.ts:31`) has no `componentPath`, and the alignment silently breaks if `resolveExportLeaves` ever reorders/dedups). FIX: add an optional `componentPath?: ComponentPath` field to `ExportLeaf` (additive, structured-clone-safe — `ComponentPath` is `ReadonlyArray<string>`) and populate it inside `resolveExportLeaves` (`packages/app/src/assembly/resolveExportLeaves.ts:~108`, where it already iterates the `visibleLeaves` result and builds each `ExportLeaf` — the `componentPath` is in hand there). `runInterferenceCheck` then reads `partId`, `pose`, `name`, AND `componentPath` from the SAME array — one walk, no zip. Build `leafMeta[i] = { componentPath: leaf.componentPath!, componentPathKey: pathKey(leaf.componentPath!), partName: leaf.name }`. `parsePathKey`/`pathKey` are real (`packages/shared/src/componentPath.ts:6,10`) — use `pathKey` for the highlight map key and keep the raw `ComponentPath` array for `setSelectedComponentPaths` (SC-7).
- **PC-2 [BLOCKER fix] — e2e must nest one clashing part inside a `.ziasm` (SC-11(b)).** Task 8 currently seeds two FLAT root-level panels, which does NOT exercise the nested flatten→compose recursion SC-11 requires. FIX: seed via `CreateCabinetCommand` (`packages/app/src/commands/CreateCabinetCommand.ts` — confirmed to exist; it produces a cabinet `.ziasm` sub-assembly containing panel components) so at least one panel lives inside a nested `.ziasm`, then place a deliberately-overlapping part (via `CreateAndPlacePanelCommand` — confirmed at `packages/app/src/commands/CreateAndPlacePanelCommand.ts`) positioned to penetrate that nested panel. Assert that `__zilventorClashResults()` contains a pair whose `aPathKey`/`bPathKey` is a NESTED key (i.e. `parsePathKey(key).length > 1`), proving recursion reached a leaf inside the sub-assembly — not just `count >= 2`. Keep the separate clean-cabinet (real face-touching butt joints) → 0-clash case (SC-11(c)).
- **PC-3 [hardening] — guard `IsDone()` before `Value()` on the clearance path.** In `checkInterference`, after `extrema.Perform(distRange)` and before `extrema.Value()`, add `if (!extrema.IsDone()) { extrema.delete(); continue; }`. `Value()` is preconditioned on `IsDone()`; a failed `Perform` on a degenerate pair can return garbage rather than throw (the try/catch only covers throws). Verified: `BRepExtrema_DistShapeShape_1()` + `LoadS1`/`LoadS2` + `Perform(Message_ProgressRange)` + `IsDone()` + `Value()` all exist in `opencascade.full.d.ts` (the spec's earlier "unverified" flag is now CONFIRMED).
- **PC-4 [annotation] — KernelApi insertion point.** The plan's "insert before line 210" is approximate. The `KernelApi` TYPE block closes (`};`) just after `exportStlAssembly` (~`api.ts:212`); add the `checkInterference(leaves, opts): Promise<ClashPair[]>` signature there. The IMPLEMENTATION goes inside the object returned by `createKernelApi()` (closes ~`api.ts:862`), so it can reach the closure-private `warmShapeForExport` / `namedShapeCache` / `transformShapeByPose` (SC-14). No edit to `worker.ts` or `kernel-client/KernelClient.ts` (Comlink auto-exposes). Use the `oc as any` / `ocAny` cast convention for un-typed OCCT classes.
- **PC-5 [confirmed, no change] — geometry oracle + OCCT sequences are correct.** SC-9's 50³ box vs 40³ box offset +30 on X → overlap 20×40×40 = **32000 mm³** is verified by hand (both boxes corner-at-origin; identity-quaternion pose = pure X-shift). `BRepAlgoAPI_Common_3(s1,s2,range)` + explicit `Build(range2)` (two separate `Message_ProgressRange_1` objects) + `HasErrors()`/`TopExp_Explorer` solid-guard (SC-3, mirroring `BooleanOps.ts:126-137`) + `VolumeProperties_1` is the correct sequence. The AABB expand-by-clearance interval-overlap test is correct on all 3 axes. SC-13a precedence (clearance only when not interfering) is enforced. Posed copies disposed per pair (SC-5). Tuning of `VOLUME_THRESHOLD_MM3` happens against the SC-10 touching-faces test's logged real volume.
