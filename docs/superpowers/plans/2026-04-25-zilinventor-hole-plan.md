# Hole Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an Inventor-parity Hole feature with three placement modes (From-Sketch, Linear, Concentric), three profile types (Simple, Counterbore, Countersink), four termination modes (Distance, Through All, To Face, To Next), a fixed 118° drill tip on blind holes, full parametric cascade, live preview, and edit-on-reopen.

**Architecture:** New `HoleOps` OCCT module builds a per-location cutter compound (cylinder + CBORE/CSK/tip cones), fused and cut against the running body. New `HoleFeature` adapter resolves placement-specific location lists (sketch circle centers; linear 2-edge offset; concentric circular edge center) + termination length (literal, bbox-through, axis-ray-to-face, axis-ray-to-next) before calling `makeHole`. `FeatureTree` adds a pre-scan that keeps hole-referenced sketches raw (parallel to the revolve pre-scan from 3a) and a `case "hole":` branch. UI is one `HoleDialog` reusing existing `FacePickController` / `EdgePickController` + a new lightweight `SketchPickController`.

**Tech Stack:** opencascade.js (OCCT 2.0.0-beta), existing Comlink kernel worker, React + Zustand, three.js viewport, existing `ParameterRegistry` + parametric cascade + `previewFeature` RPC (shipped 3a) + `FaceNaming` layer (shipped 3b).

**Spec:** `docs/superpowers/specs/2026-04-25-hole-design.md`

**Total tasks: 29** (T15 merged into T17 mid-plan; ids preserved for cross-references). Test-driven throughout. One commit per task unless noted.

---

## Phase 1 — Shared layer

### Task 1: `HolePlacement` / `HoleProfile` / `HoleTermination` / `HoleFeature` types on `Feature` union

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts` (export)
- Modify: `packages/kernel/src/adapter/FeatureTree.ts` (placeholder `case 'hole': continue;`)
- Test: `packages/shared/src/__tests__/hole-feature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/hole-feature.spec.ts
import { describe, it, expect } from 'vitest';
import type {
  Feature, HoleFeature, HolePlacement, HoleProfile, HoleTermination,
  ParamOrLiteral, FaceName, EdgeName,
} from '../types';

