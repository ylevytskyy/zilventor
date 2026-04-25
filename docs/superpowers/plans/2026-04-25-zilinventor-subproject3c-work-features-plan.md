# Sub-project 3c — Work Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Inventor 2012 work features (WorkAxis / WorkPlane / WorkPoint) — 18 creation modes total — as parametric features in the part feature tree, including auto-created origin features, viewport renderers, three creation dialogs, ribbon panel, hotkeys, and broken-ref soft-fail handling.

**Architecture:** Three new feature kinds extend the discriminated `Feature` union in shared types. `executeTree` collects evaluated work features into a new `ExecuteResult.workFeatures` array. The viewport diff-renders axes/planes/points keyed by feature id (mirrors T7 `setComponentMeshes`). UI mirrors the established `HoleDialog` / `SweepDialog` pattern with per-row pick buttons and edit-by-double-click. Sketch plane reference widens from a string literal to a `PlaneRef` discriminator with a migration shim for legacy v7 manifests.

**Tech Stack:** TypeScript, React + Zustand, three.js, OCCT (`opencascade.js`), pnpm workspace, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-25-subproject-3c-work-features-design.md`

**Total tasks: 42.** Test-driven throughout. One commit per task unless noted.

---

## File Structure

**Shared types (additive):**
- Modify: `packages/shared/src/types.ts` — add `WorkAxisFeature`, `WorkPlaneFeature`, `WorkPointFeature`, `AxisRef`, `PlaneRef`, `PointRef`, `ParamOrLiteral`, `WorkFeatureValue`. Widen `SketchFeature.plane` from string to `PlaneRef`. Extend `Feature` union.
- Modify: `packages/shared/src/fileFormat.ts` — `migrateManifest` injects origin features and migrates sketch plane literals.

**Kernel:**
- Create: `packages/kernel/src/occt/WorkFeatureOps.ts` — 3 evaluators (axis, plane, point) + 3 reference resolvers + `Vec3` math helpers.
- Create: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts` — per-mode unit tests.
- Modify: `packages/kernel/src/adapter/PartDocument.ts` — `newPart()` seeds the 7 origin work features.
- Modify: `packages/kernel/src/adapter/FeatureTree.ts` — extend `executeTree` to collect `workFeatures` into the result, soft-fail broken refs.
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts` — switch from literal plane to `PlaneRef` resolution.
- Modify: `packages/kernel/src/api.ts` — extend `ExecuteResult` with `workFeatures`.

**App — viewport:**
- Modify: `packages/app/src/viewport/SceneManager.ts` — `setWorkFeatures`, `clearWorkFeatures`, `workFeatureCount`, `getWorkFeatureNode`, `raycastWorkFeature`. Extend `geometryHash()` to fold visible work features.
- Modify: `packages/app/src/viewport/Viewport.tsx` — expose ref methods for the new SceneManager API + raycaster.

**App — store, commands, pickers:**
- Modify: `packages/app/src/store/useAppStore.ts` — three dialog slices + `setWorkFeatureVisible`.
- Create: `packages/app/src/model/WorkAxisPickController.ts` (+ spec).
- Create: `packages/app/src/model/WorkPlanePickController.ts` (+ spec).
- Create: `packages/app/src/model/WorkPointPickController.ts` (+ spec).
- Create: `packages/app/src/commands/AddWorkAxisFeatureCommand.ts` (+ spec).
- Create: `packages/app/src/commands/AddWorkPlaneFeatureCommand.ts` (+ spec).
- Create: `packages/app/src/commands/AddWorkPointFeatureCommand.ts` (+ spec).
- Create: `packages/app/src/commands/OpenWork{Axis,Plane,Point}DialogCommand.ts` (+ specs).

**App — UI:**
- Create: `packages/app/src/shell/WorkAxisDialog.tsx` (+ spec).
- Create: `packages/app/src/shell/WorkPlaneDialog.tsx` (+ spec).
- Create: `packages/app/src/shell/WorkPointDialog.tsx` (+ spec).
- Modify: `packages/app/src/shell/BrowserPane.tsx` — Origin group, work-feature leaves, visibility toggles, broken-ref badges.
- Modify: `packages/app/src/shell/Ribbon.tsx` + `packages/app/src/shell/tabs/ModelTab.tsx` — Work Features panel with split-buttons.
- Modify: `packages/app/src/App.tsx` — dialog wrappers, hotkeys, picker routing.

**E2E + perf:**
- Create: `tests/e2e/work-features/create-work-plane.spec.ts`.
- Create: `tests/e2e/work-features/parametric-cascade.spec.ts`.
- Create: `tests/e2e/work-features/broken-ref-badge.spec.ts`.
- Create: `tests/perf/work-features-recompute.spec.ts`.

---

## Phase 1 — Shared types + origin features + migration

### Task 1: WorkAxis / WorkPlane / WorkPoint types + ref discriminators

**Files:**
- Modify: `packages/shared/src/types.ts`
- Test: `packages/shared/src/__tests__/work-features-types.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/shared/src/__tests__/work-features-types.spec.ts
import { describe, it, expect } from 'vitest';
import type {
  WorkAxisFeature, WorkPlaneFeature, WorkPointFeature,
  AxisRef, PlaneRef, PointRef, ParamOrLiteral, Feature,
} from '../types';

describe('Work feature types', () => {
  it('WorkAxisFeature discriminates by mode', () => {
    const a: WorkAxisFeature = {
      kind: 'workAxis', id: 'WA1', visible: true,
      source: { mode: 'origin', axis: 'X' },
    };
    expect(a.kind).toBe('workAxis');
  });

  it('WorkPlaneFeature offsetFromPlane has offset param', () => {
    const p: WorkPlaneFeature = {
      kind: 'workPlane', id: 'WP1', visible: true,
      source: {
        mode: 'offsetFromPlane',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        offset: { kind: 'literal', value: 10 },
      },
    };
    if (p.source.mode === 'offsetFromPlane') {
      expect(p.source.offset.kind).toBe('literal');
    }
  });

  it('WorkPointFeature midpointOfEdge has edge ref', () => {
    const pt: WorkPointFeature = {
      kind: 'workPoint', id: 'WPT1', visible: true,
      source: {
        mode: 'midpointOfEdge',
        edge: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side' } },
      },
    };
    expect(pt.source.mode).toBe('midpointOfEdge');
  });

  it('Feature union includes all three new kinds', () => {
    const f1: Feature = { kind: 'workAxis', id: 'a', visible: true, source: { mode: 'origin', axis: 'Y' } };
    const f2: Feature = { kind: 'workPlane', id: 'p', visible: true, source: { mode: 'origin', plane: 'XZ' } };
    const f3: Feature = { kind: 'workPoint', id: 'q', visible: true, source: { mode: 'origin' } };
    expect([f1.kind, f2.kind, f3.kind]).toEqual(['workAxis', 'workPlane', 'workPoint']);
  });
});
```

- [ ] **Step 2: Run — should fail**

```
pnpm -C packages/shared test:unit -- work-features-types
```

Expected: FAIL (types not exported yet).

- [ ] **Step 3: Add types to `packages/shared/src/types.ts`**

Append before the existing `export type Feature = …` union:

```ts
export type ParamOrLiteral =
  | { kind: 'param'; paramName: string }
  | { kind: 'literal'; value: number };

export type AxisRef =
  | { source: 'cylindricalFace'; face: FaceName }
  | { source: 'edge'; edge: EdgeName }
  | { source: 'workAxis'; featureId: string };

export type PlaneRef =
  | { source: 'face'; face: FaceName }
  | { source: 'workPlane'; featureId: string };

export type PointRef =
  | { source: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
  | { source: 'workPoint'; featureId: string };

export type WorkAxisFeature = {
  kind: 'workAxis'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'cylindricalFace'; face: FaceName }
    | { mode: 'twoPoints'; pointA: PointRef; pointB: PointRef }
    | { mode: 'edge'; edge: EdgeName }
    | { mode: 'twoPlanes'; planeA: PlaneRef; planeB: PlaneRef }
    | { mode: 'normalToPlaneThroughPoint'; plane: PlaneRef; point: PointRef }
    | { mode: 'origin'; axis: 'X' | 'Y' | 'Z' };
};

export type WorkPlaneFeature = {
  kind: 'workPlane'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'offsetFromPlane'; plane: PlaneRef; offset: ParamOrLiteral }
    | { mode: 'threePoints'; points: [PointRef, PointRef, PointRef] }
    | { mode: 'axisAtAngleToPlane'; axis: AxisRef; plane: PlaneRef; angle: ParamOrLiteral }
    | { mode: 'tangentToSurfaceParallelToPlane'; face: FaceName; plane: PlaneRef }
    | { mode: 'axisPerpendicularToPlane'; axis: AxisRef; plane: PlaneRef }
    | { mode: 'midplane'; planeA: PlaneRef; planeB: PlaneRef }
    | { mode: 'origin'; plane: 'XY' | 'YZ' | 'XZ' };
};

export type WorkPointFeature = {
  kind: 'workPoint'; id: string; name?: string; visible: boolean;
  source:
    | { mode: 'vertex'; edge: EdgeName; end: 'start' | 'end' }
    | { mode: 'midpointOfEdge'; edge: EdgeName }
    | { mode: 'centerOfArc'; face: FaceName }
    | { mode: 'axisIntersectsPlane'; axis: AxisRef; plane: PlaneRef }
    | { mode: 'threePlanes'; planes: [PlaneRef, PlaneRef, PlaneRef] }
    | { mode: 'origin' };
};
```

Extend the existing `Feature` union by adding `| WorkAxisFeature | WorkPlaneFeature | WorkPointFeature`.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit -- work-features-types
pnpm -r typecheck
```

