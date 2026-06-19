# Part→Edge Tagging + Anchored Balloon Callouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every projected edge with the component it came from, then use that tag to anchor drawing balloon callouts (manual click + auto-balloon) to the real part's item number.

**Architecture:** Thread `pathKey(componentPath)` from `loadAssemblyForProjection` → kernel `getProjectorInput` → shared `projectView`/`classifyEdges` onto a new optional `Edge2D.componentPath`. Resolve item numbers by inverting the `BomRow[]` that `aggregateBomRecursive`/`computePartsListRows` already produce (same key space → no drift). Build the manual `addBalloon` click handler and an anchored `autoBalloonSheet` + `AutoBalloonCommand` on top.

**Tech Stack:** TypeScript, Vitest (unit), Vitest integration config (real OCCT), Playwright (e2e), React + Zustand, OpenCascade (opencascade.js) kernel via Comlink.

## Global Constraints

- Stay on branch `feat/wall-tall-cabinets`. Commit + push when each task is green.
- `componentPath` is an **additive optional field** on persisted projection geometry. **NO format-version bump** (mirrors existing optional `sourceFaceIds`). `CURRENT_FORMAT_VERSION` stays 30.
- Run unit suites from **inside the package dir**: `cd packages/<pkg> && npx vitest run <spec>` (a `vitest run` from repo root globs all packages).
- Real-OCCT integration tests are excluded by default: `npx vitest run --config vitest.integration.config.ts <spec>`.
- e2e from repo root: `npx playwright test <spec> --project=chromium`.
- tsc per package directly (`cd packages/<pkg> && npx tsc --noEmit`), not `pnpm -r typecheck` (it can mask per-package errors).
- e2e cross-module state via `window.__zilventorStore` / `__zilventorParameterRegistry`, NOT dynamic `import()` (different module instance).
- Balloon `targetMm`/`textPosMm` are **sheet-space mm** (confirmed `AnnotationElement.tsx:157`). View-local→sheet conversion: `sheet = view.positionMm + local * (scale.numerator/scale.denominator)`.
- `Edge2D` is declared in TWO places that must stay structurally compatible: `shared/src/drawing/projectedGeometry.ts` (canonical, imported by `types.ts`) and `shared/src/drawing/edgeClassifier.ts` (local return type). Add `componentPath?` to BOTH.

---

## File map

- `packages/shared/src/drawing/projectedGeometry.ts` — add `Edge2D.componentPath?` + `EdgeMesh3D`? (EdgeMesh3D lives in projector.ts). 
- `packages/shared/src/drawing/projector.ts` — `EdgeMesh3D.componentPath?`; `projectView` carries it onto `Edge3D`.
- `packages/shared/src/drawing/edgeClassifier.ts` — `Edge3D.componentPath?`, `Edge2D.componentPath?`; `classifyEdges` carries it onto each run.
- `packages/kernel/src/adapter/drawing/getProjectorInput.ts` — `AssemblyComponentInput.componentPath`; set it on each assembly edge.
- `packages/app/src/drawing/loadAssemblyForProjection.ts` — populate `componentPath: pathKey(leaf.componentPath)`.
- `packages/app/src/drawing/componentItemNumbers.ts` *(new)* — invert `BomRow[]` → maps.
- `packages/app/src/drawing/DrawingCanvas.tsx` — replace `addBalloon` stub with real click handler.
- `packages/app/src/drawing/autoBalloonSheet.ts` *(new)* — generate anchored balloons.
- `packages/app/src/commands/AutoBalloonCommand.ts` *(new)* — batch add/revert.
- `packages/app/src/shell/tabs/DrawingTab.tsx` — "Auto-balloon" button.
- `packages/app/tests/e2e/balloons.spec.ts` *(new)* — §6 e2e.

---

### Task 1: Thread `componentPath` through the shared projector

**Files:**
- Modify: `packages/shared/src/drawing/projector.ts` (EdgeMesh3D type ~:10; edge map ~:48)
- Modify: `packages/shared/src/drawing/edgeClassifier.ts` (Edge3D ~:4, Edge2D ~:10, build ~:80)
- Modify: `packages/shared/src/drawing/projectedGeometry.ts` (Edge2D ~:3)
- Test: `packages/shared/src/drawing/__tests__/projector.componentPath.spec.ts` (new)

**Interfaces:**
- Produces: `Edge2D.componentPath?: string`, `EdgeMesh3D.componentPath?: string`, `Edge3D.componentPath?: string`. `projectView(input)` copies `componentPath` from each input `EdgeMesh3D` onto every resulting `Edge2D` run.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/drawing/__tests__/projector.componentPath.spec.ts
import { describe, it, expect } from 'vitest';
import { projectView, type ProjectorInput } from '../projector';

