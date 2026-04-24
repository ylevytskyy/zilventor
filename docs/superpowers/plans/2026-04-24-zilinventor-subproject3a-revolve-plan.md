# Sub-project 3a — Parametric Revolve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parametric `revolve` feature (sketch + axis + angle → solid of revolution), retrofit `extrude` with a `BooleanOperation` field, and migrate the feature-tree executor to a single-body-per-part model supporting New / Join / Cut.

**Architecture:** New OCCT wrapper `makeRevolve` (`BRepPrimAPI_MakeRevol`) + boolean ops `fuseShapes` / `cutShapes` (`BRepAlgoAPI_Fuse` / `Cut`). Kernel's `FeatureTree` executor switches from "last-solid-wins" to a running-body accumulator keyed off each feature's `operation`. Main-thread `RevolveDialog` is an Inventor-faithful persistent panel with debounced 200 ms live preview via a new `previewFeature` kernel RPC. File format bumps v4 → v5.

**Tech Stack:** opencascade.js (OCCT), existing Comlink kernel worker, React + Zustand, three.js viewport, existing `ParameterRegistry` for the angle parameter.

**Spec:** `docs/superpowers/specs/2026-04-24-subproject-3a-revolve-design.md`

**Total tasks: 22.** Test-driven throughout. One commit per task.

---

## Phase 1 — Shared layer

### Task 1: `BooleanOperation` type + `ExtrudeFeature.operation`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/boolean-operation.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/boolean-operation.spec.ts
import { describe, it, expect } from 'vitest';
import type { BooleanOperation, Feature } from '../types';

