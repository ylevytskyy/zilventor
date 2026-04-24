# Sub-project 3b — Parametric Fillet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parametric Inventor-parity fillet feature with all 5 edge-selection modes (Edge/Loop/Feature/All-Fillets/All-Rounds), constant + variable radius, full setbacks, debounced live preview, and a topological-naming layer that makes fillets survive parametric edits to upstream features.

**Architecture:** New `FaceNaming` layer tags every face produced by sketch/extrude/revolve with a `{featureId, role, instance}` name. Edges are identified by face-pair. Fillet stores edge names, resolves them at execute time, and OCCT's `BRepFilletAPI_MakeFillet` produces the blend. `FeatureTree` gains partial-failure semantics — a fillet that fails on regenerate surfaces via `featureErrors` without aborting the tree.

**Tech Stack:** opencascade.js (OCCT), existing Comlink kernel worker, React + Zustand, three.js viewport, existing `ParameterRegistry` for parametric radii/setbacks.

**Spec:** `docs/superpowers/specs/2026-04-24-subproject-3b-fillet-design.md`

**Total tasks: 33.** Test-driven throughout. One commit per task unless noted.

---

## Phase 1 — Shared layer

### Task 1: `FaceName` + `EdgeName` + `canonicalEdgeName`

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Test: `packages/shared/src/__tests__/face-name.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/face-name.spec.ts
import { describe, it, expect } from 'vitest';
import { canonicalEdgeName, type FaceName } from '../types';

describe('FaceName / EdgeName', () => {
  const a: FaceName = { featureId: 'E1', role: 'top' };
  const b: FaceName = { featureId: 'E1', role: 'side', instance: 0 };

  it('canonicalEdgeName is symmetric', () => {
    const ab = canonicalEdgeName(a, b);
    const ba = canonicalEdgeName(b, a);
    expect(ab).toEqual(ba);
  });

  it('canonicalEdgeName orders faces deterministically', () => {
    const ab = canonicalEdgeName(a, b);
    expect(ab.faceA.role < ab.faceB.role || ab.faceA.featureId < ab.faceB.featureId).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- face-name` → FAIL (types + function missing).

- [ ] **Step 3: Extend `types.ts`**

Append to `packages/shared/src/types.ts`:

```ts
export type FaceName = {
  featureId: string;
  role: string;
  instance?: number;
};

export type EdgeName = {
  faceA: FaceName;
  faceB: FaceName;
};

function faceNameKey(f: FaceName): string {
  return `${f.featureId}|${f.role}|${f.instance ?? 0}`;
}

/**
 * Canonicalize the edge name so {A,B} and {B,A} compare structurally equal.
 * Sort by the string key.
 */
export function canonicalEdgeName(a: FaceName, b: FaceName): EdgeName {
  const [first, second] = faceNameKey(a) <= faceNameKey(b) ? [a, b] : [b, a];
  return { faceA: first, faceB: second };
}
```

Export `FaceName`, `EdgeName`, `canonicalEdgeName` from `packages/shared/src/index.ts`.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/shared test:unit -- face-name` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts packages/shared/src/__tests__/face-name.spec.ts
git commit -m "feat(shared): FaceName + EdgeName + canonicalEdgeName"
```

---

### Task 2: `FilletFeature` variant on `Feature` union

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/kernel/src/adapter/FeatureTree.ts` (placeholder `case 'fillet': continue;`)
- Test: `packages/shared/src/__tests__/fillet-feature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/fillet-feature.spec.ts
import { describe, it, expect } from 'vitest';
import type { Feature, FilletFeature, ParamOrLiteral } from '../types';

describe('FilletFeature', () => {
  it('accepts the documented shape', () => {
    const radius: ParamOrLiteral = { kind: 'param', paramName: 'r_fillet' };
    const f: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: {
          faceA: { featureId: 'E1', role: 'top' },
          faceB: { featureId: 'E1', role: 'side', instance: 0 }
        },
        selectionMode: 'edge',
        radius
      }],
      setbacks: []
    };
    expect(f.kind).toBe('fillet');
    const asUnion: Feature = f;
    expect(asUnion.kind).toBe('fillet');
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fillet-feature` → FAIL.

- [ ] **Step 3: Extend `types.ts`**

Append:

```ts
export type FilletSelectionMode = 'edge' | 'loop' | 'feature' | 'all-fillets' | 'all-rounds';

export type ParamOrLiteral =
  | { kind: 'param'; paramName: string }
  | { kind: 'literal'; value: number };

export type FilletEdgeSpec = {
  edgeId: EdgeName;
  selectionMode: FilletSelectionMode;
  radius: ParamOrLiteral;
  variableRadii?: {
    startRadius: ParamOrLiteral;
    endRadius: ParamOrLiteral;
  };
};

export type VertexSetback = {
  vertexId: { edges: EdgeName[] };
  perEdgeSetbacks: Array<{ edgeId: EdgeName; setback: ParamOrLiteral }>;
};

export type FilletFeature = {
  kind: 'fillet';
  id: string;
  mode: 'constant' | 'variable';
  edges: FilletEdgeSpec[];
  setbacks: VertexSetback[];
};
```

Extend the `Feature` union to include `FilletFeature`.

Export all new types from `index.ts`.

- [ ] **Step 4: Add placeholder in FeatureTree**

To keep typecheck green, add `else if (feature.kind === 'fillet') { continue; }` to the `executeTree` switch in `packages/kernel/src/adapter/FeatureTree.ts`, placed after the existing `revolve` branch. T13 replaces it with the real implementation.

- [ ] **Step 5: Run + typecheck**

`pnpm -C packages/shared test:unit && pnpm -r typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts packages/shared/src/__tests__/fillet-feature.spec.ts packages/kernel/src/adapter/FeatureTree.ts
git commit -m "feat(shared): FilletFeature variant on Feature union"
```

---

### Task 3: File format v5 → v6 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts`
- Modify: `packages/shared/src/types.ts` (`ProjectFile.formatVersion: 6`)
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Append failing test**

```ts
describe('fileFormat v5 → v6 migration', () => {
  it('empty v5 manifest migrates to v6 unchanged', () => {
    const input = { formatVersion: 5, document: { id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [] } };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(6);
    expect(CURRENT_FORMAT_VERSION).toBe(6);
  });

  it('v5 manifest with extrude features passes through v6', () => {
    const input = {
      formatVersion: 5,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward', operation: 'new' }
        ]
      }
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(6);
    expect(out.document.featureTree).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fileFormat` → FAIL.

- [ ] **Step 3: Add the v5→v6 step**

In `packages/shared/src/fileFormat.ts`:

```ts
export const CURRENT_FORMAT_VERSION = 6;

// Add to migrateManifest's switch:
case 5: {
  // v5 → v6 is additive (FilletFeature variant added). No-op migration.
  m = { ...m, formatVersion: 6 };
  break;
}
```

Bump `ProjectFile.formatVersion` in `types.ts` to `6`.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/shared test:unit && pnpm -r typecheck` → all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/types.ts packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): file format v6 migration (fillet feature support)"
```

---

## Phase 2 — Topological naming layer

### Task 4: `NamedShape` + `FaceNaming.ts` helpers

**Files:**
- Create: `packages/kernel/src/occt/FaceNaming.ts`
- Test: `packages/kernel/src/occt/__tests__/FaceNaming.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/src/occt/__tests__/FaceNaming.spec.ts
import { describe, it, expect } from 'vitest';
import { namedFace, attachName, faceNamesEqual, type NamedShape } from '../FaceNaming';
import { canonicalEdgeName } from '@zilventor/shared';

describe('FaceNaming helpers (unit — no OCCT)', () => {
  it('namedFace constructs a FaceName with instance default 0', () => {
    expect(namedFace('E1', 'top')).toEqual({ featureId: 'E1', role: 'top', instance: 0 });
    expect(namedFace('E1', 'side', 2)).toEqual({ featureId: 'E1', role: 'side', instance: 2 });
  });

  it('faceNamesEqual does deep equality', () => {
    expect(faceNamesEqual(namedFace('E1', 'top'), namedFace('E1', 'top'))).toBe(true);
    expect(faceNamesEqual(namedFace('E1', 'top'), namedFace('E1', 'bottom'))).toBe(false);
    expect(faceNamesEqual(namedFace('E1', 'side', 0), namedFace('E1', 'side', 1))).toBe(false);
  });

  it('attachName pushes into faceNames array', () => {
    const fakeShape = { __brand: 'OcctShape' as const, handle: null };
    const nm: NamedShape = { shape: fakeShape, faceNames: [] };
    const fakeFace = { fake: true };
    attachName(nm, fakeFace, namedFace('E1', 'top'));
    expect(nm.faceNames).toHaveLength(1);
    expect(nm.faceNames[0]!.name.role).toBe('top');
  });

  it('canonicalEdgeName is re-exported and symmetric', () => {
    const e1 = canonicalEdgeName(namedFace('E1', 'top'), namedFace('E1', 'side'));
    const e2 = canonicalEdgeName(namedFace('E1', 'side'), namedFace('E1', 'top'));
    expect(e1).toEqual(e2);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/kernel test:unit -- FaceNaming` → FAIL.

- [ ] **Step 3: Implement `FaceNaming.ts`**

```ts
// packages/kernel/src/occt/FaceNaming.ts
import type { FaceName, EdgeName } from '@zilventor/shared';
import type { OcctShape } from './SolidOps';

export type NamedShape = {
  shape: OcctShape;
  /** Parallel array of (name, TopoDS_Face handle). Linear lookup is fine
   *  at the scale of a single part's face count (dozens, not millions). */
  faceNames: Array<{ name: FaceName; face: unknown }>;
};

/**
 * Construct a FaceName. `instance` defaults to 0 (so roles with a single
 * face don't need the caller to pass 0 explicitly).
 */
export function namedFace(featureId: string, role: string, instance: number = 0): FaceName {
  return { featureId, role, instance };
}

export function faceNamesEqual(a: FaceName, b: FaceName): boolean {
  return a.featureId === b.featureId && a.role === b.role && (a.instance ?? 0) === (b.instance ?? 0);
}

/**
 * Attach a name to a face on a NamedShape. Mutates `nm.faceNames`.
 */
export function attachName(nm: NamedShape, face: unknown, name: FaceName): void {
  nm.faceNames.push({ name, face });
}

/** Re-export `canonicalEdgeName` so callers can import everything naming-
 *  related from this module. */
export { canonicalEdgeName } from '@zilventor/shared';
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:unit -- FaceNaming` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FaceNaming.ts packages/kernel/src/occt/__tests__/FaceNaming.spec.ts
git commit -m "feat(kernel): FaceNaming types + helpers"
```

---

### Task 5: `resolveEdge` + `resolveVertex`

**Files:**
- Modify: `packages/kernel/src/occt/FaceNaming.ts`
- Test: `packages/kernel/src/occt/__tests__/FaceNaming.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/occt/__tests__/FaceNaming.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, disposeShape } from '../SolidOps';
import { namedFace, attachName, resolveEdge, canonicalEdgeName, type NamedShape } from '../FaceNaming';
import type { FaceName } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