describe('projectView carries componentPath', () => {
  it('copies componentPath from input edge onto every output Edge2D', () => {
    // A single front-facing triangle + one edge tagged with a component path.
    const input: ProjectorInput = {
      triangles: [[[0, 0, 0], [10, 0, 0], [0, 10, 0]]],
      edges: [
        { id: 'e1', points: [[0, 0, 0], [10, 0, 0]], componentPath: 'root/cabinet#0' },
      ],
      bbox: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 0 } as never,
    };
    const out = projectView(input, 'front');
    const all = [...out.visibleEdges, ...out.hiddenEdges];
    expect(all.length).toBeGreaterThan(0);
    for (const e of all) expect(e.componentPath).toBe('root/cabinet#0');
  });

  it('leaves componentPath undefined when input edge has none', () => {
    const input: ProjectorInput = {
      triangles: [[[0, 0, 0], [10, 0, 0], [0, 10, 0]]],
      edges: [{ id: 'e1', points: [[0, 0, 0], [10, 0, 0]] }],
      bbox: { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 0 } as never,
    };
    const out = projectView(input, 'front');
    for (const e of [...out.visibleEdges, ...out.hiddenEdges]) {
      expect(e.componentPath).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run src/drawing/__tests__/projector.componentPath.spec.ts`
Expected: FAIL — `componentPath` not in `EdgeMesh3D` type / `undefined` on output edges.

- [ ] **Step 3: Add the optional field to the three edge types**

In `projector.ts` `EdgeMesh3D`:
```typescript
export type EdgeMesh3D = {
  readonly id: string;
  readonly points: ReadonlyArray<[number, number, number]>;
  readonly adjacentFaces?: readonly string[];
  readonly componentPath?: string;
};
```
In `edgeClassifier.ts` `Edge3D` and `Edge2D` add `readonly componentPath?: string;` to each.
In `projectedGeometry.ts` `Edge2D` add `readonly componentPath?: string;`.

- [ ] **Step 4: Carry it through `projectView` and `classifyEdges`**

In `projector.ts`, the `edgesVS` map (~:48) gains the field:
```typescript
const edgesVS: Edge3D[] = source.edges.map(e => ({
  id: e.id,
  points: e.points.map(p => {
    const v = apply(Mview, { x: p[0], y: p[1], z: p[2] });
    return [v.x, v.y, v.z] as [number, number, number];
  }),
  adjacentFaces: e.adjacentFaces ? [...e.adjacentFaces] : [],
  ...(e.componentPath !== undefined && { componentPath: e.componentPath }),
}));
```
In `edgeClassifier.ts`, the `e2d` build (~:80) gains the field:
```typescript
const e2d: Edge2D = {
  id: `${edge.id}_${runIndex}`,
  kind: 'outline',
  points: run.pts,
  ...(edge.adjacentFaces !== undefined && { sourceFaceIds: edge.adjacentFaces }),
  ...(edge.componentPath !== undefined && { componentPath: edge.componentPath }),
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run src/drawing/__tests__/projector.componentPath.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 6: Typecheck + full shared suite + commit**

Run: `cd packages/shared && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all shared tests pass.
```bash
git add packages/shared/src/drawing
git commit -m "feat(drawing): carry componentPath through projector + classifier (M3.1 task 1)"
```

---

### Task 2: Kernel sets `componentPath` on assembly edges

**Files:**
- Modify: `packages/kernel/src/adapter/drawing/getProjectorInput.ts` (`AssemblyComponentInput` ~:7; assembly edge loop ~:160)
- Test: `packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.componentPath.spec.ts` (new) — pure (no OCCT) test of the edge-tagging branch via a small refactor, OR an integration test. Use the unit approach below.

**Interfaces:**
- Consumes: nothing new.
- Produces: `AssemblyComponentInput.componentPath: string`; every edge emitted for that component carries `componentPath`.

> NOTE: `getProjectorInput` needs OCCT for tessellation, so a pure unit test can't drive the whole function. Tag-propagation is simple enough to verify with a focused integration test (real OCCT) that projects a 2-component assembly. If the repo already has a kernel integration harness for `getProjectorInput`, mirror it; otherwise add the integration spec below.

- [ ] **Step 1: Write the failing integration test**

```typescript
// packages/kernel/src/adapter/drawing/__tests__/getProjectorInput.componentPath.int.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../../../api'; // adjust to the real kernel factory used by sibling int tests
// Build a tiny 2-box assembly via the same helpers sibling integration tests use.
// Pseudocode shape — align with existing kernel integration fixtures:
describe('getProjectorInput tags edges with componentPath (real OCCT)', () => {
  it('every assembly edge carries the componentPath of its source component', async () => {
    const kernel = await createKernelApi();
    const partId = await loadTwoBoxPart(kernel); // helper from existing int tests
    const input = await kernel.getProjectorInput({
      kind: 'assembly',
      components: [
        { partId, pose: identityPose(), componentPath: 'A' },
        { partId, pose: translatedPose(50), componentPath: 'B' },
      ],
    });
    expect(input.edges.length).toBeGreaterThan(0);
    const paths = new Set(input.edges.map((e) => e.componentPath));
    expect(paths.has('A')).toBe(true);
    expect(paths.has('B')).toBe(true);
    for (const e of input.edges) expect(e.componentPath).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/drawing/__tests__/getProjectorInput.componentPath.int.spec.ts`
Expected: FAIL — `componentPath` is `undefined` on edges (and a tsc error on the `components` literal).

- [ ] **Step 3: Add the field + set it in the edge loop**

`AssemblyComponentInput` (~:7):
```typescript
export type AssemblyComponentInput = {
  partId: string;
  componentPath: string;
  pose: {
    translation: { x: number; y: number; z: number };
    quaternion: readonly [number, number, number, number];
  };
};
```
Assembly edge loop (~:160):
```typescript
for (const edge of partInput.edges) {
  allEdges.push({
    ...edge,
    id: `${compIdx}::${comp.partId}::${edge.id}`,
    componentPath: comp.componentPath,
    points: edge.points.map((p) => applyPose(p, comp.pose)),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/kernel && npx vitest run --config vitest.integration.config.ts src/adapter/drawing/__tests__/getProjectorInput.componentPath.int.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/kernel && npx tsc --noEmit`
Expected: clean. (Adding a required `componentPath` to `AssemblyComponentInput` will surface every call site — Task 3 fixes the app site; any kernel-internal/test call sites must be updated here.)
```bash
git add packages/kernel/src/adapter/drawing
git commit -m "feat(kernel): set componentPath on assembly projector edges (M3.1 task 2)"
```

---

### Task 3: `loadAssemblyForProjection` supplies `componentPath`

**Files:**
- Modify: `packages/app/src/drawing/loadAssemblyForProjection.ts` (component push ~:155; `pathKey` import)
- Test: `packages/app/src/drawing/__tests__/loadAssemblyForProjection.componentPath.spec.ts` (new) OR extend existing `loadAssemblyForProjection.spec.ts`.

**Interfaces:**
- Consumes: `AssemblyComponentInput.componentPath` (Task 2).
- Produces: each returned component carries `componentPath = pathKey(leaf.componentPath)`.

- [ ] **Step 1: Write the failing test**

Extend the existing `loadAssemblyForProjection` spec fixture (it already mocks opfs/kernel). Add:
```typescript
it('tags each projection component with pathKey(leaf.componentPath)', async () => {
  // Arrange: a 1-component assembly fixture (reuse the spec's existing setup).
  const result = await loadAssemblyForProjection(/* existing args */);
  expect(result.components.length).toBeGreaterThan(0);
  for (const c of result.components) {
    expect(typeof c.componentPath).toBe('string');
    expect(c.componentPath.length).toBeGreaterThan(0);
  }
  // The componentPath must equal pathKey of the leaf path the BOM walker uses.
  expect(result.components[0]!.componentPath).toBe(pathKey(EXPECTED_LEAF_PATH));
});
```
(Set `EXPECTED_LEAF_PATH` to the fixture's leaf component-id array, e.g. `['comp-1']`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/loadAssemblyForProjection.spec.ts`
Expected: FAIL — `componentPath` missing on returned components.

- [ ] **Step 3: Populate it**

`loadAssemblyForProjection.ts`: ensure `pathKey` is imported (`import { pathKey } from '@zilventor/shared';`) and add to the push (~:155):
```typescript
components.push({
  partId,
  componentPath: pathKey(leaf.componentPath),
  pose: {
    translation: { x: pose.translation.x, y: pose.translation.y, z: pose.translation.z },
    quaternion: [...pose.quaternion] as [number, number, number, number],
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/loadAssemblyForProjection.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
Expected: clean (the `AssemblyComponentInput` required field is now satisfied at this call site).
```bash
git add packages/app/src/drawing/loadAssemblyForProjection.ts packages/app/src/drawing/__tests__/loadAssemblyForProjection.spec.ts
git commit -m "feat(drawing): supply componentPath from loadAssemblyForProjection (M3.1 task 3)"
```

---

### Task 4: `componentItemNumbers` resolver (path↔item)

**Files:**
- Create: `packages/app/src/drawing/componentItemNumbers.ts`
- Test: `packages/app/src/drawing/__tests__/componentItemNumbers.spec.ts` (new)

**Interfaces:**
- Consumes: `BomRow[]` (from `aggregateBomRecursive`, which `computePartsListRows` runs).
- Produces:
  - `itemNumberByComponentPath(rows: BomRow[]): Map<string, number>` — each `pathKey` → its item number.
  - `representativePathByItem(rows: BomRow[]): Map<number, string>` — item number → first component path.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/drawing/__tests__/componentItemNumbers.spec.ts
import { describe, it, expect } from 'vitest';
import { itemNumberByComponentPath, representativePathByItem } from '../componentItemNumbers';
import type { BomRow } from '@zilventor/shared/src/bomRow';

const rows: BomRow[] = [
  { rowKey: 'p1::none', itemNumber: 1, qty: 2, partPath: 'p1', partName: 'A',
    color: undefined, componentIds: ['c1', 'c2'] },
  { rowKey: 'p2::none', itemNumber: 2, qty: 1, partPath: 'p2', partName: 'B',
    color: undefined, componentIds: ['c3'] },
];

describe('componentItemNumbers', () => {
  it('maps every component path to its row item number', () => {
    const m = itemNumberByComponentPath(rows);
    expect(m.get('c1')).toBe(1);
    expect(m.get('c2')).toBe(1);
    expect(m.get('c3')).toBe(2);
    expect(m.get('nope')).toBeUndefined();
  });

  it('maps each item number to its first representative path', () => {
    const m = representativePathByItem(rows);
    expect(m.get(1)).toBe('c1');
    expect(m.get(2)).toBe('c3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/componentItemNumbers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/app/src/drawing/componentItemNumbers.ts
import type { BomRow } from '@zilventor/shared/src/bomRow';

/** pathKey(componentPath) → BOM item number, for every component in every row. */
export function itemNumberByComponentPath(rows: readonly BomRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    for (const cid of row.componentIds) m.set(cid, row.itemNumber);
  }
  return m;
}

/** BOM item number → first (representative) component path for that item. */
export function representativePathByItem(rows: readonly BomRow[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const row of rows) {
    const first = row.componentIds[0];
    if (first !== undefined && !m.has(row.itemNumber)) m.set(row.itemNumber, first);
  }
  return m;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/componentItemNumbers.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add a nested-`.ziasm` key-space guard, run, commit**

Add a test that runs the REAL `aggregateBomRecursive` on a fixture with one nested `.ziasm`, then asserts that `pathKey(leafPath)` for a nested leaf appears as a key in `itemNumberByComponentPath(rows)`. Reuse the fixture style from `aggregateBomRecursive`/`computePartsListRows` specs.
```typescript
it('nested .ziasm leaf paths appear in the map (same key space as projection)', () => {
  const rows = aggregateBomRecursive(nestedAsmFixture, cacheFixture, partInfoFixture);
  const m = itemNumberByComponentPath(rows);
  // pathKey(['subAsmCompId','leafCompId']) is the key the projector also emits.
  expect(m.has(pathKey(['sub-1', 'leaf-1']))).toBe(true);
});
```
Run: `cd packages/app && npx vitest run src/drawing/__tests__/componentItemNumbers.spec.ts && npx tsc --noEmit`
Expected: PASS; tsc clean.
```bash
git add packages/app/src/drawing/componentItemNumbers.ts packages/app/src/drawing/__tests__/componentItemNumbers.spec.ts
git commit -m "feat(drawing): componentItemNumbers resolver (M3.1 task 4)"
```

---

### Task 5: Manual `addBalloon` click handler

**Files:**
- Modify: `packages/app/src/drawing/DrawingCanvas.tsx` (replace stub ~:966)
- Test: `packages/app/src/drawing/__tests__/DrawingCanvas.addBalloon.spec.tsx` (new) — mirror the existing `addCenterMark` click test pattern.

**Interfaces:**
- Consumes: `Edge2D.componentPath` (Task 1/3), `itemNumberByComponentPath` (Task 4), `AddDrawingAnnotationCommand`.
- Produces: clicking an edge in `addBalloon` mode dispatches `AddDrawingAnnotationCommand` with a `balloon` annotation whose `itemNumber` is resolved from the clicked edge's component.

- [ ] **Step 1: Write the failing test**

Mirror the existing center-mark click test (find it in the DrawingCanvas test suite). Drive a click in `addBalloon` mode where the hit edge has a known `componentPath`, with a store assembly whose BOM gives that path item number 1. Assert a balloon command was dispatched with `itemNumber: 1` and `targetMm` at the click point. Keep the harness identical to the center-mark test (same store seed, same `bus` spy).

```typescript
it('addBalloon click dispatches a balloon with the clicked part item number', async () => {
  // seed store: assembly with one component → BOM item 1; sheet with one assembly view
  // whose projection has a visible edge tagged componentPath = pathKey(['c1']).
  useToolModeStore.getState().setMode('addBalloon');
  // simulate a click on that edge (reuse the test util the center-mark test uses)
  fireEdgeClick({ edgeId: 'v1_e1_0', viewId: 'v1', svgX: 100, svgY: 80 });
  await flush();
  const cmd = busExecuteSpy.mock.calls.at(-1)?.[0];
  expect(cmd).toBeInstanceOf(AddDrawingAnnotationCommand);
  expect(cmd.opts.ann).toMatchObject({ kind: 'balloon', viewId: 'v1', itemNumber: 1 });
  expect(cmd.opts.ann.targetMm).toEqual({ x: 100, y: 80 });
});

it('addBalloon click on an untagged/unresolvable edge does not dispatch', async () => {
  useToolModeStore.getState().setMode('addBalloon');
  fireEdgeClick({ edgeId: 'v1_untagged_0', viewId: 'v1', svgX: 10, svgY: 10 });
  await flush();
  expect(busExecuteSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/DrawingCanvas.addBalloon.spec.tsx`
Expected: FAIL — stub dispatches nothing.

- [ ] **Step 3: Implement the handler (replace the stub ~:966)**

```typescript
if (toolMode === 'addBalloon') {
  const liveDrw = useAppStore.getState().activeDrawing;
  const liveSheet = liveDrw?.sheets.find((s) => s.id === liveDrw.activeSheetId) ?? liveDrw?.sheets[0];
  const asm = useAppStore.getState().activeDrawingSourceDocument;
  const srcAsm = asm && 'components' in asm ? asm : useAppStore.getState().activeAssembly;
  if (!liveDrw || !liveSheet || !srcAsm || !edgeId) { setClickAccum([]); return; }

  const v = liveSheet.views.find((vw) => vw.id === viewId) ?? liveSheet.views[0];
  const proj = v?.projection;
  const edge = proj && [...proj.visibleEdges, ...proj.hiddenEdges].find((e) => e.id === edgeId);
  const cp = edge?.componentPath;

  const subAsmDocs = useAppStore.getState().subAssemblyDocs;
  const cacheAdapter = { get: (p: string) => subAsmDocs[p]
    ? { kind: 'ok' as const, doc: subAsmDocs[p]!, partPath: p } : undefined };
  const rows = aggregateBomRecursive(srcAsm, cacheAdapter,
    partInfoCacheRef.current ?? new Map());
  const item = cp ? itemNumberByComponentPath(rows).get(cp) : undefined;

  if (item === undefined) {
    setStatus?.('Regenerate the view to balloon its parts.'); // use the project's status setter
    setClickAccum([]); return;
  }
  void bus.execute(new AddDrawingAnnotationCommand({
    sheetId: liveSheet.id,
    ann: {
      id: `ann-${Date.now()}`, kind: 'balloon', viewId: v!.id,
      targetMm: { x: svgX, y: svgY },
      textPosMm: { x: svgX + 12, y: svgY - 12 },
      itemNumber: item,
    },
  }));
  setClickAccum([]);
  return;
}
```
Add imports for `aggregateBomRecursive` and `itemNumberByComponentPath`. Use the existing status setter the file already uses (match the pattern used elsewhere in DrawingCanvas; if none, drop the status line and just no-op).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/DrawingCanvas.addBalloon.spec.tsx`
Expected: PASS (both cases).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
```bash
git add packages/app/src/drawing/DrawingCanvas.tsx packages/app/src/drawing/__tests__/DrawingCanvas.addBalloon.spec.tsx
git commit -m "feat(drawing): manual balloon placement resolves item from clicked part (M3.1 task 5)"
```

---

### Task 6: `autoBalloonSheet` — anchored auto-balloons

**Files:**
- Create: `packages/app/src/drawing/autoBalloonSheet.ts`
- Test: `packages/app/src/drawing/__tests__/autoBalloonSheet.spec.ts` (new)

**Interfaces:**
- Consumes: `representativePathByItem` (Task 4), `Edge2D.componentPath`, a `DrawingSheet`, the assembly + cache + partInfo + panelSpecs to run `computePartsListRows`.
- Produces: `autoBalloonSheet(args): BalloonAnnotation[]` — one balloon per parts-list row, `targetMm` = component bbox center (sheet space) in the view where it has the most edges, `textPosMm` laddered in a column.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/drawing/__tests__/autoBalloonSheet.spec.ts
import { describe, it, expect } from 'vitest';
import { autoBalloonSheet } from '../autoBalloonSheet';

// Build a sheet with one assembly base view at positionMm {x:50,y:50}, scale 1:1,
// whose projection has edges tagged for components mapping to items 1 and 2.
// Provide a partsList-source (asm + cache + partInfo) yielding 2 rows.
describe('autoBalloonSheet', () => {
  it('produces one balloon per parts-list row with correct item numbers', () => {
    const balloons = autoBalloonSheet(ARGS);
    expect(balloons).toHaveLength(2);
    expect(new Set(balloons.map((b) => b.itemNumber))).toEqual(new Set([1, 2]));
    for (const b of balloons) expect(b.kind).toBe('balloon');
  });

  it('anchors targetMm to the component bbox center in sheet space', () => {
    const balloons = autoBalloonSheet(ARGS);
    const b1 = balloons.find((b) => b.itemNumber === 1)!;
    // component 1 edges span view-local x[0..10] y[0..10] → center (5,5);
    // sheet = positionMm(50,50) + center*scale(1) = (55,55)
    expect(b1.targetMm).toEqual({ x: 55, y: 55 });
  });

  it('ladders text positions so balloons do not overlap', () => {
    const balloons = autoBalloonSheet(ARGS);
    const ys = balloons.map((b) => b.textPosMm.y);
    expect(new Set(ys).size).toBe(ys.length); // all distinct
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/autoBalloonSheet.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/app/src/drawing/autoBalloonSheet.ts
import type { DrawingSheet, DrawingView } from '@zilventor/shared';
import type { AssemblyDocument, PartInfo } from '@zilventor/shared';
import { aggregateBomRecursive } from '../assembly/walkers/aggregateBomRecursive';
import { computePartsListRows } from './computePartsListRows';
import { representativePathByItem } from './componentItemNumbers';

type Balloon = Extract<import('@zilventor/shared').DrawingAnnotation, { kind: 'balloon' }>;
type Cache = { get: (p: string) => unknown };

const COLUMN_DX = 30;   // mm right of the view bbox
const LADDER_DY = 14;   // mm between stacked balloons

export function autoBalloonSheet(args: {
  sheet: DrawingSheet;
  asm: AssemblyDocument;
  cache: Cache;
  partInfo: Map<string, PartInfo>;
  panelSpecs: Map<string, unknown>;
}): Balloon[] {
  const { sheet, asm, cache, partInfo, panelSpecs } = args;
  const rows = computePartsListRows(asm, cache as never, panelSpecs as never, partInfo);
  const bomRows = aggregateBomRecursive(asm, cache as never, partInfo);
  const repByItem = representativePathByItem(bomRows);

  const assemblyViews = sheet.views.filter((v) => v.projection);
  if (assemblyViews.length === 0) return [];

  const result: Balloon[] = [];
  let ladder = 0;
  for (const row of rows) {
    const cp = repByItem.get(row.item);
    if (cp === undefined) continue;
    const hit = bestViewBBoxCenter(assemblyViews, cp);
    if (!hit) continue;
    const { view, cx, cy } = hit;
    const s = view.scale.numerator / view.scale.denominator;
    const targetMm = { x: view.positionMm.x + cx * s, y: view.positionMm.y + cy * s };
    const colX = view.positionMm.x + (viewLocalMaxX(view) * s) + COLUMN_DX;
    const textPosMm = { x: colX, y: view.positionMm.y + ladder * LADDER_DY };
    ladder++;
    result.push({ id: `ann-${row.item}-${Date.now()}`, kind: 'balloon',
      viewId: view.id, targetMm, textPosMm, itemNumber: row.item });
  }
  return result;
}

/** Pick the view where componentPath has the most edges; return its bbox center (view-local). */
function bestViewBBoxCenter(views: DrawingView[], cp: string):
  { view: DrawingView; cx: number; cy: number } | null {
  let best: { view: DrawingView; cx: number; cy: number; count: number } | null = null;
  for (const view of views) {
    const proj = view.projection!;
    const pts: Array<readonly [number, number]> = [];
    for (const e of [...proj.visibleEdges, ...proj.hiddenEdges]) {
      if (e.componentPath === cp) pts.push(...e.points);
    }
    if (pts.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const count = pts.length;
    if (!best || count > best.count) {
      best = { view, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, count };
    }
  }
  return best ? { view: best.view, cx: best.cx, cy: best.cy } : null;
}

function viewLocalMaxX(view: DrawingView): number {
  const proj = view.projection!;
  let maxX = 0;
  for (const e of [...proj.visibleEdges, ...proj.hiddenEdges]) {
    for (const [x] of e.points) if (x > maxX) maxX = x;
  }
  return maxX;
}
```
(Adjust the `Cache`/`panelSpecs` typing to the real `SubAsmCacheLike`/`PanelSpec` types `computePartsListRows` expects — copy them from its signature.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/drawing/__tests__/autoBalloonSheet.spec.ts`
Expected: PASS (all three).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
```bash
git add packages/app/src/drawing/autoBalloonSheet.ts packages/app/src/drawing/__tests__/autoBalloonSheet.spec.ts
git commit -m "feat(drawing): autoBalloonSheet anchors balloons to part bbox centers (M3.1 task 6)"
```

---

### Task 7: `AutoBalloonCommand` (batch add/revert)

**Files:**
- Create: `packages/app/src/commands/AutoBalloonCommand.ts`
- Test: `packages/app/src/commands/__tests__/AutoBalloonCommand.spec.ts` (new)

**Interfaces:**
- Consumes: `Balloon[]` (Task 6 output), the same store-mutation pattern as `AddDrawingAnnotationCommand`.
- Produces: `new AutoBalloonCommand({ sheetId, balloons })` with `apply()` appending all balloons and `revert()` removing them — one undo step.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/app/src/commands/__tests__/AutoBalloonCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AutoBalloonCommand } from '../AutoBalloonCommand';
import { useAppStore } from '../../store/useAppStore';
// reuse makeDrawingDoc from AddDrawingAnnotationCommand.spec helpers

describe('AutoBalloonCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingDoc() } } as never);
  });
  const balloons = [
    { id: 'b1', kind: 'balloon', viewId: 'v1', targetMm: { x: 1, y: 1 }, textPosMm: { x: 2, y: 2 }, itemNumber: 1 },
    { id: 'b2', kind: 'balloon', viewId: 'v1', targetMm: { x: 3, y: 3 }, textPosMm: { x: 4, y: 4 }, itemNumber: 2 },
  ] as never;

  it('apply appends all balloons to the sheet', async () => {
    await new AutoBalloonCommand({ sheetId: 'sh1', balloons }).apply();
    const doc = (useAppStore.getState().activeDocument as never).document;
    expect(doc.sheets[0].annotations).toHaveLength(2);
  });
  it('revert removes exactly the balloons it added', async () => {
    const cmd = new AutoBalloonCommand({ sheetId: 'sh1', balloons });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as never).document;
    expect(doc.sheets[0].annotations).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run src/commands/__tests__/AutoBalloonCommand.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (mirror `AddDrawingAnnotationCommand`)**

Read `AddDrawingAnnotationCommand.ts` and copy its `drawingDocState` helper + structure. Apply appends `balloons`; revert filters out their ids.
```typescript
// packages/app/src/commands/AutoBalloonCommand.ts
import type { Command } from './Command'; // match the real Command interface
import type { DrawingAnnotation } from '@zilventor/shared';
import { /* drawingDocState or the helpers AddDrawingAnnotationCommand uses */ } from './AddDrawingAnnotationCommand';

export class AutoBalloonCommand implements Command {
  constructor(private readonly opts: {
    sheetId: string;
    balloons: ReadonlyArray<Extract<DrawingAnnotation, { kind: 'balloon' }>>;
  }) {}
  readonly name = 'AutoBalloon';
  async apply() { /* append all opts.balloons to sheet.annotations via drawingDocState */ }
  async revert() { /* remove annotations whose id ∈ opts.balloons.map(b=>b.id) */ }
}
```
(Implement `apply`/`revert` exactly like `AddDrawingAnnotationCommand` but over the array. If `AddDrawingAnnotationCommand` keeps `drawingDocState` private, lift it into a shared `drawingDocState.ts` and import from both — small refactor, keep behavior identical.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run src/commands/__tests__/AutoBalloonCommand.spec.ts`
Expected: PASS (both).

- [ ] **Step 5: Typecheck + commit**

Run: `cd packages/app && npx tsc --noEmit`
```bash
git add packages/app/src/commands/AutoBalloonCommand.ts packages/app/src/commands/__tests__/AutoBalloonCommand.spec.ts packages/app/src/commands/AddDrawingAnnotationCommand.ts
git commit -m "feat(commands): AutoBalloonCommand batch add/revert (M3.1 task 7)"
```

---

### Task 8: "Auto-balloon" button + §6 e2e

**Files:**
- Modify: `packages/app/src/shell/tabs/DrawingTab.tsx` (Annotate panel ~:239; i18n keys en/uk)
- Create: `packages/app/tests/e2e/balloons.spec.ts`

**Interfaces:**
- Consumes: `autoBalloonSheet` (Task 6), `AutoBalloonCommand` (Task 7), the store's bus.
- Produces: a ribbon button that generates + dispatches auto-balloons; disabled unless the source is an assembly.

- [ ] **Step 1: Add the button (unit-test the wiring first)**

Write `packages/app/src/shell/tabs/__tests__/DrawingTab.autoBalloon.spec.tsx`: render `DrawingTab` with an assembly-source drawing in the store, click the "Auto-balloon" button, assert `bus.execute` was called with an `AutoBalloonCommand`. (Mirror the existing partsList/balloon button test in this file's suite.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/DrawingTab.autoBalloon.spec.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement the button**

In the Annotate `RibbonPanel` (~:239), next to the balloon-tool button:
```tsx
<button
  type="button"
  disabled={!isAssembly}
  onClick={() => {
    const drw = useAppStore.getState().activeDrawing;
    const sheet = drw?.sheets.find((s) => s.id === drw.activeSheetId) ?? drw?.sheets[0];
    const asm = useAppStore.getState().activeDrawingSourceDocument as AssemblyDocument | undefined
      ?? useAppStore.getState().activeAssembly ?? undefined;
    if (!sheet || !asm) return;
    const subAsmDocs = useAppStore.getState().subAssemblyDocs;
    const cache = { get: (p: string) => subAsmDocs[p]
      ? { kind: 'ok' as const, doc: subAsmDocs[p]!, partPath: p } : undefined };
    const balloons = autoBalloonSheet({ sheet, asm, cache,
      partInfo: /* partInfo cache */ new Map(), panelSpecs: /* panelSpec cache */ new Map() });
    if (balloons.length > 0) void bus.execute(new AutoBalloonCommand({ sheetId: sheet.id, balloons }));
  }}
>
  {t('ribbon.drawing.autoBalloon')}
</button>
```
Add i18n keys `ribbon.drawing.autoBalloon` to `en.json` ("Auto-balloon") and `uk.json` (Ukrainian). Source `partInfo`/`panelSpecs` from the same caches `DrawingTab`/`DrawingCanvas` already use for the parts-list button.

- [ ] **Step 4: Run unit test + typecheck**

Run: `cd packages/app && npx vitest run src/shell/tabs/__tests__/DrawingTab.autoBalloon.spec.tsx && npx tsc --noEmit`
Expected: PASS; tsc clean.

- [ ] **Step 5: Write the §6 e2e (real browser)**

```typescript
// packages/app/tests/e2e/balloons.spec.ts
import { test, expect } from '@playwright/test';
// Reuse the e2e helper that opens an assembly + creates a drawing with a base view
// and a parts list (mirror an existing drawing e2e, e.g. partsList/holeTable e2e).
test('auto-balloon creates one balloon per parts-list row', async ({ page }) => {
  await page.goto('/');
  // ...open assembly, create drawing sheet + base view, place a parts list...
  // count parts-list rows via the rendered table or the store:
  const rowCount = await page.evaluate(() => {
    const st = (window as any).__zilventorStore.getState();
    const drw = st.activeDrawing;
    const pl = drw.sheets[0].annotations.find((a: any) => a.kind === 'partsList');
    return pl.rows.length;
  });
  // click Auto-balloon ribbon button
  await page.getByRole('button', { name: /auto-balloon/i }).click();
  const balloonCount = await page.evaluate(() => {
    const drw = (window as any).__zilventorStore.getState().activeDrawing;
    return drw.sheets[0].annotations.filter((a: any) => a.kind === 'balloon').length;
  });
  expect(balloonCount).toBe(rowCount);
  expect(balloonCount).toBeGreaterThan(0);
});
```
Also add a manual-placement assertion: set tool mode `addBalloon`, click a known edge, assert a balloon annotation with the expected `itemNumber` appears in the store.

- [ ] **Step 6: Run the e2e**

Run: `npx playwright test tests/e2e/balloons.spec.ts --project=chromium` (from `packages/app` or repo root per project convention)
Expected: PASS. Capture/read any screenshot the test takes.

- [ ] **Step 7: Full app suite + commit + push**

Run: `cd packages/app && npx vitest run && npx tsc --noEmit`
Expected: all green; tsc clean (note the 1 pre-existing `PlaceComponentCommand "cycle"` locale flake is not ours).
```bash
git add packages/app/src/shell/tabs/DrawingTab.tsx packages/app/src/shell/tabs/__tests__/DrawingTab.autoBalloon.spec.tsx packages/app/tests/e2e/balloons.spec.ts packages/app/src/i18n/locales/en.json packages/app/src/i18n/locales/uk.json
git commit -m "feat(drawing): Auto-balloon ribbon button + e2e (M3.1 task 8)"
git push
```

---

## Self-Review

**Spec coverage:**
- §3 tagging foundation → Tasks 1–3. ✓
- §3 reuse-walker resolution → Task 4. ✓
- §4/§5 manual balloon → Task 5. ✓
- §4/§5 auto-balloon anchoring → Task 6. ✓
- §4 batch command → Task 7. ✓
- §4 toolbar button + §7 §6 e2e → Task 8. ✓
- §6 no format bump → Global Constraints. ✓
- §7 Phase-0 (sheet-space coords, nested key-space) → resolved by trace; nested key-space guarded by Task 4 Step 5. ✓

**Placeholder scan:** Test bodies reference fixture builders (`makeDrawingDoc`, `fireEdgeClick`, e2e open-assembly helper) and a few `ARGS`/`EXPECTED_LEAF_PATH` constants that the implementer fills from the existing sibling specs — these are pointers to real, named existing helpers, not vague TODOs. Each task names the sibling test to mirror.

**Type consistency:** `componentPath?: string` identical across `EdgeMesh3D`/`Edge3D`/`Edge2D` (×2 decls). `itemNumberByComponentPath`/`representativePathByItem` names consistent Tasks 4→5→6. `AutoBalloonCommand({sheetId, balloons})` consistent Tasks 7→8. `AssemblyComponentInput.componentPath` (required) consistent Tasks 2→3.

**Risk to watch during execution:** Task 2 makes `AssemblyComponentInput.componentPath` **required** — this will surface every existing call site (kernel internals + any test fixtures building assembly projector input). Fix them in Task 2 (set a real path or `''` in pure-fixture cases) so tsc stays green before Task 3.