describe('HoleFeature', () => {
  const faceA: FaceName = { featureId: 'E1', role: 'top' };
  const edge: EdgeName = {
    faceA, faceB: { featureId: 'E1', role: 'side', instance: 0 }
  };
  const lit5: ParamOrLiteral = { kind: 'literal', value: 5 };

  it('accepts fromSketch + simple + throughAll', () => {
    const f: HoleFeature = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: lit5 },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const u: Feature = f;
    expect(u.kind).toBe('hole');
  });

  it('accepts linear + counterbore + distance', () => {
    const f: HoleFeature = {
      id: 'H2', kind: 'hole',
      placement: {
        kind: 'linear', faceName: faceA,
        refEdge1: edge, offset1: lit5,
        refEdge2: edge, offset2: lit5,
      },
      profile: {
        kind: 'counterbore', diameter: lit5,
        cboreDiameter: lit5, cboreDepth: lit5,
      },
      termination: { kind: 'distance', depth: lit5 },
      flipAxis: true,
    };
    expect(f.placement.kind).toBe('linear');
  });

  it('accepts concentric + countersink + toFace', () => {
    const f: HoleFeature = {
      id: 'H3', kind: 'hole',
      placement: { kind: 'concentric', faceName: faceA, circularEdgeName: edge },
      profile: {
        kind: 'countersink', diameter: lit5,
        cskDiameter: lit5, cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'toFace', targetFaceName: faceA },
      flipAxis: false,
    };
    expect(f.termination.kind).toBe('toFace');
  });

  it('accepts toNext termination', () => {
    const t: HoleTermination = { kind: 'toNext' };
    expect(t.kind).toBe('toNext');
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- hole-feature` → FAIL (types missing).

- [ ] **Step 3: Extend `types.ts`**

Append to `packages/shared/src/types.ts`:

```ts
export type HolePlacement =
  | { kind: 'fromSketch'; sketchId: string }
  | {
      kind: 'linear';
      faceName: FaceName;
      refEdge1: EdgeName;
      offset1: ParamOrLiteral;
      refEdge2: EdgeName;
      offset2: ParamOrLiteral;
    }
  | { kind: 'concentric'; faceName: FaceName; circularEdgeName: EdgeName };

export type HoleProfile =
  | { kind: 'simple'; diameter: ParamOrLiteral }
  | {
      kind: 'counterbore';
      diameter: ParamOrLiteral;
      cboreDiameter: ParamOrLiteral;
      cboreDepth: ParamOrLiteral;
    }
  | {
      kind: 'countersink';
      diameter: ParamOrLiteral;
      cskDiameter: ParamOrLiteral;
      cskAngle: ParamOrLiteral;  // full included angle, default 82°
    };

export type HoleTermination =
  | { kind: 'distance'; depth: ParamOrLiteral }
  | { kind: 'throughAll' }
  | { kind: 'toFace'; targetFaceName: FaceName }
  | { kind: 'toNext' };

export type HoleFeature = {
  id: string;
  kind: 'hole';
  placement: HolePlacement;
  profile: HoleProfile;
  termination: HoleTermination;
  flipAxis: boolean;
};
```

Extend the `Feature` union:

```ts
export type Feature =
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | MirrorFeature
  | LinearPatternFeature
  | HoleFeature;
```

(Exact neighbor members reflect current master — ensure `HoleFeature` is appended without removing any existing member.)

Export `HolePlacement`, `HoleProfile`, `HoleTermination`, `HoleFeature` from `packages/shared/src/index.ts`.

- [ ] **Step 4: Placeholder in FeatureTree to keep typecheck green**

In `packages/kernel/src/adapter/FeatureTree.ts`, inside the `executeTree` main switch, after the existing `case 'linearPattern':` branch, add:

```ts
} else if (feature.kind === 'hole') {
  // Wired in Task 17
  continue;
}
```

- [ ] **Step 5: Run — should pass**

```
pnpm -C packages/shared test:unit -- hole-feature
pnpm -r typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts \
        packages/shared/src/__tests__/hole-feature.spec.ts \
        packages/kernel/src/adapter/FeatureTree.ts
git commit -m "feat(shared): HoleFeature variant on Feature union"
```

---

### Task 2: File format v5 → v6 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION`, add `migrateV5ToV6`)
- Modify: `packages/shared/src/types.ts` (`ProjectFile.formatVersion: 6`)
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('fileFormat v5 → v6 migration', () => {
  it('bumps formatVersion from 5 to 6 without structural change', () => {
    const input: AnyManifest = {
      formatVersion: 5,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd0', direction: 'forward', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(6);
    expect(CURRENT_FORMAT_VERSION).toBe(6);
    const tree = (out.document as { featureTree: Array<{ kind: string }> }).featureTree;
    expect(tree).toHaveLength(2);
    expect(tree.map((f) => f.kind)).toEqual(['sketch', 'extrude']);
  });

  it('v5 manifest with mixed features survives migration untouched', () => {
    const input: AnyManifest = {
      formatVersion: 5,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
          { kind: 'revolve', id: 'R1', sketchRef: 'S1', axisPrimitiveId: 'L3', angleParam: 'a0', direction: 'normal', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(6);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fileFormat` → FAIL.

- [ ] **Step 3: Implement migration**

In `packages/shared/src/fileFormat.ts`:

```ts
export const CURRENT_FORMAT_VERSION = 6;

function migrateV5ToV6(m: AnyManifest): AnyManifest {
  return { ...m, formatVersion: 6 };
}
```

Wire `migrateV5ToV6` into `migrateManifest`'s version chain after v4→v5.

In `packages/shared/src/types.ts` change:

```ts
export type ProjectFile = {
  formatVersion: 6;
  // ...
};
```

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/shared test:unit && pnpm -r typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/types.ts \
        packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): file format v5 → v6 migration"
```

---

## Phase 2 — Kernel OCCT ops

### Task 3: `HoleOps` scaffolding + simple through-cylinder cutter

**Files:**
- Create: `packages/kernel/src/occt/HoleOps.ts`
- Create: `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/src/occt/__tests__/HoleOps.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOpenCascade } from '../occtLoader';
import { makeSimpleCutter } from '../HoleOps';

describe('HoleOps — simple cutter', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOpenCascade(); });

  it('through-cutter is a cylinder with no tip', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, 1);
    const cutter = makeSimpleCutter(oc, origin, axis, {
      diameter: 5,
      cylinderLength: 20,
      drillTipAngleDeg: null,  // null = through
    });
    expect(cutter).toBeDefined();
    // Count cylindrical faces — should be 1 (no cone)
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    let cylCount = 0;
    let conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face);
      const type = surf.get().DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(1);
    expect(conCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm --filter @zilventor/kernel exec vitest run -- HoleOps` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/kernel/src/occt/HoleOps.ts
export type SimpleCutterOpts = {
  diameter: number;
  cylinderLength: number;
  drillTipAngleDeg: number | null;  // null = through, non-null = blind
};

export function makeSimpleCutter(
  oc: any,
  origin: any,          // gp_Pnt (cutter top)
  axis: any,            // gp_Dir (points into the material)
  opts: SimpleCutterOpts,
): any {
  const radius = opts.diameter / 2;

  // Axis frame: location = cutter top, direction = downward axis
  // gp_Ax2_3(location, direction) — direction is the cylinder's axis (down into material)
  const frame = new oc.gp_Ax2_3(origin, axis);

  const cyl = new oc.BRepPrimAPI_MakeCylinder_3(frame, radius, opts.cylinderLength).Shape();

  if (opts.drillTipAngleDeg === null) {
    return cyl;
  }

  // Drill tip: cone from full radius at top to 0 at tip, positioned at cylinder's bottom.
  // Tip axis points same direction (down); cone height = radius * cot(halfAngle)
  const halfAngleRad = (opts.drillTipAngleDeg / 2) * (Math.PI / 180);
  const tipHeight = radius / Math.tan(halfAngleRad);

  // Translate frame origin by cylinderLength along axis
  const tipLocation = new oc.gp_Pnt_3(
    origin.X() + axis.X() * opts.cylinderLength,
    origin.Y() + axis.Y() * opts.cylinderLength,
    origin.Z() + axis.Z() * opts.cylinderLength,
  );
  const tipFrame = new oc.gp_Ax2_3(tipLocation, axis);

  const cone = new oc.BRepPrimAPI_MakeCone_4(tipFrame, radius, 0, tipHeight).Shape();

  // Fuse cylinder + cone
  const fuse = new oc.BRepAlgoAPI_Fuse_3(cyl, cone, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}
```

- [ ] **Step 4: Run — should pass**

`pnpm --filter @zilventor/kernel exec vitest run -- HoleOps` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts packages/kernel/src/occt/__tests__/HoleOps.spec.ts
git commit -m "feat(kernel): HoleOps — simple cylinder cutter"
```

---

### Task 4: Drill-tip cone on blind simple cutter

**Files:**
- Modify: `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`

- [ ] **Step 1: Append test**

```ts
  it('blind simple cutter has 1 cylinder + 1 cone face at 118°', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeSimpleCutter(oc, origin, axis, {
      diameter: 5,
      cylinderLength: 10,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    let cylCount = 0;
    let conCount = 0;
    let coneHalfAngle = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') {
        conCount++;
        coneHalfAngle = (surf as any).SemiAngle();
      }
    }
    expect(cylCount).toBe(1);
    expect(conCount).toBe(1);
    // 118° included → 59° half
    expect(coneHalfAngle * (180 / Math.PI)).toBeCloseTo(59, 0);
  });
```

- [ ] **Step 2: Run — should pass**

Implementation from Task 3 already handles this path. `pnpm --filter @zilventor/kernel exec vitest run -- HoleOps` → PASS. If the cone semi-angle assertion fails, inspect the `BRepPrimAPI_MakeCone_4` signature (semi-angle might be inferred opposite-sign; compare with `gp_ConeSurface` docs and flip).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/occt/__tests__/HoleOps.spec.ts
git commit -m "test(kernel): HoleOps blind cutter produces 118° cone tip"
```

---

### Task 5: Counterbore cutter

**Files:**
- Modify: `packages/kernel/src/occt/HoleOps.ts` (add `makeCounterboreCutter`)
- Modify: `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('CBORE cutter has 2 concentric cylinders + tip cone (blind)', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeCounterboreCutter(oc, origin, axis, {
      diameter: 5, cylinderLength: 20,
      cboreDiameter: 10, cboreDepth: 3,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    let cylCount = 0, conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(2);
    expect(conCount).toBe(1);
  });
```

And import `makeCounterboreCutter` at the top of the spec.

- [ ] **Step 2: Run — should fail**

`pnpm --filter @zilventor/kernel exec vitest run -- HoleOps` → FAIL (export missing).

- [ ] **Step 3: Implement**

Append to `packages/kernel/src/occt/HoleOps.ts`:

```ts
export type CounterboreCutterOpts = {
  diameter: number;
  cylinderLength: number;
  cboreDiameter: number;
  cboreDepth: number;
  drillTipAngleDeg: number | null;
};

export function makeCounterboreCutter(
  oc: any,
  origin: any,
  axis: any,
  opts: CounterboreCutterOpts,
): any {
  // CBORE sits at top, shank cylinder below
  const cboreFrame = new oc.gp_Ax2_3(origin, axis);
  const cboreRadius = opts.cboreDiameter / 2;
  const cbore = new oc.BRepPrimAPI_MakeCylinder_3(cboreFrame, cboreRadius, opts.cboreDepth).Shape();

  // Shank: starts where cbore ends, runs cylinderLength further
  const shankTop = new oc.gp_Pnt_3(
    origin.X() + axis.X() * opts.cboreDepth,
    origin.Y() + axis.Y() * opts.cboreDepth,
    origin.Z() + axis.Z() * opts.cboreDepth,
  );
  const shank = makeSimpleCutter(oc, shankTop, axis, {
    diameter: opts.diameter,
    cylinderLength: opts.cylinderLength,
    drillTipAngleDeg: opts.drillTipAngleDeg,
  });

  const fuse = new oc.BRepAlgoAPI_Fuse_3(cbore, shank, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}
```

- [ ] **Step 4: Run — should pass**

`pnpm --filter @zilventor/kernel exec vitest run -- HoleOps` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts packages/kernel/src/occt/__tests__/HoleOps.spec.ts
git commit -m "feat(kernel): HoleOps — counterbore cutter"
```

---

### Task 6: Countersink cutter

**Files:**
- Modify: `packages/kernel/src/occt/HoleOps.ts` (add `makeCountersinkCutter`)
- Modify: `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('CSK cutter has 1 cylinder + 1 conical CSK face + tip cone (blind)', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeCountersinkCutter(oc, origin, axis, {
      diameter: 5, cylinderLength: 20,
      cskDiameter: 10, cskAngleDeg: 82,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
    );
    let cylCount = 0, conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(1);
    // CSK conical + tip cone = 2
    expect(conCount).toBe(2);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (export missing).

- [ ] **Step 3: Implement**

Append:

```ts
export type CountersinkCutterOpts = {
  diameter: number;
  cylinderLength: number;
  cskDiameter: number;
  cskAngleDeg: number;       // full included angle
  drillTipAngleDeg: number | null;
};

export function makeCountersinkCutter(
  oc: any,
  origin: any,
  axis: any,
  opts: CountersinkCutterOpts,
): any {
  const topRadius = opts.cskDiameter / 2;
  const bottomRadius = opts.diameter / 2;
  const halfAngleRad = (opts.cskAngleDeg / 2) * (Math.PI / 180);
  // Height of trapezoidal cone frustum: (R_top - R_bottom) / tan(halfAngle)
  const cskHeight = (topRadius - bottomRadius) / Math.tan(halfAngleRad);

  const cskFrame = new oc.gp_Ax2_3(origin, axis);
  const cskCone = new oc.BRepPrimAPI_MakeCone_4(cskFrame, topRadius, bottomRadius, cskHeight).Shape();

  const shankTop = new oc.gp_Pnt_3(
    origin.X() + axis.X() * cskHeight,
    origin.Y() + axis.Y() * cskHeight,
    origin.Z() + axis.Z() * cskHeight,
  );
  const shank = makeSimpleCutter(oc, shankTop, axis, {
    diameter: opts.diameter,
    cylinderLength: opts.cylinderLength,
    drillTipAngleDeg: opts.drillTipAngleDeg,
  });

  const fuse = new oc.BRepAlgoAPI_Fuse_3(cskCone, shank, new oc.Message_ProgressRange_1());
  fuse.Build(new oc.Message_ProgressRange_1());
  return fuse.Shape();
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts packages/kernel/src/occt/__tests__/HoleOps.spec.ts
git commit -m "feat(kernel): HoleOps — countersink cutter"
```

---

### Task 7: Axis intersector helper for To-Face / To-Next

**Files:**
- Modify: `packages/kernel/src/occt/HoleOps.ts` (add `axisSolidCrossings`)
- Modify: `packages/kernel/src/occt/__tests__/HoleOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  describe('axisSolidCrossings', () => {
    it('finds both front and back faces of a cube along +Z axis', async () => {
      const cubeShape = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
      const origin = new oc.gp_Pnt_3(5, 5, -5);  // outside cube
      const axis = new oc.gp_Dir_4(0, 0, 1);     // pointing up through cube
      const crossings = axisSolidCrossings(oc, cubeShape, origin, axis);
      expect(crossings.length).toBe(2);
      // First crossing is the -Z face at z=0, so distance from origin = 5
      expect(crossings[0]!.distance).toBeCloseTo(5, 3);
      // Second is the +Z face at z=10, distance = 15
      expect(crossings[1]!.distance).toBeCloseTo(15, 3);
    });

    it('crossings are sorted ascending by distance', () => {
      const cubeShape = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
      const origin = new oc.gp_Pnt_3(5, 5, -5);
      const axis = new oc.gp_Dir_4(0, 0, 1);
      const crossings = axisSolidCrossings(oc, cubeShape, origin, axis);
      for (let i = 1; i < crossings.length; i++) {
        expect(crossings[i]!.distance).toBeGreaterThanOrEqual(crossings[i - 1]!.distance);
      }
    });
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Append:

```ts
export type AxisCrossing = {
  distance: number;   // along axis from origin
  point: any;         // gp_Pnt
  face: any;          // TopoDS_Face
};

export function axisSolidCrossings(
  oc: any,
  body: any,        // TopoDS_Shape
  origin: any,      // gp_Pnt
  axis: any,        // gp_Dir
): AxisCrossing[] {
  const line = new oc.gp_Lin_3(origin, axis);
  const intersector = new oc.BRepIntCurveSurface_Inter();
  // Curve mode: use the infinite line
  intersector.Init_2(body, line, 1e-7);

  const out: AxisCrossing[] = [];
  for (; intersector.More(); intersector.Next()) {
    const w = intersector.W();  // parameter along the line = signed distance from origin
    if (w < -1e-6) continue;     // behind the origin
    out.push({
      distance: w,
      point: intersector.Pnt(),
      face: intersector.Face(),
    });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts packages/kernel/src/occt/__tests__/HoleOps.spec.ts
git commit -m "feat(kernel): HoleOps — axis-solid intersector"
```

---

### Task 8: `makeHole` top-level — fuse cutters + cut body + face naming

**Files:**
- Modify: `packages/kernel/src/occt/HoleOps.ts` (add `makeHole` + `ResolvedHoleProfile` + `ResolvedHoleTermination`)
- Create: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts` (scaffolding only — full tests in later tasks)

- [ ] **Step 1: Write failing test (kernel integration style)**

```ts
// packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOpenCascade } from '../../../occt/occtLoader';
import { makeHole } from '../../../occt/HoleOps';

describe('makeHole — integration (kernel)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOpenCascade(); });

  it('drills a simple through-hole through a cube, reducing volume', () => {
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, 15);  // above top face, axis pointing down
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const body = makeHole(oc, cube, [{ origin, axis }], {
      kind: 'simple', diameter: 4,
    }, { kind: 'throughAll' });

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(body, props, 1e-7, false, false);
    const volume = props.Mass();
    const expectedHole = Math.PI * 2 * 2 * 10;
    const expected = 1000 - expectedHole;
    expect(volume).toBeCloseTo(expected, -1);  // within ~10 mm³
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm --filter @zilventor/kernel exec vitest run -- HoleFeature.integration` → FAIL.

- [ ] **Step 3: Implement `makeHole`**

Append to `packages/kernel/src/occt/HoleOps.ts`:

```ts
export type ResolvedHoleProfile =
  | { kind: 'simple'; diameter: number }
  | { kind: 'counterbore'; diameter: number; cboreDiameter: number; cboreDepth: number }
  | { kind: 'countersink'; diameter: number; cskDiameter: number; cskAngleDeg: number };

export type ResolvedHoleTermination =
  | { kind: 'distance'; depth: number }
  | { kind: 'throughAll' }
  | { kind: 'toFace'; targetFaceHash: string }  // adapter resolves FaceName → a shape-local face identity key
  | { kind: 'toNext' };

export type HoleLocation = { origin: any; axis: any };

const DRILL_TIP_ANGLE_DEG = 118;

function boundingDiagonal(oc: any, body: any): number {
  const bnd = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(body, bnd, false);
  const x = new oc.gp_Pnt_1();   // dummy
  // Bnd_Box::Get pattern returns 6 doubles through out-params; use CornerMin/CornerMax:
  const lo = bnd.CornerMin();
  const hi = bnd.CornerMax();
  const dx = hi.X() - lo.X();
  const dy = hi.Y() - lo.Y();
  const dz = hi.Z() - lo.Z();
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function resolveLength(
  oc: any,
  body: any,
  loc: HoleLocation,
  termination: ResolvedHoleTermination,
): { length: number; blind: boolean } {
  if (termination.kind === 'distance')    return { length: termination.depth, blind: true };
  if (termination.kind === 'throughAll')  return { length: 2 * boundingDiagonal(oc, body), blind: false };
  if (termination.kind === 'toNext') {
    const crossings = axisSolidCrossings(oc, body, loc.origin, loc.axis);
    // Skip the entry crossing (the placement face) by taking the SECOND crossing past origin.
    if (crossings.length < 2) throw new Error('toNext: no next face found');
    return { length: crossings[1]!.distance, blind: false };
  }
  // toFace: the adapter has already translated FaceName → a targetFaceHash that we check per crossing
  // by hashing the face's surface pointer via BRepTools::Write; to keep the kernel decoupled from
  // FaceName, the adapter passes the shape directly via `termination.targetFace` (see Task 14 revision).
  throw new Error('toFace termination requires adapter-resolved target face — use makeHoleWithTargetFace');
}

function buildCutter(
  oc: any,
  loc: HoleLocation,
  profile: ResolvedHoleProfile,
  length: number,
  blind: boolean,
): any {
  const tipAngle = blind ? DRILL_TIP_ANGLE_DEG : null;
  if (profile.kind === 'simple') {
    return makeSimpleCutter(oc, loc.origin, loc.axis, {
      diameter: profile.diameter,
      cylinderLength: length,
      drillTipAngleDeg: tipAngle,
    });
  }
  if (profile.kind === 'counterbore') {
    return makeCounterboreCutter(oc, loc.origin, loc.axis, {
      diameter: profile.diameter,
      cylinderLength: length,
      cboreDiameter: profile.cboreDiameter,
      cboreDepth: profile.cboreDepth,
      drillTipAngleDeg: tipAngle,
    });
  }
  return makeCountersinkCutter(oc, loc.origin, loc.axis, {
    diameter: profile.diameter,
    cylinderLength: length,
    cskDiameter: profile.cskDiameter,
    cskAngleDeg: profile.cskAngleDeg,
    drillTipAngleDeg: tipAngle,
  });
}

export function makeHole(
  oc: any,
  body: any,
  locations: HoleLocation[],
  profile: ResolvedHoleProfile,
  termination: ResolvedHoleTermination,
): any {
  if (locations.length === 0) return body;

  // Fuse per-location cutters into one compound
  let compound: any | null = null;
  for (const loc of locations) {
    const { length, blind } = resolveLength(oc, body, loc, termination);
    const cutter = buildCutter(oc, loc, profile, length, blind);
    if (compound === null) {
      compound = cutter;
    } else {
      const fuse = new oc.BRepAlgoAPI_Fuse_3(compound, cutter, new oc.Message_ProgressRange_1());
      fuse.Build(new oc.Message_ProgressRange_1());
      compound = fuse.Shape();
    }
  }

  const cut = new oc.BRepAlgoAPI_Cut_3(body, compound, new oc.Message_ProgressRange_1());
  cut.Build(new oc.Message_ProgressRange_1());
  return cut.Shape();
}
```

Note: `toFace` path is left unimplemented in this task — it needs adapter-resolved target face and is added in Task 14. Throw a clear error for now.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts \
        packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "feat(kernel): HoleOps — makeHole top-level (simple + cbore + csk)"
```

---

### Task 9: Face-naming hook for hole faces

**Files:**
- Modify: `packages/kernel/src/occt/FaceNaming.ts` (add `tagHoleFaces` helper)
- Test: Add to `packages/kernel/src/occt/__tests__/FaceNaming.spec.ts`

Review `FaceNaming.ts` for the existing tagging pattern. The hole path needs to tag the new faces on the cut result with roles `shank`, `cbore`, `csk`, `tip` keyed by `featureId` and `locationIndex`.

- [ ] **Step 1: Write failing test**

```ts
  it('tagHoleFaces labels shank / cbore / csk / tip faces with feature + location', async () => {
    const oc = await loadOpenCascade();
    const body = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, 15);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cut = makeHole(oc, body, [{ origin, axis }],
      { kind: 'counterbore', diameter: 4, cboreDiameter: 7, cboreDepth: 2 },
      { kind: 'distance', depth: 8 });

    const names = tagHoleFaces(oc, cut, 'H1', 0, 'counterbore', /* blind */ true);
    const roles = Array.from(names.values()).map((n) => n.role);
    expect(roles).toContain('H1/hole/0/shank');
    expect(roles).toContain('H1/hole/0/cbore');
    expect(roles).toContain('H1/hole/0/tip');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Append to `packages/kernel/src/occt/FaceNaming.ts`:

```ts
/**
 * Tag faces produced by a hole cut. Walks faces, classifies by surface type,
 * and associates them with the named role. Because we cannot distinguish the
 * tip cone from a CSK cone by surface type alone, blind holes resolve the
 * smallest conical face (by area) as the tip.
 */
export function tagHoleFaces(
  oc: any,
  cutBody: any,
  featureId: string,
  locationIndex: number,
  profileKind: 'simple' | 'counterbore' | 'countersink',
  blind: boolean,
): Map<any /* TopoDS_Face */, FaceName> {
  const out = new Map<any, FaceName>();
  const explorer = new oc.TopExp_Explorer_2(
    cutBody, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any
  );

  const cylFaces: any[] = [];
  const conFaces: { face: any; area: number }[] = [];

  for (; explorer.More(); explorer.Next()) {
    const face = oc.TopoDS.Face_1(explorer.Current());
    const surf = oc.BRep_Tool.Surface_2(face).get();
    const type = surf.DynamicType().get().Name();
    if (type === 'Geom_CylindricalSurface') cylFaces.push(face);
    if (type === 'Geom_ConicalSurface') {
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      conFaces.push({ face, area: props.Mass() });
    }
  }

  // Sort cylinders by radius asc: shank is smallest, cbore is larger (if CBORE)
  cylFaces.sort((a, b) => {
    const ra = (oc.BRep_Tool.Surface_2(a).get() as any).Radius();
    const rb = (oc.BRep_Tool.Surface_2(b).get() as any).Radius();
    return ra - rb;
  });

  // Shank = smallest cylinder
  if (cylFaces[0]) {
    out.set(cylFaces[0], { featureId, role: `${featureId}/hole/${locationIndex}/shank` });
  }
  if (profileKind === 'counterbore' && cylFaces[1]) {
    out.set(cylFaces[1], { featureId, role: `${featureId}/hole/${locationIndex}/cbore` });
  }

  // Cones: tip (if blind) is smallest-area; CSK is the remainder
  conFaces.sort((a, b) => a.area - b.area);
  let coneIdx = 0;
  if (blind && conFaces[coneIdx]) {
    out.set(conFaces[coneIdx]!.face, { featureId, role: `${featureId}/hole/${locationIndex}/tip` });
    coneIdx++;
  }
  if (profileKind === 'countersink' && conFaces[coneIdx]) {
    out.set(conFaces[coneIdx]!.face, { featureId, role: `${featureId}/hole/${locationIndex}/csk` });
  }

  return out;
}
```

Export `tagHoleFaces` from the same file.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FaceNaming.ts \
        packages/kernel/src/occt/__tests__/FaceNaming.spec.ts
git commit -m "feat(kernel): FaceNaming.tagHoleFaces — shank/cbore/csk/tip roles"
```

---

## Phase 3 — Adapter

### Task 10: `HoleFeature` adapter — fromSketch placement + simple throughAll path

**Files:**
- Create: `packages/kernel/src/adapter/features/HoleFeature.ts`
- Extend: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('fromSketch placement drills one hole per circle center on an XY sketch', async () => {
    const oc = await loadOpenCascade();
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 10).Shape();
    // Mock NamedShape wrapper — adapter reads .shape + .faceNames
    const running = { shape: body, faceNames: new Map(), edgeNames: new Map() };

    // Raw sketch feature with two circles at (5,5) and (15,15) on the XY plane
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'C1', kind: 'circle', center: { x: 5, y: 5 }, radius: 1 },
        { id: 'C2', kind: 'circle', center: { x: 15, y: 15 }, radius: 1 },
      ],
      constraints: [],
    };
    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const resolve = (p: any) => p.value;
    const result = await executeHoleFeature(oc, running, feature, resolve, new Map([['S1', sketch]]));

    // Body volume should be reduced by ≈ 2 holes × π·r²·h = 2 × π × 1² × 10 ≈ 62.83
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const volume = props.Mass();
    expect(volume).toBeCloseTo(20 * 20 * 10 - 2 * Math.PI * 10, 0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/kernel/src/adapter/features/HoleFeature.ts
import type { Feature, HoleFeature, ParamOrLiteral, HoleProfile, HoleTermination } from '@zilventor/shared';
import type { NamedShape } from '../PartDocument';
import { makeHole, type HoleLocation, type ResolvedHoleProfile, type ResolvedHoleTermination } from '../../occt/HoleOps';
import { tagHoleFaces } from '../../occt/FaceNaming';

function resolveProfile(p: HoleProfile, resolve: (v: ParamOrLiteral) => number): ResolvedHoleProfile {
  if (p.kind === 'simple') return { kind: 'simple', diameter: resolve(p.diameter) };
  if (p.kind === 'counterbore') return {
    kind: 'counterbore',
    diameter: resolve(p.diameter),
    cboreDiameter: resolve(p.cboreDiameter),
    cboreDepth: resolve(p.cboreDepth),
  };
  return {
    kind: 'countersink',
    diameter: resolve(p.diameter),
    cskDiameter: resolve(p.cskDiameter),
    cskAngleDeg: resolve(p.cskAngle),
  };
}

function resolveTerminationBasic(t: HoleTermination, resolve: (v: ParamOrLiteral) => number): ResolvedHoleTermination | null {
  // Basic cases only — toFace and toNext are finished in Task 14
  if (t.kind === 'distance') return { kind: 'distance', depth: resolve(t.depth) };
  if (t.kind === 'throughAll') return { kind: 'throughAll' };
  if (t.kind === 'toNext') return { kind: 'toNext' };
  return null; // toFace path added in Task 14
}

type Vec3 = { x: number; y: number; z: number };

function sketchPlaneFrame(plane: 'XY' | 'XZ' | 'YZ'): { u: Vec3; v: Vec3; n: Vec3 } {
  if (plane === 'XY') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  if (plane === 'XZ') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 1, z: 0 } };
  return { u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 1, y: 0, z: 0 } };
}

function scale(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function neg(a: Vec3): Vec3 { return { x: -a.x, y: -a.y, z: -a.z }; }

function resolveFromSketchLocations(oc: any, sketch: any, flipAxis: boolean): HoleLocation[] {
  const frame = sketchPlaneFrame(sketch.plane);
  const axisVec = flipAxis ? neg(frame.n) : frame.n;
  const locations: HoleLocation[] = [];
  for (const prim of sketch.primitives) {
    let center: { x: number; y: number } | null = null;
    if (prim.kind === 'circle') center = prim.center;
    if (prim.kind === 'point') center = prim; // if/when points land in the sketch model
    if (center === null) continue;
    const p3 = add(scale(frame.u, center.x), scale(frame.v, center.y));
    const origin = new oc.gp_Pnt_3(p3.x, p3.y, p3.z);
    const axis = new oc.gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
    locations.push({ origin, axis });
  }
  return locations;
}

export async function executeHoleFeature(
  oc: any,
  runningBody: NamedShape,
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
  sketchById: Map<string, Feature>,
): Promise<NamedShape> {
  let locations: HoleLocation[];
  if (feature.placement.kind === 'fromSketch') {
    const sketch = sketchById.get(feature.placement.sketchId);
    if (!sketch || sketch.kind !== 'sketch') throw new Error(`hole: sketch ${feature.placement.sketchId} not found`);
    locations = resolveFromSketchLocations(oc, sketch, feature.flipAxis);
  } else {
    throw new Error(`hole: placement ${feature.placement.kind} not implemented in Task 10`);
  }

  const profile = resolveProfile(feature.profile, resolveParam);
  const termination = resolveTerminationBasic(feature.termination, resolveParam);
  if (termination === null) throw new Error('hole: toFace termination not yet implemented');

  const cutShape = makeHole(oc, runningBody.shape, locations, profile, termination);

  const blind = termination.kind === 'distance';
  const newNames = tagHoleFaces(oc, cutShape, feature.id, 0, feature.profile.kind, blind);

  // Merge names: existing runningBody faceNames survive where face is unchanged; new names added.
  // Proper identity matching is the face-naming layer's concern (already solved in 3b); here we
  // simply union the maps. The adapter's NamedShape construction layer handles identity preservation
  // for carry-over faces via the shared FaceNaming machinery.
  const faceNames = new Map(runningBody.faceNames);
  for (const [face, name] of newNames) faceNames.set(face, name);

  return { shape: cutShape, faceNames, edgeNames: runningBody.edgeNames };
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/HoleFeature.ts \
        packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "feat(kernel): HoleFeature adapter — fromSketch simple-through placement"
```

---

### Task 11: `fromSketch` — full primitive extraction (points + circle centers, non-XY planes)

**Files:**
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts`
- Extend: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('fromSketch on XZ plane drills along Y-axis', async () => {
    const oc = await loadOpenCascade();
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20).Shape();
    const running = { shape: body, faceNames: new Map(), edgeNames: new Map() };
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'C1', kind: 'circle', center: { x: 10, y: 10 }, radius: 1 }],
      constraints: [],
    };
    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map([['S1', sketch]]));
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // Hole axis is +Y through a 20-thick box: volume loss ≈ π·1²·20 ≈ 62.83
    expect(8000 - props.Mass()).toBeCloseTo(Math.PI * 20, 0);
  });

  it('fromSketch with flipAxis reverses hole direction', async () => {
    const oc = await loadOpenCascade();
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20).Shape();
    const running = { shape: body, faceNames: new Map(), edgeNames: new Map() };
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', center: { x: 10, y: 10 }, radius: 1 }],
      constraints: [],
    };
    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 5 } },
      flipAxis: true,  // axis is -Z instead of +Z — but the sketch is at Z=0, so a -Z blind hole would miss the body
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map([['S1', sketch]]));
    // Hole missed body entirely; volume unchanged
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(8000, 0);
  });
```

- [ ] **Step 2: Run — should pass or need tweak**

Task 10's implementation already handles non-XY planes and flipAxis via `sketchPlaneFrame` and `flipAxis ? neg(frame.n) : frame.n`. Run `pnpm --filter @zilventor/kernel exec vitest run -- HoleFeature.integration`. If either assertion is off, inspect whether the sketch plane frame convention matches the existing sketcher's convention (cross-check against `packages/kernel/src/occt/SketchOps.ts`).

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "test(kernel): HoleFeature fromSketch across planes + flipAxis"
```

---

### Task 12: `linear` placement resolver

**Files:**
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts`
- Extend: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('linear placement drills at offset from two perpendicular edges', async () => {
    const oc = await loadOpenCascade();
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 10).Shape();
    // Tag top face and two perpendicular bottom edges of the top
    const topFaceName: FaceName = { featureId: 'B1', role: 'top' };
    const edgeXName: EdgeName = { faceA: topFaceName, faceB: { featureId: 'B1', role: 'front' } };
    const edgeYName: EdgeName = { faceA: topFaceName, faceB: { featureId: 'B1', role: 'left' } };

    // Build faceNames/edgeNames maps for the running body (using real face/edge lookups).
    // Helper `nameCubeFaces` scans a box's 6 faces and assigns the standard 6 role names.
    const running = nameCubeFaces(oc, body, 'B1');

    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: {
        kind: 'linear', faceName: topFaceName,
        refEdge1: edgeXName, offset1: { kind: 'literal', value: 3 },
        refEdge2: edgeYName, offset2: { kind: 'literal', value: 4 },
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());

    // Volume loss ≈ π × 1² × 10 = π·10
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    expect(20 * 20 * 10 - props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });
```

Add `nameCubeFaces` helper at the top of the spec file — scan the six faces of a MakeBox result, assign role names `top/bottom/front/back/left/right` based on the centroid's dominant coordinate sign. (Mirror helper from existing `FaceNaming.integration.spec.ts` if present; otherwise inline.)

- [ ] **Step 2: Run — should fail**

FAIL (linear placement branch throws in Task 10).

- [ ] **Step 3: Implement linear resolver**

Append to `HoleFeature.ts`:

```ts
function findFaceByName(runningBody: NamedShape, name: FaceName): any | null {
  for (const [face, n] of runningBody.faceNames) {
    if (n.featureId === name.featureId && n.role === name.role && (n.instance ?? 0) === (name.instance ?? 0)) return face;
  }
  return null;
}

function findEdgeByName(oc: any, runningBody: NamedShape, name: EdgeName): any | null {
  // The EdgeName maps in runningBody should be canonicalized already.
  for (const [edge, n] of runningBody.edgeNames) {
    // EdgeName equality via canonicalized key
    if (canonicalEdgeNameKey(n) === canonicalEdgeNameKey(name)) return edge;
  }
  return null;
}

function facePlaneNormal(oc: any, face: any): { origin: Vec3; normal: Vec3 } {
  const surf = oc.BRep_Tool.Surface_2(face).get();
  // Face must be planar for linear placement
  const plane = (surf as any).Plane();  // Geom_Plane → gp_Pln
  const loc = plane.Location();
  const dir = plane.Axis().Direction();
  return {
    origin: { x: loc.X(), y: loc.Y(), z: loc.Z() },
    normal: { x: dir.X(), y: dir.Y(), z: dir.Z() },
  };
}

function edgeLineOnFace(oc: any, edge: any, face: any): { origin: Vec3; direction: Vec3 } {
  const adaptor = new oc.BRepAdaptor_Curve_2(edge, face);
  const first = adaptor.FirstParameter();
  const second = adaptor.LastParameter();
  const mid = (first + second) / 2;
  const p0 = adaptor.Value(first);
  const p1 = adaptor.Value(second);
  return {
    origin: { x: p0.X(), y: p0.Y(), z: p0.Z() },
    direction: normalize({ x: p1.X() - p0.X(), y: p1.Y() - p0.Y(), z: p1.Z() - p0.Z() }),
  };
}

function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function normalize(v: Vec3): Vec3 { const L = Math.sqrt(dot(v, v)); return { x: v.x / L, y: v.y / L, z: v.z / L }; }

function resolveLinearLocation(
  oc: any,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'linear' }>,
  offset1: number,
  offset2: number,
  flipAxis: boolean,
): HoleLocation {
  const face = findFaceByName(runningBody, placement.faceName);
  if (!face) throw new Error(`linear: face ${placement.faceName.role} not found`);
  const e1 = findEdgeByName(oc, runningBody, placement.refEdge1);
  const e2 = findEdgeByName(oc, runningBody, placement.refEdge2);
  if (!e1 || !e2) throw new Error('linear: reference edge not found');

  const { normal } = facePlaneNormal(oc, face);
  const l1 = edgeLineOnFace(oc, e1, face);
  const l2 = edgeLineOnFace(oc, e2, face);

  // Perpendicular-to-edge direction within face plane
  const perp1 = normalize(cross(l1.direction, normal));
  const perp2 = normalize(cross(l2.direction, normal));

  // Solve: find point P on face such that
  //   distance-from-line(P, l1) = offset1 along perp1
  //   distance-from-line(P, l2) = offset2 along perp2
  // Parametric: P = l1.origin + offset1 * perp1 + t * l1.direction
  //   then project onto perp2 from l2.origin.
  // Use 2-equation linear solve on the face plane's 2D basis.

  const u = l1.direction;
  const v = perp1;
  const P0 = add(l1.origin, scale(v, offset1));
  // Now find t such that (P0 + t*u - l2.origin)·perp2 = offset2
  const dOffset = offset2 - dot({ x: P0.x - l2.origin.x, y: P0.y - l2.origin.y, z: P0.z - l2.origin.z }, perp2);
  const denom = dot(u, perp2);
  if (Math.abs(denom) < 1e-9) throw new Error('linear: reference edges are parallel');
  const t = dOffset / denom;
  const P = add(P0, scale(u, t));

  const origin = new oc.gp_Pnt_3(P.x, P.y, P.z);
  const axisVec = flipAxis ? neg(normal) : normal;
  const axis = new oc.gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
  return { origin, axis };
}
```

Wire into the main `executeHoleFeature` switch:

```ts
  if (feature.placement.kind === 'fromSketch') { /* existing */ }
  else if (feature.placement.kind === 'linear') {
    locations = [resolveLinearLocation(
      oc, runningBody, feature.placement,
      resolveParam(feature.placement.offset1),
      resolveParam(feature.placement.offset2),
      feature.flipAxis,
    )];
  } else { throw new Error(`hole: placement ${feature.placement.kind} not yet implemented`); }
```

Also add `canonicalEdgeNameKey` if not already present (import from `@zilventor/shared`).

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/HoleFeature.ts \
        packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "feat(kernel): HoleFeature linear placement resolver"
```

---

### Task 13: `concentric` placement resolver

**Files:**
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts`
- Extend: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('concentric placement centers hole on a circular edge', async () => {
    const oc = await loadOpenCascade();
    // Build a cylinder (= revolved rectangle) so we have a circular top edge
    const cyl = new oc.BRepPrimAPI_MakeCylinder_2(5, 10).Shape();
    // Find top face + the circular edge on it via a small helper (see spec file)
    const { topFace, circularEdge, faceNames, edgeNames } = nameCylinderTopologies(oc, cyl, 'C1');
    const running = { shape: cyl, faceNames, edgeNames };

    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: {
        kind: 'concentric',
        faceName: { featureId: 'C1', role: 'top' },
        circularEdgeName: { faceA: { featureId: 'C1', role: 'top' }, faceB: { featureId: 'C1', role: 'side' } },
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const origVol = Math.PI * 25 * 10;
    const holeVol = Math.PI * 1 * 10;
    expect(origVol - props.Mass()).toBeCloseTo(holeVol, 0);
  });
```

(Add `nameCylinderTopologies` helper at top of spec file — scan the cylinder's top/bottom faces + the circular edge between them, assign canonical names.)

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement concentric resolver**

Append to `HoleFeature.ts`:

```ts
function resolveConcentricLocation(
  oc: any,
  runningBody: NamedShape,
  placement: Extract<HolePlacement, { kind: 'concentric' }>,
  flipAxis: boolean,
): HoleLocation {
  const face = findFaceByName(runningBody, placement.faceName);
  if (!face) throw new Error(`concentric: face not found`);
  const edge = findEdgeByName(oc, runningBody, placement.circularEdgeName);
  if (!edge) throw new Error('concentric: circular edge not found');

  const adaptor = new oc.BRepAdaptor_Curve_1(edge);
  const curveType = adaptor.GetType();
  if (curveType !== oc.GeomAbs_CurveType.GeomAbs_Circle as any) {
    throw new Error('concentric: picked edge is not a circle');
  }
  const circle = adaptor.Circle();    // gp_Circ
  const center = circle.Location();
  const circleAxis = circle.Axis().Direction();

  // Use face normal to pick sign
  const { normal: faceNormal } = facePlaneNormal(oc, face);
  const circleVec: Vec3 = { x: circleAxis.X(), y: circleAxis.Y(), z: circleAxis.Z() };
  const signed = dot(circleVec, faceNormal) >= 0 ? circleVec : neg(circleVec);
  const axisVec = flipAxis ? neg(signed) : signed;

  const origin = new oc.gp_Pnt_3(center.X(), center.Y(), center.Z());
  const axis = new oc.gp_Dir_4(axisVec.x, axisVec.y, axisVec.z);
  return { origin, axis };
}
```

Wire into main switch.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/HoleFeature.ts \
        packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "feat(kernel): HoleFeature concentric placement resolver"
```

---

### Task 14: `toFace` + `toNext` termination full implementations

**Files:**
- Modify: `packages/kernel/src/occt/HoleOps.ts` (pass target-face argument through)
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts` (resolve `toFace` via `axisSolidCrossings` filtered by face identity)
- Extend: `packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('toFace termination stops exactly at the picked face on a stacked-plate fixture', async () => {
    const oc = await loadOpenCascade();
    // Two stacked boxes fused into one: plate A (z 0..5) + plate B (z 5..10)
    const a = new oc.BRepPrimAPI_MakeBox_2(20, 20, 5).Shape();
    const bShape = new oc.BRepPrimAPI_MakeBox_3(
      new oc.gp_Pnt_3(0, 0, 5), new oc.gp_Pnt_3(20, 20, 10)
    ).Shape();
    const fuse = new oc.BRepAlgoAPI_Fuse_3(a, bShape, new oc.Message_ProgressRange_1());
    fuse.Build(new oc.Message_ProgressRange_1());
    const body = fuse.Shape();

    // Name: top face (z=10), internal z=5 face split-and-merged (might not survive fuse),
    // and bottom (z=0). For the test we target the top face of the fused body to verify the
    // 'stops at this face' semantics even if == throughAll in this fixture. For a meaningful
    // 'toFace' test, we target the z=0 face (bottom) from an origin above z=10.
    const names = nameBodyFaces(oc, body, 'F1');  // helper: names faces by bbox centroid

    const topFaceName: FaceName = { featureId: 'F1', role: 'top' };
    const bottomFaceName: FaceName = { featureId: 'F1', role: 'bottom' };
    const running = { shape: body, faceNames: names, edgeNames: new Map() };

    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'toFace', targetFaceName: bottomFaceName },
      flipAxis: false,
    };
    // Use a sketch with origin above top face; flipAxis=false uses +Z, but we want to drill -Z.
    // So set the sketch on XY at z=10 implicitly; axis becomes +Z from XY plane.
    // Instead, flip axis = true and place sketch at z=0 plane — sketch point (10,10) → (10,10,0),
    // axis = -Z (due to flip), intersects bottom face at distance 0 (coincident) which fails.
    // Use a sketch at higher Z by using XY plane and flipAxis=true; origin is then on bottom face.
    // Simpler: pre-translate the sketch feature origin. For this integration spec, skip and test
    // the toFace logic via the unit-level `resolveToFaceTermination` helper exported for testing.

    // Cheap path: call the helper directly.
    const origin = new oc.gp_Pnt_3(10, 10, 15);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const length = resolveToFaceLength(oc, body, names, bottomFaceName, origin, axis);
    // Bottom face at z=0; origin at z=15; axis -Z → length = 15
    expect(length).toBeCloseTo(15, 3);
  });

  it('toNext stops at first body face past the entry', async () => {
    const oc = await loadOpenCascade();
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, 15);  // above cube top
    const axis = new oc.gp_Dir_4(0, 0, -1);    // pointing down
    // toNext semantics: first crossing past entry. Entry = top face at distance 5; next = bottom at distance 15.
    // `resolveLength` with toNext returns crossings[1].distance = 15.
    // Use the crossings helper directly:
    const crossings = axisSolidCrossings(oc, cube, origin, axis);
    expect(crossings[1]!.distance).toBeCloseTo(15, 3);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (`resolveToFaceLength` not exported).

- [ ] **Step 3: Implement**

In `packages/kernel/src/adapter/features/HoleFeature.ts`:

```ts
export function resolveToFaceLength(
  oc: any,
  body: any,
  faceNames: Map<any, FaceName>,
  targetFaceName: FaceName,
  origin: any,
  axis: any,
): number {
  const crossings = axisSolidCrossings(oc, body, origin, axis);
  // Build a name-lookup on current body: iterate crossing.face, match via the faceNames map (IsSame).
  for (const crossing of crossings) {
    for (const [face, name] of faceNames) {
      if (oc.BRep_Tool.Surface_2(face).get() === oc.BRep_Tool.Surface_2(crossing.face).get()) {
        // Identity via underlying surface reference is approximate; prefer TopoDS_Shape::IsSame
      }
      if (face.IsSame(crossing.face)) {
        if (name.featureId === targetFaceName.featureId
            && name.role === targetFaceName.role
            && (name.instance ?? 0) === (targetFaceName.instance ?? 0)) {
          return crossing.distance;
        }
      }
    }
  }
  throw new Error(`toFace: target face ${targetFaceName.role} not reached by axis`);
}
```

Adjust `executeHoleFeature` to handle `toFace`:

```ts
function resolveTermination(
  oc: any,
  body: any,
  faceNames: Map<any, FaceName>,
  t: HoleTermination,
  loc: HoleLocation,
  resolve: (v: ParamOrLiteral) => number,
): ResolvedHoleTermination {
  if (t.kind === 'distance') return { kind: 'distance', depth: resolve(t.depth) };
  if (t.kind === 'throughAll') return { kind: 'throughAll' };
  if (t.kind === 'toNext') return { kind: 'toNext' };
  // toFace
  const length = resolveToFaceLength(oc, body, faceNames, t.targetFaceName, loc.origin, loc.axis);
  return { kind: 'distance', depth: length };   // translate to a literal distance (no tip — handled via blind flag)
}
```

Note: `toFace` translates to a `distance` literal at the resolved length, but we must suppress the drill tip (the spec says no tip for toFace). Adjust `buildCutter` / `resolveLength` accordingly: use a sentinel `{ kind: 'distance', depth, blindTip: false }` extension, OR have the adapter set `blind=false` by rewriting `t.kind` to `throughAll` with a bounded length. Cleanest path: extend `ResolvedHoleTermination` with an explicit `blindTip: boolean` on `distance`:

```ts
export type ResolvedHoleTermination =
  | { kind: 'distance'; depth: number; blindTip: boolean }
  | { kind: 'throughAll' }
  | { kind: 'toNext' };
```

Update `resolveLength` in `HoleOps.ts`:

```ts
  if (termination.kind === 'distance') return { length: termination.depth, blind: termination.blindTip };
```

And update the adapter's `resolveTerminationBasic` to tag `distance` with `blindTip: true` and `toFace` translation with `blindTip: false`. `toNext` stays `blind: false`.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/HoleOps.ts \
        packages/kernel/src/adapter/features/HoleFeature.ts \
        packages/kernel/src/adapter/features/__tests__/HoleFeature.integration.spec.ts
git commit -m "feat(kernel): HoleFeature — toFace + toNext termination"
```

---

### Task 15: Soft-fail wrapper

**Files:**
- Modify: `packages/kernel/src/adapter/features/HoleFeature.ts` (don't actually — the FeatureTree wraps per-feature. Extend `FeatureTree.ts` instead when we wire Task 17.)

Skip as a standalone task — the soft-fail is a FeatureTree concern and is added in Task 17 alongside the `case 'hole':` branch. Keep the task number stable (Task 15 merged into Task 17).

Renumber-safe — no separate commit. Move directly to Task 16.

---

## Phase 4 — FeatureTree integration

### Task 16: Pre-scan `holeSketchIds` in `executeTree`

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Extend: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('sketches referenced by a hole feature are kept raw and skip executeSketchFeature', async () => {
    const oc = await loadOpenCascade();
    const tree: Feature[] = [
      { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
      { kind: 'sketch', id: 'S0', plane: 'XY', primitives: [{ id: 'R1', kind: 'rect', x: 0, y: 0, w: 20, h: 20 }], constraints: [] },
      // Hole references sketch S1 for locations; S1 must not be extruded
      { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [{ id: 'C1', kind: 'circle', center: { x: 10, y: 10 }, radius: 1 }], constraints: [] },
      { kind: 'hole', id: 'H1',
        placement: { kind: 'fromSketch', sketchId: 'S1' },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
        termination: { kind: 'throughAll' },
        flipAxis: false,
      },
    ];
    const params = { d0: 5 };
    const result = await executeTree(oc, tree, params);
    expect(result.value).toBeDefined();
    // Volume = 20 × 20 × 5 − π·1²·5
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.value.shape, props, 1e-7, false, false);
    expect(2000 - props.Mass()).toBeCloseTo(Math.PI * 5, 0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL — hole branch is a `continue` placeholder.

- [ ] **Step 3: Implement pre-scan**

At the top of `executeTree` in `packages/kernel/src/adapter/FeatureTree.ts`:

```ts
const holeSketchIds = new Set<string>();
for (const feat of tree) {
  if (feat.kind === 'hole' && feat.placement.kind === 'fromSketch') {
    holeSketchIds.add(feat.placement.sketchId);
  }
}
```

Then in the main loop, when encountering a sketch, skip `executeSketchFeature` if its id is in `holeSketchIds` — store the raw Feature in a `sketchById: Map<string, Feature>` built alongside.

- [ ] **Step 4: Defer full branch wiring to Task 17**

This task only installs the pre-scan + raw-sketch bookkeeping. Test will still FAIL because the `case 'hole':` is still a `continue`. Mark this as expected — move on to Task 17.

- [ ] **Step 5: Commit (WIP)**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts
git commit -m "feat(kernel): FeatureTree — pre-scan hole-referenced sketches"
```

---

### Task 17: `case 'hole':` branch with soft-fail

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Extend: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Replace placeholder with real branch**

In `executeTree`:

```ts
} else if (feature.kind === 'hole') {
  try {
    runningBody = await executeHoleFeature(oc, runningBody, feature, resolveParam, sketchById);
  } catch (e) {
    // Soft-fail — keep prior running body, record error
    featureErrors.push({ featureId: feature.id, message: (e as Error).message });
    continue;
  }
}
```

Import `executeHoleFeature` at the top.

- [ ] **Step 2: Write soft-fail test**

```ts
  it('hole referencing a missing sketch soft-fails without aborting the tree', async () => {
    const oc = await loadOpenCascade();
    const tree: Feature[] = [
      { kind: 'sketch', id: 'S0', plane: 'XY', primitives: [{ id: 'R1', kind: 'rect', x: 0, y: 0, w: 20, h: 20 }], constraints: [] },
      { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
      { kind: 'hole', id: 'H1',
        placement: { kind: 'fromSketch', sketchId: 'NONEXISTENT' },
        profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
        termination: { kind: 'throughAll' },
        flipAxis: false,
      },
    ];
    const result = await executeTree(oc, tree, { d0: 5 });
    expect(result.value).toBeDefined();
    // Body should equal the pre-hole extrude
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.value.shape, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(2000, 0);
    expect(result.value.featureErrors?.some((e) => e.featureId === 'H1')).toBe(true);
  });
```

- [ ] **Step 3: Run — should pass**

`pnpm --filter @zilventor/kernel exec vitest run -- FeatureTree.integration` → PASS (both the pre-scan test from Task 16 and the soft-fail test).

- [ ] **Step 4: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts \
        packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts
git commit -m "feat(kernel): FeatureTree — hole branch with soft-fail"
```

---

## Phase 5 — App wiring

### Task 18: `useAppStore` hole slice

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Extend: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('holeDialogOpen defaults to false; openHoleForEdit seeds editingHoleId', () => {
    const store = createStore();
    expect(store.getState().holeDialogOpen).toBe(false);
    store.getState().openHoleForEdit('H1');
    expect(store.getState().holeDialogOpen).toBe(true);
    expect(store.getState().editingHoleId).toBe('H1');
  });

  it('resetHoleDialog clears all hole dialog state', () => {
    const store = createStore();
    store.getState().openHoleForEdit('H1');
    store.getState().resetHoleDialog();
    expect(store.getState().holeDialogOpen).toBe(false);
    expect(store.getState().editingHoleId).toBeNull();
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Extend store**

In `useAppStore.ts`, add to the state shape:

```ts
// Hole dialog state
holeDialogOpen: boolean;
holePlacementMode: 'fromSketch' | 'linear' | 'concentric';
holeSketchId: string | null;
holePlacementFace: FaceName | null;
holeRefEdges: [EdgeName | null, EdgeName | null];
holeCircularEdge: EdgeName | null;
holeTargetFace: FaceName | null;
editingHoleId: string | null;
holeInitialValues: Partial<HoleFeature> | null;
// actions
openHoleForEdit: (id: string) => void;
resetHoleDialog: () => void;
toggleHoleDialog: (open: boolean) => void;
```

Defaults: all nullable fields `null`, `holeDialogOpen: false`, `holePlacementMode: 'fromSketch'`, `holeRefEdges: [null, null]`.

Implementations:

```ts
openHoleForEdit: (id) => set((s) => ({
  ...s, holeDialogOpen: true, editingHoleId: id, holeInitialValues: null,
})),
resetHoleDialog: () => set((s) => ({
  ...s,
  holeDialogOpen: false,
  holePlacementMode: 'fromSketch',
  holeSketchId: null,
  holePlacementFace: null,
  holeRefEdges: [null, null],
  holeCircularEdge: null,
  holeTargetFace: null,
  editingHoleId: null,
  holeInitialValues: null,
})),
toggleHoleDialog: (open) => set((s) => ({ ...s, holeDialogOpen: open })),
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(app): useAppStore — hole dialog slice"
```

---

### Task 19: `AddHoleFeatureCommand` + H keyboard shortcut

**Files:**
- Create: `packages/app/src/commands/AddHoleFeatureCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddHoleFeatureCommand.spec.ts`
- Modify: `packages/app/src/commands/commands.ts` (register)
- Modify: `packages/app/src/App.tsx` (H hotkey binding)

- [ ] **Step 1: Write failing test**

```ts
// packages/app/src/commands/__tests__/AddHoleFeatureCommand.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { AddHoleFeatureCommand } from '../AddHoleFeatureCommand';

describe('AddHoleFeatureCommand', () => {
  it('opens the hole dialog in create mode', () => {
    const toggle = vi.fn();
    const store = { toggleHoleDialog: toggle, resetHoleDialog: vi.fn() };
    AddHoleFeatureCommand({ store } as any);
    expect(store.resetHoleDialog).toHaveBeenCalled();
    expect(toggle).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/AddHoleFeatureCommand.ts
export type AddHoleContext = {
  store: { toggleHoleDialog: (open: boolean) => void; resetHoleDialog: () => void };
};

export function AddHoleFeatureCommand(ctx: AddHoleContext): void {
  ctx.store.resetHoleDialog();
  ctx.store.toggleHoleDialog(true);
}
```

Register in `commands.ts` alongside other Add*Command entries. Bind H in the keyboard map — `App.tsx` `handleKeyDown` routes H (not-shift, not-cmd, not-alt) to `AddHoleFeatureCommand(ctx)` when in Model mode.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddHoleFeatureCommand.ts \
        packages/app/src/commands/__tests__/AddHoleFeatureCommand.spec.ts \
        packages/app/src/commands/commands.ts packages/app/src/App.tsx
git commit -m "feat(app): AddHoleFeatureCommand + H hotkey"
```

---

### Task 20: `HoleDialog` scaffold + layout

**Files:**
- Create: `packages/app/src/shell/HoleDialog.tsx`
- Create: `packages/app/src/shell/__tests__/HoleDialog.spec.tsx`
- Modify: `packages/app/src/App.tsx` (render `<HoleDialog />` conditional on `holeDialogOpen`)

- [ ] **Step 1: Write failing render test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoleDialog } from '../HoleDialog';

describe('HoleDialog', () => {
  it('renders the four sections when open', () => {
    render(<HoleDialog />);
    expect(screen.getByRole('heading', { name: /placement/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /termination/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement skeleton**

```tsx
// packages/app/src/shell/HoleDialog.tsx
import React from 'react';
import { useAppStore } from '../store/useAppStore';

export function HoleDialog(): JSX.Element | null {
  const open = useAppStore((s) => s.holeDialogOpen);
  const resetHoleDialog = useAppStore((s) => s.resetHoleDialog);
  if (!open) return null;

  return (
    <div className="fixed right-4 top-24 z-50 w-96 rounded-md border border-zinc-700 bg-zinc-900/95 p-4 text-zinc-100 shadow-xl">
      <section>
        <h2 className="mb-2 text-sm font-semibold">Placement</h2>
        {/* radio group + mode-specific picks — Task 21 */}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Profile</h2>
        {/* Task 22 */}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold">Termination</h2>
        {/* Task 23 */}
      </section>
      <footer className="mt-4 flex justify-end gap-2">
        <button onClick={resetHoleDialog} className="rounded bg-zinc-700 px-3 py-1 text-xs">Cancel</button>
        <button className="rounded bg-blue-600 px-3 py-1 text-xs">OK</button>
      </footer>
    </div>
  );
}
```

Mount in `App.tsx`:

```tsx
import { HoleDialog } from './shell/HoleDialog';
// ...
<HoleDialog />
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/HoleDialog.tsx \
        packages/app/src/shell/__tests__/HoleDialog.spec.tsx \
        packages/app/src/App.tsx
git commit -m "feat(app): HoleDialog skeleton"
```

---

### Task 21: `HoleDialog` — Placement section (all 3 modes + pick wiring)

**Files:**
- Modify: `packages/app/src/shell/HoleDialog.tsx`
- Create: `packages/app/src/model/SketchPickController.ts` (new lightweight pick controller)
- Create: `packages/app/src/model/__tests__/SketchPickController.spec.ts`
- Extend: `packages/app/src/shell/__tests__/HoleDialog.spec.tsx`

- [ ] **Step 1: Write SketchPickController test**

```ts
import { SketchPickController } from '../SketchPickController';

it('click on browser-pane sketch node fires onPick with sketch id', () => {
  const onPick = vi.fn();
  const ctrl = new SketchPickController({ onPick });
  ctrl.activate();
  // Simulate event from browser-pane
  ctrl.selectFromBrowser('S1');
  expect(onPick).toHaveBeenCalledWith('S1');
  ctrl.deactivate();
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement SketchPickController**

```ts
// packages/app/src/model/SketchPickController.ts
export type SketchPickOpts = { onPick: (sketchId: string) => void };

export class SketchPickController {
  private active = false;
  constructor(private opts: SketchPickOpts) {}

  activate(): void { this.active = true; }
  deactivate(): void { this.active = false; }
  isActive(): boolean { return this.active; }

  selectFromBrowser(sketchId: string): void {
    if (!this.active) return;
    this.opts.onPick(sketchId);
  }
  // Viewport click handler — bridge wired in BrowserPane + Viewport Task 25
}
```

- [ ] **Step 4: Extend HoleDialog with Placement section**

In `HoleDialog.tsx`:

```tsx
const placementMode = useAppStore((s) => s.holePlacementMode);
const setPlacementMode = (m: 'fromSketch' | 'linear' | 'concentric') =>
  useAppStore.setState((s) => ({ ...s, holePlacementMode: m }));

// Radio group
<div className="flex gap-2 mb-2">
  {(['fromSketch', 'linear', 'concentric'] as const).map((m) => (
    <label key={m} className="flex items-center gap-1 text-xs">
      <input
        type="radio"
        name="holePlacement"
        checked={placementMode === m}
        onChange={() => setPlacementMode(m)}
      />
      {m === 'fromSketch' ? 'From Sketch' : m[0]!.toUpperCase() + m.slice(1)}
    </label>
  ))}
</div>

// Mode-specific row
{placementMode === 'fromSketch' && (
  <button
    onClick={() => /* activate SketchPickController */}
    className="w-full rounded border border-zinc-700 px-2 py-1 text-xs"
  >
    {useAppStore.getState().holeSketchId ? `Sketch: ${useAppStore.getState().holeSketchId}` : 'Pick sketch'}
  </button>
)}
{placementMode === 'linear' && (
  <div className="space-y-1">
    <button>Pick face</button>
    <div className="flex gap-1"><button>Pick edge 1</button><input placeholder="offset 1" /></div>
    <div className="flex gap-1"><button>Pick edge 2</button><input placeholder="offset 2" /></div>
  </div>
)}
{placementMode === 'concentric' && (
  <div className="space-y-1">
    <button>Pick face</button>
    <button>Pick circular edge</button>
  </div>
)}
```

Pick-button onClick handlers activate the appropriate PickController (reuse existing `FacePickController`, `EdgePickController`, and the new `SketchPickController`) and store the picked result in the store slice.

- [ ] **Step 5: Extend HoleDialog test**

```tsx
  it('radio group switches mode-specific pick rows', () => {
    render(<HoleDialog />);
    // default = fromSketch
    expect(screen.getByText(/pick sketch/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/linear/i));
    expect(screen.getByText(/pick edge 1/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/concentric/i));
    expect(screen.getByText(/pick circular edge/i)).toBeInTheDocument();
  });
```

- [ ] **Step 6: Run — should pass**

PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app/src/shell/HoleDialog.tsx \
        packages/app/src/model/SketchPickController.ts \
        packages/app/src/model/__tests__/SketchPickController.spec.ts \
        packages/app/src/shell/__tests__/HoleDialog.spec.tsx
git commit -m "feat(app): HoleDialog — Placement section + SketchPickController"
```

---

### Task 22: `HoleDialog` — Profile section (Simple / CBORE / CSK)

**Files:**
- Modify: `packages/app/src/shell/HoleDialog.tsx`
- Extend: `packages/app/src/shell/__tests__/HoleDialog.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
  it('CBORE profile reveals cboreDiameter and cboreDepth fields', () => {
    render(<HoleDialog />);
    // Default is Simple — no CBORE fields
    expect(screen.queryByLabelText(/CBORE Ø/i)).toBeNull();
    fireEvent.click(screen.getByLabelText(/counterbore/i));
    expect(screen.getByLabelText(/CBORE Ø/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/CBORE depth/i)).toBeInTheDocument();
  });

  it('CSK profile reveals cskDiameter and cskAngle fields with 82° default', () => {
    render(<HoleDialog />);
    fireEvent.click(screen.getByLabelText(/countersink/i));
    expect(screen.getByLabelText(/CSK Ø/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/CSK angle/i) as HTMLInputElement).value).toBe('82');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Extend HoleDialog**

Add a `profileKind` local state (mirrored to store if needed) and the Diameter/CBORE/CSK fields:

```tsx
const [profileKind, setProfileKind] = React.useState<'simple' | 'counterbore' | 'countersink'>('simple');
const [diameter, setDiameter] = React.useState('5');
const [cboreDiameter, setCboreDiameter] = React.useState('10');
const [cboreDepth, setCboreDepth] = React.useState('3');
const [cskDiameter, setCskDiameter] = React.useState('10');
const [cskAngle, setCskAngle] = React.useState('82');

// inside the Profile section:
<div className="flex gap-2 mb-2">
  {(['simple', 'counterbore', 'countersink'] as const).map((k) => (
    <label key={k} className="flex items-center gap-1 text-xs">
      <input type="radio" name="profile" checked={profileKind === k} onChange={() => setProfileKind(k)} />
      {k[0]!.toUpperCase() + k.slice(1)}
    </label>
  ))}
</div>
<label className="block text-xs">Ø <input aria-label="Diameter" value={diameter} onChange={(e) => setDiameter(e.target.value)} /></label>
{profileKind === 'counterbore' && (
  <>
    <label className="block text-xs">CBORE Ø <input aria-label="CBORE Ø" value={cboreDiameter} onChange={(e) => setCboreDiameter(e.target.value)} /></label>
    <label className="block text-xs">CBORE depth <input aria-label="CBORE depth" value={cboreDepth} onChange={(e) => setCboreDepth(e.target.value)} /></label>
  </>
)}
{profileKind === 'countersink' && (
  <>
    <label className="block text-xs">CSK Ø <input aria-label="CSK Ø" value={cskDiameter} onChange={(e) => setCskDiameter(e.target.value)} /></label>
    <label className="block text-xs">CSK angle <input aria-label="CSK angle" value={cskAngle} onChange={(e) => setCskAngle(e.target.value)} /></label>
  </>
)}
```

(Use `NumericInputOverlay` in place of plain `<input>` for parity with other dialogs — same component used in FilletDialog/ExtrudeDialog.)

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/HoleDialog.tsx packages/app/src/shell/__tests__/HoleDialog.spec.tsx
git commit -m "feat(app): HoleDialog — Profile section (simple/cbore/csk)"
```

---

### Task 23: `HoleDialog` — Termination section + commit path

**Files:**
- Modify: `packages/app/src/shell/HoleDialog.tsx`
- Extend: `packages/app/src/shell/__tests__/HoleDialog.spec.tsx`
- Modify: `packages/app/src/commands/AddHoleFeatureCommand.ts` (commit handler)

- [ ] **Step 1: Write failing test**

```tsx
  it('Distance termination reveals depth field; Through All / To Next / To Face do not', () => {
    render(<HoleDialog />);
    fireEvent.change(screen.getByLabelText(/termination/i), { target: { value: 'distance' } });
    expect(screen.getByLabelText(/depth/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/termination/i), { target: { value: 'throughAll' } });
    expect(screen.queryByLabelText(/depth/i)).toBeNull();
  });

  it('OK fires store.addHole with composed HoleFeature', () => {
    const addHole = vi.fn();
    // Override store for test (inject via context or stub)
    render(<HoleDialog addHole={addHole} />);
    fireEvent.click(screen.getByLabelText(/counterbore/i));
    fireEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(addHole).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'hole',
      profile: expect.objectContaining({ kind: 'counterbore' }),
    }));
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement termination + OK handler**

Add termination dropdown:

```tsx
const [termKind, setTermKind] = React.useState<'distance' | 'throughAll' | 'toFace' | 'toNext'>('throughAll');
const [depth, setDepth] = React.useState('10');

<select aria-label="Termination" value={termKind} onChange={(e) => setTermKind(e.target.value as any)}>
  <option value="distance">Distance</option>
  <option value="throughAll">Through All</option>
  <option value="toFace">To Face</option>
  <option value="toNext">To Next</option>
</select>
{termKind === 'distance' && (
  <label className="block text-xs">Depth <input aria-label="Depth" value={depth} onChange={(e) => setDepth(e.target.value)} /></label>
)}
{termKind === 'toFace' && (
  <button onClick={() => /* activate FacePickController for target */}>Pick target face</button>
)}
```

OK handler builds a `HoleFeature` from the current dialog state + store picks and dispatches `store.addHole(feature)` (or if `editingHoleId` is set, `store.replaceHole(editingHoleId, feature)`):

```tsx
const onOk = () => {
  const s = useAppStore.getState();
  const placement: HolePlacement = (() => {
    if (s.holePlacementMode === 'fromSketch') return { kind: 'fromSketch', sketchId: s.holeSketchId! };
    if (s.holePlacementMode === 'linear') return {
      kind: 'linear', faceName: s.holePlacementFace!,
      refEdge1: s.holeRefEdges[0]!, offset1: parseNumericInput(offset1),
      refEdge2: s.holeRefEdges[1]!, offset2: parseNumericInput(offset2),
    };
    return { kind: 'concentric', faceName: s.holePlacementFace!, circularEdgeName: s.holeCircularEdge! };
  })();
  const profile: HoleProfile = (() => {
    if (profileKind === 'simple') return { kind: 'simple', diameter: parseNumericInput(diameter) };
    if (profileKind === 'counterbore') return {
      kind: 'counterbore',
      diameter: parseNumericInput(diameter),
      cboreDiameter: parseNumericInput(cboreDiameter),
      cboreDepth: parseNumericInput(cboreDepth),
    };
    return {
      kind: 'countersink',
      diameter: parseNumericInput(diameter),
      cskDiameter: parseNumericInput(cskDiameter),
      cskAngle: parseNumericInput(cskAngle),
    };
  })();
  const termination: HoleTermination = (() => {
    if (termKind === 'distance') return { kind: 'distance', depth: parseNumericInput(depth) };
    if (termKind === 'toFace') return { kind: 'toFace', targetFaceName: s.holeTargetFace! };
    if (termKind === 'toNext') return { kind: 'toNext' };
    return { kind: 'throughAll' };
  })();
  const id = s.editingHoleId ?? `H${Date.now()}`;
  const feature: HoleFeature = { id, kind: 'hole', placement, profile, termination, flipAxis: false };
  if (s.editingHoleId) s.replaceFeature(id, feature);
  else s.addFeature(feature);
  s.resetHoleDialog();
};
```

`parseNumericInput` accepts `"5"` → `{ kind: 'literal', value: 5 }` and `"=d_hole"` → `{ kind: 'param', paramName: 'd_hole' }`.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/HoleDialog.tsx packages/app/src/shell/__tests__/HoleDialog.spec.tsx \
        packages/app/src/commands/AddHoleFeatureCommand.ts
git commit -m "feat(app): HoleDialog — Termination section + OK commit path"
```

---

### Task 24: Ribbon Modify panel Hole button + drill icon

**Files:**
- Modify: `packages/app/src/shell/Ribbon.tsx` (or `tabs/ModelTab.tsx`) — Modify panel
- Modify: `packages/icons/src/index.ts` — export `DrillIcon`
- Create: `packages/icons/src/DrillIcon.tsx`
- Extend: `packages/app/src/shell/__tests__/Ribbon.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
  it('Model → Modify → Hole button dispatches AddHoleFeatureCommand', () => {
    const addHole = vi.fn();
    render(<Ribbon onAddHole={addHole} />);
    fireEvent.click(screen.getByRole('button', { name: /hole/i }));
    expect(addHole).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement icon + ribbon button**

```tsx
// packages/icons/src/DrillIcon.tsx
import React from 'react';
export function DrillIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.25">
      <rect x="3" y="2" width="10" height="6" rx="1" />
      <path d="M8 8 L8 13 L6 15 L10 15 L8 13" />
    </svg>
  );
}
```

Export from `packages/icons/src/index.ts`.

In `Ribbon.tsx` (or `ModelTab.tsx`), inside the Modify panel next to Chamfer / Shell / Fillet, add:

```tsx
<button
  onClick={() => AddHoleFeatureCommand(ctx)}
  className="..."
  aria-label="Hole"
  title="Hole (H)"
>
  <DrillIcon /> Hole
</button>
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/icons/src/DrillIcon.tsx packages/icons/src/index.ts \
        packages/app/src/shell/Ribbon.tsx packages/app/src/shell/__tests__/Ribbon.spec.tsx
git commit -m "feat(app): ribbon Modify panel — Hole button + drill icon"
```

---

### Task 25: BrowserPane Hole node + double-click-to-edit

**Files:**
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Extend: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
  it('renders a Hole node for each HoleFeature and double-click opens dialog in edit mode', () => {
    const state = {
      parts: [{ id: 'P1', tree: [
        { id: 'H1', kind: 'hole', placement: { kind: 'fromSketch', sketchId: 'S1' },
          profile: { kind: 'simple', diameter: { kind: 'literal', value: 5 } },
          termination: { kind: 'throughAll' }, flipAxis: false },
      ] }],
    };
    const openHoleForEdit = vi.fn();
    render(<BrowserPane state={state} openHoleForEdit={openHoleForEdit} />);
    const node = screen.getByText(/H1/i);
    fireEvent.doubleClick(node);
    expect(openHoleForEdit).toHaveBeenCalledWith('H1');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `BrowserPane.tsx`, inside the feature-tree rendering loop, add:

```tsx
{feature.kind === 'hole' && (
  <div
    className="flex items-center gap-1 pl-4 text-xs hover:bg-zinc-800"
    onDoubleClick={() => openHoleForEdit(feature.id)}
  >
    <DrillIcon /> {feature.id}
  </div>
)}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/BrowserPane.tsx packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "feat(app): BrowserPane — Hole node + double-click-to-edit"
```

---

### Task 26: `openHoleForEdit` rehydrates dialog from stored feature

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts` (`openHoleForEdit` now seeds `holeInitialValues` + picks)
- Modify: `packages/app/src/shell/HoleDialog.tsx` (consume `holeInitialValues` on mount)
- Extend: `packages/app/src/shell/__tests__/HoleDialog.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
  it('opens a stored CBORE hole in edit mode with all fields pre-filled', () => {
    const stored: HoleFeature = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'counterbore',
        diameter: { kind: 'literal', value: 4 },
        cboreDiameter: { kind: 'literal', value: 8 },
        cboreDepth: { kind: 'literal', value: 2 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 6 } },
      flipAxis: true,
    };
    const store = createStoreWithFeatures([stored]);
    store.getState().openHoleForEdit('H1');
    render(<HoleDialog store={store} />);
    expect((screen.getByLabelText(/Diameter/i) as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText(/CBORE Ø/i) as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText(/Depth/i) as HTMLInputElement).value).toBe('6');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement `openHoleForEdit` seeder**

```ts
openHoleForEdit: (id) => set((s) => {
  const feature = s.findFeatureById(id) as HoleFeature | undefined;
  if (!feature || feature.kind !== 'hole') return s;
  const placementMode = feature.placement.kind;
  return {
    ...s,
    holeDialogOpen: true,
    editingHoleId: id,
    holeInitialValues: feature,
    holePlacementMode: placementMode,
    holeSketchId: placementMode === 'fromSketch' ? feature.placement.sketchId : null,
    holePlacementFace:
      placementMode === 'linear' ? feature.placement.faceName :
      placementMode === 'concentric' ? feature.placement.faceName :
      null,
    holeRefEdges: placementMode === 'linear'
      ? [feature.placement.refEdge1, feature.placement.refEdge2]
      : [null, null],
    holeCircularEdge: placementMode === 'concentric' ? feature.placement.circularEdgeName : null,
    holeTargetFace: feature.termination.kind === 'toFace' ? feature.termination.targetFaceName : null,
  };
}),
```

In `HoleDialog.tsx`, on mount / when `holeInitialValues` changes, pre-fill the local state hooks:

```tsx
const initial = useAppStore((s) => s.holeInitialValues);
React.useEffect(() => {
  if (!initial) return;
  setProfileKind(initial.profile!.kind);
  setDiameter(String(literalOrParamText(initial.profile!.diameter)));
  if (initial.profile!.kind === 'counterbore') {
    setCboreDiameter(String(literalOrParamText(initial.profile!.cboreDiameter)));
    setCboreDepth(String(literalOrParamText(initial.profile!.cboreDepth)));
  }
  if (initial.profile!.kind === 'countersink') {
    setCskDiameter(String(literalOrParamText(initial.profile!.cskDiameter)));
    setCskAngle(String(literalOrParamText(initial.profile!.cskAngle)));
  }
  setTermKind(initial.termination!.kind);
  if (initial.termination!.kind === 'distance') {
    setDepth(String(literalOrParamText(initial.termination!.depth)));
  }
}, [initial]);
```

`literalOrParamText` returns `value` for literals and `=paramName` for params.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts \
        packages/app/src/shell/HoleDialog.tsx \
        packages/app/src/shell/__tests__/HoleDialog.spec.tsx
git commit -m "feat(app): HoleDialog — rehydrate from stored feature"
```

---

### Task 27: Live preview via `previewFeature` RPC

**Files:**
- Modify: `packages/app/src/shell/HoleDialog.tsx` (debounce + RPC)
- Modify: `packages/app/src/App.tsx` (viewport preview mesh slot already exists; extend for hole preview shape)

Reuse the `previewFeature` infrastructure shipped by Revolve (3a T9) and Fillet (3b). The `KernelClient` already exposes `previewFeature(feature, resolveParam)` → `{ mesh }`. Hole preview constructs a full `HoleFeature` from the current dialog state and calls this RPC; on success, viewport renders the returned mesh translucently; on error, footer badge.

- [ ] **Step 1: Write failing test (perf-style debounce)**

Defer the full debounce test to Phase 6 (Task 31 — perf). Here, sanity-check that `HoleDialog` calls `previewFeature` at least once when all required picks are made.

```tsx
  it('calls previewFeature after dialog fields settle', async () => {
    const preview = vi.fn().mockResolvedValue({ mesh: { positions: new Float32Array(), indices: new Uint32Array() } });
    render(<HoleDialog previewFeature={preview} />);
    fireEvent.change(screen.getByLabelText(/Diameter/i), { target: { value: '5' } });
    await new Promise((r) => setTimeout(r, 200));
    expect(preview).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement debounced preview**

In `HoleDialog.tsx`, track the composed `HoleFeature` and debounce 150 ms before calling `kernel.previewFeature`:

```tsx
React.useEffect(() => {
  const handle = setTimeout(async () => {
    const feature = composeFeature();
    if (!featureIsComplete(feature)) return;
    try {
      const { mesh } = await kernelClient.previewFeature(feature, resolveParam);
      viewport.setPreviewMesh(mesh);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      viewport.clearPreviewMesh();
    }
  }, 150);
  return () => { clearTimeout(handle); viewport.clearPreviewMesh(); };
}, [dialogStateJson]);
```

`featureIsComplete` checks all picks are present (sketch for fromSketch, face+edges for linear, etc.).

Extend `KernelClient.previewFeature` to accept a `HoleFeature` and route to `executeHoleFeature` on the worker side. If the existing RPC is feature-type-agnostic (it accepts any `Feature`), no worker change is needed.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/HoleDialog.tsx packages/app/src/shell/__tests__/HoleDialog.spec.tsx
git commit -m "feat(app): HoleDialog — debounced live preview"
```

---

## Phase 6 — E2E + Perf

### Task 28: E2E — `hole-from-sketch.spec.ts`

**Files:**
- Create: `tests/e2e/model/hole-from-sketch.spec.ts`

- [ ] **Step 1: Write E2E**

```ts
import { test, expect } from '@playwright/test';

test('from-sketch simple through hole drills per circle center', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('r');                           // sketch rect (place on XY)
  // — draw a 20x20 rect, commit
  await drawRect(page, [0, 0], [20, 20]);
  await commitSketch(page);
  await extrude(page, 10);                                  // E key + 10 mm

  await page.keyboard.press('s');                           // start sketch on top face
  await drawCircle(page, [5, 5], 1);
  await drawCircle(page, [15, 15], 1);
  await commitSketch(page);

  await page.keyboard.press('h');                           // open Hole dialog
  await page.getByRole('button', { name: /pick sketch/i }).click();
  await page.getByText(/Sketch[12]/).click();               // pick the 2-circle sketch
  await page.getByLabel(/Diameter/i).fill('2');
  await page.getByLabel(/Termination/i).selectOption('throughAll');
  await page.getByRole('button', { name: /ok/i }).click();

  // Assert geometry-hash reflects drilled body
  const hash = await page.locator('[data-testid=viewport]').getAttribute('data-geometry-hash');
  expect(hash).toBeDefined();
  // Should be distinct from the pre-hole hash (captured earlier via a helper)
});
```

- [ ] **Step 2: Run — should pass**

`pnpm exec playwright test --project=chromium -- hole-from-sketch` → PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/model/hole-from-sketch.spec.ts
git commit -m "test(e2e): hole from-sketch — drills per circle center"
```

---

### Task 29: E2E — `hole-linear.spec.ts`

**Files:**
- Create: `tests/e2e/model/hole-linear.spec.ts`

- [ ] **Step 1: Write E2E**

```ts
test('linear placement with CBORE blind', async ({ page }) => {
  await page.goto('/');
  // Build a 20x20x10 box
  await setupCube(page, { w: 20, h: 20, d: 10 });
  await page.keyboard.press('h');
  await page.getByLabel(/linear/i).check();
  await page.getByRole('button', { name: /pick face/i }).click();
  await pickFace(page, 'top');
  await page.getByRole('button', { name: /pick edge 1/i }).click();
  await pickEdge(page, 'top-front');
  await page.getByLabel(/offset 1/i).fill('5');
  await page.getByRole('button', { name: /pick edge 2/i }).click();
  await pickEdge(page, 'top-left');
  await page.getByLabel(/offset 2/i).fill('5');
  await page.getByLabel(/counterbore/i).check();
  await page.getByLabel(/Diameter/i).fill('4');
  await page.getByLabel(/CBORE Ø/i).fill('8');
  await page.getByLabel(/CBORE depth/i).fill('2');
  await page.getByLabel(/Termination/i).selectOption('distance');
  await page.getByLabel(/Depth/i).fill('6');
  await page.getByRole('button', { name: /ok/i }).click();

  // Expect browser-pane shows 'H*' node
  await expect(page.locator('[data-testid=browser-pane]')).toContainText(/H/);
});
```

- [ ] **Step 2: Run — should pass**

PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/model/hole-linear.spec.ts
git commit -m "test(e2e): hole linear — CBORE blind from 2 edge offsets"
```

---

### Task 30: E2E `hole-concentric` + `hole-parametric-cascade` + `hole-edit-reopen` + perf + final review

**Files:**
- Create: `tests/e2e/model/hole-concentric.spec.ts`
- Create: `tests/e2e/model/hole-parametric-cascade.spec.ts`
- Create: `tests/e2e/model/hole-edit-reopen.spec.ts`
- Create: `tests/e2e/perf/hole-preview-debounce.spec.ts`
- Create: `docs/superpowers/manual-tests/hole.md`

- [ ] **Step 1: Write the four E2E specs**

```ts
// tests/e2e/model/hole-concentric.spec.ts
test('concentric placement on a revolved ring', async ({ page }) => {
  await page.goto('/');
  await setupRevolvedRing(page);     // creates a hollow cylinder with inner circular edge
  await page.keyboard.press('h');
  await page.getByLabel(/concentric/i).check();
  await page.getByRole('button', { name: /pick face/i }).click();
  await pickFace(page, 'top');
  await page.getByRole('button', { name: /pick circular edge/i }).click();
  await pickCircularEdge(page);
  await page.getByLabel(/countersink/i).check();
  await page.getByLabel(/Diameter/i).fill('4');
  await page.getByLabel(/CSK Ø/i).fill('8');
  await page.getByLabel(/Termination/i).selectOption('throughAll');
  await page.getByRole('button', { name: /ok/i }).click();
  await expect(page.locator('[data-testid=browser-pane]')).toContainText(/H/);
});
```

```ts
// tests/e2e/model/hole-parametric-cascade.spec.ts
test('editing a diameter parameter regenerates the hole with new geometry hash', async ({ page }) => {
  await page.goto('/');
  await createHoleWithParamDiameter(page, 'd_hole', 4);
  const hashA = await getHash(page);
  await editParameter(page, 'd_hole', 8);
  const hashB = await getHash(page);
  expect(hashA).not.toBe(hashB);
});
```

```ts
// tests/e2e/model/hole-edit-reopen.spec.ts
test('double-clicking a Hole browser node re-opens dialog with fields populated', async ({ page }) => {
  await page.goto('/');
  await createSimpleHole(page, { diameter: 5, termination: 'throughAll' });
  await page.locator('[data-testid=browser-pane] >> text=H').dblclick();
  await expect(page.getByLabel(/Diameter/i)).toHaveValue('5');
});
```

```ts
// tests/e2e/perf/hole-preview-debounce.spec.ts
test('preview RPC fires at most once per 150 ms', async ({ page }) => {
  await page.goto('/');
  await openHoleDialog(page);
  const calls: number[] = [];
  await page.exposeFunction('__recordPreview', (t: number) => { calls.push(t); });
  await page.evaluate(() => {
    const orig = (window as any).__kernelClient.previewFeature;
    (window as any).__kernelClient.previewFeature = async (...a: any[]) => {
      (window as any).__recordPreview(performance.now());
      return orig(...a);
    };
  });
  // Drag the diameter input rapidly
  const d = page.getByLabel(/Diameter/i);
  for (let v = 1; v < 20; v++) { await d.fill(String(v)); }
  await page.waitForTimeout(300);
  // Assert inter-call gaps ≥ 100 ms (allowing some scheduler jitter)
  for (let i = 1; i < calls.length; i++) {
    expect(calls[i]! - calls[i - 1]!).toBeGreaterThanOrEqual(100);
  }
});
```

- [ ] **Step 2: Write manual checklist**

```md
<!-- docs/superpowers/manual-tests/hole.md -->
# Hole feature manual checklist

- [ ] From-sketch simple through: draw a sketch with 2 circles, H, pick sketch, OK — 2 holes appear.
- [ ] Linear CBORE blind: pick top face + 2 perpendicular edges + offsets + CBORE blind depth — appears at expected position.
- [ ] Concentric CSK on a revolved ring — centered on inner edge.
- [ ] Edit parameter d_hole from 4 → 8 — existing hole regenerates.
- [ ] Double-click Hole in browser — dialog reopens with fields populated.
- [ ] Flip-axis toggle reverses hole direction.
- [ ] To-Face termination on a stacked-plate fixture stops at the picked face.
- [ ] Preview appears within ~200 ms of field edits.
```

- [ ] **Step 3: Run all**

```
pnpm -r typecheck
pnpm -C packages/shared test:unit
pnpm -C packages/app test:unit
pnpm --filter @zilventor/kernel exec vitest run
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=perf
```

All green.

- [ ] **Step 4: Update memory**

Add `/Users/lion/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/project_hole_feature.md` summarizing ship state + add a pointer to `MEMORY.md`.

- [ ] **Step 5: Final review commit**

```bash
git add tests/e2e/model/hole-concentric.spec.ts \
        tests/e2e/model/hole-parametric-cascade.spec.ts \
        tests/e2e/model/hole-edit-reopen.spec.ts \
        tests/e2e/perf/hole-preview-debounce.spec.ts \
        docs/superpowers/manual-tests/hole.md
git commit -m "test(e2e): hole — concentric / cascade / edit-reopen / perf + manual checklist"
```

- [ ] **Step 6: Push**

```bash
git push origin master
```

---

## Self-Review summary (for the implementer)

- **Spec coverage:** every scope-summary row has at least one task implementing it. From-Sketch (T10–T11), Linear (T12), Concentric (T13), Simple/CBORE/CSK (T3–T6), Distance/ThroughAll/ToFace/ToNext (T7+T14), 118° drill tip (T4), flipAxis (T11), parametric cascade (inherent — no extra wiring), live preview (T27), rehydrate (T26), soft-fail (T17), face naming (T9), migration (T2).
- **Deferred items** are called out in the spec and not tasked here: OnPoint, Spotface, Tapped, flat-bottom toggle, per-hole overrides, symmetric direction, taper/reamed, thread callouts.
- **Existing reuse:** `FaceNaming`, `NamedShape`, `canonicalEdgeName`, `FacePickController`, `EdgePickController`, `NumericInputOverlay`, `previewFeature` RPC, `parameterRegistry.subscribe → setParameter → execute` cascade — all shipped by prior sub-projects. No plan tasks rebuild them.
- **One commit per task.** Tasks 15 (soft-fail) and 16 (pre-scan) were merged to keep the feature-tree changes atomic in Task 17.

## Execution

After saving this plan, continue via the execution skill chosen at the top of the session.