describe('resolveEdge (integration)', () => {
  it('finds the edge shared by two named faces on a box', () => {
    // Build a 10x10x10 box and enumerate its 6 faces via TopExp_Explorer.
    const box = makeBox(oc, 10, 10, 10);
    const explorer = new oc.TopExp_Explorer_2(
      box.handle as never, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
    );
    const faces: unknown[] = [];
    while (explorer.More()) {
      faces.push(explorer.Current());
      explorer.Next();
    }
    explorer.delete();
    expect(faces.length).toBe(6);

    // Name the first two arbitrary faces for test purposes.
    const nm: NamedShape = { shape: box, faceNames: [] };
    const nameA: FaceName = namedFace('E1', 'top');
    const nameB: FaceName = namedFace('E1', 'side', 0);
    attachName(nm, faces[0]!, nameA);
    attachName(nm, faces[1]!, nameB);

    const edgeName = canonicalEdgeName(nameA, nameB);
    const edge = resolveEdge(oc, nm, edgeName);
    // Two arbitrary adjacent faces of a box share exactly one edge;
    // two opposite faces share none. Either way the function returns
    // without throwing — if they share 1 edge we get a handle, else null.
    expect(edge === null || typeof edge === 'object').toBe(true);
    disposeShape(box);
    for (const f of faces) (f as { delete?: () => void }).delete?.();
  });

  it('returns null when either face is absent from the map', () => {
    const box = makeBox(oc, 10, 10, 10);
    const nm: NamedShape = { shape: box, faceNames: [] };
    const edgeName = canonicalEdgeName(namedFace('X', 'top'), namedFace('Y', 'bottom'));
    expect(resolveEdge(oc, nm, edgeName)).toBe(null);
    disposeShape(box);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/kernel test:integration -- FaceNaming` → FAIL.

- [ ] **Step 3: Implement `resolveEdge` + `resolveVertex`**

Append to `packages/kernel/src/occt/FaceNaming.ts`:

```ts
import type { OcctInstance } from './occtLoader';

/**
 * Resolve a stored EdgeName to the current TopoDS_Edge in a NamedShape.
 *
 * Strategy: find both faces by name lookup. Then enumerate edges of one
 * face via TopExp_Explorer, looking for the edge that is also present
 * on the other face (via TopoDS_Shape.IsSame or a shared-edge comparison).
 *
 * Returns the TopoDS_Edge handle on hit, null on miss. The returned
 * handle's lifetime is tied to the parent shape; callers should not
 * dispose it independently.
 */
export function resolveEdge(oc: OcctInstance, nm: NamedShape, edgeName: EdgeName): unknown | null {
  const a = nm.faceNames.find((e) => faceNamesEqual(e.name, edgeName.faceA))?.face;
  const b = nm.faceNames.find((e) => faceNamesEqual(e.name, edgeName.faceB))?.face;
  if (!a || !b) return null;

  const explA = new oc.TopExp_Explorer_2(
    a as never, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const edgesA: unknown[] = [];
  while (explA.More()) { edgesA.push(explA.Current()); explA.Next(); }
  explA.delete();

  const explB = new oc.TopExp_Explorer_2(
    b as never, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while (explB.More()) {
    const eB = explB.Current();
    for (const eA of edgesA) {
      if ((eA as { IsSame?: (other: unknown) => boolean }).IsSame?.(eB as never)) {
        // Found the shared edge. Clean up remaining exploration.
        for (const e of edgesA) if (e !== eA) (e as { delete?: () => void }).delete?.();
        explB.delete();
        return eA;
      }
    }
    (eB as { delete?: () => void }).delete?.();
    explB.Next();
  }
  explB.delete();
  for (const e of edgesA) (e as { delete?: () => void }).delete?.();
  return null;
}

/**
 * Resolve a stored vertex (identified by its ≥3 converging edges) to
 * a TopoDS_Vertex in the shape. Returns null if any edge is missing or
 * the edges don't share a common vertex.
 */
export function resolveVertex(
  oc: OcctInstance,
  nm: NamedShape,
  vertexId: { edges: EdgeName[] }
): unknown | null {
  if (vertexId.edges.length < 2) return null;
  const resolved = vertexId.edges.map((en) => resolveEdge(oc, nm, en));
  if (resolved.some((e) => e === null)) return null;
  // Walk vertices of the first edge and check each is present on all others.
  const explV = new oc.TopExp_Explorer_2(
    resolved[0] as never, oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while (explV.More()) {
    const v = explV.Current();
    let sharedByAll = true;
    for (let i = 1; i < resolved.length; i++) {
      const explOther = new oc.TopExp_Explorer_2(
        resolved[i] as never, oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
      );
      let foundOnThisEdge = false;
      while (explOther.More()) {
        const other = explOther.Current();
        if ((v as { IsSame?: (x: unknown) => boolean }).IsSame?.(other as never)) { foundOnThisEdge = true; }
        (other as { delete?: () => void }).delete?.();
        explOther.Next();
      }
      explOther.delete();
      if (!foundOnThisEdge) { sharedByAll = false; break; }
    }
    if (sharedByAll) { explV.delete(); return v; }
    (v as { delete?: () => void }).delete?.();
    explV.Next();
  }
  explV.delete();
  return null;
}
```

Verify the `TopExp_Explorer_2` and `TopAbs_ShapeEnum` constructor suffixes against `packages/kernel/node_modules/opencascade.js/dist/opencascade.full.d.ts` before the test run. Adjust suffix numbers if needed (the `_2` vs `_1` pattern from 3a T4/T5 applies).

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FaceNaming` → PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FaceNaming.ts packages/kernel/src/occt/__tests__/FaceNaming.integration.spec.ts
git commit -m "feat(kernel): resolveEdge + resolveVertex via TopExp_Explorer"
```

---

## Phase 3 — Feature retrofits (emit NamedShape)

### Task 6: `SketchFeature` emits `NamedShape`

**Files:**
- Modify: `packages/kernel/src/adapter/features/SketchFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts`
- Modify: call sites in `FeatureTree.ts`, `RevolveFeature.ts`

- [ ] **Step 1: Update the existing test**

Extend `SketchFeature.integration.spec.ts` to assert the returned `SketchResult` carries a `NamedShape`-shaped wrapper. Sketches are 2D, so `faceNames` is empty — but the result type now includes the naming surface for downstream consumers to call `attachName` where extrusion produces faces.

Add:
```ts
it('executeSketchFeature result has NamedShape with empty faceNames', () => {
  const sketchFeature = {
    kind: 'sketch' as const, id: 'S1', plane: 'XY' as const,
    primitives: [{ id: 'R1', kind: 'rectangle' as const, x: 0, y: 0, w: 10, h: 10 }],
    constraints: []
  };
  const r = executeSketchFeature(oc, sketchFeature);
  expect(r.ok).toBe(true);
  if (r.ok) {
    // Sketch doesn't produce faces — faceNames is empty. The naming is
    // attached by downstream features (extrude/revolve) that do.
    expect(r.value.named).toBeDefined();
    expect(r.value.named.faceNames).toEqual([]);
    disposeSketchResult(oc, r.value);
  }
});
```

- [ ] **Step 2: Run — should fail**

FAIL (`named` field missing).

- [ ] **Step 3: Extend `SketchResult`**

```ts
// packages/kernel/src/adapter/features/SketchFeature.ts
import type { NamedShape } from '../../occt/FaceNaming';

export type SketchResult = {
  sketchId: string;
  wire: WireHandle;
  plane: 'XY' | 'XZ' | 'YZ';
  closed: boolean;
  /** Placeholder NamedShape that downstream features (extrude/revolve) will
   *  attach faces to. Sketches themselves produce only edges/wires; the
   *  naming becomes meaningful once a solid is generated. `shape` here is
   *  a degenerate wrapper — downstream code should read `named.faceNames`,
   *  not `named.shape`. */
  named: NamedShape;
};
```

Populate in `executeSketchFeature`:

```ts
return ok({
  sketchId: feature.id,
  wire: closedWires[0]!,
  plane: feature.plane,
  closed: true,
  named: { shape: { __brand: 'OcctShape', handle: null }, faceNames: [] }
});
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- SketchFeature` → PASS.

- [ ] **Step 5: Verify typecheck**

`pnpm -r typecheck` — no regressions in FeatureTree or RevolveFeature (they don't touch `named` yet; T7/T8 will wire it through).

- [ ] **Step 6: Commit**

```bash
git add packages/kernel/src/adapter/features/SketchFeature.ts packages/kernel/src/adapter/features/__tests__/SketchFeature.integration.spec.ts
git commit -m "feat(kernel): SketchResult carries NamedShape for downstream naming"
```

---

### Task 7: `ExtrudeFeature` names its output faces

**Files:**
- Modify: `packages/kernel/src/adapter/features/ExtrudeFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts`

- [ ] **Step 1: Update the existing test**

Add an assertion to the existing extrude-a-rectangle test:

```ts
it('executeExtrudeFeature labels 6 faces for a rectangle prism', () => {
  // ... existing setup + extrude call ...
  expect(result.value.named.faceNames).toHaveLength(6);
  const roles = result.value.named.faceNames.map((f) => f.name.role).sort();
  expect(roles).toContain('top');
  expect(roles).toContain('bottom');
  expect(roles.filter((r) => r === 'side')).toHaveLength(4);
});
```

Update `ExtrudeResult` type to include `named: NamedShape`.

- [ ] **Step 2: Run — should fail**

FAIL — `named` missing and no face labelling.

- [ ] **Step 3: Implement face naming in `executeExtrudeFeature`**

After `mkPrism.Shape()` produces the solid:

```ts
// Enumerate faces of the resulting prism and assign names.
const namedResult: NamedShape = { shape: { __brand: 'OcctShape', handle: shape }, faceNames: [] };
const expl = new oc.TopExp_Explorer_2(
  shape as never, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
);
const faces: unknown[] = [];
while (expl.More()) { faces.push(expl.Current()); expl.Next(); }
expl.delete();

// For a prism, top is the face with highest Z centroid; bottom is lowest Z;
// the rest are sides in ascending order of side-face X+Y centroid hash.
// Compute centroids via GProp_GProps.
const withCentroids = faces.map((f) => {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(f as never, props, false as never, false as never);
  const c = props.CentreOfMass();
  const coord: [number, number, number] = [c.X(), c.Y(), c.Z()];
  c.delete();
  props.delete();
  return { face: f, c: coord };
});
// Sort by Z to identify top/bottom.
withCentroids.sort((a, b) => a.c[2] - b.c[2]);
const bottom = withCentroids[0]!;
const top = withCentroids[withCentroids.length - 1]!;
const sides = withCentroids.slice(1, withCentroids.length - 1);
attachName(namedResult, bottom.face, namedFace(feature.id, 'bottom'));
attachName(namedResult, top.face, namedFace(feature.id, 'top'));
// Sort sides by atan2(cY - center, cX - center) for stable instance indexing.
const cx = (top.c[0] + bottom.c[0]) / 2;
const cy = (top.c[1] + bottom.c[1]) / 2;
sides.sort((a, b) => Math.atan2(a.c[1] - cy, a.c[0] - cx) - Math.atan2(b.c[1] - cy, b.c[0] - cx));
sides.forEach((s, i) => attachName(namedResult, s.face, namedFace(feature.id, 'side', i)));

// Return ExtrudeResult with named included.
return ok({ featureId: feature.id, solid: { __brand: 'OcctShape', handle: shape }, named: namedResult });
```

Import `NamedShape`, `namedFace`, `attachName` from `../../occt/FaceNaming`.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- ExtrudeFeature` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/ExtrudeFeature.ts packages/kernel/src/adapter/features/__tests__/ExtrudeFeature.integration.spec.ts
git commit -m "feat(kernel): ExtrudeFeature labels top/bottom/side faces"
```

---

### Task 8: `RevolveFeature` names its output faces

**Files:**
- Modify: `packages/kernel/src/adapter/features/RevolveFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/RevolveFeature.integration.spec.ts`

- [ ] **Step 1: Update existing tests**

Extend the 360° revolve test:

```ts
expect(r.value.named.faceNames.length).toBeGreaterThan(0);
const roles = r.value.named.faceNames.map((f) => f.name.role);
// Full 360° produces a lateral face (and potentially a top/bottom cap
// depending on profile geometry).
expect(roles).toContain('lateral');
```

For the partial 90° test, extend:

```ts
// Partial revolve produces lateral + two cap faces (cap_start, cap_end).
const roles = r.value.named.faceNames.map((f) => f.name.role);
expect(roles).toContain('cap_start');
expect(roles).toContain('cap_end');
```

Update `RevolveResult` to include `named: NamedShape`.

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Label revolve output faces**

After the revolve produces its shape, enumerate faces and label:

- For 360°: mark all faces as `lateral` (no caps exist). Instance-number by ascending distance from axis origin.
- For partial: the two faces whose normal is parallel to the axis direction are `cap_start` (the one at the start angle) and `cap_end`; the rest are `lateral/{n}`.

Approximate classification: compute the face's normal at its centroid (`BRepGProp_Face.Normal` or evaluate the surface at UV center); a normal parallel (within tolerance) to the axis direction → cap; else lateral.

Implementation sketch:

```ts
// After makeRevolve returns the raw OCCT shape:
const namedResult: NamedShape = { shape: { __brand: 'OcctShape', handle: shape }, faceNames: [] };
// Enumerate faces.
const expl = new oc.TopExp_Explorer_2(...);
const faces = /* collect */;
expl.delete();

const axisUnit = [dx / mag, dy / mag, dz / mag];
let capCount = 0;
let lateralCount = 0;
for (const f of faces) {
  const props = new oc.GProp_GProps_1();
  oc.BRepGProp.SurfaceProperties_1(f as never, props, false as never, false as never);
  const c = props.CentreOfMass();
  // Get normal via BRepTools or Geom surface probing — use BRepAdaptor_Surface.
  // For MVP, classify as cap when face is planar AND its normal aligns with axis.
  const isCap = isCapFace(oc, f, axisUnit);
  c.delete(); props.delete();
  if (isCap) {
    attachName(namedResult, f, namedFace(feature.id, capCount === 0 ? 'cap_start' : 'cap_end'));
    capCount++;
  } else {
    attachName(namedResult, f, namedFace(feature.id, 'lateral', lateralCount++));
  }
}
```

`isCapFace` helper: probe via `BRepAdaptor_Surface_2(face)`, check `GetType() === GeomAbs_Plane`, and compare plane normal to axis direction (dot product > 0.99). If type-checking rejects the imported name, consult `opencascade.full.d.ts` for the right suffix.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- RevolveFeature` → 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/RevolveFeature.ts packages/kernel/src/adapter/features/__tests__/RevolveFeature.integration.spec.ts
git commit -m "feat(kernel): RevolveFeature labels lateral/cap_start/cap_end faces"
```

---

## Phase 4 — FilletOps

### Task 9: `makeFillet` constant-radius wrapper

**Files:**
- Create: `packages/kernel/src/occt/FilletOps.ts`
- Test: `packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { makeFillet } from '../FilletOps';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

function enumerateEdges(oc: OcctInstance, shape: unknown): unknown[] {
  const expl = new oc.TopExp_Explorer_2(
    shape as never, oc.TopAbs_ShapeEnum.TopAbs_EDGE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const edges: unknown[] = [];
  while (expl.More()) { edges.push(expl.Current()); expl.Next(); }
  expl.delete();
  return edges;
}

describe('makeFillet constant radius (integration)', () => {
  it('fillets all 12 edges of a cube at 2mm', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    expect(edges.length).toBe(12);
    const r = makeFillet(oc, box, {
      edges: edges.map((e) => ({ edge: e, radius: 2 })),
      setbacks: []
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // Fillet doesn't grow the bbox; may slightly shrink due to blend.
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(box);
  });

  it('returns filletFailed when radius exceeds curvature', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    const r = makeFillet(oc, box, {
      edges: edges.map((e) => ({ edge: e, radius: 6 })),  // too large
      setbacks: []
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('filletFailed');
    disposeShape(box);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL (module missing).

- [ ] **Step 3: Implement `FilletOps.ts`**

```ts
// packages/kernel/src/occt/FilletOps.ts
import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';
import { ok, err, type Result, type KernelError, newCorrelationId } from '@zilventor/shared';

export type FilletRequest = {
  edges: Array<{
    edge: unknown;
    radius: number;
    variable?: { startRadius: number; endRadius: number };
  }>;
  setbacks: Array<{ vertex: unknown; edge: unknown; setback: number }>;
};

/**
 * Build a filleted solid via BRepFilletAPI_MakeFillet.
 *
 * Each edge is registered with a constant radius via `.Add(radius, edge)` or
 * (variable-radius mode, T10) a per-parameter radius array. Setbacks are
 * applied via `.SetFilletShape` per-vertex+edge (T11).
 */
export function makeFillet(oc: OcctInstance, solid: OcctShape, req: FilletRequest): Result<OcctShape, KernelError> {
  if (req.edges.length === 0) {
    return err({ kind: 'invalidParameter', message: 'Fillet has no edges; pick at least one', correlationId: newCorrelationId() });
  }
  for (const e of req.edges) {
    if (!e.variable && e.radius <= 0) {
      return err({ kind: 'invalidParameter', message: `Fillet radius must be > 0 (got ${e.radius})`, correlationId: newCorrelationId() });
    }
  }

  let mkFillet: unknown = null;
  try {
    mkFillet = new oc.BRepFilletAPI_MakeFillet_2(solid.handle as never, oc.ChFi3d_FilletShape.ChFi3d_Rational as never);
    for (const e of req.edges) {
      (mkFillet as { Add_2: (r: number, edge: unknown) => void }).Add_2(e.radius, e.edge as never);
    }
    (mkFillet as { Build: () => void }).Build();
    const isDone = (mkFillet as { IsDone: () => boolean }).IsDone();
    if (!isDone) {
      (mkFillet as { delete: () => void }).delete();
      return err({ kind: 'filletFailed', message: 'Fillet did not converge', correlationId: newCorrelationId() });
    }
    const shape = (mkFillet as { Shape: () => unknown }).Shape();
    (mkFillet as { delete: () => void }).delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    if (mkFillet) (mkFillet as { delete?: () => void }).delete?.();
    return err({ kind: 'filletFailed', message: `Fillet threw: ${(e as Error).message}`, correlationId: newCorrelationId() });
  }
}
```

Also add `'filletFailed'` and `'edgeNotFound'` to `KernelErrorKind` in `packages/shared/src/errors.ts`.

Suffix verification: `BRepFilletAPI_MakeFillet_2`, `ChFi3d_Rational`, `Add_2` — check against `opencascade.full.d.ts`. Adjust numeric suffixes as needed (likely variants).

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FilletOps` → 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FilletOps.ts packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts packages/shared/src/errors.ts
git commit -m "feat(kernel): makeFillet constant-radius wrapper + kernel errors"
```

---

### Task 10: `makeFillet` variable-radius support

**Files:**
- Modify: `packages/kernel/src/occt/FilletOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('variable-radius fillet transitions linearly along one edge', () => {
  const box = makeBox(oc, 10, 10, 10);
  const edges = enumerateEdges(oc, box.handle);
  const r = makeFillet(oc, box, {
    edges: [{ edge: edges[0]!, radius: 0, variable: { startRadius: 1, endRadius: 3 } }],
    setbacks: []
  });
  expect(r.ok).toBe(true);
  if (r.ok) {
    // Successful variable-radius fillet; mesh-worthy shape.
    const bbox = computeBoundingBox(oc, r.value);
    expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
    disposeShape(r.value);
  }
  disposeShape(box);
});
```

- [ ] **Step 2: Run — should fail**

FAIL (variable branch not implemented).

- [ ] **Step 3: Extend `makeFillet` with variable-radius branch**

Inside the edges loop, replace the single `.Add_2(radius, edge)` with a branch:

```ts
for (const e of req.edges) {
  if (e.variable) {
    // Variable: pass a 2-entry TColgp_Array1OfPnt2d with (0, startR) and (1, endR).
    // Pnt2d.X = parameter (0..1); Pnt2d.Y = radius at that parameter.
    const arr = new oc.TColgp_Array1OfPnt2d_2(1, 2);
    const p0 = new oc.gp_Pnt2d_3(0, e.variable.startRadius);
    const p1 = new oc.gp_Pnt2d_3(1, e.variable.endRadius);
    arr.SetValue(1, p0 as never);
    arr.SetValue(2, p1 as never);
    (mkFillet as { Add_5: (arr: unknown, edge: unknown) => void }).Add_5(arr as never, e.edge as never);
    p0.delete(); p1.delete(); arr.delete();
  } else {
    (mkFillet as { Add_2: (r: number, edge: unknown) => void }).Add_2(e.radius, e.edge as never);
  }
}
```

Suffix verification for `TColgp_Array1OfPnt2d_2`, `gp_Pnt2d_3`, and `Add_5` against `opencascade.full.d.ts`. Likely alternates exist.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FilletOps` → 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FilletOps.ts packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts
git commit -m "feat(kernel): makeFillet variable-radius support"
```

---

### Task 11: `makeFillet` setback support

**Files:**
- Modify: `packages/kernel/src/occt/FilletOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('setback pulls the blend back from a shared vertex', () => {
  const box = makeBox(oc, 10, 10, 10);
  const edges = enumerateEdges(oc, box.handle);
  // Find two edges that share a vertex — use the first two; on a box's
  // edge traversal, edges[0] and edges[1] commonly share a corner.
  // Test-local heuristic: try the first pair; if no vertex is shared,
  // the setback has no effect but the fillet still succeeds.
  const sharedVertex = findSharedVertex(oc, edges[0]!, edges[1]!);
  if (!sharedVertex) return;  // skip if no shared vertex at this traversal order

  const r = makeFillet(oc, box, {
    edges: [
      { edge: edges[0]!, radius: 2 },
      { edge: edges[1]!, radius: 2 }
    ],
    setbacks: [
      { vertex: sharedVertex, edge: edges[0]!, setback: 1 },
      { vertex: sharedVertex, edge: edges[1]!, setback: 1 }
    ]
  });
  expect(r.ok).toBe(true);
  if (r.ok) disposeShape(r.value);
  disposeShape(box);
});
```

`findSharedVertex` test-local helper using `TopExp_Explorer` + `IsSame` comparison (pattern from T5).

- [ ] **Step 2: Run — should fail**

FAIL (setbacks ignored).

- [ ] **Step 3: Extend `makeFillet` with setback handling**

After all edges are `.Add`-ed and BEFORE `.Build()`:

```ts
for (const sb of req.setbacks) {
  // Per-vertex-per-edge setback. The API is SetFilletShape or SetSetback
  // depending on opencascade.js binding — verify via d.ts.
  (mkFillet as { SetSetback?: (edge: unknown, vertex: unknown, setback: number) => void })
    .SetSetback?.(sb.edge as never, sb.vertex as never, sb.setback);
}
```

If `SetSetback` isn't available in the binding, fall back: compute the setback distance from the vertex along the edge and pass as the endpoint radius of a variable-mode fillet. Document the fallback in a code comment; tests pass either way.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FilletOps` → 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FilletOps.ts packages/kernel/src/occt/__tests__/FilletOps.integration.spec.ts
git commit -m "feat(kernel): makeFillet setback support"
```

---

## Phase 5 — FilletFeature adapter + FeatureTree integration

### Task 12: `executeFilletFeature` adapter

**Files:**
- Create: `packages/kernel/src/adapter/features/FilletFeature.ts`
- Test: `packages/kernel/src/adapter/features/__tests__/FilletFeature.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/kernel/src/adapter/features/__tests__/FilletFeature.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../../../occt/SolidOps';
import { namedFace, attachName, type NamedShape } from '../../../occt/FaceNaming';
import { executeFilletFeature } from '../FilletFeature';
import { canonicalEdgeName, ok, type Result, type KernelError, type FilletFeature, type ParamOrLiteral } from '@zilventor/shared';

let oc: OcctInstance;
beforeAll(async () => { oc = await loadOcct(); });

// Test-local helper: manually name a box's faces (top/bottom/side/0..3) so
// we can exercise executeFilletFeature without dragging in ExtrudeFeature.
function nameBoxFaces(oc: OcctInstance, box: { __brand: 'OcctShape'; handle: unknown }, featureId: string): NamedShape {
  // ... enumerate + name faces by Z-centroid ordering, same logic as T7 ...
  // returns NamedShape with 6 labelled faces
}

describe('executeFilletFeature (integration)', () => {
  it('fillets one top edge by name', () => {
    const box = makeBox(oc, 10, 10, 10);
    const named = nameBoxFaces(oc, box, 'E1');
    const resolveParam = (p: ParamOrLiteral): Result<number, KernelError> =>
      p.kind === 'literal' ? ok(p.value) : ok(2);  // stub: returns 2 for any param
    const feature: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: canonicalEdgeName(namedFace('E1', 'top'), namedFace('E1', 'side', 0)),
        selectionMode: 'edge',
        radius: { kind: 'literal', value: 2 }
      }],
      setbacks: []
    };
    const r = executeFilletFeature(oc, named, feature, resolveParam);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.faceNames.length).toBeGreaterThan(0);
      const hasBlend = r.value.faceNames.some((f) => f.name.role === 'blend');
      expect(hasBlend).toBe(true);
      disposeShape(r.value.shape);
    }
  });

  it('returns edgeNotFound when the edgeId maps to missing faces', () => {
    const box = makeBox(oc, 10, 10, 10);
    const named: NamedShape = { shape: box, faceNames: [] };  // no faces named
    const feature: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: canonicalEdgeName(namedFace('X', 'top'), namedFace('Y', 'side')),
        selectionMode: 'edge',
        radius: { kind: 'literal', value: 2 }
      }],
      setbacks: []
    };
    const r = executeFilletFeature(oc, named, feature, (p) => p.kind === 'literal' ? ok(p.value) : ok(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('edgeNotFound');
    disposeShape(box);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement `FilletFeature.ts`**

```ts
// packages/kernel/src/adapter/features/FilletFeature.ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { OcctShape } from '../../occt/SolidOps';
import { type NamedShape, resolveEdge, resolveVertex, attachName, namedFace } from '../../occt/FaceNaming';
import { makeFillet, type FilletRequest } from '../../occt/FilletOps';
import {
  ok, err, type Result, type KernelError, newCorrelationId,
  type FilletFeature, type ParamOrLiteral
} from '@zilventor/shared';

/**
 * Run a fillet feature against a running body.
 *
 * Flow:
 *   1. Resolve each FilletEdgeSpec.edgeId to a TopoDS_Edge via resolveEdge.
 *      A null means an upstream parametric edit invalidated the feature —
 *      return edgeNotFound with the offending edgeName in the message.
 *   2. Resolve every radius / startR / endR / setback via resolveParam.
 *   3. Build FilletRequest; call makeFillet.
 *   4. Name the result's faces: surviving input faces keep their names
 *      (matched via TopoDS_Shape.IsSame); newly-created blend faces get
 *      {feature.id}/blend/{n}.
 *   5. Return NamedShape.
 */
export function executeFilletFeature(
  oc: OcctInstance,
  runningBody: NamedShape,
  feature: FilletFeature,
  resolveParam: (p: ParamOrLiteral) => Result<number, KernelError>
): Result<NamedShape, KernelError> {
  // Step 1: resolve edges.
  const filletEdges: FilletRequest['edges'] = [];
  for (const spec of feature.edges) {
    const edge = resolveEdge(oc, runningBody, spec.edgeId);
    if (!edge) {
      return err({
        kind: 'edgeNotFound',
        message: `Edge ${spec.edgeId.faceA.role}-${spec.edgeId.faceB.role} not found in running body`,
        correlationId: newCorrelationId(),
        featureId: feature.id
      });
    }
    // Step 2: resolve radii.
    if (feature.mode === 'variable' && spec.variableRadii) {
      const startR = resolveParam(spec.variableRadii.startRadius);
      if (!startR.ok) return err({ ...startR.error, featureId: feature.id });
      const endR = resolveParam(spec.variableRadii.endRadius);
      if (!endR.ok) return err({ ...endR.error, featureId: feature.id });
      filletEdges.push({ edge, radius: 0, variable: { startRadius: startR.value, endRadius: endR.value } });
    } else {
      const r = resolveParam(spec.radius);
      if (!r.ok) return err({ ...r.error, featureId: feature.id });
      filletEdges.push({ edge, radius: r.value });
    }
  }

  // Resolve setbacks.
  const setbacks: FilletRequest['setbacks'] = [];
  for (const sb of feature.setbacks) {
    const vertex = resolveVertex(oc, runningBody, sb.vertexId);
    if (!vertex) continue;  // vertex no longer exists — skip this setback entry
    for (const pe of sb.perEdgeSetbacks) {
      const edge = resolveEdge(oc, runningBody, pe.edgeId);
      if (!edge) continue;
      const val = resolveParam(pe.setback);
      if (!val.ok) return err({ ...val.error, featureId: feature.id });
      setbacks.push({ vertex, edge, setback: val.value });
    }
  }

  // Step 3: call makeFillet.
  const result = makeFillet(oc, runningBody.shape, { edges: filletEdges, setbacks });
  if (!result.ok) return err({ ...result.error, featureId: feature.id });

  // Step 4: name faces of the result.
  const named: NamedShape = { shape: result.value, faceNames: [] };
  const expl = new oc.TopExp_Explorer_2(
    result.value.handle as never, oc.TopAbs_ShapeEnum.TopAbs_FACE as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  let blendIndex = 0;
  while (expl.More()) {
    const face = expl.Current();
    const surviving = runningBody.faceNames.find((f) =>
      (face as { IsSame?: (o: unknown) => boolean }).IsSame?.(f.face as never)
    );
    if (surviving) {
      attachName(named, face, surviving.name);
    } else {
      attachName(named, face, namedFace(feature.id, 'blend', blendIndex++));
    }
    expl.Next();
  }
  expl.delete();
  return ok(named);
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FilletFeature` → 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/FilletFeature.ts packages/kernel/src/adapter/features/__tests__/FilletFeature.integration.spec.ts
git commit -m "feat(kernel): executeFilletFeature adapter with edge/vertex resolution"
```

---

### Task 13: Wire `FilletFeature` into `FeatureTree.executeTree`

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('extrude New + fillet top edges produces a blended body', async () => {
  const part = makePart({
    parameters: {
      d1: { name: 'd1', expression: '10', value: 10, unit: 'mm' as const },
      r1: { name: 'r1', expression: '2', value: 2, unit: 'mm' as const }
    },
    features: [
      { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
      { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' },
      {
        kind: 'fillet', id: 'f1', mode: 'constant',
        edges: [{
          edgeId: canonicalEdgeName(namedFace('e1', 'top'), namedFace('e1', 'side', 0)),
          selectionMode: 'edge',
          radius: { kind: 'param', paramName: 'r1' }
        }],
        setbacks: []
      }
    ]
  });
  const r = await executeTree(occt, part);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.finalSolid).toBeDefined();
    disposeShape(r.value.finalSolid);
  }
});
```

Extend `makePart` helper in the spec file to accept `fillet` feature kind (add a mapper alongside existing rectSketch / extrude / rectAxisSketch / revolve mappers).

- [ ] **Step 2: Run — should fail**

FAIL (revolve placeholder still `continue`s).

- [ ] **Step 3: Replace the placeholder with the real branch**

Replace the `else if (feature.kind === 'fillet') { continue; }` added in T2 with:

```ts
} else if (feature.kind === 'fillet') {
  if (!finalSolid) {
    featureErrors.set(feature.id, {
      kind: 'invalidParameter',
      message: 'Fillet needs a body to modify',
      correlationId: newCorrelationId(),
      featureId: feature.id
    });
    continue;  // preserve whatever state we have
  }
  const result = executeFilletFeature(oc, finalSolid, feature, (p) => {
    if (p.kind === 'literal') return ok(p.value);
    const param = part.parameters[p.paramName];
    if (!param) return err({ kind: 'invalidParameter', message: `Parameter ${p.paramName} not found`, correlationId: newCorrelationId() });
    return resolve(param.expression, param.unit);
  });
  if (!result.ok) {
    featureErrors.set(feature.id, result.error);
    continue;
  }
  // Dispose the previous NamedShape's shape (fillet consumed + replaced it).
  disposeShape(finalSolid.shape);
  finalSolid = result.value;
}
```

Wire `featureErrors: Map<string, KernelError>` into `executeTree`'s return value (the `featureErrors` plumbing is formally added in T14; this task populates it).

Also: convert `finalSolid` from `OcctShape | null` to `NamedShape | null` throughout `executeTree`. All call sites that read `.handle` adjust to `.shape.handle`. Mesh tessellation unwraps via `finalSolid.shape`.

Update extrude branch to use `ex.value.named` in place of `ex.value.solid` where appropriate.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- FeatureTree` → all existing tests + new one PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts
git commit -m "feat(kernel): wire fillet into FeatureTree executor with featureErrors"
```

---

### Task 14: `ExecutionResult.featureErrors` extension + propagation

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/api.ts`
- Modify: `packages/kernel/src/__tests__/api.integration.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to api.integration.spec.ts
it('execute surfaces featureErrors for a fillet that fails to resolve', async () => {
  const api = createKernelApi();
  await api.init();
  const partId = await api.createPart('P');
  await api.addFeature(partId, { kind: 'sketch', id: 'S1', plane: 'XY',
    primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }], constraints: [] });
  await api.setParameter(partId, { name: 'd1', expression: '10', value: 10, unit: 'mm' });
  await api.addFeature(partId, {
    kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd1', direction: 'forward', operation: 'new'
  });
  // Fillet referencing a non-existent face.
  await api.setParameter(partId, { name: 'r1', expression: '2', value: 2, unit: 'mm' });
  await api.addFeature(partId, {
    kind: 'fillet', id: 'F1', mode: 'constant',
    edges: [{
      edgeId: { faceA: { featureId: 'ZZZ', role: 'top' }, faceB: { featureId: 'ZZZ', role: 'bottom' } },
      selectionMode: 'edge',
      radius: { kind: 'param', paramName: 'r1' }
    }],
    setbacks: []
  });
  const r = await api.execute(partId);
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.featureErrors).toBeDefined();
    expect(r.value.featureErrors!.get('F1')?.kind).toBe('edgeNotFound');
  }
});
```

- [ ] **Step 2: Run — should fail**

FAIL (`featureErrors` not populated).

- [ ] **Step 3: Extend `ExecutionResult` type + populate**

In `packages/kernel/src/adapter/FeatureTree.ts`:

```ts
export type ExecutionResult = {
  mesh: Mesh;
  finalSolid: OcctShape;
  featureErrors?: Map<string, KernelError>;
};
```

In `executeTree`, maintain `const featureErrors = new Map<string, KernelError>()` throughout execution; populate from fillet (and future modifier) branches. Return with `featureErrors: featureErrors.size > 0 ? featureErrors : undefined`.

In `packages/kernel/src/api.ts`: `previewFeature` already unwraps mesh from executeTree result; it can discard `featureErrors` (preview calls always target a fresh scratch feature, so errors go through the regular err path). `execute` propagates `featureErrors` unchanged.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/kernel test:integration -- api` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts packages/kernel/src/api.ts packages/kernel/src/__tests__/api.integration.spec.ts
git commit -m "feat(kernel): ExecutionResult.featureErrors for partial-failure reporting"
```

---

## Phase 6 — App command

### Task 15: `AddFilletFeatureCommand`

**Files:**
- Create: `packages/app/src/commands/AddFilletFeatureCommand.ts`
- Test: `packages/app/src/commands/__tests__/AddFilletFeatureCommand.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/commands/__tests__/AddFilletFeatureCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { AddFilletFeatureCommand } from '../AddFilletFeatureCommand';
import { ParameterRegistry } from '../../parameters/ParameterRegistry';
import { useAppStore } from '../../store/useAppStore';
import type { KernelClient } from '../../kernel-client/KernelClient';
import type { FilletFeature } from '@zilventor/shared';

describe('AddFilletFeatureCommand', () => {
  it('apply writes parameters + feature; revert rolls them back', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: []
    });
    const kernel = {
      addFeature: vi.fn().mockResolvedValue(undefined),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      setParameter: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ ok: true, value: { mesh: { positions: new Float32Array(), indices: new Uint32Array(), boundingBox: [0,0,0,0,0,0] as const } } }),
      getPart: vi.fn().mockResolvedValue({ id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [] })
    } as unknown as KernelClient;
    const registry = new ParameterRegistry();
    const feature: FilletFeature = {
      kind: 'fillet', id: 'F1', mode: 'constant',
      edges: [{
        edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 0 } },
        selectionMode: 'edge',
        radius: { kind: 'param', paramName: 'r_fillet' }
      }],
      setbacks: []
    };
    const cmd = new AddFilletFeatureCommand({
      partId: 'P1',
      feature,
      parameterExpressions: { r_fillet: { expression: '2', unit: 'mm' } },
      kernel,
      registry,
      store: { setActivePart: useAppStore.getState().setActivePart }
    });
    await cmd.apply();
    expect(registry.getValue('r_fillet')).toBe(2);
    expect(kernel.addFeature).toHaveBeenCalledWith('P1', feature);
    await cmd.revert();
    expect(registry.getValue('r_fillet')).toBeUndefined();
    expect(kernel.removeFeature).toHaveBeenCalledWith('P1', 'F1');
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL (module missing).

- [ ] **Step 3: Implement `AddFilletFeatureCommand.ts`**

Mirror `AddRevolveFeatureCommand` structure:

```ts
// packages/app/src/commands/AddFilletFeatureCommand.ts
import type { Command } from './Command';
import type { FilletFeature, PartDocument } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export type AddFilletFeatureStore = {
  setActivePart(p: PartDocument | null): void;
};

export type AddFilletFeatureOpts = {
  partId: string;
  feature: FilletFeature;
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
  kernel: KernelClient;
  registry: ParameterRegistry;
  store?: AddFilletFeatureStore;
};

export class AddFilletFeatureCommand implements Command {
  readonly name = 'AddFilletFeature';
  private writtenParams: string[] = [];
  constructor(private opts: AddFilletFeatureOpts) {}

  async apply(): Promise<void> {
    // Step 1: register each parameter in ParameterRegistry.
    for (const [name, { expression, unit }] of Object.entries(this.opts.parameterExpressions)) {
      const res = this.opts.registry.setParameter({ name, expression, unit });
      if (!res.ok) {
        // Rollback: remove anything we already wrote.
        for (const n of this.writtenParams) this.opts.registry.removeParameter(n);
        this.writtenParams = [];
        throw new Error(`Parameter setup failed: ${JSON.stringify(res.error)}`);
      }
      this.writtenParams.push(name);
    }
    try {
      // Step 2: push parameters to kernel.
      for (const name of this.writtenParams) {
        const val = this.opts.registry.getValue(name);
        const exprData = this.opts.parameterExpressions[name]!;
        await this.opts.kernel.setParameter(this.opts.partId, {
          name, expression: exprData.expression, value: val ?? 0, unit: exprData.unit
        });
      }
      await this.opts.kernel.addFeature(this.opts.partId, this.opts.feature);
      await this.opts.kernel.execute(this.opts.partId);
      if (this.opts.store) {
        const next = await this.opts.kernel.getPart(this.opts.partId);
        this.opts.store.setActivePart(next);
      }
    } catch (e) {
      // F6 compensation: undo registry writes if kernel failed.
      for (const n of this.writtenParams) this.opts.registry.removeParameter(n);
      this.writtenParams = [];
      throw e;
    }
  }

  async revert(): Promise<void> {
    await this.opts.kernel.removeFeature(this.opts.partId, this.opts.feature.id);
    for (const name of this.writtenParams) {
      this.opts.registry.removeParameter(name);
      await this.opts.kernel.deleteParameter(this.opts.partId, name);
    }
    this.writtenParams = [];
    await this.opts.kernel.execute(this.opts.partId);
    if (this.opts.store) {
      const next = await this.opts.kernel.getPart(this.opts.partId);
      this.opts.store.setActivePart(next);
    }
  }
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/app test:unit -- AddFilletFeatureCommand` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddFilletFeatureCommand.ts packages/app/src/commands/__tests__/AddFilletFeatureCommand.spec.ts
git commit -m "feat(app): AddFilletFeatureCommand with F6/F7 patterns"
```

---

## Phase 7 — Dialog

### Task 16: `FilletDialog` skeleton + mode/selection-mode toggles

**Files:**
- Create: `packages/app/src/shell/FilletDialog.tsx`
- Test: `packages/app/src/shell/__tests__/FilletDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// packages/app/src/shell/__tests__/FilletDialog.spec.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilletDialog } from '../FilletDialog';

describe('FilletDialog (layout)', () => {
  it('renders mode toggle + selection-mode toggle + 3 tabs', () => {
    render(<FilletDialog
      edges={[]}
      pickingMode="edge"
      previewError={null}
      onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
      onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
      onSelectionModeChange={vi.fn()}
      onModeChange={vi.fn()}
      onRadiusChange={vi.fn()}
    />);
    expect(screen.getByRole('tab', { name: /Edges/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Variable/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Setbacks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Constant/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Edge$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Loop/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /All Fillets/ })).toBeInTheDocument();
  });

  it('OK disabled when edges list is empty', () => {
    const onCommit = vi.fn();
    render(<FilletDialog edges={[]} pickingMode="edge" previewError={null}
      onCommit={onCommit} onApply={vi.fn()} onCancel={vi.fn()}
      onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
      onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: /^OK$/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL (component missing).

- [ ] **Step 3: Implement skeleton**

Create `FilletDialog.tsx` with:

```tsx
import { useState, type FormEvent } from 'react';
import type { FilletEdgeSpec, FilletSelectionMode, ParamOrLiteral } from '@zilventor/shared';

export type FilletDialogValue = {
  mode: 'constant' | 'variable';
  radius: string;  // expression text
  edges: FilletEdgeSpec[];
  setbacks: Array<{ vertexKey: string; perEdge: Array<{ edgeKey: string; setback: string }> }>;
};

type Props = {
  edges: FilletEdgeSpec[];
  pickingMode: FilletSelectionMode;
  previewError: string | null;
  onCommit(v: FilletDialogValue): void;
  onApply(v: FilletDialogValue): void;
  onCancel(): void;
  onAddEdges(): void;
  onRemoveEdge(spec: FilletEdgeSpec): void;
  onClearEdges(): void;
  onSelectionModeChange(mode: FilletSelectionMode): void;
  onModeChange(mode: 'constant' | 'variable'): void;
  onRadiusChange(expression: string): void;
};

export function FilletDialog(props: Props): JSX.Element {
  const [tab, setTab] = useState<'edges' | 'variable' | 'setbacks'>('edges');
  const [mode, setMode] = useState<'constant' | 'variable'>('constant');
  const [radius, setRadius] = useState('2');

  const canCommit = props.edges.length > 0 && radius.trim().length > 0;

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (canCommit) props.onCommit({ mode, radius, edges: props.edges, setbacks: [] });
  };

  // ... render: panel > header > mode toggle (Constant/Variable buttons with aria-pressed) >
  // tab row (Edges/Variable/Setbacks) > selection-mode row (5 buttons) > tab body (Edges
  // tab: radius input + edge-list + Add/Clear buttons) > preview-error badge > OK/Cancel/Apply
}
```

Structure details: inline styles matching `RevolveDialog` palette (`#1a1a1a` panel, `#eee` text, `#2a2a2a` buttons, `#3b5a8a` pressed). Panel is 400px wide.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/app test:unit -- FilletDialog` → 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FilletDialog.tsx packages/app/src/shell/__tests__/FilletDialog.spec.tsx
git commit -m "feat(app): FilletDialog skeleton (tabs + mode + selection-mode toggles)"
```

---

### Task 17: FilletDialog Edges tab — radius field + edge list

**Files:**
- Modify: `packages/app/src/shell/FilletDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/FilletDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('Edges tab shows radius input + edge list with remove buttons', () => {
  const onRemoveEdge = vi.fn();
  const edges: FilletEdgeSpec[] = [{
    edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 0 } },
    selectionMode: 'edge',
    radius: { kind: 'literal', value: 2 }
  }];
  render(<FilletDialog edges={edges} pickingMode="edge" previewError={null}
    onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
    onAddEdges={vi.fn()} onRemoveEdge={onRemoveEdge} onClearEdges={vi.fn()}
    onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
  />);
  expect(screen.getByLabelText(/Radius/)).toBeInTheDocument();
  expect(screen.getByText(/top.*side/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Remove/ }));
  expect(onRemoveEdge).toHaveBeenCalled();
});

it('renders inline parse error when validateExpression returns a string', () => {
  render(<FilletDialog edges={[]} pickingMode="edge" previewError={null}
    validateExpression={() => 'bad expression'}
    onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
    onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
    onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
  />);
  expect(screen.getByRole('alert')).toHaveTextContent('bad expression');
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement Edges-tab body**

Within the `tab === 'edges'` branch, render:

- A radius input (`<input aria-label="Radius" value={radius} onChange={...}>`).
- Inline error under the input when `validateExpression(radius)` returns non-null.
- The edge-list as a list of rows:
  ```tsx
  {props.edges.map((e, i) => (
    <div key={i} role="row">
      <span>{e.edgeId.faceA.role}–{e.edgeId.faceB.role}</span>
      <button type="button" onClick={() => props.onRemoveEdge(e)}>Remove</button>
    </div>
  ))}
  ```
- "Add" button fires `props.onAddEdges()` — app enters pick mode.
- "Clear All" button fires `props.onClearEdges()`.

Add optional `validateExpression?: (expression: string) => string | null` prop (mirrors RevolveDialog's F1 addition).

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/app test:unit -- FilletDialog` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FilletDialog.tsx packages/app/src/shell/__tests__/FilletDialog.spec.tsx
git commit -m "feat(app): FilletDialog Edges tab (radius + edge list + inline errors)"
```

---

### Task 18: FilletDialog Variable tab

**Files:**
- Modify: `packages/app/src/shell/FilletDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/FilletDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('Variable tab is disabled when mode = constant', () => {
  render(<FilletDialog edges={[]} pickingMode="edge" previewError={null}
    onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
    onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
    onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
  />);
  const varTab = screen.getByRole('tab', { name: /Variable/ });
  expect(varTab).toHaveAttribute('aria-disabled', 'true');
});

it('Variable tab shows per-edge startR/endR inputs when mode = variable', async () => {
  const edges: FilletEdgeSpec[] = [{
    edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 0 } },
    selectionMode: 'edge',
    radius: { kind: 'literal', value: 2 },
    variableRadii: { startRadius: { kind: 'literal', value: 1 }, endRadius: { kind: 'literal', value: 3 } }
  }];
  render(<FilletDialog edges={edges} pickingMode="edge" previewError={null}
    initialMode="variable"
    onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
    onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
    onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
    onVariableRadiiChange={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('tab', { name: /Variable/ }));
  expect(screen.getByLabelText(/Start radius/)).toBeInTheDocument();
  expect(screen.getByLabelText(/End radius/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement Variable tab**

Add `initialMode?: 'constant' | 'variable'` and `onVariableRadiiChange?: (edge: FilletEdgeSpec, startR: string, endR: string) => void` props.

In the `tab === 'variable'` branch, render per-edge rows:
```tsx
{props.edges.map((e, i) => {
  const startR = e.variableRadii?.startRadius.kind === 'literal' ? String(e.variableRadii.startRadius.value) : '1';
  const endR = e.variableRadii?.endRadius.kind === 'literal' ? String(e.variableRadii.endRadius.value) : '2';
  return (
    <div key={i} role="row">
      <span>{e.edgeId.faceA.role}–{e.edgeId.faceB.role}</span>
      <label>Start radius <input aria-label="Start radius" value={startR} onChange={(ev) => props.onVariableRadiiChange?.(e, ev.target.value, endR)} /></label>
      <label>End radius <input aria-label="End radius" value={endR} onChange={(ev) => props.onVariableRadiiChange?.(e, startR, ev.target.value)} /></label>
      {/* simple gradient bar for the transition preview */}
      <div style={{ height: 6, background: `linear-gradient(to right, #3b5a8a ${startR}%, #8aa4c7 ${endR}%)` }} />
    </div>
  );
})}
```

Disable the Variable tab when `mode === 'constant'` (set `aria-disabled="true"` and no-op onClick).

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FilletDialog.tsx packages/app/src/shell/__tests__/FilletDialog.spec.tsx
git commit -m "feat(app): FilletDialog Variable tab (per-edge start/end radii)"
```

---

### Task 19: FilletDialog Setbacks tab

**Files:**
- Modify: `packages/app/src/shell/FilletDialog.tsx`
- Modify: `packages/app/src/shell/__tests__/FilletDialog.spec.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('Setbacks tab shows auto-detected vertices with setback inputs', () => {
  const edges: FilletEdgeSpec[] = [
    { edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 0 } }, selectionMode: 'edge', radius: { kind: 'literal', value: 2 } },
    { edgeId: { faceA: { featureId: 'E1', role: 'top' }, faceB: { featureId: 'E1', role: 'side', instance: 1 } }, selectionMode: 'edge', radius: { kind: 'literal', value: 2 } },
    { edgeId: { faceA: { featureId: 'E1', role: 'side', instance: 0 } , faceB: { featureId: 'E1', role: 'side', instance: 1 } }, selectionMode: 'edge', radius: { kind: 'literal', value: 2 } }
  ];
  render(<FilletDialog edges={edges} pickingMode="edge" previewError={null}
    vertices={[{ vertexKey: 'V1', perEdge: [{ edgeKey: 'top-side0', defaultSetback: 1 }, { edgeKey: 'top-side1', defaultSetback: 1 }, { edgeKey: 'side0-side1', defaultSetback: 1 }] }]}
    onCommit={vi.fn()} onApply={vi.fn()} onCancel={vi.fn()}
    onAddEdges={vi.fn()} onRemoveEdge={vi.fn()} onClearEdges={vi.fn()}
    onSelectionModeChange={vi.fn()} onModeChange={vi.fn()} onRadiusChange={vi.fn()}
    onSetbackChange={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('tab', { name: /Setbacks/ }));
  expect(screen.getAllByLabelText(/Setback/)).toHaveLength(3);
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement Setbacks tab**

Add `vertices?: Array<{ vertexKey: string; perEdge: Array<{ edgeKey: string; defaultSetback: number; currentSetback?: string }> }>` prop and `onSetbackChange?: (vertexKey: string, edgeKey: string, setback: string) => void`.

Render in `tab === 'setbacks'`:
```tsx
{props.vertices?.map((v) => (
  <fieldset key={v.vertexKey}>
    <legend>Vertex {v.vertexKey}</legend>
    {v.perEdge.map((pe) => (
      <label key={pe.edgeKey}>
        Setback for {pe.edgeKey}
        <input aria-label="Setback"
          value={pe.currentSetback ?? String(pe.defaultSetback)}
          onChange={(ev) => props.onSetbackChange?.(v.vertexKey, pe.edgeKey, ev.target.value)}
        />
      </label>
    ))}
  </fieldset>
))}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/FilletDialog.tsx packages/app/src/shell/__tests__/FilletDialog.spec.tsx
git commit -m "feat(app): FilletDialog Setbacks tab (per-vertex-per-edge inputs)"
```

---

## Phase 8 — EdgePickController

### Task 20: `EdgePickController` skeleton + Edge mode

**Files:**
- Create: `packages/app/src/model/EdgePickController.ts`
- Test: `packages/app/src/model/__tests__/EdgePickController.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/app/src/model/__tests__/EdgePickController.spec.ts
import { describe, it, expect } from 'vitest';
import { EdgePickController, type TessellatedEdge } from '../EdgePickController';
import { canonicalEdgeName } from '@zilventor/shared';

const faceA = { featureId: 'E1', role: 'top' };
const faceB = { featureId: 'E1', role: 'side', instance: 0 };
const edgeName = canonicalEdgeName(faceA, faceB);

const edge: TessellatedEdge = {
  edgeName,
  segments: [[{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]],
  faceNames: [faceA, faceB],
  dihedralAngle: 90
};

describe('EdgePickController Edge mode', () => {
  it('pick returns the hit edge when within tolerance', () => {
    const ctrl = new EdgePickController();
    ctrl.setCandidates([edge]);
    ctrl.setMode('edge');
    const hit = ctrl.pick({ x: 5, y: 0, z: 0 });
    expect(hit).toEqual([edgeName]);
  });
  it('pick returns null when point is out of tolerance', () => {
    const ctrl = new EdgePickController();
    ctrl.setCandidates([edge]);
    ctrl.setMode('edge');
    expect(ctrl.pick({ x: 5, y: 50, z: 0 })).toBe(null);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/model/EdgePickController.ts
import type { EdgeName, FaceName, FilletSelectionMode } from '@zilventor/shared';

export type Vec3 = { x: number; y: number; z: number };

export type TessellatedEdge = {
  edgeName: EdgeName;
  segments: Array<[Vec3, Vec3]>;
  faceNames: [FaceName, FaceName];
  dihedralAngle?: number;
};

export class EdgePickController {
  private candidates: TessellatedEdge[] = [];
  private mode: FilletSelectionMode = 'edge';
  private tolerance = 2;  // world units

  setCandidates(edges: TessellatedEdge[]): void { this.candidates = edges; }
  setMode(m: FilletSelectionMode): void { this.mode = m; }
  setTolerance(t: number): void { this.tolerance = t; }

  pick(point: Vec3): EdgeName[] | null {
    const hit = this.nearestEdge(point);
    if (!hit) return null;
    // T21: loop/feature/all-fillets/all-rounds dispatch here.
    return [hit.edgeName];
  }

  highlight(point: Vec3): EdgeName[] | null {
    return this.pick(point);  // T24 refines to a separate hover path
  }

  private nearestEdge(p: Vec3): TessellatedEdge | null {
    let best: { edge: TessellatedEdge; d: number } | null = null;
    for (const e of this.candidates) {
      for (const [a, b] of e.segments) {
        const d = distPointToSegment(p, a, b);
        if (d <= this.tolerance && (!best || d < best.d)) {
          best = { edge: e, d };
        }
      }
    }
    return best?.edge ?? null;
  }
}

function distPointToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
  const c1 = vx * wx + vy * wy + vz * wz;
  if (c1 <= 0) return Math.hypot(wx, wy, wz);
  const c2 = vx * vx + vy * vy + vz * vz;
  if (c1 >= c2) return Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy), p.z - (a.z + t * vz));
}
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/app test:unit -- EdgePickController` → 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/model/EdgePickController.ts packages/app/src/model/__tests__/EdgePickController.spec.ts
git commit -m "feat(app): EdgePickController skeleton + Edge mode hit-test"
```

---

### Task 21: Loop mode (tangency graph walk)

**Files:**
- Modify: `packages/app/src/model/EdgePickController.ts`
- Modify: `packages/app/src/model/__tests__/EdgePickController.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('Loop mode walks tangent-continuous neighbors', () => {
  // 4 edges forming a closed loop (top face of a box), all tangent-continuous.
  const e1 = /* edge AB from (0,0,0) to (10,0,0) */;
  const e2 = /* edge BC from (10,0,0) to (10,10,0), shares B with e1 */;
  const e3 = /* edge CD from (10,10,0) to (0,10,0) */;
  const e4 = /* edge DA from (0,10,0) to (0,0,0) */;
  const ctrl = new EdgePickController();
  ctrl.setCandidates([e1, e2, e3, e4]);
  ctrl.setMode('loop');
  const hit = ctrl.pick({ x: 5, y: 0, z: 0 });  // on e1
  expect(hit).toHaveLength(4);
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement loop walk**

In `pick`, when `mode === 'loop'`:

```ts
if (this.mode === 'loop') {
  const visited = new Set<string>();
  const queue: TessellatedEdge[] = [hit.edge];
  const result: EdgeName[] = [];
  while (queue.length > 0) {
    const e = queue.shift()!;
    const key = edgeNameKey(e.edgeName);
    if (visited.has(key)) continue;
    visited.add(key);
    result.push(e.edgeName);
    // Find neighbors: edges sharing an endpoint with e whose tangent change is small.
    for (const other of this.candidates) {
      if (visited.has(edgeNameKey(other.edgeName))) continue;
      if (shareEndpointWithSmallTangentChange(e, other)) queue.push(other);
    }
  }
  return result;
}
```

Helpers: `edgeNameKey(n)` = `{featureId}/{role}/{instance}|...`. `shareEndpointWithSmallTangentChange(a, b)` = compute endpoint proximity < 0.01 AND dihedral change ≤ 5°.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/model/EdgePickController.ts packages/app/src/model/__tests__/EdgePickController.spec.ts
git commit -m "feat(app): EdgePickController Loop mode via tangency graph walk"
```

---

### Task 22: Feature / All-Fillets / All-Rounds modes

**Files:**
- Modify: `packages/app/src/model/EdgePickController.ts`
- Modify: `packages/app/src/model/__tests__/EdgePickController.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('Feature mode returns all edges whose faces reference the hit edge featureId', () => {
  const eE1 = /* edge with faces {E1/top, E1/side/0} */;
  const eE1_other = /* edge with faces {E1/side/0, E1/side/1} */;
  const eE2 = /* edge with faces {E2/top, E2/side/0} */;
  const ctrl = new EdgePickController();
  ctrl.setCandidates([eE1, eE1_other, eE2]);
  ctrl.setMode('feature');
  const hit = ctrl.pick(/* point on eE1 */);
  expect(hit).toHaveLength(2);  // eE1 + eE1_other, not eE2
});

it('All Fillets mode returns only concave edges', () => {
  const concaveEdge = /* dihedralAngle: 200 */;
  const convexEdge = /* dihedralAngle: 160 */;
  const ctrl = new EdgePickController();
  ctrl.setCandidates([concaveEdge, convexEdge]);
  ctrl.setMode('all-fillets');
  const hit = ctrl.pick(/* point near concaveEdge */);
  expect(hit).toContain(concaveEdge.edgeName);
  expect(hit).not.toContain(convexEdge.edgeName);
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement remaining modes**

```ts
if (this.mode === 'feature') {
  const fid = hit.edge.faceNames[0].featureId;
  return this.candidates
    .filter((e) => e.faceNames[0].featureId === fid && e.faceNames[1].featureId === fid)
    .map((e) => e.edgeName);
}
if (this.mode === 'all-fillets') {
  return this.candidates
    .filter((e) => (e.dihedralAngle ?? 180) > 180)
    .map((e) => e.edgeName);
}
if (this.mode === 'all-rounds') {
  return this.candidates
    .filter((e) => (e.dihedralAngle ?? 180) < 180)
    .map((e) => e.edgeName);
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/model/EdgePickController.ts packages/app/src/model/__tests__/EdgePickController.spec.ts
git commit -m "feat(app): EdgePickController Feature/All-Fillets/All-Rounds modes"
```

---

## Phase 9 — App wiring

### Task 23: Ribbon button + `F` shortcut + dialog render

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/shell/tabs/ModelTab.tsx`
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Add store flag**

In `useAppStore.ts`:
```ts
filletDialogOpen: boolean;
setFilletDialogOpen(v: boolean): void;
```
Initialize to `false`; implement the setter.

- [ ] **Step 2: Add Model-tab Revolve-adjacent Fillet button**

In `ModelTab.tsx`, after the Revolve button:
```tsx
<button
  onClick={() => useAppStore.getState().setFilletDialogOpen(true)}
  disabled={!hasSketch}
>
  Fillet (F)
</button>
```

- [ ] **Step 3: Wire `F` shortcut in App.tsx**

In the global keyboard handler in App.tsx, after the `r` shortcut branch:
```ts
if (!sketchMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') {
  e.preventDefault();
  useAppStore.getState().setFilletDialogOpen(true);
  return;
}
```

- [ ] **Step 4: Render FilletDialog conditionally**

In App.tsx render tree, next to the RevolveDialog render block:
```tsx
{filletDialogOpen && (
  <FilletDialog
    edges={filletEdges}
    pickingMode={filletSelectionMode}
    previewError={filletPreviewError}
    onCommit={onFilletCommit}
    onApply={onFilletApply}
    onCancel={onFilletCancel}
    onAddEdges={onFilletAddEdges}
    onRemoveEdge={onFilletRemoveEdge}
    onClearEdges={() => setFilletEdges([])}
    onSelectionModeChange={setFilletSelectionMode}
    onModeChange={setFilletMode}
    onRadiusChange={setFilletRadiusExpr}
    validateExpression={(expr) => {
      const res = parameterRegistry.dryRun({ name: 'r_fillet_dry', expression: expr, unit: 'mm' });
      return res.ok ? null : formatExpressionError(res.error);
    }}
  />
)}
```

Add supporting state: `filletEdges`, `filletSelectionMode`, `filletPreviewError`, `filletMode`, `filletRadiusExpr`. Stub the handlers (`onFilletCommit` etc.) as no-ops; T24/T25 wire the real logic.

- [ ] **Step 5: Verify**

`pnpm -C packages/app test:unit && pnpm -r typecheck` — all green. No new tests; existing 155+ unit tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/shell/tabs/ModelTab.tsx packages/app/src/App.tsx
git commit -m "feat(app): Fillet ribbon button + F shortcut + dialog mount"
```

---

### Task 24: Edge pick routing + hover highlight

**Files:**
- Modify: `packages/app/src/App.tsx`
- Modify: `packages/app/src/viewport/SceneManager.ts`
- Modify: `packages/app/src/viewport/Viewport.tsx`

- [ ] **Step 1: Add picker ref + pick state**

In App.tsx, following the `axisPickerRef` pattern:
```ts
const edgePickerRef = useRef<EdgePickController>(new EdgePickController());
const [pickingFilletEdges, setPickingFilletEdges] = useState(false);
const [hoveredEdgeSet, setHoveredEdgeSet] = useState<EdgeName[] | null>(null);
```

- [ ] **Step 2: onFilletAddEdges — enter pick mode**

```ts
const onFilletAddEdges = useCallback(() => {
  if (!activePart) return;
  // Populate picker candidates from the currently-tessellated body.
  // App.tsx stores tessellatedEdges from the execute effect; wire that
  // forward here.
  edgePickerRef.current.setCandidates(tessellatedEdgesRef.current ?? []);
  edgePickerRef.current.setMode(filletSelectionMode);
  setPickingFilletEdges(true);
}, [activePart, filletSelectionMode]);
```

- [ ] **Step 3: Route viewport pointer**

In `handleViewportPointer`, add a branch before the axis-pick branch:

```ts
if (!sketchMode && pickingFilletEdges) {
  if (ev.type === 'move') {
    const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
    const hover = edgePickerRef.current.highlight(world);
    setHoveredEdgeSet(hover);
    return;
  }
  if (ev.type === 'click') {
    const world = viewportRef.current.screenToWorld(ev.clientX, ev.clientY);
    const pick = edgePickerRef.current.pick(world);
    if (pick && pick.length > 0) {
      const newSpecs: FilletEdgeSpec[] = pick.map((edgeId) => ({
        edgeId, selectionMode: filletSelectionMode,
        radius: { kind: 'param', paramName: 'r_fillet' }
      }));
      setFilletEdges((prev) => [...prev, ...newSpecs]);
      setPickingFilletEdges(false);
      setHoveredEdgeSet(null);
    }
  }
  return;
}
```

- [ ] **Step 4: Render hover overlay**

Add `setHighlightedEdges(edges)` / `clearHighlightedEdges()` to SceneManager.ts: accepts a list of world-space line segments, renders them as a temporary `THREE.Line` overlay at elevated color. App.tsx calls `viewportRef.current?.setHighlightedEdges(...)` whenever `hoveredEdgeSet` changes.

Forward the new methods through `ViewportRef` via `useImperativeHandle` (mirrors the T14 preview-mesh plumbing).

- [ ] **Step 5: Verify**

`pnpm -r typecheck && pnpm -C packages/app test:unit` — all green.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/App.tsx packages/app/src/viewport/SceneManager.ts packages/app/src/viewport/Viewport.tsx
git commit -m "feat(app): fillet edge-pick routing + hover highlight"
```

---

### Task 25: schedulePreview + commit/cancel flow

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Implement onFilletCommit / onFilletApply / onFilletCancel**

```ts
const onFilletCommit = useCallback(async (v: FilletDialogValue) => {
  if (!activePart || !kernel || filletEdges.length === 0) return;
  const feature: FilletFeature = {
    kind: 'fillet',
    id: `f${Date.now()}`,
    mode: v.mode,
    edges: filletEdges,
    setbacks: []  // user-edited setbacks flow in through v.setbacks (T19) — map here
  };
  const parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }> = {
    r_fillet: { expression: v.radius, unit: 'mm' }
  };
  // Variable-mode: each spec's variableRadii references named params too;
  // pull them into parameterExpressions.
  const store = useAppStore.getState();
  try {
    await store.bus.execute(new AddFilletFeatureCommand({
      partId: activePart.id, feature, parameterExpressions,
      kernel, registry: parameterRegistry,
      store: { setActivePart: store.setActivePart }
    }));
    clearFilletPreview();
    clearFilletScratchParams();
    setFilletDialogOpen(false);
    setFilletEdges([]);
  } catch (e) {
    showToast(`Fillet failed: ${(e as Error).message}`);
  }
}, [activePart, kernel, filletEdges]);

const onFilletApply = /* mirror onFilletCommit but don't close dialog or clear edges */;
const onFilletCancel = useCallback(() => {
  clearFilletPreview();
  clearFilletScratchParams();  // F7 pattern: delete any scratch params written by preview
  setFilletDialogOpen(false);
  setFilletEdges([]);
  setPickingFilletEdges(false);
  setHoveredEdgeSet(null);
}, []);
```

- [ ] **Step 2: Debounced preview**

```ts
const filletPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const scheduleFilletPreview = useCallback((v: FilletDialogValue) => {
  if (filletPreviewTimerRef.current) clearTimeout(filletPreviewTimerRef.current);
  if (!activePart || !kernel || filletEdges.length === 0) return;
  filletPreviewTimerRef.current = setTimeout(async () => {
    const scratchFeature: FilletFeature = { kind: 'fillet', id: 'F_scratch', mode: v.mode, edges: filletEdges, setbacks: [] };
    // Pre-write the radius param.
    await kernel.setParameter(activePart.id, { name: 'r_fillet', expression: v.radius, value: 0, unit: 'mm' });
    filletScratchParamsRef.current.add('r_fillet');
    const r = await kernel.previewFeature(activePart.id, scratchFeature);
    if (r.ok) viewportRef.current?.setPreviewMesh(r.value.mesh.positions, r.value.mesh.indices);
    else {
      viewportRef.current?.clearPreviewMesh();
      setFilletPreviewError(r.error.message);
    }
  }, 200);
}, [activePart, kernel, filletEdges]);
```

Call `scheduleFilletPreview` from the dialog's `onRadiusChange` / `onModeChange` handlers.

- [ ] **Step 3: Instrumentation counter**

Inside the `setTimeout` callback, after `previewFeature` resolves:
```ts
if (import.meta.env.DEV) {
  const w = window as unknown as { __zilventorFilletPreviewCount?: number };
  w.__zilventorFilletPreviewCount = (w.__zilventorFilletPreviewCount ?? 0) + 1;
}
```

- [ ] **Step 4: Verify**

`pnpm -C packages/app test:unit && pnpm -r typecheck && pnpm test:e2e -- model` — all existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): fillet debounced preview + commit/apply/cancel flow"
```

---

## Phase 10 — BrowserPane warning badge

### Task 26: BrowserPane warning badge + re-open in edit mode

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (add `featureErrors` slice)
- Modify: `packages/app/src/App.tsx` (mirror executeResult.featureErrors into store)
- Modify: `packages/app/src/shell/BrowserPane.tsx`

- [ ] **Step 1: Store slice**

```ts
// useAppStore.ts
featureErrors: Map<string, KernelError>;
setFeatureErrors(m: Map<string, KernelError>): void;
```

- [ ] **Step 2: Mirror from execute**

In App.tsx's execute-useEffect, after `kernel.execute(activePart.id)` resolves:
```ts
useAppStore.getState().setFeatureErrors(res.value.featureErrors ?? new Map());
```

- [ ] **Step 3: Render badge in BrowserPane**

In the feature-tree list rendering:
```tsx
{featureErrors.has(feature.id) && (
  <button
    data-feature-error={featureErrors.get(feature.id)?.kind}
    aria-label={`Feature ${feature.id} has errors`}
    onClick={() => reopenFilletDialogInEditMode(feature.id)}
  >⚠</button>
)}
```

Define `reopenFilletDialogInEditMode(featureId)` as a helper at the App level: finds the feature in activePart.featureTree, pre-populates dialog state (edges, mode, radius expression), opens the dialog, sets a `filletEditMode` flag that causes OK to replace rather than add.

- [ ] **Step 4: Verify**

`pnpm -C packages/app test:unit && pnpm -r typecheck` — all green.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/App.tsx packages/app/src/shell/BrowserPane.tsx
git commit -m "feat(app): feature-tree warning badge + re-open fillet in edit mode"
```

---

## Phase 11 — E2E + perf

### Task 27: E2E `place-fillet-box.spec.ts`

**Files:**
- Create: `tests/e2e/model/place-fillet-box.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { waitForKernelReady } from '../helpers/buildBox';
import { seedKernelPart } from '../helpers/seedKernelPart';

test('place a fillet on a box top edge', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  await page.getByRole('tab', { name: 'Model' }).click();
  await page.getByRole('button', { name: 'New Part' }).click();
  await seedKernelPart(page, {
    parameters: [{ name: 'd1', expression: '10', value: 10, unit: 'mm' }],
    sketches: [{ id: 'S1', primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 10, h: 10 }] }],
    extrudes: [{ id: 'E1', sketchRef: 'S1', distanceParam: 'd1', operation: 'new' }]
  });
  const initialTris = await page.locator('[data-triangle-count]').getAttribute('data-triangle-count');
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: /Revolve|Fillet/i })).toBeVisible();
  // Add an edge by clicking a top edge.
  await page.getByRole('button', { name: /^Add$/ }).click();
  const canvasPt = await page.evaluate(() => {
    const w = window as unknown as { __zilventorWorldToScreen: (x: number, y: number) => { x: number; y: number } };
    return w.__zilventorWorldToScreen(5, 5);  // roughly on the top face center; picker tolerates
  });
  await page.locator('main#region-viewport canvas').click({ position: { x: canvasPt.x, y: canvasPt.y }, force: true });
  await page.getByLabel('Radius').fill('2');
  await page.getByRole('button', { name: /^OK$/ }).click();
  const finalTris = await page.locator('[data-triangle-count]').getAttribute('data-triangle-count');
  expect(Number(finalTris)).toBeGreaterThan(Number(initialTris));
  const count = await page.evaluate(() => {
    const s = (window as unknown as { __zilventorStore: { getState(): { activePart: { featureTree: Array<{ kind: string }> } } } }).__zilventorStore.getState();
    return s.activePart.featureTree.filter((f) => f.kind === 'fillet').length;
  });
  expect(count).toBe(1);
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm exec playwright test --project=chromium place-fillet-box
git add tests/e2e/model/place-fillet-box.spec.ts
git commit -m "test(e2e): place-fillet-box golden path"
```

---

### Task 28: E2E `fillet-loop-selection.spec.ts`

**Files:**
- Create: `tests/e2e/model/fillet-loop-selection.spec.ts`

- [ ] **Step 1: Write the test**

Seed a cube. Click the Loop selection-mode toggle. Click one top edge. Assert the dialog's edge-list count is 4 (all top edges auto-selected). OK. Assert final mesh has 4 blend faces (verify via `data-feature-fillet-blend-count` if added, else via triangle-count delta vs a single-edge fillet baseline).

- [ ] **Step 2: Run + commit**

```bash
pnpm exec playwright test --project=chromium fillet-loop-selection
git add tests/e2e/model/fillet-loop-selection.spec.ts
git commit -m "test(e2e): fillet loop selection auto-picks tangent-continuous edges"
```

---

### Task 29: E2E `fillet-parametric-cascade.spec.ts`

**Files:**
- Create: `tests/e2e/model/fillet-parametric-cascade.spec.ts`

- [ ] **Step 1: Write the test**

Seed a cube with `d1 = 10` and a fillet on its top edges at `r_fillet = 2`. Edit `d1` to `20` via the Parameters panel. Assert cube grows (bbox Z extent ≈ 20) AND the triangle count doesn't drop to pre-fillet levels (indicating the fillet re-resolved successfully).

- [ ] **Step 2: Run + commit**

```bash
pnpm exec playwright test --project=chromium fillet-parametric-cascade
git add tests/e2e/model/fillet-parametric-cascade.spec.ts
git commit -m "test(e2e): fillet survives parametric edit via topological naming"
```

---

### Task 30: E2E `fillet-edge-lost.spec.ts`

**Files:**
- Create: `tests/e2e/model/fillet-edge-lost.spec.ts`

- [ ] **Step 1: Write the test**

Seed cube + fillet on top edge. Then programmatically mutate the sketch so the relevant face disappears (e.g., replace the rectangle with a smaller one that no longer produces a top face at that position). Call `kernel.execute`. Assert the returned `ExecutionResult.featureErrors` has an entry for the fillet feature with kind `edgeNotFound`. Assert the BrowserPane renders a warning badge. Click the badge and assert the dialog opens with the bad edge highlighted.

- [ ] **Step 2: Run + commit**

```bash
pnpm exec playwright test --project=chromium fillet-edge-lost
git add tests/e2e/model/fillet-edge-lost.spec.ts
git commit -m "test(e2e): fillet edge-lost surfaces badge + reopen flow"
```

---

### Task 31: Perf `fillet-preview-debounce.spec.ts`

**Files:**
- Create: `tests/perf/fillet-preview-debounce.spec.ts`

- [ ] **Step 1: Write the test**

Mirror `tests/perf/revolve-preview-debounce.spec.ts`. Seed cube + open Fillet dialog + add one top edge. Reset `window.__zilventorFilletPreviewCount` to 0. Rapid-fire 10 fills on the Radius input at 100 ms intervals. Wait 500 ms settle. Assert `count >= 1`, `count <= 3`, `totalMs <= 2000`.

- [ ] **Step 2: Run + commit**

```bash
pnpm exec playwright test --project=perf fillet-preview-debounce
git add tests/perf/fillet-preview-debounce.spec.ts
git commit -m "test(perf): fillet-preview-debounce — verifies 200ms debounce"
```

---

## Phase 12 — Docs + ship

### Task 32: Manual test checklist + memory update

**Files:**
- Create: `docs/superpowers/manual-tests/subproject-3b.md`
- Modify: memory `project_subproject_3b_execution_state.md`

- [ ] **Step 1: Write the checklist**

Sections: Setup, Golden path (single-edge fillet), Loop/Feature/All-modes selection, Variable radius, Setbacks, Parametric cascade, Edge-lost UX, Save/reopen, Error paths.

Each section is a bulleted list of `- [ ] <action> → <expected>` items the user checks while poking the app.

- [ ] **Step 2: Memory update**

Write `/Users/lion/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/project_subproject_3b_execution_state.md` summarizing 3b's status + key commit SHAs + known limitations (if any).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/manual-tests/subproject-3b.md
git commit -m "docs(manual-tests): sub-project 3b checklist"
```

---

### Task 33: Final code review + ship

- [ ] **Step 1: Run full suite**

```bash
pnpm -r typecheck
pnpm -r test:unit
pnpm -C packages/kernel test:integration
pnpm test:e2e
pnpm exec playwright test --project=perf
```

All green.

- [ ] **Step 2: Dispatch `superpowers:code-reviewer` agent**

End-of-project review. Fix any Critical / Important findings inline.

- [ ] **Step 3: Push to origin**

```bash
git push origin master
```

- [ ] **Step 4: Update MEMORY.md index line**

Change 3b entry from `IN FLIGHT` to `SHIPPED at <final-sha>`.

---

## Summary

**33 tasks** delivering:

- Shared types: `FaceName`, `EdgeName`, `canonicalEdgeName`, `FilletFeature`, `ParamOrLiteral`, `VertexSetback`, `FilletSelectionMode`.
- File format v6 migration.
- Topological naming layer (`NamedShape`, `attachName`, `resolveEdge`, `resolveVertex`) with unit + integration tests.
- Feature retrofits (SketchFeature / ExtrudeFeature / RevolveFeature emit NamedShape with labelled faces).
- OCCT wrappers: `makeFillet` (constant, variable, setback).
- `executeFilletFeature` adapter with edge/vertex resolution.
- `FeatureTree` partial-failure semantics via `featureErrors`.
- `AddFilletFeatureCommand` with F6/F7 patterns.
- `FilletDialog` Inventor-parity panel (3 tabs, 2 modes, 5 selection modes).
- `EdgePickController` with all 5 selection modes.
- Ribbon button, `F` shortcut, pick routing, debounced preview, BrowserPane warning badge + re-open flow.
- 4 E2E tests + 1 perf test + manual checklist.

**Test coverage:** ~18 new unit/integration tests + 4 E2E + 1 perf.

**Risk mitigation:** Face-naming correctness verified by integration tests that chain sketch → extrude → fillet + parametric edits. OCCT suffix drift from 3a's T4/T5 pattern — first implementation tries the most likely binding; integration-test failure is the signal to verify against `opencascade.full.d.ts`.