Both PASS. If typecheck flags downstream consumers of `Feature` that don't handle the new kinds, leave them — Tasks 4–8 add the handlers. Use `// eslint-disable @typescript-eslint/switch-exhaustiveness-check` or a `default: throw` only if a build literally cannot complete; otherwise let the type system catch the gaps in later tasks.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/work-features-types.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): WorkAxis/WorkPlane/WorkPoint types + AxisRef/PlaneRef/PointRef

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Widen SketchFeature.plane from string literal to PlaneRef

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/__tests__/work-features-types.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `work-features-types.spec.ts`:

```ts
describe('SketchFeature.plane is a PlaneRef', () => {
  it('accepts a workPlane reference', () => {
    const f: Feature = {
      kind: 'sketch', id: 'S1',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      primitives: [], constraints: [],
    };
    if (f.kind === 'sketch' && f.plane.source === 'workPlane') {
      expect(f.plane.featureId).toBe('origin.XY');
    }
  });

  it('accepts a face reference', () => {
    const f: Feature = {
      kind: 'sketch', id: 'S2',
      plane: { source: 'face', face: { featureId: 'E1', role: 'top' } },
      primitives: [], constraints: [],
    };
    if (f.kind === 'sketch' && f.plane.source === 'face') {
      expect(f.plane.face.role).toBe('top');
    }
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Update SketchFeature type**

In `types.ts`, find the line:

```ts
| { kind: 'sketch'; id: string; plane: 'XY' | 'XZ' | 'YZ'; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
```

Change `plane:` to `PlaneRef`:

```ts
| { kind: 'sketch'; id: string; plane: PlaneRef; primitives: SketchPrimitive[]; constraints: SketchConstraint[] }
```

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit
pnpm -r typecheck
```

Many consumers of `sketch.plane` will fail typecheck (Tasks 5, 6, 28 fix them). For now, leave them — the test for THIS task passes.

If typecheck cannot build at all, add a temporary type assertion `(sketch.plane as any)` at the failing site and note it for the next task. Avoid mass refactoring out of scope.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/work-features-types.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): SketchFeature.plane widened from string literal to PlaneRef

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: WorkFeatureValue + ExecuteResult extension

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/kernel/src/api.ts`
- Test: `packages/shared/src/__tests__/work-features-types.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `work-features-types.spec.ts`:

```ts
import type { WorkFeatureValue, Vec3 } from '../types';

describe('WorkFeatureValue', () => {
  it('discriminates axis | plane | point', () => {
    const a: WorkFeatureValue = { featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } };
    const p: WorkFeatureValue = { featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const pt: WorkFeatureValue = { featureId: 'WPT1', kind: 'point', position: { x: 0, y: 0, z: 0 } };
    expect([a.kind, p.kind, pt.kind]).toEqual(['axis', 'plane', 'point']);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Add types**

In `packages/shared/src/types.ts`, ensure `Vec3` exists (it may already; if not, add):

```ts
export type Vec3 = { x: number; y: number; z: number };
```

Then add:

```ts
export type WorkFeatureValue =
  | { featureId: string; kind: 'axis'; origin: Vec3; direction: Vec3 }
  | { featureId: string; kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { featureId: string; kind: 'point'; position: Vec3 };
```

In `packages/kernel/src/api.ts`, extend `ExecuteResult`:

```ts
import type { ..., WorkFeatureValue } from '@zilventor/shared';

export type ExecuteResult = {
  mesh: Mesh;
  tessellatedEdges?: TessellatedEdge[];
  faceNames?: FaceName[];
  tessellatedFaces?: TessellatedFace[];
  featureErrors?: Map<string, KernelError>;
  workFeatures?: WorkFeatureValue[];   // ← new
};
```

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/work-features-types.spec.ts \
        packages/kernel/src/api.ts
git commit -m "$(cat <<'EOF'
feat(shared,kernel): WorkFeatureValue + ExecuteResult.workFeatures

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: newPart() seeds 7 origin work features

**Files:**
- Modify: `packages/kernel/src/adapter/PartDocument.ts`
- Modify: `packages/kernel/src/adapter/__tests__/PartDocument.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `PartDocument.spec.ts`:

```ts
describe('newPart() origin features', () => {
  it('seeds 7 origin work features at the start of featureTree', () => {
    const p = newPart('Part1');
    const ids = p.featureTree.slice(0, 7).map((f) => f.id);
    expect(ids).toEqual([
      'origin.X', 'origin.Y', 'origin.Z',
      'origin.XY', 'origin.YZ', 'origin.XZ',
      'origin.O',
    ]);
  });

  it('origin work features default visible=false', () => {
    const p = newPart('Part1');
    for (const f of p.featureTree.slice(0, 7)) {
      if (f.kind === 'workAxis' || f.kind === 'workPlane' || f.kind === 'workPoint') {
        expect(f.visible).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `packages/kernel/src/adapter/PartDocument.ts`, find `newPart(name)`. Replace the `featureTree: []` initializer with:

```ts
featureTree: [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
],
```

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/kernel test:unit -- PartDocument
```

PASS for the new tests.

Existing tests in PartDocument.spec.ts that asserted `featureTree.length === 0` or counted features by index will now fail. Update those tests:
- `featureTree.length === 0` → `featureTree.length === 7`
- Index-based asserts → use `.find((f) => f.id === '<id>')` lookups

If a kernel integration test (e.g., `FeatureTree.integration.spec.ts`) breaks because of origin features in its expected output, fix it the same way.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/PartDocument.ts \
        packages/kernel/src/adapter/__tests__/PartDocument.spec.ts \
        packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts \
        packages/kernel/src/adapter/features/__tests__/*.integration.spec.ts
# Stage only files actually modified.
git commit -m "$(cat <<'EOF'
feat(kernel): newPart() seeds 7 origin work features

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: migrateManifest injects origin features for legacy v7 parts

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write failing test**

Append to `fileFormat.spec.ts`:

```ts
describe('migrateManifest origin features', () => {
  it('legacy v7 part without origin features gets origin features prepended', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] } as any,
        ],
      },
    };
    const out = migrateManifest(input);
    const tree = (out as any).document.featureTree;
    expect(tree[0].id).toBe('origin.X');
    expect(tree[6].id).toBe('origin.O');
    expect(tree[7].id).toBe('S1');
  });

  it('manifest with existing origin features is left untouched', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } } as any,
          { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } } as any,
          { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } } as any,
          { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } } as any,
          { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } } as any,
          { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } } as any,
          { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } } as any,
        ],
      },
    };
    const out = migrateManifest(input);
    const tree = (out as any).document.featureTree;
    expect(tree.length).toBe(7);
  });

  it('assembly manifests are untouched (no origin features)', () => {
    const input: AnyManifest = {
      formatVersion: 7,
      kind: 'assembly',
      document: { id: 'A1', name: 'a', units: 'mm', parameters: {}, components: [] },
    };
    const out = migrateManifest(input);
    expect((out as any).document.components).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `packages/shared/src/fileFormat.ts`, add a normalization pass that runs after `kind` defaulting (introduced in 4a-T2):

```ts
const ORIGIN_FEATURES = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
];

function injectOriginFeatures(m: AnyManifest): AnyManifest {
  const anyM = m as any;
  if (anyM.kind !== 'part') return m;
  const tree = anyM.document?.featureTree ?? [];
  const hasOrigin = tree.some((f: any) => typeof f.id === 'string' && f.id.startsWith('origin.'));
  if (hasOrigin) return m;
  return {
    ...anyM,
    document: {
      ...anyM.document,
      featureTree: [...ORIGIN_FEATURES, ...tree],
    },
  };
}
```

Wire it in the `migrateManifest` chain after `normalizeKind`.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts \
        packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): migrateManifest injects origin work features for legacy v7 parts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: migrateManifest migrates sketch.plane string → PlaneRef

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('migrateManifest sketch.plane migration', () => {
  it('migrates plane: "XY" to { source: "workPlane", featureId: "origin.XY" }', () => {
    const input: AnyManifest = {
      formatVersion: 7, kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY' as any, primitives: [], constraints: [] } as any,
        ],
      },
    };
    const out = migrateManifest(input);
    const tree = (out as any).document.featureTree;
    const sketch = tree.find((f: any) => f.id === 'S1');
    expect(sketch.plane).toEqual({ source: 'workPlane', featureId: 'origin.XY' });
  });

  it('leaves PlaneRef sketches untouched', () => {
    const planeRef = { source: 'workPlane', featureId: 'origin.YZ' };
    const input: AnyManifest = {
      formatVersion: 7, kind: 'part',
      document: {
        id: 'P1', name: 'p', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: planeRef, primitives: [], constraints: [] } as any,
        ],
      },
    };
    const out = migrateManifest(input);
    const sketch = (out as any).document.featureTree.find((f: any) => f.id === 'S1');
    expect(sketch.plane).toEqual(planeRef);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Add another normalization pass in `fileFormat.ts`:

```ts
function migrateSketchPlanes(m: AnyManifest): AnyManifest {
  const anyM = m as any;
  if (anyM.kind !== 'part') return m;
  const tree = anyM.document?.featureTree ?? [];
  let changed = false;
  const next = tree.map((f: any) => {
    if (f.kind !== 'sketch') return f;
    if (typeof f.plane === 'string') {
      changed = true;
      return { ...f, plane: { source: 'workPlane', featureId: `origin.${f.plane}` } };
    }
    return f;
  });
  if (!changed) return m;
  return { ...anyM, document: { ...anyM.document, featureTree: next } };
}
```

Wire it after `injectOriginFeatures` in `migrateManifest`.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/shared test:unit
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts \
        packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "$(cat <<'EOF'
feat(shared): migrateManifest migrates sketch.plane string literals to PlaneRef

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: SketchFeature consumes PlaneRef in kernel

**Files:**
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`

This task switches kernel-side sketch evaluation from a string-keyed plane lookup to a `PlaneRef` resolver. The full work-feature resolver lands in Task 9 — for this task, we handle the only legal `PlaneRef` so far: `{ source: 'workPlane', featureId: 'origin.{XY,YZ,XZ}' }`.

- [ ] **Step 1: Write failing test**

Update the existing sketch integration test (or add a focused one):

```ts
it('sketch plane resolves an origin workPlane reference', async () => {
  const occt = await loadOcct();
  const part: PartDocument = {
    id: 'P1', name: 'p', units: 'mm', parameters: { d: { name: 'd', expression: '10', value: 10, unit: 'mm' } },
    featureTree: [
      { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
      { kind: 'sketch', id: 'S1',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }], constraints: [] },
      { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd', direction: 'forward', operation: 'new' },
    ],
  };
  const r = await executeTree(occt, part);
  expect(r.ok).toBe(true);
});
```

- [ ] **Step 2: Run — should fail**

FAIL (the existing string-keyed lookup doesn't handle PlaneRef).

- [ ] **Step 3: Implement**

In `SketchFeature.ts`, find the existing plane-to-`gp_Pln` mapping. Replace the switch on the string with a `PlaneRef` resolver fragment:

```ts
function resolveOriginPlane(plane: PlaneRef): { ok: true; plane: 'XY'|'YZ'|'XZ' } | { ok: false; message: string } {
  if (plane.source !== 'workPlane') {
    return { ok: false, message: `Sketch plane: only origin work planes supported until WorkFeatureOps lands. Got source=${plane.source}` };
  }
  const id = plane.featureId;
  if (id === 'origin.XY') return { ok: true, plane: 'XY' };
  if (id === 'origin.YZ') return { ok: true, plane: 'YZ' };
  if (id === 'origin.XZ') return { ok: true, plane: 'XZ' };
  return { ok: false, message: `Sketch plane: unknown work plane ${id}. WorkFeatureOps will handle in Task 9.` };
}
```

Use the resolver to convert the PlaneRef into the existing OCCT call. Tasks 9–14 will replace this stub with the full evaluator chain.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/kernel test:unit -- SketchFeature
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/SketchFeature.ts \
        packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts
git commit -m "$(cat <<'EOF'
feat(kernel): SketchFeature reads plane from PlaneRef (origin work planes)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Kernel `WorkFeatureOps.ts` skeleton + Vec3 helpers

**Files:**
- Create: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Create: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts
import { describe, it, expect } from 'vitest';
import { dot, cross, sub, normalize, length, type Vec3 } from '../WorkFeatureOps';

describe('Vec3 helpers', () => {
  it('dot product', () => {
    expect(dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32);
  });
  it('cross product', () => {
    expect(cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({ x: 0, y: 0, z: 1 });
  });
  it('subtract', () => {
    expect(sub({ x: 5, y: 5, z: 5 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 4, y: 3, z: 2 });
  });
  it('normalize', () => {
    const n = normalize({ x: 3, y: 0, z: 0 });
    expect(n.x).toBeCloseTo(1, 5);
  });
  it('length', () => {
    expect(length({ x: 3, y: 4, z: 0 })).toBeCloseTo(5, 5);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL (file doesn't exist).

- [ ] **Step 3: Implement**

```ts
// packages/kernel/src/occt/WorkFeatureOps.ts
import type {
  AxisRef, PlaneRef, PointRef,
  WorkAxisFeature, WorkPlaneFeature, WorkPointFeature,
  WorkFeatureValue, KernelError, Result, Vec3, FaceName, EdgeName,
} from '@zilventor/shared';
import type { OcctInstance } from './occtLoader';
import type { NamedShape } from './FaceNaming';

export type { Vec3 } from '@zilventor/shared';

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (v: Vec3, s: number): Vec3 => ({ x: v.x * s, y: v.y * s, z: v.z * s });
export const length = (v: Vec3): number => Math.sqrt(dot(v, v));
export const normalize = (v: Vec3): Vec3 => {
  const l = length(v);
  if (l < 1e-12) return { x: 0, y: 0, z: 0 };
  return scale(v, 1 / l);
};

// Stubs filled in by Tasks 9–14.
export function evaluateWorkAxis(
  _occt: OcctInstance, _shape: NamedShape | null,
  _source: WorkAxisFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; direction: Vec3 }, KernelError> {
  return { ok: false, error: { kind: 'notImplemented', message: 'evaluateWorkAxis not yet implemented' } };
}

export function evaluateWorkPlane(
  _occt: OcctInstance, _shape: NamedShape | null,
  _source: WorkPlaneFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; normal: Vec3 }, KernelError> {
  return { ok: false, error: { kind: 'notImplemented', message: 'evaluateWorkPlane not yet implemented' } };
}

export function evaluateWorkPoint(
  _occt: OcctInstance, _shape: NamedShape | null,
  _source: WorkPointFeature['source'],
  _wfs: Map<string, WorkFeatureValue>,
): Result<{ position: Vec3 }, KernelError> {
  return { ok: false, error: { kind: 'notImplemented', message: 'evaluateWorkPoint not yet implemented' } };
}
```

If the `notImplemented` kind doesn't exist in `KernelError`, add it to the error union in `packages/shared/src/types.ts`.

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/kernel test:unit -- WorkFeatureOps
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/WorkFeatureOps.ts \
        packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts \
        packages/shared/src/types.ts
git commit -m "$(cat <<'EOF'
feat(kernel): WorkFeatureOps skeleton + Vec3 helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — Kernel evaluators

### Task 9: Origin-mode evaluators (axis/plane/point)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

The simplest of all — just hardcoded outputs.

- [ ] **Step 1: Write failing tests**

```ts
describe('evaluateWorkAxis origin', () => {
  it('axis X → origin (0,0,0) direction (1,0,0)', () => {
    const r = evaluateWorkAxis(null as any, null, { mode: 'origin', axis: 'X' }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } });
  });
  it.each([
    ['Y', { x: 0, y: 1, z: 0 }],
    ['Z', { x: 0, y: 0, z: 1 }],
  ])('axis %s direction is %j', (axis, expected) => {
    const r = evaluateWorkAxis(null as any, null, { mode: 'origin', axis: axis as any }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.direction).toEqual(expected);
  });
});

describe('evaluateWorkPlane origin', () => {
  it.each([
    ['XY', { x: 0, y: 0, z: 1 }],
    ['YZ', { x: 1, y: 0, z: 0 }],
    ['XZ', { x: 0, y: 1, z: 0 }],
  ])('plane %s normal is %j', (plane, expected) => {
    const r = evaluateWorkPlane(null as any, null, { mode: 'origin', plane: plane as any }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normal).toEqual(expected);
  });
});

describe('evaluateWorkPoint origin', () => {
  it('returns (0,0,0)', () => {
    const r = evaluateWorkPoint(null as any, null, { mode: 'origin' }, new Map());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `WorkFeatureOps.ts`, replace the three stub bodies:

```ts
export function evaluateWorkAxis(occt, shape, source, wfs): Result<...> {
  if (source.mode === 'origin') {
    const dir =
      source.axis === 'X' ? { x: 1, y: 0, z: 0 } :
      source.axis === 'Y' ? { x: 0, y: 1, z: 0 } :
      { x: 0, y: 0, z: 1 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, direction: dir } };
  }
  return { ok: false, error: { kind: 'notImplemented', message: `evaluateWorkAxis: mode ${source.mode} not yet` } };
}

export function evaluateWorkPlane(occt, shape, source, wfs): Result<...> {
  if (source.mode === 'origin') {
    const n =
      source.plane === 'XY' ? { x: 0, y: 0, z: 1 } :
      source.plane === 'YZ' ? { x: 1, y: 0, z: 0 } :
      { x: 0, y: 1, z: 0 };
    return { ok: true, value: { origin: { x: 0, y: 0, z: 0 }, normal: n } };
  }
  return { ok: false, error: { kind: 'notImplemented', message: `evaluateWorkPlane: mode ${source.mode}` } };
}

export function evaluateWorkPoint(occt, shape, source, wfs): Result<...> {
  if (source.mode === 'origin') {
    return { ok: true, value: { position: { x: 0, y: 0, z: 0 } } };
  }
  return { ok: false, error: { kind: 'notImplemented', message: `evaluateWorkPoint: mode ${source.mode}` } };
}
```

- [ ] **Step 4: Run — should pass**

```
pnpm -C packages/kernel test:unit -- WorkFeatureOps
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(kernel): WorkFeatureOps origin-mode evaluators ..."
```

---

### Task 10: Reference resolvers (resolveAxis/Plane/PointRef)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

Resolvers convert a `*Ref` (which may point to a face, edge, vertex, or another work feature) into a Vec3 representation, looking up prior work features through the provided Map.

- [ ] **Step 1: Write failing tests**

```ts
describe('resolvePlaneRef', () => {
  it('resolves a workPlane reference from the cache', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = resolvePlaneRef({ source: 'workPlane', featureId: 'origin.XY' }, null as any, null, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('returns notFound when work plane is missing', () => {
    const r = resolvePlaneRef({ source: 'workPlane', featureId: 'missing' }, null as any, null, new Map());
    expect(r.ok).toBe(false);
  });
});

describe('resolveAxisRef', () => {
  it('resolves a workAxis reference from the cache', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['WA1', { featureId: 'WA1', kind: 'axis', origin: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = resolveAxisRef({ source: 'workAxis', featureId: 'WA1' }, null as any, null, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.origin).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('resolvePointRef', () => {
  it('resolves a workPoint reference', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.O', { featureId: 'origin.O', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
    ]);
    const r = resolvePointRef({ source: 'workPoint', featureId: 'origin.O' }, null as any, null, wfs);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
export function resolveAxisRef(
  ref: AxisRef, occt: OcctInstance | null, shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; direction: Vec3 }, KernelError> {
  if (ref.source === 'workAxis') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'axis') {
      return { ok: false, error: { kind: 'notFound', message: `work axis ${ref.featureId} not found` } };
    }
    return { ok: true, value: { origin: v.origin, direction: v.direction } };
  }
  // cylindricalFace / edge come in Tasks 11 + 13
  return { ok: false, error: { kind: 'notImplemented', message: `resolveAxisRef: source ${ref.source}` } };
}

export function resolvePlaneRef(
  ref: PlaneRef, occt: OcctInstance | null, shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ origin: Vec3; normal: Vec3 }, KernelError> {
  if (ref.source === 'workPlane') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'plane') {
      return { ok: false, error: { kind: 'notFound', message: `work plane ${ref.featureId} not found` } };
    }
    return { ok: true, value: { origin: v.origin, normal: v.normal } };
  }
  // face comes in Task 12
  return { ok: false, error: { kind: 'notImplemented', message: `resolvePlaneRef: source ${ref.source}` } };
}

export function resolvePointRef(
  ref: PointRef, occt: OcctInstance | null, shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
): Result<{ position: Vec3 }, KernelError> {
  if (ref.source === 'workPoint') {
    const v = wfs.get(ref.featureId);
    if (!v || v.kind !== 'point') {
      return { ok: false, error: { kind: 'notFound', message: `work point ${ref.featureId} not found` } };
    }
    return { ok: true, value: { position: v.position } };
  }
  // vertex comes in Task 13
  return { ok: false, error: { kind: 'notImplemented', message: `resolvePointRef: source ${ref.source}` } };
}
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(kernel): WorkFeatureOps reference resolvers (work-feature → world-space)
```

---

### Task 11: WorkAxis evaluator — modes that depend only on resolvers (twoPoints, normalToPlaneThroughPoint, twoPlanes)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

These three modes don't need OCCT — they're pure linear algebra over resolved point/plane refs.

- [ ] **Step 1: Write failing tests**

```ts
describe('evaluateWorkAxis non-OCCT modes', () => {
  it('twoPoints axis from origin to (10,0,0)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.O', { featureId: 'origin.O', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
      ['P1', { featureId: 'P1', kind: 'point', position: { x: 10, y: 0, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(null as any, null, {
      mode: 'twoPoints',
      pointA: { source: 'workPoint', featureId: 'origin.O' },
      pointB: { source: 'workPoint', featureId: 'P1' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 0, y: 0, z: 0 });
      expect(r.value.direction.x).toBeCloseTo(1, 5);
    }
  });

  it('normalToPlaneThroughPoint: plane XY, point (3,4,0) → axis up at (3,4,0)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['P', { featureId: 'P', kind: 'point', position: { x: 3, y: 4, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(null as any, null, {
      mode: 'normalToPlaneThroughPoint',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      point: { source: 'workPoint', featureId: 'P' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin).toEqual({ x: 3, y: 4, z: 0 });
      expect(r.value.direction).toEqual({ x: 0, y: 0, z: 1 });
    }
  });

  it('twoPlanes: XY ∩ XZ = X-axis', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['origin.XZ', { featureId: 'origin.XZ', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }],
    ]);
    const r = evaluateWorkAxis(null as any, null, {
      mode: 'twoPlanes',
      planeA: { source: 'workPlane', featureId: 'origin.XY' },
      planeB: { source: 'workPlane', featureId: 'origin.XZ' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.value.direction.x)).toBeCloseTo(1, 5);
      expect(r.value.direction.y).toBeCloseTo(0, 5);
      expect(r.value.direction.z).toBeCloseTo(0, 5);
    }
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `evaluateWorkAxis`, before the trailing `return { ok: false, error: { kind: 'notImplemented', ... } }`, add:

```ts
if (source.mode === 'twoPoints') {
  const a = resolvePointRef(source.pointA, occt, shape, wfs);
  if (!a.ok) return a;
  const b = resolvePointRef(source.pointB, occt, shape, wfs);
  if (!b.ok) return b;
  const dir = normalize(sub(b.value.position, a.value.position));
  return { ok: true, value: { origin: a.value.position, direction: dir } };
}
if (source.mode === 'normalToPlaneThroughPoint') {
  const pl = resolvePlaneRef(source.plane, occt, shape, wfs);
  if (!pl.ok) return pl;
  const pt = resolvePointRef(source.point, occt, shape, wfs);
  if (!pt.ok) return pt;
  return { ok: true, value: { origin: pt.value.position, direction: normalize(pl.value.normal) } };
}
if (source.mode === 'twoPlanes') {
  const pa = resolvePlaneRef(source.planeA, occt, shape, wfs);
  if (!pa.ok) return pa;
  const pb = resolvePlaneRef(source.planeB, occt, shape, wfs);
  if (!pb.ok) return pb;
  const dir = normalize(cross(pa.value.normal, pb.value.normal));
  if (length(dir) < 1e-9) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'twoPlanes: planes are parallel; no intersection axis' } };
  }
  // Find a point on both planes by solving the 2x2 system in the dominant coords.
  // Pick the axis with smallest |dir.X|, |dir.Y|, |dir.Z| as the free coord = 0.
  const fixCoord =
    Math.abs(dir.x) < Math.abs(dir.y)
      ? (Math.abs(dir.x) < Math.abs(dir.z) ? 'x' : 'z')
      : (Math.abs(dir.y) < Math.abs(dir.z) ? 'y' : 'z');
  // Standard: solve nA·x = nA·oA, nB·x = nB·oB with one coord pinned to 0.
  const dA = dot(pa.value.normal, pa.value.origin);
  const dB = dot(pb.value.normal, pb.value.origin);
  let origin: Vec3;
  if (fixCoord === 'x') {
    const det = pa.value.normal.y * pb.value.normal.z - pa.value.normal.z * pb.value.normal.y;
    const y = (dA * pb.value.normal.z - dB * pa.value.normal.z) / det;
    const z = (pa.value.normal.y * dB - pb.value.normal.y * dA) / det;
    origin = { x: 0, y, z };
  } else if (fixCoord === 'y') {
    const det = pa.value.normal.x * pb.value.normal.z - pa.value.normal.z * pb.value.normal.x;
    const x = (dA * pb.value.normal.z - dB * pa.value.normal.z) / det;
    const z = (pa.value.normal.x * dB - pb.value.normal.x * dA) / det;
    origin = { x, y: 0, z };
  } else {
    const det = pa.value.normal.x * pb.value.normal.y - pa.value.normal.y * pb.value.normal.x;
    const x = (dA * pb.value.normal.y - dB * pa.value.normal.y) / det;
    const y = (pa.value.normal.x * dB - pb.value.normal.x * dA) / det;
    origin = { x, y, z: 0 };
  }
  return { ok: true, value: { origin, direction: dir } };
}
```

If the `invalidGeometry` kind doesn't exist in `KernelError`, add it to the error union.

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(kernel): WorkAxis evaluators — twoPoints, normalToPlaneThroughPoint, twoPlanes
```

---

### Task 12: WorkPlane evaluator — non-OCCT modes (offsetFromPlane, threePoints, midplane, axisAtAngleToPlane, axisPerpendicularToPlane)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('evaluateWorkPlane non-OCCT modes', () => {
  it('offsetFromPlane: XY + 10mm → origin (0,0,10) normal (0,0,1)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['origin.XY', { featureId: 'origin.XY', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(null as any, null, {
      mode: 'offsetFromPlane',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      offset: { kind: 'literal', value: 10 },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.origin.z).toBeCloseTo(10, 5);
      expect(r.value.normal.z).toBeCloseTo(1, 5);
    }
  });

  it('threePoints: (0,0,0) (1,0,0) (0,1,0) → XY plane', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['A', { featureId: 'A', kind: 'point', position: { x: 0, y: 0, z: 0 } }],
      ['B', { featureId: 'B', kind: 'point', position: { x: 1, y: 0, z: 0 } }],
      ['C', { featureId: 'C', kind: 'point', position: { x: 0, y: 1, z: 0 } }],
    ]);
    const r = evaluateWorkPlane(null as any, null, {
      mode: 'threePoints',
      points: [
        { source: 'workPoint', featureId: 'A' },
        { source: 'workPoint', featureId: 'B' },
        { source: 'workPoint', featureId: 'C' },
      ],
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.normal.z).toBeCloseTo(1, 5);
  });

  it('midplane: XY at z=0 + XY at z=10 → XY at z=5', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['P0', { featureId: 'P0', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['P1', { featureId: 'P1', kind: 'plane', origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(null as any, null, {
      mode: 'midplane',
      planeA: { source: 'workPlane', featureId: 'P0' },
      planeB: { source: 'workPlane', featureId: 'P1' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.origin.z).toBeCloseTo(5, 5);
  });

  it('axisPerpendicularToPlane: X-axis perpendicular to XY → plane through X-axis with normal Y', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['ax', { featureId: 'ax', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }],
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(null as any, null, {
      mode: 'axisPerpendicularToPlane',
      axis: { source: 'workAxis', featureId: 'ax' },
      plane: { source: 'workPlane', featureId: 'xy' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.value.normal.y)).toBeCloseTo(1, 5);
  });

  it('axisAtAngleToPlane: 90° from X-axis at XY → vertical plane through X', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['ax', { featureId: 'ax', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }],
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPlane(null as any, null, {
      mode: 'axisAtAngleToPlane',
      axis: { source: 'workAxis', featureId: 'ax' },
      plane: { source: 'workPlane', featureId: 'xy' },
      angle: { kind: 'literal', value: 90 },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Math.abs(r.value.normal.z)).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Add a helper for parameter resolution at the top of the file:

```ts
function resolveParam(p: ParamOrLiteral, params: Record<string, { value: number }>): number {
  if (p.kind === 'literal') return p.value;
  return params[p.paramName]?.value ?? 0;
}
```

`evaluateWorkPlane` signature gains a `params: Record<string, ParameterDef>` argument (update caller in `executeTree` later, Task 16). Then add the mode branches:

```ts
if (source.mode === 'offsetFromPlane') {
  const pl = resolvePlaneRef(source.plane, occt, shape, wfs);
  if (!pl.ok) return pl;
  const off = resolveParam(source.offset, params);
  return {
    ok: true,
    value: {
      origin: add(pl.value.origin, scale(normalize(pl.value.normal), off)),
      normal: pl.value.normal,
    },
  };
}
if (source.mode === 'threePoints') {
  const a = resolvePointRef(source.points[0], occt, shape, wfs);
  if (!a.ok) return a;
  const b = resolvePointRef(source.points[1], occt, shape, wfs);
  if (!b.ok) return b;
  const c = resolvePointRef(source.points[2], occt, shape, wfs);
  if (!c.ok) return c;
  const ab = sub(b.value.position, a.value.position);
  const ac = sub(c.value.position, a.value.position);
  const n = cross(ab, ac);
  if (length(n) < 1e-9) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'threePoints: collinear' } };
  }
  return { ok: true, value: { origin: a.value.position, normal: normalize(n) } };
}
if (source.mode === 'midplane') {
  const a = resolvePlaneRef(source.planeA, occt, shape, wfs);
  if (!a.ok) return a;
  const b = resolvePlaneRef(source.planeB, occt, shape, wfs);
  if (!b.ok) return b;
  // Require near-parallel normals
  const dotN = Math.abs(dot(normalize(a.value.normal), normalize(b.value.normal)));
  if (dotN < 0.999) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'midplane: input planes are not parallel' } };
  }
  const mid = scale(add(a.value.origin, b.value.origin), 0.5);
  return { ok: true, value: { origin: mid, normal: normalize(a.value.normal) } };
}
if (source.mode === 'axisPerpendicularToPlane') {
  const ax = resolveAxisRef(source.axis, occt, shape, wfs);
  if (!ax.ok) return ax;
  const pl = resolvePlaneRef(source.plane, occt, shape, wfs);
  if (!pl.ok) return pl;
  // Plane contains the axis and has normal perpendicular to plane.normal AND axis.direction.
  const n = normalize(cross(ax.value.direction, pl.value.normal));
  if (length(n) < 1e-9) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'axisPerpendicularToPlane: axis parallel to plane normal' } };
  }
  return { ok: true, value: { origin: ax.value.origin, normal: n } };
}
if (source.mode === 'axisAtAngleToPlane') {
  const ax = resolveAxisRef(source.axis, occt, shape, wfs);
  if (!ax.ok) return ax;
  const pl = resolvePlaneRef(source.plane, occt, shape, wfs);
  if (!pl.ok) return pl;
  const angle = (resolveParam(source.angle, params) * Math.PI) / 180;
  // Start with plane normal; rotate by `angle` about the axis direction (Rodrigues).
  const k = normalize(ax.value.direction);
  const n0 = pl.value.normal;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const term1 = scale(n0, cosA);
  const term2 = scale(cross(k, n0), sinA);
  const term3 = scale(k, dot(k, n0) * (1 - cosA));
  const n = normalize(add(add(term1, term2), term3));
  return { ok: true, value: { origin: ax.value.origin, normal: n } };
}
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(kernel): WorkPlane evaluators — offset, threePoints, midplane, axisPerp, axisAngle
```

---

### Task 13: WorkPoint evaluator — non-OCCT modes (axisIntersectsPlane, threePlanes)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('evaluateWorkPoint non-OCCT modes', () => {
  it('axisIntersectsPlane: Z-axis ∩ XY at z=10 → (0,0,10)', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['ax', { featureId: 'ax', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } }],
      ['pl', { featureId: 'pl', kind: 'plane', origin: { x: 0, y: 0, z: 10 }, normal: { x: 0, y: 0, z: 1 } }],
    ]);
    const r = evaluateWorkPoint(null as any, null, {
      mode: 'axisIntersectsPlane',
      axis: { source: 'workAxis', featureId: 'ax' },
      plane: { source: 'workPlane', featureId: 'pl' },
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.position.z).toBeCloseTo(10, 5);
  });

  it('threePlanes: XY ∩ YZ ∩ XZ → origin', () => {
    const wfs = new Map<string, WorkFeatureValue>([
      ['xy', { featureId: 'xy', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } }],
      ['yz', { featureId: 'yz', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } }],
      ['xz', { featureId: 'xz', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } }],
    ]);
    const r = evaluateWorkPoint(null as any, null, {
      mode: 'threePlanes',
      planes: [
        { source: 'workPlane', featureId: 'xy' },
        { source: 'workPlane', featureId: 'yz' },
        { source: 'workPlane', featureId: 'xz' },
      ],
    }, wfs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.position).toEqual({ x: 0, y: 0, z: 0 });
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
if (source.mode === 'axisIntersectsPlane') {
  const ax = resolveAxisRef(source.axis, occt, shape, wfs);
  if (!ax.ok) return ax;
  const pl = resolvePlaneRef(source.plane, occt, shape, wfs);
  if (!pl.ok) return pl;
  const denom = dot(ax.value.direction, pl.value.normal);
  if (Math.abs(denom) < 1e-9) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'axisIntersectsPlane: axis parallel to plane' } };
  }
  const t = dot(sub(pl.value.origin, ax.value.origin), pl.value.normal) / denom;
  return { ok: true, value: { position: add(ax.value.origin, scale(ax.value.direction, t)) } };
}
if (source.mode === 'threePlanes') {
  // Solve a 3x3 linear system: each plane's normal·x = normal·origin.
  const planes = await Promise.all(source.planes.map((p) => Promise.resolve(resolvePlaneRef(p, occt, shape, wfs))));
  for (const r of planes) if (!r.ok) return r as any;
  const okPlanes = planes.map((r) => (r as any).value as { origin: Vec3; normal: Vec3 });
  const n = okPlanes.map((p) => p.normal);
  const d = okPlanes.map((p) => dot(p.normal, p.origin));
  // Cramer's rule
  const det = (m: number[][]): number =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!)
    - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!)
    + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const M = [
    [n[0]!.x, n[0]!.y, n[0]!.z],
    [n[1]!.x, n[1]!.y, n[1]!.z],
    [n[2]!.x, n[2]!.y, n[2]!.z],
  ];
  const D = det(M);
  if (Math.abs(D) < 1e-9) {
    return { ok: false, error: { kind: 'invalidGeometry', message: 'threePlanes: planes are linearly dependent' } };
  }
  const Mx = M.map((row, i) => [d[i]!, row[1]!, row[2]!]);
  const My = M.map((row, i) => [row[0]!, d[i]!, row[2]!]);
  const Mz = M.map((row, i) => [row[0]!, row[1]!, d[i]!]);
  return {
    ok: true,
    value: { position: { x: det(Mx) / D, y: det(My) / D, z: det(Mz) / D } },
  };
}
```

(The `await Promise.all` is unnecessary since `resolvePlaneRef` is sync — replace with `.map(...)` and the in-loop `for` early-return.)

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(kernel): WorkPoint evaluators — axisIntersectsPlane, threePlanes
```

---

### Task 14: OCCT-bound evaluators (cylindricalFace axis, edge axis, face plane, vertex point, midpointOfEdge, centerOfArc, tangentToSurfaceParallelToPlane)

**Files:**
- Modify: `packages/kernel/src/occt/WorkFeatureOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/WorkFeatureOps.spec.ts`
- Possibly modify: `packages/kernel/src/occt/FaceNaming.ts` (helpers to look up shape by FaceName)

These modes need OCCT to extract geometry from existing shapes (cylinder axes, sphere centers, edge endpoints).

This is the most complex task in the kernel layer. Decompose into per-mode implementations, each with its own integration test that builds a known shape and verifies the evaluator's output. Use `BRepAdaptor_Surface`, `BRepAdaptor_Curve`, `BRep_Tool`, and `gp_Cylinder` / `gp_Pln` / `gp_Circ` / `gp_Lin` / `gp_Sphere` types from `opencascade.js`.

For the seven OCCT-bound modes, mirror the existing `FilletOps.ts` / `HoleOps.ts` patterns when reading shape topology.

- [ ] **Step 1–4: Per-mode TDD**

For each mode, write a failing integration test (build a cube + extract a face/edge, run the evaluator, assert the geometry), implement, run, commit. **One commit per mode** (this is intentional — the task is large and easier to bisect by mode).

- [ ] **Step 5: Commit**

This task produces 7 commits total:
- `feat(kernel): WorkAxis cylindricalFace`
- `feat(kernel): WorkAxis edge`
- `feat(kernel): WorkPlane face` (and `resolvePlaneRef face`)
- `feat(kernel): WorkPoint vertex` (and `resolvePointRef vertex`)
- `feat(kernel): WorkPoint midpointOfEdge`
- `feat(kernel): WorkPoint centerOfArc`
- `feat(kernel): WorkPlane tangentToSurfaceParallelToPlane`

---

### Task 15: executeTree integration — collect workFeatures into ExecuteResult

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
it('executeTree returns workFeatures for parts with work-feature nodes', async () => {
  const occt = await loadOcct();
  const part: PartDocument = newPart('P1');  // has 7 origin features
  // Add a userland work plane offset 10mm from origin XY
  part.featureTree.push({
    kind: 'workPlane', id: 'WP1', visible: true,
    source: {
      mode: 'offsetFromPlane',
      plane: { source: 'workPlane', featureId: 'origin.XY' },
      offset: { kind: 'literal', value: 10 },
    },
  });
  const r = await executeTree(occt, part);
  expect(r.ok).toBe(true);
  if (r.ok) {
    const wfs = (r.value.workFeatures ?? []) as WorkFeatureValue[];
    const wp1 = wfs.find((w) => w.featureId === 'WP1');
    expect(wp1).toBeDefined();
    expect(wp1!.kind).toBe('plane');
    if (wp1?.kind === 'plane') expect(wp1.origin.z).toBeCloseTo(10, 5);
  }
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `executeTree`, after the iteration that processes solid-producing features, add a pass over the feature tree that evaluates work features:

```ts
const workFeatures = new Map<string, WorkFeatureValue>();
for (const f of part.featureTree) {
  if (f.kind === 'workAxis') {
    const r = evaluateWorkAxis(occt, currentNamedShape, f.source, workFeatures);
    if (r.ok) {
      workFeatures.set(f.id, { featureId: f.id, kind: 'axis', origin: r.value.origin, direction: r.value.direction });
    } else {
      featureErrors.set(f.id, r.error);
    }
  } else if (f.kind === 'workPlane') {
    const r = evaluateWorkPlane(occt, currentNamedShape, f.source, workFeatures, part.parameters);
    if (r.ok) {
      workFeatures.set(f.id, { featureId: f.id, kind: 'plane', origin: r.value.origin, normal: r.value.normal });
    } else {
      featureErrors.set(f.id, r.error);
    }
  } else if (f.kind === 'workPoint') {
    const r = evaluateWorkPoint(occt, currentNamedShape, f.source, workFeatures);
    if (r.ok) {
      workFeatures.set(f.id, { featureId: f.id, kind: 'point', position: r.value.position });
    } else {
      featureErrors.set(f.id, r.error);
    }
  }
}
```

Pass `Array.from(workFeatures.values())` into the `ExecutionResult` returned to `kernel.execute`.

Important: work features are evaluated in feature-tree order, so a downstream work feature can reference an upstream one via the `workFeatures` Map (already populated by the time the loop reaches it). Origin features (which appear at index 0–6) populate first, so user features see them.

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(kernel): executeTree collects workFeatures into ExecuteResult
```

---

### Task 16: Integration test — sketch-on-work-plane round trip

**Files:**
- Create: `packages/kernel/src/__tests__/WorkFeature.integration.spec.ts`

End-to-end: build a part with sketch on `origin.XY`, extrude, add a work plane offset 10mm from the top face, sketch on that, extrude. Assert `workFeatures` array has correct entries for each pass.

- [ ] **Step 1–4: Write + verify**

Mirror existing kernel integration spec style.

- [ ] **Step 5: Commit**

```
test(kernel): WorkFeature integration — sketch on derived work plane
```

---

## Phase 3 — Renderer

### Task 17: SceneManager.setWorkFeatures + axis renderer

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('SceneManager — work features', () => {
  let mgr: SceneManager;
  beforeEach(() => {
    const canvas = document.createElement('canvas');
    mgr = new SceneManager(canvas);
  });

  it('setWorkFeatures adds an axis renderer node', () => {
    mgr.setWorkFeatures([
      { featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true },
    ]);
    expect(mgr.workFeatureCount()).toBe(1);
    const node = mgr.getWorkFeatureNode('WA1');
    expect(node).toBeDefined();
  });

  it('updates same id in place', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true }]);
    const a = mgr.getWorkFeatureNode('WA1');
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 5, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 }, visible: true }]);
    const b = mgr.getWorkFeatureNode('WA1');
    expect(a).toBe(b);
  });

  it('removes nodes whose id is no longer in the spec list', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: true }]);
    mgr.setWorkFeatures([]);
    expect(mgr.workFeatureCount()).toBe(0);
  });

  it('respects visible flag', () => {
    mgr.setWorkFeatures([{ featureId: 'WA1', kind: 'axis', origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 }, visible: false }]);
    expect(mgr.getWorkFeatureNode('WA1')!.visible).toBe(false);
  });
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement**

```ts
private workFeatureNodes = new Map<string, THREE.Object3D>();
private workFeatureMaterial = {
  axis: new THREE.LineDashedMaterial({ color: 0xe8c36a, dashSize: 8, gapSize: 4 }),
};

setWorkFeatures(specs: Array<{
  featureId: string;
  kind: 'axis' | 'plane' | 'point';
  origin: Vec3;
  direction?: Vec3;
  normal?: Vec3;
  visible: boolean;
}>): void {
  const incoming = new Set(specs.map((s) => s.featureId));
  for (const [id, node] of this.workFeatureNodes) {
    if (!incoming.has(id)) {
      this.scene.remove(node);
      this.workFeatureNodes.delete(id);
    }
  }
  for (const spec of specs) {
    let node = this.workFeatureNodes.get(spec.featureId);
    if (!node) {
      node = this.buildWorkFeatureNode(spec);
      node.userData.workFeatureId = spec.featureId;
      this.scene.add(node);
      this.workFeatureNodes.set(spec.featureId, node);
    } else {
      this.updateWorkFeatureNode(node, spec);
    }
    // Store the spec on the node so geometryHash() and pickers can read it without
    // re-parsing the scene-graph geometry. Axis direction in particular isn't
    // recoverable from a Line node's transform.
    node.userData.workFeatureSpec = spec;
    node.visible = spec.visible;
  }
}

clearWorkFeatures(): void {
  for (const n of this.workFeatureNodes.values()) this.scene.remove(n);
  this.workFeatureNodes.clear();
}

workFeatureCount(): number { return this.workFeatureNodes.size; }
getWorkFeatureNode(id: string): THREE.Object3D | undefined { return this.workFeatureNodes.get(id); }

// Axis-only build/update — Tasks 18 + 19 add plane and point.
private buildWorkFeatureNode(spec): THREE.Object3D {
  if (spec.kind === 'axis') {
    const dir = new THREE.Vector3(spec.direction!.x, spec.direction!.y, spec.direction!.z).normalize();
    const half = 100;  // 200 mm long
    const p1 = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z).addScaledVector(dir, -half);
    const p2 = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z).addScaledVector(dir,  half);
    const g = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(g, this.workFeatureMaterial.axis);
    line.computeLineDistances();
    return line;
  }
  // Plane + Point come in Tasks 18 + 19.
  return new THREE.Group();
}

private updateWorkFeatureNode(node: THREE.Object3D, spec): void {
  if (spec.kind === 'axis' && (node as THREE.Line).geometry) {
    const dir = new THREE.Vector3(spec.direction!.x, spec.direction!.y, spec.direction!.z).normalize();
    const half = 100;
    const p1 = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z).addScaledVector(dir, -half);
    const p2 = new THREE.Vector3(spec.origin.x, spec.origin.y, spec.origin.z).addScaledVector(dir,  half);
    (node as THREE.Line).geometry.setFromPoints([p1, p2]);
    (node as THREE.Line).computeLineDistances();
  }
}
```

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(app): SceneManager — work-feature axis renderer (diff render)
```

---

### Task 18: SceneManager work-plane renderer

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
it('builds a plane node with translucent rectangle + wireframe border', () => {
  mgr.setWorkFeatures([
    { featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true },
  ]);
  const node = mgr.getWorkFeatureNode('WP1') as THREE.Group;
  expect(node).toBeDefined();
  expect(node.children.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run — should fail**

- [ ] **Step 3: Implement**

Extend `buildWorkFeatureNode`:

```ts
if (spec.kind === 'plane') {
  const group = new THREE.Group();
  const planeGeom = new THREE.PlaneGeometry(200, 200);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0x5b9ad8, opacity: 0.15, transparent: true,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const fill = new THREE.Mesh(planeGeom, fillMat);
  group.add(fill);
  const edges = new THREE.EdgesGeometry(planeGeom);
  const border = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x5b9ad8 }));
  group.add(border);
  // Orient: PlaneGeometry's default normal is +Z; rotate to match spec.normal.
  const targetNormal = new THREE.Vector3(spec.normal!.x, spec.normal!.y, spec.normal!.z).normalize();
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(defaultNormal, targetNormal);
  group.applyQuaternion(q);
  group.position.set(spec.origin.x, spec.origin.y, spec.origin.z);
  return group;
}
```

Extend `updateWorkFeatureNode` to handle plane updates similarly (re-set position + quaternion).

- [ ] **Step 4: Run — should pass**

- [ ] **Step 5: Commit**

```
feat(app): SceneManager — work-plane renderer
```

---

### Task 19: SceneManager work-point renderer

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
it('builds a point node as a small green cross', () => {
  mgr.setWorkFeatures([
    { featureId: 'WPT1', kind: 'point', origin: { x: 1, y: 2, z: 3 }, visible: true },
  ]);
  const node = mgr.getWorkFeatureNode('WPT1') as THREE.Group;
  expect(node).toBeDefined();
  expect(node.position.x).toBeCloseTo(1, 5);
});
```

- [ ] **Step 2–4: Implement + verify**

```ts
if (spec.kind === 'point') {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x7ed957 });
  const half = 3;  // 6 mm cross
  const make = (axis: 'x' | 'y' | 'z') => {
    const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0)];
    points[0]![axis] = -half;
    points[1]![axis] =  half;
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(g, mat);
  };
  group.add(make('x'));
  group.add(make('y'));
  group.add(make('z'));
  group.position.set(spec.origin.x, spec.origin.y, spec.origin.z);
  return group;
}
```

`updateWorkFeatureNode` for points just re-sets position.

- [ ] **Step 5: Commit**

```
feat(app): SceneManager — work-point renderer
```

---

### Task 20: SceneManager.geometryHash() folds work features

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
it('geometry hash includes work-feature transforms', () => {
  mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
  const a = mgr.geometryHash();
  mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
  const b = mgr.geometryHash();
  expect(a).not.toBe(b);
});

it('hidden work features do not affect the hash', () => {
  mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: false }]);
  const a = mgr.geometryHash();
  mgr.setWorkFeatures([]);
  const b = mgr.geometryHash();
  expect(a).toBe(b);
});
```

- [ ] **Step 2–4: Implement + verify**

In `geometryHash()`, after the existing component-mesh fold, add a fold over visible work features. Read from `node.userData.workFeatureSpec` so the hash captures the source semantic data (axis origin + direction; plane origin + normal; point position) without depending on how that data is encoded in the scene graph:

```ts
const wfIds = Array.from(this.workFeatureNodes.keys()).sort();
for (const id of wfIds) {
  const node = this.workFeatureNodes.get(id)!;
  if (!node.visible) continue;
  const spec = node.userData.workFeatureSpec as
    | { kind: 'axis'; origin: Vec3; direction: Vec3 }
    | { kind: 'plane'; origin: Vec3; normal: Vec3 }
    | { kind: 'point'; origin: Vec3 };
  if (!spec) continue;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  for (const v of [spec.origin.x, spec.origin.y, spec.origin.z]) {
    h = Math.imul(h ^ Math.round(v * 1000), 16777619);
  }
  if (spec.kind === 'axis') {
    for (const v of [spec.direction.x, spec.direction.y, spec.direction.z]) {
      h = Math.imul(h ^ Math.round(v * 10000), 16777619);
    }
  } else if (spec.kind === 'plane') {
    for (const v of [spec.normal.x, spec.normal.y, spec.normal.z]) {
      h = Math.imul(h ^ Math.round(v * 10000), 16777619);
    }
  }
}
```

- [ ] **Step 5: Commit**

```
feat(app): SceneManager — geometry hash includes work-feature transforms
```

---

### Task 21: SceneManager.raycastWorkFeature

**Files:**
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/Viewport.tsx`
- Modify: `packages/app/src/viewport/__tests__/SceneManager.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
it('raycastWorkFeature returns the hit feature id', () => {
  mgr.setWorkFeatures([{ featureId: 'WP1', kind: 'plane', origin: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, visible: true }]);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  camera.position.set(0, 0, 200);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const id = mgr.raycastWorkFeature(camera, new THREE.Vector2(0, 0));
  expect(id).toBe('WP1');
});
```

- [ ] **Step 2–4: Implement**

```ts
raycastWorkFeature(camera: THREE.Camera, ndc: THREE.Vector2): string | null {
  if (this.workFeatureNodes.size === 0) return null;
  for (const n of this.workFeatureNodes.values()) n.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  // Recursive intersect because plane/point nodes are Groups.
  const objs = Array.from(this.workFeatureNodes.values());
  const hits = raycaster.intersectObjects(objs, true);
  if (hits.length === 0) return null;
  // Walk up to find the feature-id userData
  let obj: THREE.Object3D | null = hits[0]!.object;
  while (obj && !obj.userData.workFeatureId) obj = obj.parent ?? null;
  if (obj && typeof obj.userData.workFeatureId === 'string') return obj.userData.workFeatureId;
  return null;
}
```

In `Viewport.tsx`, expose `raycastWorkFeature(clientX, clientY)` on the ref (mirrors `raycastComponent`).

- [ ] **Step 5: Commit**

```
feat(app): SceneManager + Viewport — raycastWorkFeature
```

---

## Phase 4 — Store + commands + pickers

### Task 22: useAppStore work-feature dialog slices

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('useAppStore work-feature dialog slices', () => {
  beforeEach(() => {
    useAppStore.getState().resetWorkPlaneDialog();
    useAppStore.getState().resetWorkAxisDialog();
    useAppStore.getState().resetWorkPointDialog();
  });

  it('work plane dialog defaults are sane', () => {
    const s = useAppStore.getState();
    expect(s.workPlaneDialogOpen).toBe(false);
    expect(s.workPlaneInitialValues).toBeNull();
  });

  it('toggleWorkPlaneDialog opens + closes', () => {
    useAppStore.getState().toggleWorkPlaneDialog(true);
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(true);
    useAppStore.getState().toggleWorkPlaneDialog(false);
    expect(useAppStore.getState().workPlaneDialogOpen).toBe(false);
  });

  it('setWorkFeatureVisible updates a feature without touching other state', () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'p', units: 'mm', parameters: {},
      featureTree: [
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } } as any,
      ],
    });
    useAppStore.getState().setWorkFeatureVisible('origin.XY', true);
    const wp = useAppStore.getState().activePart!.featureTree[0] as any;
    expect(wp.visible).toBe(true);
  });
});
```

- [ ] **Step 2–4: Implement**

Add to `AppState`:

```ts
workPlaneDialogOpen: boolean;
workPlaneInitialValues: WorkPlaneFeature | null;
editingWorkPlaneId: string | null;
toggleWorkPlaneDialog(open: boolean): void;
resetWorkPlaneDialog(): void;
openWorkPlaneForEdit(id: string): void;
// …same shape for workAxis* and workPoint*

setWorkFeatureVisible(featureId: string, visible: boolean): void;
```

Implementations mirror the hole-dialog slice (T6 of 4a / sweep-dialog patterns).

- [ ] **Step 5: Commit**

```
feat(app): useAppStore — work-feature dialog slices + setWorkFeatureVisible
```

---

### Task 23: WorkPlanePickController

**Files:**
- Create: `packages/app/src/model/WorkPlanePickController.ts`
- Create: `packages/app/src/model/__tests__/WorkPlanePickController.spec.ts`

Mirror the simple `ComponentPickController` (4a-T9) shape. The controller is a stateful router: `activate(mode: 'face' | 'workPlane')`, `deactivate()`, `pickFromViewport(hit)` where `hit` is either a face name or a work-feature id.

- [ ] **Step 1–4: Standard TDD**

- [ ] **Step 5: Commit**

```
feat(app): WorkPlanePickController
```

---

### Task 24: WorkAxisPickController

**Files:**
- Create: `packages/app/src/model/WorkAxisPickController.ts`
- Create: `packages/app/src/model/__tests__/WorkAxisPickController.spec.ts`

Same shape as Task 23, with modes `'cylindricalFace' | 'edge' | 'workAxis'`.

- [ ] **Step 5: Commit**

```
feat(app): WorkAxisPickController
```

---

### Task 25: WorkPointPickController

**Files:**
- Create: `packages/app/src/model/WorkPointPickController.ts`
- Create: `packages/app/src/model/__tests__/WorkPointPickController.spec.ts`

Modes: `'vertex' | 'workPoint'`.

- [ ] **Step 5: Commit**

```
feat(app): WorkPointPickController
```

---

### Task 26: AddWorkPlaneFeatureCommand (class)

**Files:**
- Create: `packages/app/src/commands/AddWorkPlaneFeatureCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddWorkPlaneFeatureCommand.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddWorkPlaneFeatureCommand } from '../AddWorkPlaneFeatureCommand';

describe('AddWorkPlaneFeatureCommand', () => {
  beforeEach(() => {
    // seed a part
  });

  it('apply() appends a workPlane feature to activePart', async () => {
    const cmd = new AddWorkPlaneFeatureCommand({
      featureId: 'WP1',
      source: { mode: 'origin', plane: 'XY' },
    });
    await cmd.apply();
    const tree = useAppStore.getState().activePart!.featureTree;
    expect(tree.find((f) => f.id === 'WP1')).toBeDefined();
  });

  it('revert() removes the appended feature', async () => {
    const cmd = new AddWorkPlaneFeatureCommand({
      featureId: 'WP1', source: { mode: 'origin', plane: 'XY' },
    });
    await cmd.apply();
    await cmd.revert();
    const tree = useAppStore.getState().activePart!.featureTree;
    expect(tree.find((f) => f.id === 'WP1')).toBeUndefined();
  });
});
```

- [ ] **Step 2–4: Implement**

```ts
import type { Command } from './Command';
import type { WorkPlaneFeature } from '@zilventor/shared';
import { useAppStore } from '../store/useAppStore';

export type AddWorkPlaneOpts = {
  featureId: string;
  source: WorkPlaneFeature['source'];
  visible?: boolean;
  name?: string;
};

export class AddWorkPlaneFeatureCommand implements Command {
  readonly name = 'AddWorkPlane';
  private appliedId: string | null = null;
  constructor(private opts: AddWorkPlaneOpts) {}

  async apply(): Promise<void> {
    const { kernel, activePart, setActivePart } = useAppStore.getState();
    if (!kernel || !activePart) return;
    const feat: WorkPlaneFeature = {
      kind: 'workPlane',
      id: this.opts.featureId,
      visible: this.opts.visible ?? true,
      ...(this.opts.name ? { name: this.opts.name } : {}),
      source: this.opts.source,
    };
    await kernel.addFeature(activePart.id, feat);
    const next = await kernel.getPart(activePart.id);
    setActivePart(next);
    this.appliedId = this.opts.featureId;
  }

  async revert(): Promise<void> {
    if (!this.appliedId) return;
    const { kernel, activePart, setActivePart } = useAppStore.getState();
    if (!kernel || !activePart) return;
    await kernel.removeFeature(activePart.id, this.appliedId);
    const next = await kernel.getPart(activePart.id);
    setActivePart(next);
    this.appliedId = null;
  }
}
```

- [ ] **Step 5: Commit**

```
feat(app): AddWorkPlaneFeatureCommand class
```

---

### Task 27: AddWorkAxisFeatureCommand

Mirror Task 26 with `WorkAxisFeature`.

- [ ] **Step 5: Commit**

```
feat(app): AddWorkAxisFeatureCommand class
```

---

### Task 28: AddWorkPointFeatureCommand

Mirror Task 26 with `WorkPointFeature`.

- [ ] **Step 5: Commit**

```
feat(app): AddWorkPointFeatureCommand class
```

---

### Task 29: OpenWork{Axis,Plane,Point}DialogCommand free functions

**Files:**
- Create: `packages/app/src/commands/OpenWorkPlaneDialogCommand.ts`
- Create: `packages/app/src/commands/OpenWorkAxisDialogCommand.ts`
- Create: `packages/app/src/commands/OpenWorkPointDialogCommand.ts`
- Create: respective `*.spec.ts` files

Each is a one-line wrapper over the corresponding store toggle. Mirrors the OpenSweepDialogCommand pattern.

- [ ] **Step 5: Commit**

```
feat(app): Open{WorkPlane,WorkAxis,WorkPoint}DialogCommand
```

---

## Phase 5 — Dialogs

### Task 30: WorkPlaneDialog presentation

**Files:**
- Create: `packages/app/src/shell/WorkPlaneDialog.tsx`
- Create: `packages/app/src/shell/__tests__/WorkPlaneDialog.spec.tsx`

The dialog is one component with mode-based input rows (mirrors `HoleDialog` in concept).

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkPlaneDialog } from '../WorkPlaneDialog';

describe('WorkPlaneDialog', () => {
  const baseProps = {
    onCommit: () => {}, onCancel: () => {},
  };

  it('renders mode dropdown with 7 options (incl. origin)', () => {
    render(<WorkPlaneDialog {...baseProps} />);
    expect(screen.getByRole('combobox', { name: /mode/i })).toBeInTheDocument();
  });

  it('OK in offsetFromPlane mode commits the source', () => {
    const onCommit = vi.fn();
    render(<WorkPlaneDialog {...baseProps} onCommit={onCommit} />);
    fireEvent.change(screen.getByRole('combobox', { name: /mode/i }), { target: { value: 'offsetFromPlane' } });
    // Pick origin.XY (test driver dispatches the expected ref directly via store hooks
    // — UI integration is covered by E2E)
    // For unit test: stub the picked plane via prop
    // (In real flow, the dialog reads picker results from the store. The unit test
    // bypasses by providing initialValues that already pre-fill the plane ref.)
    // Skip detailed click flow; verify shape via initialValues path.
  });

  // Per-mode rendering tests
  it('threePoints mode shows 3 point pick buttons', () => { /* ... */ });
  it('axisAtAngleToPlane mode shows axis pick + plane pick + angle input', () => { /* ... */ });
});
```

(Realistically the dialog will need its own mode-specific input components — keep the spec lean and test mode rendering, not full interaction; E2E covers integration.)

- [ ] **Step 2–4: Implement**

The full dialog is ~250 lines. Layout:

```
┌────────────────────────────────────┐
│ Work Plane                         │
│ Mode: [offsetFromPlane         ▼] │
│                                    │
│ <mode-specific rows>               │
│                                    │
│              [Cancel] [OK]         │
└────────────────────────────────────┘
```

Each mode renders its own input rows from a switch/match on `mode`. Pick buttons toggle the corresponding `WorkPlanePickController` and read back picked refs via `useAppStore`.

- [ ] **Step 5: Commit**

```
feat(app): WorkPlaneDialog presentation component
```

---

### Task 31: WorkAxisDialog presentation

Mirror Task 30 with 6 modes.

- [ ] **Step 5: Commit**

```
feat(app): WorkAxisDialog presentation component
```

---

### Task 32: WorkPointDialog presentation

Mirror Task 30 with 5 modes.

- [ ] **Step 5: Commit**

```
feat(app): WorkPointDialog presentation component
```

---

### Task 33: App.tsx wrappers for the three dialogs

**Files:**
- Modify: `packages/app/src/App.tsx`

Add three dialog wrappers next to the existing `PlaceComponentDialog` / `EditComponentDialog` wrappers (4a-T21). Each wrapper:
- Reads `workPlaneDialogOpen` / `workAxisDialogOpen` / `workPointDialogOpen` from the store.
- On `onCommit(source)`, instantiates the matching `Add*FeatureCommand` and dispatches via the bus.
- On `onCancel`, calls the matching reset.

- [ ] **Step 5: Commit**

```
feat(app): App.tsx wrappers for WorkPlane/Axis/Point dialogs
```

---

## Phase 6 — Browser pane + ribbon + hotkeys + picker routing

### Task 34: BrowserPane Origin group + work-feature leaves

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

Render origin features under a collapsible "Origin" group at the top. Render user-created work features under their feature kind in tree order (mixed with sketches/extrudes/etc.).

- [ ] **Step 5: Commit**

```
feat(app): BrowserPane — Origin group + work-feature leaves
```

---

### Task 35: BrowserPane visibility toggles + broken-ref badges

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

Eye icon next to each work feature flips `visible` via `useAppStore.getState().setWorkFeatureVisible(id, !visible)`. Red ⚠ badge for work features in `featureErrors` opens the dialog with that feature's prior values.

- [ ] **Step 5: Commit**

```
feat(app): BrowserPane — visibility toggles + broken-ref badges
```

---

### Task 36: Ribbon Work Features panel

**Files:**
- Modify: `packages/app/src/shell/Ribbon.tsx` and/or `packages/app/src/shell/tabs/ModelTab.tsx`
- Modify: existing `Ribbon.spec.tsx`

Add a new "Work Features" panel to the Model tab between "Sketch" and "Modify" with three split-buttons (Plane / Axis / Point). Click the icon to open the default mode; click the dropdown arrow for the full mode list.

If split-button isn't already a component in the design, render as plain buttons for v1 and add the dropdown menu in a follow-up — the multi-mode dropdown is UX polish that isn't on the critical path.

- [ ] **Step 5: Commit**

```
feat(app): Ribbon — Model tab Work Features panel (Plane / Axis / Point)
```

---

### Task 37: Ctrl+Shift+{P,A,W} hotkeys

**Files:**
- Modify: `packages/app/src/App.tsx`

Add three hotkey branches in the existing `handleKeyDown`:

```ts
if (!sketchMode && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
  e.preventDefault();
  OpenWorkPlaneDialogCommand();
  return;
}
// ...same for 'a' (axis) and 'w' (point)
```

Note: `Ctrl+Shift+W` is bound to "Work Point" because plain `w` is already taken by Sweep (3-T?). Document this divergence from Inventor in the spec's open-questions section already; nothing more to do.

- [ ] **Step 5: Commit**

```
feat(app): hotkeys — Ctrl+Shift+P/A/W open work-feature dialogs
```

---

### Task 38: handleViewportPointer routing for the 3 new pickers

**Files:**
- Modify: `packages/app/src/App.tsx`

Add picker branches in `handleViewportPointer` for `WorkPlanePickController`, `WorkAxisPickController`, `WorkPointPickController`. Each branch checks `controller.isActive()` and routes hover/click to the controller. Mirrors the existing fillet-edge / chamfer-edge / shell-face / profile / axis branches.

This is where App.tsx's `handleViewportPointer` switch becomes long enough to consider extraction (spec risk #3). For v1 keep inline; flag follow-up to extract a router strategy.

- [ ] **Step 5: Commit**

```
feat(app): handleViewportPointer — work-feature picker routing
```

---

## Phase 7 — E2E + perf

### Task 39: E2E create-work-plane

**Files:**
- Create: `tests/e2e/work-features/create-work-plane.spec.ts`

Open the WorkPlane dialog via ribbon; pick the top face of an extruded box; enter offset 25; click OK. Assert the new work plane exists in the active part's feature tree and `data-geometry-hash` updates.

- [ ] **Step 5: Commit**

```
test(e2e): create-work-plane via ribbon Work Features panel
```

---

### Task 40: E2E parametric-cascade

**Files:**
- Create: `tests/e2e/work-features/parametric-cascade.spec.ts`

Build a part with: sketch + extrude + work plane offset by parameter `d_off` from top face + sketch on that plane + extrude. Edit `d_off` in the parameter panel from 25 → 50. Assert geometry hash changes (work plane re-evaluates and the second extrude moves).

- [ ] **Step 5: Commit**

```
test(e2e): parametric-cascade — work plane offset driven by parameter
```

---

### Task 41: E2E broken-ref-badge

**Files:**
- Create: `tests/e2e/work-features/broken-ref-badge.spec.ts`

Build a part with: sketch + extrude + work plane offset from top face. Delete the extrude (via browser pane right-click → Delete). Assert browser pane shows red ⚠ badge on the work plane.

- [ ] **Step 5: Commit**

```
test(e2e): broken-ref-badge — deleted host face surfaces work-plane error
```

---

### Task 42: Perf work-features-recompute

**Files:**
- Create: `tests/perf/work-features-recompute.spec.ts`

Build a part with 20 chained work features (axis → plane → axis → plane …). Time how long parametric edit cascade takes. Assert ≤ 200 ms.

```ts
test('Perf: 20-deep work-feature cascade recomputes ≤ 200 ms', async ({ page }) => {
  // setup: build the chain via store mutations
  // measure: edit root parameter, time until geometry-hash settles
  // assert: totalMs ≤ 200
});
```

- [ ] **Step 5: Commit**

```
test(perf): work-features-recompute ≤ 200 ms for 20-deep cascade
```

---

## Final integration smoke

After Task 42, run the full test gauntlet to confirm nothing else regressed:

```bash
pnpm -r typecheck
pnpm -r test:unit
pnpm test:e2e
pnpm test:perf
```

Update memory file `project_subproject_3c_execution_state.md` with shipped commits and final test totals.