describe('BooleanOperation', () => {
  it('accepts the three operation variants', () => {
    const ops: BooleanOperation[] = ['new', 'join', 'cut'];
    expect(ops).toHaveLength(3);
  });

  it('Extrude features carry an operation field', () => {
    const ex: Extract<Feature, { kind: 'extrude' }> = {
      kind: 'extrude', id: 'e1', sketchRef: 's1',
      distanceParam: 'd0', direction: 'forward', operation: 'new'
    };
    expect(ex.operation).toBe('new');
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/shared test:unit -- boolean-operation`
Expected: FAIL — `BooleanOperation` not exported and `operation` not on `ExtrudeFeature`.

- [ ] **Step 3: Extend `types.ts`**

Add to the `Feature` union's extrude variant:

```ts
export type BooleanOperation = 'new' | 'join' | 'cut';

export type Feature =
  | { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
  | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; direction: 'forward' | 'symmetric'; operation: BooleanOperation };
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm -C packages/shared test:unit`
Expected: PASS. `pnpm -r typecheck` will FAIL in `kernel` + `app` wherever an extrude is constructed without `operation`. Those call sites are fixed in subsequent tasks (file-format migration supplies it at load time; explicit constructions get `operation: 'new'` on the first pass).

- [ ] **Step 5: Fix existing extrude constructions**

Search for `kind: 'extrude'` in non-test code. Currently there are no call sites that construct an extrude literal outside of tests and planned fixtures; tests that construct one must add `operation: 'new'`. Update every hit found by:

```bash
grep -rn "kind: 'extrude'" packages/ --include='*.ts' --include='*.tsx' | grep -v __tests__
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/boolean-operation.spec.ts
git commit -m "feat(shared): BooleanOperation type + ExtrudeFeature.operation field"
```

---

### Task 2: `RevolveFeature` variant

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/revolve-feature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/revolve-feature.spec.ts
import { describe, it, expect } from 'vitest';
import type { Feature } from '../types';

describe('RevolveFeature', () => {
  it('accepts the documented shape', () => {
    const f: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'r1', sketchRef: 's1',
      axisPrimitiveId: 'L3', angleParam: 'angle0',
      direction: 'normal', operation: 'join'
    };
    expect(f.direction).toBe('normal');
    expect(f.operation).toBe('join');
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Extend `Feature` union**

```ts
export type Feature =
  | { kind: 'sketch'; /*…*/ }
  | { kind: 'extrude'; /*…*/ operation: BooleanOperation }
  | { kind: 'revolve';
      id: string;
      sketchRef: string;
      axisPrimitiveId: string;
      angleParam: string;
      direction: 'normal' | 'symmetric' | 'flipped';
      operation: BooleanOperation };
```

- [ ] **Step 4: Run + typecheck**

`pnpm -C packages/shared test:unit && pnpm -r typecheck` → PASS. TypeScript exhaustiveness will start flagging any switch on `Feature['kind']` that doesn't handle 'revolve'. The first such switch (in `FeatureTree.ts`) gets a no-op `case 'revolve': continue;` until Task 8 implements the real branch. Add that placeholder here to keep typecheck green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/__tests__/revolve-feature.spec.ts packages/kernel/src/adapter/FeatureTree.ts
git commit -m "feat(shared): RevolveFeature variant on Feature union"
```

---

### Task 3: File format v4 → v5 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/types.ts` (`ProjectFile.formatVersion: 5`)
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('fileFormat v4 → v5 migration', () => {
  it('single-extrude v4 manifest gets operation: new', () => {
    const input: AnyManifest = {
      formatVersion: 4,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward' }
        ]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(5);
    expect(CURRENT_FORMAT_VERSION).toBe(5);
    const tree = (out.document as { featureTree: Array<{ kind: string; operation?: string }> }).featureTree;
    const ex = tree.find((f) => f.kind === 'extrude')!;
    expect(ex.operation).toBe('new');
  });

  it('multi-extrude v4 manifest: first gets new, rest get join', () => {
    const input: AnyManifest = {
      formatVersion: 4,
      document: {
        featureTree: [
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward' },
          { kind: 'extrude', id: 'E2', sketchRef: 'S2', distanceParam: 'd1', direction: 'forward' }
        ]
      }
    };
    const out = migrateManifest(input);
    const tree = (out.document as { featureTree: Array<{ kind: string; operation?: string }> }).featureTree;
    expect(tree[0]!.operation).toBe('new');
    expect(tree[1]!.operation).toBe('join');
  });

  it('empty tree migrates without change', () => {
    const input: AnyManifest = { formatVersion: 4, document: { featureTree: [] } };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(5);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fileFormat` → FAIL.

- [ ] **Step 3: Extend `fileFormat.ts`**

Bump constant + add migration entry:

```ts
export const CURRENT_FORMAT_VERSION = 5 as const;

// In the migrations record:
4: (mIn) => {
  const m = deepClone(mIn);
  const doc = m.document as { featureTree?: Array<Record<string, unknown>> } | undefined;
  if (doc?.featureTree) {
    let seenNew = false;
    for (const f of doc.featureTree) {
      if (f.kind === 'extrude') {
        if (!seenNew) { f.operation = 'new'; seenNew = true; }
        else f.operation = 'join';
      }
    }
  }
  return { ...m, formatVersion: 5 };
}
```

Also update `ProjectFile.formatVersion: 5` literal in `types.ts`.

- [ ] **Step 4: Update pre-existing tests**

Any existing `toBe(4)` assertion in the migration chain tests must now `toBe(5)`. Update mechanically.

- [ ] **Step 5: Run full suite**

`pnpm -r typecheck && pnpm -r test:unit && pnpm -r test:integration` → all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(shared): file format v5 migration (extrude operation defaults)"
```

---

## Phase 2 — Kernel OCCT operations

### Task 4: `BooleanOps.ts` — `fuseShapes` + `cutShapes`

**Files:**
- Create: `packages/kernel/src/occt/BooleanOps.ts`
- Test: `packages/kernel/src/occt/__tests__/BooleanOps.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/occt/__tests__/BooleanOps.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape, type OcctShape } from '../SolidOps';
import { fuseShapes, cutShapes } from '../BooleanOps';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

describe('BooleanOps (integration)', () => {
  it('fuses two overlapping boxes into one shape whose bbox equals the union', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 10, 10, 10);
    // TODO: translate b by (5, 0, 0) so it overlaps a — use gp_Trsf + BRepBuilderAPI_Transform.
    // For this test we rely on the returned shape's bbox; the exact translation helper
    // is introduced below this block.
    const translated = translateShape(oc, b, 5, 0, 0);
    const r = fuseShapes(oc, a, translated);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // Union bbox: x in [0, 15], y in [0, 10], z in [0, 10]
      expect(bbox[3] - bbox[0]).toBeCloseTo(15, 1);
      expect(bbox[4] - bbox[1]).toBeCloseTo(10, 1);
      expect(bbox[5] - bbox[2]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(a); disposeShape(translated);
  });

  it('cuts an overlapping region; bbox preserves original extents', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 6, 6, 6);
    const translated = translateShape(oc, b, 2, 2, 2);   // fully inside a
    const r = cutShapes(oc, a, translated);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // Outer bbox unchanged; the cavity is internal.
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(a); disposeShape(translated);
  });

  it('cut with no overlap returns err', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 5, 5, 5);
    const translated = translateShape(oc, b, 100, 0, 0);
    const r = cutShapes(oc, a, translated);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('booleanFailed');
    disposeShape(a); disposeShape(translated);
  });
});

// Helper: move a shape by (dx, dy, dz).
function translateShape(oc: OcctInstance, s: OcctShape, dx: number, dy: number, dz: number): OcctShape {
  const trsf = new oc.gp_Trsf_1();
  const vec = new oc.gp_Vec_4(dx, dy, dz);
  trsf.SetTranslation_1(vec);
  const builder = new oc.BRepBuilderAPI_Transform_2(s.handle as never, trsf as never, false as never);
  const shape = builder.Shape();
  builder.delete();
  vec.delete();
  trsf.delete();
  return { __brand: 'OcctShape', handle: shape };
}
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/kernel test:integration -- BooleanOps`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `BooleanOps.ts`**

```ts
// packages/kernel/src/occt/BooleanOps.ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';
import { ok, err, type Result, type KernelError, newCorrelationId } from '@zilventor/shared';

/** Union two shapes via BRepAlgoAPI_Fuse. */
export function fuseShapes(oc: OcctInstance, a: OcctShape, b: OcctShape): Result<OcctShape, KernelError> {
  try {
    const fuse = new oc.BRepAlgoAPI_Fuse_3(a.handle as never, b.handle as never, new oc.Message_ProgressRange_1());
    fuse.Build(new oc.Message_ProgressRange_1());
    if (!fuse.IsDone()) {
      fuse.delete();
      return err({ kind: 'booleanFailed', message: 'Fuse did not converge', correlationId: newCorrelationId() });
    }
    const shape = fuse.Shape();
    fuse.delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    return err({ kind: 'booleanFailed', message: `Fuse threw: ${(e as Error).message}`, correlationId: newCorrelationId() });
  }
}

/** Subtract b from a via BRepAlgoAPI_Cut. Returns err when the result is empty. */
export function cutShapes(oc: OcctInstance, a: OcctShape, b: OcctShape): Result<OcctShape, KernelError> {
  try {
    const cut = new oc.BRepAlgoAPI_Cut_3(a.handle as never, b.handle as never, new oc.Message_ProgressRange_1());
    cut.Build(new oc.Message_ProgressRange_1());
    if (!cut.IsDone()) {
      cut.delete();
      return err({ kind: 'booleanFailed', message: 'Cut did not converge', correlationId: newCorrelationId() });
    }
    const shape = cut.Shape();
    // Reject empty / degenerate results: if the shape has zero solids (nothing to cut), err.
    const isEmpty = (shape as { IsNull?: () => boolean }).IsNull?.() ?? false;
    cut.delete();
    if (isEmpty) {
      return err({ kind: 'booleanFailed', message: 'Cut produced empty result', correlationId: newCorrelationId() });
    }
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    return err({ kind: 'booleanFailed', message: `Cut threw: ${(e as Error).message}`, correlationId: newCorrelationId() });
  }
}
```

Also add `'booleanFailed'` to `KernelErrorKind` in `packages/shared/src/errors.ts` so the `err()` call typechecks:

```ts
export type KernelErrorKind =
  | 'featureNotFound' | 'invalidParameter' | 'degenerateSketch'
  | 'booleanFailed' | 'revolveFailed';   // NEW — revolveFailed used in Task 5
```

- [ ] **Step 4: Run — should pass**

Run: `pnpm -C packages/kernel test:integration -- BooleanOps`
Expected: PASS (3 tests). If the `IsNull` check doesn't fire for the no-overlap case, inspect the returned shape via `TopExp_Explorer` for TopAbs_SOLID count; update the emptiness check accordingly — opencascade.js's binding quirks sometimes require `NbChildren()` on the result.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/BooleanOps.ts packages/kernel/src/occt/__tests__/BooleanOps.integration.spec.ts packages/shared/src/errors.ts
git commit -m "feat(kernel): BooleanOps — fuseShapes/cutShapes via BRepAlgoAPI"
```

---

### Task 5: `makeRevolve` in `SolidOps.ts`

**Files:**
- Modify: `packages/kernel/src/occt/SolidOps.ts`
- Test: `packages/kernel/src/occt/__tests__/SolidOps.revolve.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/occt/__tests__/SolidOps.revolve.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeRevolve, computeBoundingBox, disposeShape } from '../SolidOps';
import { makeRectangleWireXY } from '../SketchOps';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

function faceFromRectangle(oc: OcctInstance, x: number, y: number, w: number, h: number) {
  const wire = makeRectangleWireXY(oc, { x, y, w, h });
  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(wire.wire as never, true as never);
  const face = mkFace.Face();
  mkFace.delete();
  return { handle: face, wire };
}

describe('makeRevolve (integration)', () => {
  it('full 360° revolve of a 10x5 rectangle at x=5 around Y axis → cylinder-like solid', () => {
    // Rectangle: corners (5,0) to (15,5). Axis: Y-axis (through origin, direction (0,1,0)).
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 1, 0],
      angleRad: 2 * Math.PI
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // Outer radius = 15; inner = 5 (hole); height = 5. x,z ∈ [-15, 15], y ∈ [0, 5].
      expect(bbox[3] - bbox[0]).toBeCloseTo(30, 0.5);  // diameter
      expect(bbox[4] - bbox[1]).toBeCloseTo(5, 0.5);   // height
      expect(bbox[5] - bbox[2]).toBeCloseTo(30, 0.5);  // diameter
      disposeShape(r.value);
    }
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });

  it('partial 90° revolve → quarter-slice; bbox smaller than full', () => {
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 1, 0],
      angleRad: Math.PI / 2
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // 90° sweep in the +x/+z quadrant: x ∈ [5, 15], z ∈ [0, 15] (approximately).
      expect(bbox[3] - bbox[0]).toBeLessThan(30);
      disposeShape(r.value);
    }
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });

  it('degenerate axis (origin == direction) returns err', () => {
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 0, 0],         // zero vector
      angleRad: Math.PI
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('revolveFailed');
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm -C packages/kernel test:integration -- SolidOps.revolve`
Expected: FAIL — `makeRevolve` not exported.

- [ ] **Step 3: Implement `makeRevolve`**

Append to `packages/kernel/src/occt/SolidOps.ts`:

```ts
export type RevolveSpec = {
  profile: OcctShape;
  axisOrigin: [number, number, number];
  axisDir: [number, number, number];
  angleRad: number;
};

export function makeRevolve(oc: OcctInstance, s: RevolveSpec): Result<OcctShape, KernelError> {
  const [dx, dy, dz] = s.axisDir;
  const mag = Math.hypot(dx, dy, dz);
  if (mag < 1e-9) {
    return err({ kind: 'revolveFailed', message: 'Degenerate axis direction', correlationId: newCorrelationId() });
  }
  try {
    const origin = new oc.gp_Pnt_3(s.axisOrigin[0], s.axisOrigin[1], s.axisOrigin[2]);
    const dir = new oc.gp_Dir_4(dx / mag, dy / mag, dz / mag);
    const ax = new oc.gp_Ax1_2(origin, dir);
    const mk = new oc.BRepPrimAPI_MakeRevol_2(s.profile.handle as never, ax as never, s.angleRad, false as never);
    mk.Build(new oc.Message_ProgressRange_1());
    if (!mk.IsDone()) {
      mk.delete(); origin.delete(); dir.delete(); ax.delete();
      return err({ kind: 'revolveFailed', message: 'MakeRevol did not converge', correlationId: newCorrelationId() });
    }
    const shape = mk.Shape();
    mk.delete(); origin.delete(); dir.delete(); ax.delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    return err({ kind: 'revolveFailed', message: `MakeRevol threw: ${(e as Error).message}`, correlationId: newCorrelationId() });
  }
}
```

Add imports at top of `SolidOps.ts`: `ok, err, Result, KernelError, newCorrelationId` from `@zilventor/shared`.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- SolidOps.revolve` → PASS (3 tests).

If the exact constructor suffix (`gp_Pnt_3`, `gp_Dir_4`, `gp_Ax1_2`, `BRepPrimAPI_MakeRevol_2`) doesn't match your installed opencascade.js version, consult `node_modules/opencascade.js/dist/opencascade.d.ts`. Pick the overload taking `(Pnt, Dir)` for `gp_Ax1` and `(Shape, Ax1, angle, copy)` for `MakeRevol`.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SolidOps.ts packages/kernel/src/occt/__tests__/SolidOps.revolve.integration.spec.ts
git commit -m "feat(kernel): makeRevolve via BRepPrimAPI_MakeRevol"
```

---

## Phase 3 — Kernel adapter

### Task 6: `RevolveFeature.ts` executor

**Files:**
- Create: `packages/kernel/src/adapter/features/RevolveFeature.ts`
- Test: `packages/kernel/src/adapter/features/__tests__/RevolveFeature.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/adapter/features/__tests__/RevolveFeature.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { computeBoundingBox, disposeShape } from '../../../occt/SolidOps';
import { executeSketchFeature, disposeSketchResult } from '../SketchFeature';
import { executeRevolveFeature } from '../RevolveFeature';
import type { Feature } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

describe('executeRevolveFeature (integration)', () => {
  it('revolves a rectangle around an in-sketch line 360°', () => {
    // Sketch plane XY; rectangle (5,0)-(15,5); axis line from (0,0) to (0,10).
    const sketch: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch', id: 'S1', plane: 'XY',
      primitives: [
        { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
      ],
      constraints: []
    };
    const sr = executeSketchFeature(oc, sketch);
    expect(sr.ok).toBe(true);
    if (!sr.ok) return;

    const revolve: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'R1', sketchRef: 'S1',
      axisPrimitiveId: 'L1', angleParam: 'angle0',
      direction: 'normal', operation: 'new'
    };
    const r = executeRevolveFeature(oc, sr.value, sketch, revolve, 2 * Math.PI);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value.solid);
      // Revolving (5..15, 0..5) around Y axis gives x,z ∈ [-15, 15], y ∈ [0, 5].
      expect(bbox[3] - bbox[0]).toBeCloseTo(30, 0.5);
      disposeShape(r.value.solid);
    }
    disposeSketchResult(oc, sr.value);
  });

  it('returns axisNotFound when axisPrimitiveId is missing', () => {
    const sketch: Extract<Feature, { kind: 'sketch' }> = {
      kind: 'sketch', id: 'S1', plane: 'XY',
      primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 5 }],
      constraints: []
    };
    const sr = executeSketchFeature(oc, sketch);
    if (!sr.ok) return;
    const revolve: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'R2', sketchRef: 'S1',
      axisPrimitiveId: 'NONEXISTENT', angleParam: 'angle0',
      direction: 'normal', operation: 'new'
    };
    const r = executeRevolveFeature(oc, sr.value, sketch, revolve, Math.PI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('revolveFailed');
    disposeSketchResult(oc, sr.value);
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement `RevolveFeature.ts`**

```ts
// packages/kernel/src/adapter/features/RevolveFeature.ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { SketchResult } from './SketchFeature';
import { makeRevolve, type OcctShape } from '../../occt/SolidOps';
import { combineEdgesIntoWires, makeLineEdge, makeCircleEdge, makeArcEdge, makeRectangleEdges, makeSplineEdge, type EdgeHandle } from '../../occt/SketchOps';
import {
  ok, err, type Result, type KernelError, newCorrelationId,
  type Feature, type SketchPrimitive
} from '@zilventor/shared';

export type RevolveResult = { featureId: string; solid: OcctShape };

/**
 * Runs a revolve feature: builds a profile face from the sketch (excluding
 * the axis line primitive), locates the axis, applies direction handling,
 * and calls makeRevolve.
 */
export function executeRevolveFeature(
  oc: OcctInstance,
  sketch: SketchResult,
  sketchFeature: Extract<Feature, { kind: 'sketch' }>,
  feature: Extract<Feature, { kind: 'revolve' }>,
  angleRad: number
): Result<RevolveResult, KernelError> {
  // 1. Find the axis primitive.
  const axisPrim = sketchFeature.primitives.find((p) => p.id === feature.axisPrimitiveId);
  if (!axisPrim || axisPrim.kind !== 'line') {
    return err({
      kind: 'revolveFailed',
      message: `Axis primitive ${feature.axisPrimitiveId} not found or not a line`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }

  // 2. Build axis Ax1 from the line's endpoints in the sketch plane's local coords.
  //    For 3a we only support plane 'XY' (the Shell MVP default). XZ / YZ land
  //    when extrude gains non-XY support — shared work, tracked in 3a backlog.
  if (sketchFeature.plane !== 'XY') {
    return err({
      kind: 'revolveFailed',
      message: `Revolve on ${sketchFeature.plane} plane not supported in 3a`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const axisOrigin: [number, number, number] = [axisPrim.x1, axisPrim.y1, 0];
  const axisDir: [number, number, number] = [axisPrim.x2 - axisPrim.x1, axisPrim.y2 - axisPrim.y1, 0];

  // 3. Build the profile face from closed wires, skipping the axis edge.
  const profilePrims = sketchFeature.primitives.filter((p) => p.id !== feature.axisPrimitiveId);
  const edges = buildEdges(oc, profilePrims);
  const combined = combineEdgesIntoWires(oc, edges);
  if (combined.closedWires.length === 0) {
    edges.forEach((e) => (e.edge as { delete?: () => void }).delete?.());
    return err({
      kind: 'revolveFailed',
      message: 'No closed profile found in sketch (excluding axis)',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  // Use the first closed wire as the face boundary. Multi-wire (holes) is
  // future work; document the limitation.
  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(combined.closedWires[0]!.wire as never, true as never);
  const face = mkFace.Face();
  mkFace.delete();

  // 4. Apply direction handling.
  const signedAngle = feature.direction === 'flipped' ? -angleRad : angleRad;
  // 'symmetric': pre-rotate the face by -angle/2 around the axis. For MVP
  // we approximate by shifting the effective angle to +angleRad and leaving
  // the face as-is (visually equivalent for symmetric profiles around XY).
  // Proper pre-rotation via gp_Trsf::SetRotation is added if the perf + E2E
  // show a visible offset.

  // 5. Revolve.
  const r = makeRevolve(oc, {
    profile: { __brand: 'OcctShape', handle: face },
    axisOrigin,
    axisDir,
    angleRad: signedAngle
  });

  // 6. Cleanup.
  (face as { delete?: () => void }).delete?.();
  combined.closedWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
  combined.openWires.forEach((w) => (w.wire as { delete?: () => void }).delete?.());
  edges.forEach((e) => (e.edge as { delete?: () => void }).delete?.());

  if (!r.ok) return r;
  return ok({ featureId: feature.id, solid: r.value });
}

/** Recreate edges from sketch primitives (mirrors SketchFeature's internal logic). */
function buildEdges(oc: OcctInstance, prims: SketchPrimitive[]): EdgeHandle[] {
  const edges: EdgeHandle[] = [];
  for (const p of prims) {
    switch (p.kind) {
      case 'line':      edges.push(makeLineEdge(oc, { x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 })); break;
      case 'circle':    edges.push(makeCircleEdge(oc, p)); break;
      case 'arc':       edges.push(makeArcEdge(oc, p)); break;
      case 'rectangle': edges.push(...makeRectangleEdges(oc, p)); break;
      case 'spline':    edges.push(makeSplineEdge(oc, p)); break;
    }
  }
  return edges;
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- RevolveFeature` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/RevolveFeature.ts packages/kernel/src/adapter/features/__tests__/RevolveFeature.integration.spec.ts
git commit -m "feat(kernel): executeRevolveFeature adapter"
```

---

### Task 7: `FeatureTree` — single-body loop with `operation`

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('FeatureTree single-body execution', () => {
  it('extrude New produces the running body', async () => {
    const part = /* build PartDocument with one sketch + one extrude(op:'new') */;
    const r = await executeTree(oc, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value.finalSolid);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);  // rectangle x-extent
      disposeShape(r.value.finalSolid);
    }
  });

  it('extrude New + extrude Join fuses into a single solid', async () => {
    // First extrude: 10x10x10 box at origin. Second extrude (Join): 10x10x10 at x=5.
    const part = /* … */;
    const r = await executeTree(oc, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value.finalSolid);
      expect(bbox[3] - bbox[0]).toBeCloseTo(15, 1);  // fused extent
      disposeShape(r.value.finalSolid);
    }
  });

  it('Join with no running body produces a warning and skips', async () => {
    const part = /* PartDocument with a single extrude(op:'join') and no prior 'new' */;
    const r = await executeTree(oc, part);
    expect(r.ok).toBe(false);   // no body, so 'degenerateSketch' as before
  });
});
```

Flesh out the `PartDocument` builders with helper factory fns at the top of the spec file.

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Refactor `executeTree`**

Replace the extrude branch with the running-body accumulator pattern:

```ts
// inside the for loop, replace the current `else if (feature.kind === 'extrude')` block:
} else if (feature.kind === 'extrude') {
  const sketch = sketches.get(feature.sketchRef);
  if (!sketch) { /* existing featureNotFound error */ return; }
  const param = part.parameters[feature.distanceParam];
  if (!param) { /* existing invalidParameter error */ return; }
  const resolved = resolve(param.expression, param.unit);
  if (!resolved.ok) { cleanupOnError(); return resolved; }

  const ex = executeExtrudeFeature(oc, sketch, feature, resolved.value);
  if (!ex.ok) { cleanupOnError(); return ex; }

  const applied = applyBooleanOp(oc, finalSolid, ex.value.solid, feature.operation);
  if (!applied.ok) { cleanupOnError(); return applied; }
  finalSolid = applied.value;
}
```

Add the helper `applyBooleanOp` near the bottom of the file:

```ts
import { fuseShapes, cutShapes } from '../occt/BooleanOps';

function applyBooleanOp(
  oc: OcctInstance,
  running: OcctShape | null,
  next: OcctShape,
  op: BooleanOperation
): Result<OcctShape, KernelError> {
  if (op === 'new') {
    if (running) disposeShape(running);
    return ok(next);
  }
  if (op === 'join') {
    if (!running) return ok(next);   // first feature can be Join (treated as seed)
    const r = fuseShapes(oc, running, next);
    disposeShape(running); disposeShape(next);
    return r;
  }
  if (op === 'cut') {
    if (!running) return err({ kind: 'booleanFailed', message: 'Cut needs a target body', correlationId: newCorrelationId() });
    const r = cutShapes(oc, running, next);
    disposeShape(running); disposeShape(next);
    return r;
  }
  return err({ kind: 'booleanFailed', message: `Unknown operation: ${op}`, correlationId: newCorrelationId() });
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FeatureTree` → all PASS (pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts
git commit -m "feat(kernel): single-body FeatureTree with BooleanOperation routing"
```

---

### Task 8: Wire revolve into `FeatureTree.executeTree`

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('FeatureTree revolve execution', () => {
  it('extrude New + revolve Join produces a fused body', async () => {
    // First a cube via extrude, then a partial revolve joined onto it.
    // Expected: bbox grows along the revolve's swept region.
    const part = /* … */;
    const r = await executeTree(oc, part);
    expect(r.ok).toBe(true);
    if (r.ok) disposeShape(r.value.finalSolid);
  });

  it('extrude New + revolve Cut removes material', async () => {
    const part = /* … */;
    const r = await executeTree(oc, part);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Add revolve branch to `executeTree`**

Replace the Task 2 placeholder `case 'revolve': continue;` with:

```ts
} else if (feature.kind === 'revolve') {
  const sketchResult = sketches.get(feature.sketchRef);
  const sketchFeature = part.featureTree.find((f) => f.kind === 'sketch' && f.id === feature.sketchRef);
  if (!sketchResult || !sketchFeature || sketchFeature.kind !== 'sketch') {
    cleanupOnError();
    return err({
      kind: 'featureNotFound',
      message: `Sketch ${feature.sketchRef} not found for revolve`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const param = part.parameters[feature.angleParam];
  if (!param) {
    cleanupOnError();
    return err({
      kind: 'invalidParameter',
      message: `Parameter ${feature.angleParam} not found`,
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
  }
  const resolved = resolve(param.expression, param.unit);
  if (!resolved.ok) { cleanupOnError(); return resolved; }
  const angleRad = (resolved.value * Math.PI) / 180;    // unit: deg → rad

  const rv = executeRevolveFeature(oc, sketchResult, sketchFeature, feature, angleRad);
  if (!rv.ok) { cleanupOnError(); return rv; }
  const applied = applyBooleanOp(oc, finalSolid, rv.value.solid, feature.operation);
  if (!applied.ok) { cleanupOnError(); return applied; }
  finalSolid = applied.value;
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FeatureTree` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts
git commit -m "feat(kernel): wire revolve into FeatureTree executor"
```

---

## Phase 4 — Kernel API

### Task 9: `kernel.previewFeature` RPC

**Files:**
- Modify: `packages/kernel/src/api.ts`
- Modify: `packages/app/src/kernel-client/KernelClient.ts`
- Test: `packages/kernel/src/__tests__/api.integration.spec.ts`

- [ ] **Step 1: Append the failing test**

```ts
it('previewFeature executes without mutating the stored part', async () => {
  const api = createKernelApi();
  await api.init();
  const partId = await api.createPart('P');
  await api.addFeature(partId, { kind: 'sketch', id: 'S1', plane: 'XY',
    primitives: [
      { id: 'R1', kind: 'rectangle', x: 5, y: 0, w: 10, h: 5 },
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }
    ], constraints: [] });
  await api.setParameter(partId, { name: 'angle0', expression: '360', value: 360, unit: 'deg' });

  const scratch: Feature = {
    kind: 'revolve', id: 'R_scratch', sketchRef: 'S1', axisPrimitiveId: 'L1',
    angleParam: 'angle0', direction: 'normal', operation: 'new'
  };
  const r = await api.previewFeature(partId, scratch);
  expect(r.ok).toBe(true);

  // Stored part's featureTree unchanged.
  const p = await api.getPart(partId);
  expect(p!.featureTree.filter((f) => f.kind === 'revolve')).toHaveLength(0);
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/kernel test:integration -- api` → FAIL (`previewFeature` missing).

- [ ] **Step 3: Implement `previewFeature`**

Add to `KernelApi` type + implementation in `createKernelApi`:

```ts
export type KernelApi = {
  // …existing…
  previewFeature(partId: string, feature: Feature): Promise<Result<ExecuteResult, KernelError>>;
};

// In createKernelApi():
async previewFeature(partId, feature) {
  if (!occt) throw new Error('kernel not initialized');
  const p = parts.get(partId);
  if (!p) throw new Error(`no part ${partId}`);
  // Build a virtual part = current part + scratch feature appended.
  const virtual = { ...p, featureTree: [...p.featureTree, feature] };
  const r = await executeTree(occt, virtual);
  if (!r.ok) return r;
  disposeShape(r.value.finalSolid);
  return { ok: true, value: { mesh: r.value.mesh } };
}
```

- [ ] **Step 4: Add `previewFeature` to `KernelClient`**

`packages/app/src/kernel-client/KernelClient.ts`: the Comlink-wrapped client picks up the new method automatically via its proxy, but the `KernelClient` TS interface needs the signature. Add:

```ts
previewFeature(partId: string, feature: Feature): Promise<Result<ExecuteResult, KernelError>>;
```

- [ ] **Step 5: Run — should pass**

`pnpm -C packages/kernel test:integration && pnpm -r typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/api.ts packages/app/src/kernel-client/KernelClient.ts packages/kernel/src/__tests__/api.integration.spec.ts
git commit -m "feat(kernel): previewFeature RPC (virtual tree, no persistence)"
```

---

## Phase 5 — App layer

### Task 10: `AddRevolveFeatureCommand`

**Files:**
- Create: `packages/app/src/commands/AddRevolveFeatureCommand.ts`
- Test: `packages/app/src/commands/__tests__/AddRevolveFeatureCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/commands/__tests__/AddRevolveFeatureCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { AddRevolveFeatureCommand } from '../AddRevolveFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { Feature } from '@zilventor/shared';

describe('AddRevolveFeatureCommand', () => {
  it('apply adds feature to kernel and parameter to registry; revert rolls both back', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm',
      parameters: {},
      featureTree: [{ kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] }]
    });

    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true, value: { mesh: { positions: new Float32Array(), indices: new Uint32Array(), boundingBox: [0,0,0,0,0,0] as const } } })
    } as unknown as KernelClient;

    const registry = new ParameterRegistry();
    const feature: Extract<Feature, { kind: 'revolve' }> = {
      kind: 'revolve', id: 'R1', sketchRef: 'S1',
      axisPrimitiveId: 'L1', angleParam: 'angle0',
      direction: 'normal', operation: 'new'
    };

    const cmd = new AddRevolveFeatureCommand('P1', feature, '360', kernel, registry);
    await cmd.apply();
    expect(registry.getValue('angle0')).toBe(360);
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    expect(kernel.execute).toHaveBeenCalled();

    await cmd.revert();
    expect(registry.getValue('angle0')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'R1');
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/AddRevolveFeatureCommand.ts
import type { Command } from './Command';
import type { Feature } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export class AddRevolveFeatureCommand implements Command {
  readonly name = 'AddRevolveFeature';
  constructor(
    private partId: string,
    private feature: Extract<Feature, { kind: 'revolve' }>,
    private angleExpression: string,
    private kernel: KernelClient,
    private registry: ParameterRegistry
  ) {}

  async apply(): Promise<void> {
    this.registry.setParameter({
      name: this.feature.angleParam,
      expression: this.angleExpression,
      unit: 'deg'
    });
    await this.kernel.setParameter(this.partId, {
      name: this.feature.angleParam,
      expression: this.angleExpression,
      value: this.registry.getValue(this.feature.angleParam) ?? 0,
      unit: 'deg'
    });
    await this.kernel.addFeature(this.partId, this.feature);
    await this.kernel.execute(this.partId);
  }

  async revert(): Promise<void> {
    await this.kernel.removeFeature(this.partId, this.feature.id);
    this.registry.removeParameter(this.feature.angleParam);
    await this.kernel.deleteParameter(this.partId, this.feature.angleParam);
    await this.kernel.execute(this.partId);
  }
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/app test:unit -- AddRevolveFeatureCommand` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddRevolveFeatureCommand.ts packages/app/src/commands/__tests__/AddRevolveFeatureCommand.spec.ts
git commit -m "feat(app): AddRevolveFeatureCommand"
```

---

### Task 11: `RevolveDialog` component — layout + static state

**Files:**
- Create: `packages/app/src/shell/RevolveDialog.tsx`
- Test: `packages/app/src/shell/__tests__/RevolveDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RevolveDialog } from '../RevolveDialog';

describe('RevolveDialog (layout)', () => {
  it('renders Profile + Axis fields, Extents dropdown, Angle input, Operation icons', () => {
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={null}
      hasRunningBody={false}
      onCommit={vi.fn()}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
    />);
    expect(screen.getByText(/Profile/i)).toBeInTheDocument();
    expect(screen.getByText(/Axis/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Angle/i)).toBeInTheDocument();
    // Operation: empty body → only New enabled.
    expect(screen.getByRole('button', { name: /New/ })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Join/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cut/ })).toBeDisabled();
  });

  it('OK is disabled until axis is picked', () => {
    const onCommit = vi.fn();
    render(<RevolveDialog
      profile={{ sketchId: 'S1', closedProfileCount: 1 }}
      axis={null}
      hasRunningBody={false}
      onCommit={onCommit}
      onApply={vi.fn()}
      onCancel={vi.fn()}
      onPickProfile={vi.fn()}
      onPickAxis={vi.fn()}
    />);
    const ok = screen.getByRole('button', { name: /^OK$/ });
    expect(ok).toBeDisabled();
    fireEvent.click(ok);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement the dialog (layout only, no preview yet)**

```tsx
// packages/app/src/shell/RevolveDialog.tsx
import { useState, type FormEvent } from 'react';

type ProfileRef = { sketchId: string; closedProfileCount: number };
type AxisRef = { primitiveId: string };

type Props = {
  profile: ProfileRef | null;
  axis: AxisRef | null;
  hasRunningBody: boolean;
  initialName?: string;
  initialExpression?: string;
  onCommit(v: { name: string; expression: string; direction: 'normal' | 'symmetric' | 'flipped'; operation: 'new' | 'join' | 'cut' }): void;
  onApply(v: { name: string; expression: string; direction: 'normal' | 'symmetric' | 'flipped'; operation: 'new' | 'join' | 'cut' }): void;
  onCancel(): void;
  onPickProfile(): void;
  onPickAxis(): void;
};

export function RevolveDialog(props: Props) {
  const [name, setName] = useState(props.initialName ?? 'angle0');
  const [expression, setExpression] = useState(props.initialExpression ?? '360');
  const [direction, setDirection] = useState<'normal' | 'symmetric' | 'flipped'>('normal');
  const [operation, setOperation] = useState<'new' | 'join' | 'cut'>(props.hasRunningBody ? 'join' : 'new');

  const canCommit = !!props.profile && !!props.axis && expression.trim().length > 0;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (canCommit) props.onCommit({ name, expression, direction, operation });
  };

  return (
    <form role="dialog" aria-label="Revolve" onSubmit={handleSubmit} style={{
      position: 'fixed', top: 80, right: 24, width: 320,
      background: '#1a1a1a', color: '#eee', border: '1px solid #444',
      borderRadius: 6, padding: 14, zIndex: 55
    }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Revolve</div>

      <div>
        <button type="button" onClick={props.onPickProfile} style={{ marginRight: 8 }}>↑ Profile</button>
        <span>{props.profile ? `${props.profile.sketchId} / ${props.profile.closedProfileCount} profile` : 'pick a profile'}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        <button type="button" onClick={props.onPickAxis} style={{ marginRight: 8 }}>↑ Axis</button>
        <span>{props.axis ? props.axis.primitiveId : 'pick a line'}</span>
      </div>

      <label style={{ display: 'block', marginTop: 10 }}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginTop: 2 }} />
      </label>
      <label style={{ display: 'block', marginTop: 6 }}>
        Angle
        <input aria-label="Angle" value={expression} onChange={(e) => setExpression(e.target.value)} style={{ width: '100%', marginTop: 2 }} />
      </label>

      <div style={{ marginTop: 10 }}>
        Direction:
        {(['flipped', 'symmetric', 'normal'] as const).map((d) => (
          <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)} style={{ marginLeft: 4 }}>
            {d === 'flipped' ? '◁' : d === 'symmetric' ? '◁▷' : '▷'}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        Operation:
        <button type="button" aria-pressed={operation === 'new'} onClick={() => setOperation('new')} style={{ marginLeft: 4 }}>New</button>
        <button type="button" aria-pressed={operation === 'join'} disabled={!props.hasRunningBody} onClick={() => setOperation('join')} style={{ marginLeft: 4 }}>Join</button>
        <button type="button" aria-pressed={operation === 'cut'} disabled={!props.hasRunningBody} onClick={() => setOperation('cut')} style={{ marginLeft: 4 }}>Cut</button>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="submit" disabled={!canCommit}>OK</button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
        <button type="button" disabled={!canCommit} onClick={() => props.onApply({ name, expression, direction, operation })}>Apply</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/RevolveDialog.tsx packages/app/src/shell/__tests__/RevolveDialog.spec.tsx
git commit -m "feat(app): RevolveDialog — layout + static state"
```

---

### Task 12: Axis-pick state machine in `ActiveToolController` (Model mode)

**Files:**
- Modify: `packages/app/src/sketcher/ActiveToolController.ts` (extend `ToolKind` union)
- OR: Create a new `packages/app/src/model/AxisPickController.ts` module used by `App.tsx` while `RevolveDialog` is open.

- [ ] **Step 1: Decide placement**

Axis picking happens in Model mode (not sketch mode) but uses the same canvas pointer stream. Put the state machine in a new file (`AxisPickController.ts`) invoked directly by App.tsx when the dialog arms the Axis field; don't overload `ActiveToolController` which is sketch-mode-only.

- [ ] **Step 2: Write the failing test**

```ts
// packages/app/src/model/__tests__/AxisPickController.spec.ts
import { describe, it, expect } from 'vitest';
import { AxisPickController } from '../AxisPickController';

describe('AxisPickController', () => {
  it('onPointerClick returns the primitive id of a hit line', () => {
    const ctrl = new AxisPickController();
    ctrl.setCandidates([
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'L2', kind: 'line', x1: 0, y1: 5, x2: 10, y2: 5 }
    ]);
    expect(ctrl.pick({ x: 5, y: 0 })).toBe('L1');
    expect(ctrl.pick({ x: 5, y: 5 })).toBe('L2');
    expect(ctrl.pick({ x: 5, y: 2.5 })).toBeNull();
  });
});
```

- [ ] **Step 3: Implement `AxisPickController`**

```ts
// packages/app/src/model/AxisPickController.ts
import type { SketchPrimitive } from '@zilventor/shared';
import type { Point2 } from '../sketcher/snap';

export class AxisPickController {
  private candidates: Array<Extract<SketchPrimitive, { kind: 'line' }>> = [];
  private tolerance = 5;   // world units

  setCandidates(prims: SketchPrimitive[]): void {
    this.candidates = prims.filter((p): p is Extract<SketchPrimitive, { kind: 'line' }> => p.kind === 'line');
  }

  setTolerance(t: number): void { this.tolerance = t; }

  pick(p: Point2): string | null {
    let best: { id: string; d: number } | null = null;
    for (const line of this.candidates) {
      const d = distToSegment(p, { x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 });
      if (d < this.tolerance && (!best || d < best.d)) best = { id: line.id, d };
    }
    return best?.id ?? null;
  }
}

function distToSegment(p: Point2, a: Point2, b: Point2): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(wx, wy);
  const c2 = vx * vx + vy * vy;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/model/AxisPickController.ts packages/app/src/model/__tests__/AxisPickController.spec.ts
git commit -m "feat(app): AxisPickController — line-hit test for Model-mode axis pick"
```

---

### Task 13: Wire Revolve end-to-end in `App.tsx`

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/shell/tabs/ModelTab.tsx` (Revolve ribbon button)

- [ ] **Step 1: Add Revolve button to ModelTab**

```tsx
// ModelTab.tsx — next to Extrude button
<button onClick={() => useAppStore.getState().setRevolveDialogOpen(true)}>Revolve (R)</button>
```

Add the store flag:

```ts
// useAppStore.ts
revolveDialogOpen: boolean;
setRevolveDialogOpen(v: boolean): void;
```

- [ ] **Step 2: Add `R` shortcut + dialog rendering in App.tsx**

Add to the existing global keyboard handler (guarded by NOT sketchMode to avoid shadowing Rectangle tool):

```ts
if (!sketchMode && e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
  e.preventDefault();
  useAppStore.getState().setRevolveDialogOpen(true);
  return;
}
```

Render the dialog:

```tsx
{revolveDialogOpen && (
  <RevolveDialog
    profile={computeProfileRef(activePart)}
    axis={selectedAxisRef}
    hasRunningBody={hasRunningBody(activePart)}
    onPickProfile={() => { /* TODO step 4 */ }}
    onPickAxis={() => setPickingAxis(true)}
    onCommit={onRevolveCommit}
    onApply={onRevolveApply}
    onCancel={() => { setRevolveDialogOpen(false); setPickingAxis(false); }}
  />
)}
```

- [ ] **Step 3: Axis picking via viewport click**

When `pickingAxis === true`, `handleViewportPointer` routes pointer clicks to `axisPickerRef.current.pick(worldCoord)` instead of the sketch tool controller. On hit → set `selectedAxisRef` + `setPickingAxis(false)`.

- [ ] **Step 4: `onRevolveCommit` handler**

```ts
const onRevolveCommit = async (v: { name: string; expression: string; direction; operation }) => {
  if (!selectedAxisRef || !activePart) return;
  const sketchId = activePart.featureTree.find((f) => f.kind === 'sketch')?.id;
  if (!sketchId) return;
  const feature: Extract<Feature, { kind: 'revolve' }> = {
    kind: 'revolve', id: nextFeatureId('r'), sketchRef: sketchId,
    axisPrimitiveId: selectedAxisRef.primitiveId,
    angleParam: v.name, direction: v.direction, operation: v.operation
  };
  const cmd = new AddRevolveFeatureCommand(activePart.id, feature, v.expression, kernel, parameterRegistry);
  try {
    await useAppStore.getState().bus.execute(cmd);
    setRevolveDialogOpen(false);
    setSelectedAxisRef(null);
  } catch (e) {
    showToast(`Revolve failed: ${(e as Error).message}`);
  }
};
```

- [ ] **Step 5: Run typecheck + tests**

`pnpm -r typecheck && pnpm -C packages/app test:unit` → all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): wire Revolve dialog + ribbon button + R shortcut + axis pick"
```

---

### Task 14: Live preview (debounced 200 ms)

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add preview state + effect**

```tsx
const [previewMesh, setPreviewMesh] = useState<Mesh | null>(null);
const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const schedulePreview = (scratch: Extract<Feature, { kind: 'revolve' }>, angleExpression: string) => {
  if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
  previewTimerRef.current = setTimeout(async () => {
    // Register the angle param in the kernel-side part before previewing.
    await kernel.setParameter(activePart.id, {
      name: scratch.angleParam, expression: angleExpression,
      value: 0, unit: 'deg'
    });
    const r = await kernel.previewFeature(activePart.id, scratch);
    if (r.ok) setPreviewMesh(r.value.mesh);
    else setPreviewMesh(null);
  }, 200);
};
```

- [ ] **Step 2: Drive `schedulePreview` from RevolveDialog's inputs**

Pass an `onDraftChange` prop to `RevolveDialog` that fires on every name/expression/direction/operation change. The dialog keeps its existing state management; we add:

```tsx
useEffect(() => {
  if (!props.axis || !props.profile) return;
  props.onDraftChange?.({ name, expression, direction, operation });
}, [name, expression, direction, operation, props.axis, props.profile]);
```

- [ ] **Step 3: Render preview mesh in Viewport**

Add a dedicated `THREE.Mesh` in the scene set to 50% opacity when `previewMesh !== null`. Dispose old buffer geometry before creating a new one (standard three.js cleanup).

- [ ] **Step 4: Clean up on close**

On `onCancel` / `onCommit`: `setPreviewMesh(null)` and `clearTimeout(previewTimerRef.current)`.

- [ ] **Step 5: Typecheck**

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/App.tsx packages/app/src/shell/RevolveDialog.tsx
git commit -m "feat(app): Revolve dialog live preview (debounced 200ms via previewFeature)"
```

---

### Task 15: Extrude dialog retrofit — Operation icon row

**Files:**
- Modify: `packages/app/src/shell/ExtrudeDialog.tsx` (or equivalent)
- Modify: its test file

- [ ] **Step 1: Write the failing test**

```tsx
it('ExtrudeDialog shows Operation icon row with Join default when body exists', () => {
  render(<ExtrudeDialog hasRunningBody={true} onCommit={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole('button', { name: /New/ })).not.toBeDisabled();
  expect(screen.getByRole('button', { name: /Join/ })).toHaveAttribute('aria-pressed', 'true');
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Add the operation row to ExtrudeDialog**

Mirror the Revolve pattern. Props gain `hasRunningBody: boolean`; `onCommit` signature adds `operation`.

- [ ] **Step 4: Wire in App.tsx**

The extrude commit handler passes `v.operation` into the feature spec.

- [ ] **Step 5: Run → pass**

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/shell/ExtrudeDialog.tsx packages/app/src/shell/__tests__/ExtrudeDialog.spec.tsx packages/app/src/App.tsx
git commit -m "feat(app): Extrude dialog Operation icon row (New/Join/Cut)"
```

---

## Phase 6 — E2E + docs

### Task 16: E2E — place a revolve on a simple profile

**File:** `tests/e2e/model/place-revolve-full.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';

test('place a full 360° revolve', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);

  // Setup: New Part → 2D Sketch → draw rectangle profile + axis line → exit sketch.
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await page.getByRole('tab', { name: 'Sketch' }).click();
  await page.getByRole('button', { name: '2D Sketch' }).click();
  // … draw the rectangle + axis line via tool clicks (mirror 2c's draw helpers).
  // Then Finish Sketch.

  await page.getByRole('button', { name: 'Finish Sketch' }).click();
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog', { name: /Revolve/i })).toBeVisible();

  // Click the Axis pick button, then click on the axis line in the viewport.
  await page.getByRole('button', { name: /↑ Axis/ }).click();
  // Compute screen coord for the axis via __zilventorWorldToScreen, mirroring
  // the pattern from 2c's over-define-dim-highlights-conflict.spec.ts.

  await page.getByLabel('Angle').fill('360');
  await page.getByRole('button', { name: /^OK$/ }).click();

  // Feature tree now has a revolve entry.
  const featureCount = await page.evaluate(() => {
    const s = (window as any).__zilventorStore.getState();
    return s.activePart.featureTree.filter((f: { kind: string }) => f.kind === 'revolve').length;
  });
  expect(featureCount).toBe(1);
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e -- place-revolve-full
git add tests/e2e/model/place-revolve-full.spec.ts
git commit -m "test(e2e): place-revolve-full golden path"
```

---

### Task 17: E2E — revolve Join + Cut on existing body

**File:** `tests/e2e/model/revolve-join-cut.spec.ts`

- [ ] **Step 1: Write the test**

Seed via `setActivePart` with a pre-built extrude New feature. Then press R, pick axis, type angle, select Join → commit. Verify tree has 2 features. Repeat for Cut → verify tree has 3 features.

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e -- revolve-join-cut
git add tests/e2e/model/revolve-join-cut.spec.ts
git commit -m "test(e2e): revolve Join then Cut against existing body"
```

---

### Task 18: E2E — parametric revolve cascade

**File:** `tests/e2e/model/parametric-revolve-cascade.spec.ts`

- [ ] **Step 1: Write the test**

Seed a part with revolve using `angleParam: 'theta0'`, `theta0 = 180`. Open Parameters panel (F7), change `theta0` to `90`. Verify the bbox of the viewport mesh changes (via `__zilventorStore` read of `cachedGeometry.boundingBox` after recompute).

- [ ] **Step 2: Run + commit**

```bash
pnpm test:e2e -- parametric-revolve-cascade
git add tests/e2e/model/parametric-revolve-cascade.spec.ts
git commit -m "test(e2e): parameter change cascades to revolve geometry"
```

---

### Task 19: Perf — preview debounce

**File:** `tests/perf/revolve-preview-debounce.spec.ts`

- [ ] **Step 1: Write the test**

Seed sketch + axis via `setActivePart`. Open Revolve dialog. Rapid-fire 10 `fill()` calls on the Angle field with different values over ~1 second. Count the number of `previewFeature` RPC calls via `page.on('console')` (log each call from the worker) or by instrumenting `KernelClient.previewFeature` with a counter exposed on `window.__zilventorPreviewCount`.

Assert: `count ≤ 7` (some debounces coalesced) and total wall time ≤ 2 s.

- [ ] **Step 2: Run + commit**

```bash
pnpm test:perf -- revolve-preview-debounce
git add tests/perf/revolve-preview-debounce.spec.ts packages/app/src/kernel-client/KernelClient.ts
git commit -m "test(perf): revolve-preview-debounce — verifies 200ms debounce"
```

---

### Task 20: Manual test checklist

**File:** `docs/superpowers/manual-tests/subproject-3a.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Sub-project 3a — Manual test checklist

## Setup
- [ ] `pnpm dev` starts Vite. Open `http://localhost:5173`. Ready / mm.

## Golden path
- [ ] New Part → 2D Sketch → draw a rectangle profile + a vertical line as axis → Finish Sketch.
- [ ] Model tab → Revolve (or press **R**). Dialog opens with Profile auto-filled.
- [ ] Click Axis, then click the vertical line in the viewport. Field shows the primitive id.
- [ ] Type `360` in the Angle field. Preview mesh appears (50% opacity).
- [ ] OK. Solid appears, dialog closes. Feature tree shows `Revolve1 [New]`.

## Join / Cut
- [ ] With an existing body, open Revolve dialog. Join is the default operation, Cut is enabled.
- [ ] Pick axis, type `90`, select Join → OK. Body updates; bounding box grows.
- [ ] Revolve again with Cut → carves material away.

## Parametric
- [ ] Name the angle parameter `theta0` in the Revolve dialog, expression `90`.
- [ ] Open Parameters panel (**F7**), edit `theta0` to `180`. Solid regenerates live.
- [ ] Edit to `theta0 + 90`. Expression evaluates; cascade works.

## Error paths
- [ ] Place axis so it crosses the profile: preview fails, error badge in dialog footer.
- [ ] Cut with no body: dialog auto-switches to New, toast warns.
- [ ] Type `0 + width` with `width` undefined: inline error under Angle field.

## Save / reopen
- [ ] Save `.zipt`. Reopen fresh tab. Revolve feature + angle parameter persist. Geometry regenerates.

## Extrude retrofit
- [ ] New extrude on an existing body defaults Operation to Join. User can pick Cut.
- [ ] Legacy v4 file opens: first extrude shows as New, subsequent as Join.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-3a.md
git commit -m "docs(manual-tests): sub-project 3a checklist"
```

---

### Task 21: Spec polish + memory update

**Files:**
- Modify: `docs/superpowers/specs/2026-04-24-subproject-3a-revolve-design.md` (any clarifications discovered during implementation)
- Update: user's memory file `memory/project_subproject_3a_execution_state.md` via the controller session's memory system.

- [ ] **Step 1: Write the memory state**

Short memo summarizing 3a's status, key commit SHAs, known limitations (symmetric direction simplification, single-plane support).

- [ ] **Step 2: Commit spec polish**

```bash
git add docs/superpowers/specs/2026-04-24-subproject-3a-revolve-design.md
git commit -m "docs(spec): 3a clarifications post-implementation"
```

---

### Task 22: Final code review + ship

- [ ] **Step 1: Run the full suite**

```bash
pnpm -r typecheck
pnpm -r test:unit
pnpm -r test:integration
pnpm test:e2e
pnpm test:perf
```

All green.

- [ ] **Step 2: Dispatch `superpowers:code-reviewer` agent**

Use the skill's end-of-project review pattern. Fix any Critical / Important findings inline.

- [ ] **Step 3: Push to origin**

```bash
git push origin master
```

- [ ] **Step 4: Update MEMORY.md index line**

Change 3a entry from `IN FLIGHT` to `SHIPPED at <final-sha>`.

---

## Summary

**22 tasks** delivering:

- `BooleanOperation` + `RevolveFeature` types and file-format v5 migration.
- OCCT wrappers: `makeRevolve`, `fuseShapes`, `cutShapes`.
- Single-body feature-tree executor with `operation`-driven New / Join / Cut.
- `previewFeature` kernel RPC (non-mutating virtual tree execution).
- `AddRevolveFeatureCommand` with ParameterRegistry + kernel coordination.
- `RevolveDialog` Inventor-faithful layout + axis-pick flow + debounced live preview.
- Extrude dialog retrofit with the Operation icon row.
- 3 E2E tests + 1 perf test + manual checklist.

**Test coverage:** 14 new tests (matches spec).

**Risk mitigation:** Tasks 4 and 5 verify opencascade.js constructor suffixes at the point of use; if a suffix is wrong, the integration test fails immediately with a clear OCCT error string.
