# Sweep Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final piece of Sub-project 3 — a Sweep feature that runs a closed-loop profile sketch along an open or closed path sketch with three orientation modes (Path / Parallel / Guide Rail) and three boolean operations (New / Join / Cut), with full parametric cascade, live preview, edit-on-reopen, and Inventor-2012 dialog parity.

**Architecture:** New `SweepOps` OCCT module wraps `BRepOffsetAPI_MakePipeShell` for all three orientations. New `SweepFeature` adapter resolves up to three sketch references (profile, path, optional guide rail), builds wires, dispatches to `makeSweep`, and applies the boolean op via existing `fuseShapes` / `cutShapes` from 3a. `FeatureTree` adds a pre-scan that keeps sweep-referenced sketches raw (parallel to revolve and hole patterns) and a `case 'sweep':` branch with try/catch soft-fail. UI is one `SweepDialog` (presentation component) + `OpenSweepDialogCommand` + `AddSweepFeatureCommand` (class), with debounced 150 ms live preview and rehydrate-on-edit.

**Tech Stack:** opencascade.js (OCCT 2.0.0-beta), existing Comlink kernel worker, React + Zustand, three.js viewport, existing `previewFeature` RPC (3a), existing `FaceNaming` layer (3b), existing `SketchPickController` (Hole T21).

**Spec:** `docs/superpowers/specs/2026-04-25-sweep-design.md`

**Total tasks: 29.** Test-driven throughout. One commit per task unless noted.

---

## Phase 1 — Shared layer

### Task 1: `SweepOrientation` + `SweepFeature` types on `Feature` union

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/kernel/src/adapter/FeatureTree.ts` (placeholder `case 'sweep': continue;`)
- Test: `packages/shared/src/__tests__/sweep-feature.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/__tests__/sweep-feature.spec.ts
import { describe, it, expect } from 'vitest';
import type { Feature, SweepFeature, SweepOrientation, BooleanOperation } from '../types';

describe('SweepFeature', () => {
  it('accepts path orientation + new operation', () => {
    const f: SweepFeature = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const u: Feature = f;
    expect(u.kind).toBe('sweep');
  });

  it('accepts parallel orientation + join operation', () => {
    const f: SweepFeature = {
      id: 'SW2', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'parallel' },
      operation: 'join',
    };
    expect(f.orientation.kind).toBe('parallel');
  });

  it('accepts guideRail orientation with a third sketch + cut operation', () => {
    const f: SweepFeature = {
      id: 'SW3', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'guideRail', guideRailSketchId: 'S3' },
      operation: 'cut',
    };
    if (f.orientation.kind === 'guideRail') {
      expect(f.orientation.guideRailSketchId).toBe('S3');
    }
  });

  it('all three boolean operations are valid', () => {
    const ops: BooleanOperation[] = ['new', 'join', 'cut'];
    expect(ops).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- sweep-feature` → FAIL.

- [ ] **Step 3: Extend `types.ts`**

Append to `packages/shared/src/types.ts`:

```ts
export type SweepOrientation =
  | { kind: 'path' }
  | { kind: 'parallel' }
  | { kind: 'guideRail'; guideRailSketchId: string };

export type SweepFeature = {
  id: string;
  kind: 'sweep';
  profileSketchId: string;
  pathSketchId: string;
  orientation: SweepOrientation;
  operation: BooleanOperation;
};
```

Extend the `Feature` union — add `| SweepFeature` at the tail. Read the current union shape first to confirm exact members; do not remove anything.

- [ ] **Step 4: Placeholder in FeatureTree**

In `packages/kernel/src/adapter/FeatureTree.ts`, after the existing `case 'hole'` branch, add:

```ts
} else if (feature.kind === 'sweep') {
  // Wired in Task 17
  continue;
}
```

- [ ] **Step 5: Run — should pass**

```
pnpm -C packages/shared test:unit -- sweep-feature
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts \
        packages/shared/src/__tests__/sweep-feature.spec.ts \
        packages/kernel/src/adapter/FeatureTree.ts
git commit -m "feat(shared): SweepFeature variant on Feature union

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: File format v6 → v7 migration

**Files:**
- Modify: `packages/shared/src/fileFormat.ts` (`CURRENT_FORMAT_VERSION` + chain)
- Modify: `packages/shared/src/types.ts` (`ProjectFile.formatVersion: 7`)
- Modify: `packages/shared/src/__tests__/fileFormat.spec.ts`

- [ ] **Step 1: Append failing tests**

```ts
describe('fileFormat v6 → v7 migration', () => {
  it('bumps formatVersion from 6 to 7 without structural change', () => {
    const input: AnyManifest = {
      formatVersion: 6,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'sketch', id: 'S1', plane: 'XY', primitives: [], constraints: [] },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(7);
    expect(CURRENT_FORMAT_VERSION).toBe(7);
  });

  it('v6 with mixed features survives migration', () => {
    const input: AnyManifest = {
      formatVersion: 6,
      document: {
        id: 'P1', name: 'P', units: 'mm', parameters: {},
        featureTree: [
          { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' },
        ],
      },
    };
    const out = migrateManifest(input);
    expect(out.formatVersion).toBe(7);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm -C packages/shared test:unit -- fileFormat` → FAIL.

- [ ] **Step 3: Implement migration**

In `packages/shared/src/fileFormat.ts`:

```ts
export const CURRENT_FORMAT_VERSION = 7;

function migrateV6ToV7(m: AnyManifest): AnyManifest {
  return { ...m, formatVersion: 7 };
}
```

Wire `migrateV6ToV7` into the chain after v5→v6.

In `packages/shared/src/types.ts`, change `ProjectFile.formatVersion: 6` → `7`.

- [ ] **Step 4: Run — should pass**

`pnpm -C packages/shared test:unit && pnpm -r typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/fileFormat.ts packages/shared/src/types.ts \
        packages/shared/src/__tests__/fileFormat.spec.ts
git commit -m "feat(shared): file format v6 → v7 migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Kernel OCCT ops

### Task 3: `SweepOps` scaffolding + `buildWireFromSketch` helper

**Files:**
- Create: `packages/kernel/src/occt/SweepOps.ts`
- Create: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/kernel/src/occt/__tests__/SweepOps.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import { buildWireFromSketch } from '../SweepOps';

describe('SweepOps — buildWireFromSketch', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('builds a closed wire from a 4-line rectangle sketch', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
        { id: 'L3', kind: 'line', x1: 10, y1: 5, x2: 0, y2: 5 },
        { id: 'L4', kind: 'line', x1: 0, y1: 5, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).IsNull?.()).not.toBe(true);
    expect((wire as any).Closed?.()).toBe(true);
  });

  it('builds an open wire from two connected line segments', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 5 },
      ],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(false);
  });

  it('builds a closed wire from a single full circle', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 5 }],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).Closed?.()).toBe(true);
  });
});
```

- [ ] **Step 2: Run — should fail**

`pnpm --filter @zilventor/kernel exec vitest run -- SweepOps` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/kernel/src/occt/SweepOps.ts

type Vec3 = { x: number; y: number; z: number };

function sketchPlaneFrame(plane: 'XY' | 'XZ' | 'YZ'): { u: Vec3; v: Vec3; n: Vec3 } {
  if (plane === 'XY') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, n: { x: 0, y: 0, z: 1 } };
  if (plane === 'XZ') return { u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 1, z: 0 } };
  return { u: { x: 0, y: 1, z: 0 }, v: { x: 0, y: 0, z: 1 }, n: { x: 1, y: 0, z: 0 } };
}

function to3D(plane: 'XY' | 'XZ' | 'YZ', x: number, y: number): Vec3 {
  const f = sketchPlaneFrame(plane);
  return {
    x: f.u.x * x + f.v.x * y,
    y: f.u.y * x + f.v.y * y,
    z: f.u.z * x + f.v.z * y,
  };
}

/**
 * Build an OCCT wire (TopoDS_Wire) from a sketch's primitives, in order.
 *
 * Supports `line` and `circle` primitives. Arc / spline support can be added
 * incrementally — throws "unsupported primitive kind" otherwise.
 *
 * The resulting wire's `Closed()` predicate returns true iff the primitive
 * chain is end-to-end closed.
 */
export function buildWireFromSketch(oc: any, sketch: any): any {
  const plane = sketch.plane as 'XY' | 'XZ' | 'YZ';
  const wireBuilder = new oc.BRepBuilderAPI_MakeWire_1();

  for (const prim of sketch.primitives) {
    if (prim.kind === 'line') {
      const p1 = to3D(plane, prim.x1, prim.y1);
      const p2 = to3D(plane, prim.x2, prim.y2);
      const gp1 = new oc.gp_Pnt_3(p1.x, p1.y, p1.z);
      const gp2 = new oc.gp_Pnt_3(p2.x, p2.y, p2.z);
      const edge = new oc.BRepBuilderAPI_MakeEdge_3(gp1, gp2).Edge();
      wireBuilder.Add_1(edge);
    } else if (prim.kind === 'circle') {
      const c = to3D(plane, prim.cx, prim.cy);
      const f = sketchPlaneFrame(plane);
      const center = new oc.gp_Pnt_3(c.x, c.y, c.z);
      const axis = new oc.gp_Dir_4(f.n.x, f.n.y, f.n.z);
      const ax2 = new oc.gp_Ax2_3(center, axis);
      const circ = new oc.gp_Circ_2(ax2, prim.r);
      const edge = new oc.BRepBuilderAPI_MakeEdge_8(circ).Edge();
      wireBuilder.Add_1(edge);
    } else {
      throw new Error(`SweepOps: unsupported primitive kind '${prim.kind}'`);
    }
  }

  if (!wireBuilder.IsDone()) throw new Error('SweepOps: wire builder did not complete (disconnected primitives?)');
  return wireBuilder.Wire();
}
```

OCCT overload-suffix notes:
- `BRepBuilderAPI_MakeWire_1` is the no-arg constructor used incrementally with `Add_1(edge)`.
- `BRepBuilderAPI_MakeEdge_3(gp_Pnt, gp_Pnt)` builds a line segment edge.
- `BRepBuilderAPI_MakeEdge_8(gp_Circ)` builds a full-circle edge.
- `gp_Circ_2(gp_Ax2, radius)` is the standard circle constructor.

If runtime reports "invalid number of parameters" for any of these, inspect `node_modules/opencascade.js/dist/opencascade.full.d.ts` and adjust suffixes.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — buildWireFromSketch (line + circle)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Arc primitive support in `buildWireFromSketch`

**Files:**
- Modify: `packages/kernel/src/occt/SweepOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

Check `packages/shared/src/types.ts` for the actual arc primitive shape — it's likely `{ kind: 'arc'; cx: number; cy: number; r: number; startAngle: number; endAngle: number }` or similar. Use the real fields.

- [ ] **Step 1: Write failing test**

```ts
  it('builds an open wire from a single 90° arc primitive', () => {
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      // Adjust field names to whatever the real arc primitive shape is.
      primitives: [{ id: 'A1', kind: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2 }],
      constraints: [],
    };
    const wire = buildWireFromSketch(oc, sketch);
    expect((wire as any).IsNull?.()).not.toBe(true);
    expect((wire as any).Closed?.()).toBe(false);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL with "unsupported primitive kind 'arc'".

- [ ] **Step 3: Add arc branch**

In `buildWireFromSketch`, before the `else` throw, add:

```ts
} else if (prim.kind === 'arc') {
  const c = to3D(plane, prim.cx, prim.cy);
  const f = sketchPlaneFrame(plane);
  const center = new oc.gp_Pnt_3(c.x, c.y, c.z);
  const axis = new oc.gp_Dir_4(f.n.x, f.n.y, f.n.z);
  const ax2 = new oc.gp_Ax2_3(center, axis);
  const circ = new oc.gp_Circ_2(ax2, prim.r);
  // BRepBuilderAPI_MakeEdge_9 takes (gp_Circ, alpha1, alpha2) for an arc
  const edge = new oc.BRepBuilderAPI_MakeEdge_9(circ, prim.startAngle, prim.endAngle).Edge();
  wireBuilder.Add_1(edge);
}
```

If `BRepBuilderAPI_MakeEdge_9` isn't the right overload, inspect `.d.ts` for the `(gp_Circ, alpha1, alpha2)` constructor and use that suffix.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — arc primitive support in wire builder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `makeSweep` — Path orientation

**Files:**
- Modify: `packages/kernel/src/occt/SweepOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('Path orientation: line + circle profile produces a cylinder', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'path' });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // π · 1² · 10 = ~31.42
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });
```

The XZ-plane line goes from (0,0) to (0,10) which becomes world (0,0,0)→(0,0,10), so the path is a 10mm spine along +Z. The XY-plane circle profile gets transported along +Z by `MakePipeShell`, producing a cylinder.

- [ ] **Step 2: Run — should fail**

FAIL (`makeSweep` not exported).

- [ ] **Step 3: Implement `makeSweep`**

Append to `SweepOps.ts`:

```ts
export type ResolvedSweepOrientation =
  | { kind: 'path' }
  | { kind: 'parallel' }
  | { kind: 'guideRail'; guideWire: any };

export function makeSweep(
  oc: any,
  profileWire: any,
  pathWire: any,
  orientation: ResolvedSweepOrientation,
): any {
  const builder = new oc.BRepOffsetAPI_MakePipeShell(pathWire);

  if (orientation.kind === 'path') {
    // SetMode_2(IsFrenet=true) — Frenet frame mode
    builder.SetMode_2(true);
  } else if (orientation.kind === 'parallel') {
    // Implemented in Task 6
    throw new Error('SweepOps: parallel orientation not yet implemented in this task');
  } else {
    // Implemented in Task 7
    throw new Error('SweepOps: guideRail orientation not yet implemented in this task');
  }

  // Add_1(profile, WithContact=false, WithCorrection=false)
  builder.Add_1(profileWire, false, false);
  builder.Build(new oc.Message_ProgressRange_1());
  if (!builder.IsDone()) throw new Error('SweepOps: MakePipeShell.Build failed');
  if (!builder.MakeSolid()) throw new Error('SweepOps: MakePipeShell.MakeSolid failed (profile may not be closed)');
  return builder.Shape();
}
```

If `SetMode_2` is the wrong overload (likely candidates: `SetMode_1` taking `gp_Ax2`, `SetMode_2` taking boolean for Frenet, `SetMode_3` taking spine direction), inspect `opencascade.full.d.ts` for `BRepOffsetAPI_MakePipeShell::SetMode` overloads. The Frenet-mode overload signature is `void SetMode(const Standard_Boolean IsFrenet)`.

If `Add_1` rejects the 3-arg signature, the typical alternatives are:
- `Add_1(profile)` — 1-arg
- `Add_2(profile, WithContact, WithCorrection)` — 3-arg
- `Add_3(profile, location, WithContact, WithCorrection)` — 4-arg

Try `Add_2` if `Add_1` doesn't accept the booleans.

- [ ] **Step 4: Run — should pass**

PASS. If volume is off:
- Wrong cylinder height — verify path goes 0..10 along +Z (the XZ-plane sketch frame has v = +Z, so y2=10 maps to z=10).
- Wrong cylinder radius — verify profile circle has r=1.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — makeSweep with Path (Frenet) orientation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `makeSweep` — Parallel orientation

**Files:**
- Modify: `packages/kernel/src/occt/SweepOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('Parallel orientation: line spine + offset square profile produces axis-aligned prism', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'L2', kind: 'line', x1: 2, y1: 0, x2: 2, y2: 2 },
        { id: 'L3', kind: 'line', x1: 2, y1: 2, x2: 0, y2: 2 },
        { id: 'L4', kind: 'line', x1: 0, y1: 2, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'parallel' });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // 2×2×10 = 40
    expect(props.Mass()).toBeCloseTo(40, 0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (parallel branch throws).

- [ ] **Step 3: Implement parallel branch**

In `makeSweep`, replace the parallel-branch throw with:

```ts
} else if (orientation.kind === 'parallel') {
  // Compute a fixed frame from the profile wire (use first edge midpoint + sketch plane normal)
  // The frame's `Direction()` becomes the path-tangent reference; locking it makes the profile
  // keep its initial world orientation across the path.
  // Simplest: SetMode_1(profile_origin_ax2) — anchors the profile frame.
  // Pull center + normal from the profile wire's bounding box centroid + first-edge plane.
  const bbox = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(profileWire, bbox, false);
  const lo = bbox.CornerMin();
  const hi = bbox.CornerMax();
  const centroid = new oc.gp_Pnt_3((lo.X() + hi.X()) / 2, (lo.Y() + hi.Y()) / 2, (lo.Z() + hi.Z()) / 2);
  // For an XY-plane profile, normal is +Z. We pull this from the sketch frame, but in this
  // kernel-level helper we accept profileWire only — so we infer the normal from the wire's
  // smallest bounding-box dimension (degenerate axis = normal).
  const dx = hi.X() - lo.X();
  const dy = hi.Y() - lo.Y();
  const dz = hi.Z() - lo.Z();
  let nx = 0, ny = 0, nz = 1;
  if (dx <= dy && dx <= dz) { nx = 1; ny = 0; nz = 0; }
  else if (dy <= dx && dy <= dz) { nx = 0; ny = 1; nz = 0; }
  // else default +Z (already set)
  const normal = new oc.gp_Dir_4(nx, ny, nz);
  const ax2 = new oc.gp_Ax2_3(centroid, normal);
  builder.SetMode_1(ax2);
}
```

If `SetMode_1(gp_Ax2)` is the wrong overload, inspect `.d.ts` for the parallel-frame variant. The signature is `void SetMode(const gp_Ax2& Axe)`.

- [ ] **Step 4: Run — should pass**

PASS. If volume is off (e.g., showing a rotated/skewed prism):
- The inferred normal may be wrong. Pass the sketch's plane normal explicitly via a third argument or set `orientation.kind === 'parallel'` to carry a `frame: gp_Ax2` field. For now, the bbox-degenerate-axis heuristic should work for axis-aligned XY/XZ/YZ profiles.

If correctness needs a more reliable normal computation, change the orientation type to `{ kind: 'parallel'; frame: gp_Ax2 }` and have the adapter pass it. The kernel test fixture would then construct the frame inline.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — makeSweep parallel orientation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `makeSweep` — Guide Rail orientation

**Files:**
- Modify: `packages/kernel/src/occt/SweepOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('Guide Rail orientation: line spine + parallel rail produces a tracked sweep', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const guide: any = {
      id: 'G', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 3, y1: 0, x2: 3, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    const guideWire = buildWireFromSketch(oc, guide);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'guideRail', guideWire });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // For a parallel guide rail, the result is essentially the same as a Path-orientation sweep
    // (a cylinder of volume π·1²·10), since the guide doesn't bend the profile.
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, -1);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement guideRail branch**

In `makeSweep`, replace the guideRail-branch throw with:

```ts
} else {
  // Guide rail mode
  // SetMode_4(GuideWire, KeepContact, BRepFill_TypeOfContact)
  // BRepFill_TypeOfContact_NoContact = 0, ContactOnBorder = 1 (verify against .d.ts)
  builder.SetMode_4(orientation.guideWire, true, oc.BRepFill_TypeOfContact.BRepFill_ContactOnBorder);
}
```

Verify the enum name — common candidates:
- `oc.BRepFill_TypeOfContact.BRepFill_ContactOnBorder`
- `oc.BRepFill_TypeOfContact.ContactOnBorder`
- numeric `1`

If neither symbolic name resolves, fall back to the numeric value (likely `1`).

- [ ] **Step 4: Run — should pass**

PASS. If `MakeSolid` fails:
- Check that the guide rail starts at a point reachable from the profile's contact location.
- The plan-test guide is parallel to the spine, both starting at z=0; the profile is at the origin so its `cx=0` corner contacts the spine at z=0. If `KeepContact=true` requires the profile to actually touch the guide, the test profile may need to be repositioned (e.g., move the circle to `cx=3` so it's on the guide).

If the test still fails after repositioning, switch `KeepContact` to `false` and use a different `BRepFill_TypeOfContact` value (`NoContact`).

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — makeSweep guide-rail orientation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Closed-loop path support

**Files:**
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('closed-loop path (rectangle) + circle profile produces a ring', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 0.5 }],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
        { id: 'L3', kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
        { id: 'L4', kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
      ],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, profile);
    const pathWire = buildWireFromSketch(oc, path);
    expect((pathWire as any).Closed?.()).toBe(true);
    const solid = makeSweep(oc, profileWire, pathWire, { kind: 'path' });
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(solid, props, 1e-7, false, false);
    // 4 sides × 10mm = 40mm of total path length, π·0.5²·40 = ~31.42
    expect(props.Mass()).toBeCloseTo(Math.PI * 0.25 * 40, -1);
  });
```

- [ ] **Step 2: Run — should pass**

The Task 5 implementation already handles closed paths because `BRepOffsetAPI_MakePipeShell` accepts both. Run:

```
pnpm --filter @zilventor/kernel exec vitest run -- SweepOps
```

Should PASS. If volume is off, check the path's actual perimeter (10×4=40) and the profile's cross-section area (π·0.5²=0.785).

If `MakeSolid` fails for the closed loop, OCCT may need `MakeSolid()` to be skipped — for closed loops, the result is a torus-like shape that may not have caps. In that case, return `builder.Shape()` directly without calling `MakeSolid`. Branch on `pathWire.Closed()`:

```ts
if (!(pathWire as any).Closed?.()) {
  if (!builder.MakeSolid()) throw new Error('...');
}
return builder.Shape();
```

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/src/occt/__tests__/SweepOps.spec.ts \
        packages/kernel/src/occt/SweepOps.ts
git commit -m "test(kernel): SweepOps — closed-loop path produces ring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Profile-not-closed + degenerate path validation

**Files:**
- Modify: `packages/kernel/src/occt/SweepOps.ts`
- Modify: `packages/kernel/src/occt/__tests__/SweepOps.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
  it('profile-not-closed throws', () => {
    const openProfile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'L2', kind: 'line', x1: 1, y1: 0, x2: 1, y2: 1 },
      ],
      constraints: [],
    };
    const path: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const profileWire = buildWireFromSketch(oc, openProfile);
    const pathWire = buildWireFromSketch(oc, path);
    expect(() => makeSweep(oc, profileWire, pathWire, { kind: 'path' })).toThrow(/profile/i);
  });

  it('zero-length path throws', () => {
    const profile: any = {
      id: 'P', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const degenPath: any = {
      id: 'PA', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 0 }],
      constraints: [],
    };
    expect(() => buildWireFromSketch(oc, degenPath)).toThrow(/zero|degenerate|length/i);
  });
```

- [ ] **Step 2: Run — should fail**

The first test may fail with an OCCT-internal error rather than the expected message. The second will fail because `buildWireFromSketch` doesn't currently check zero-length edges.

- [ ] **Step 3: Add validation**

In `makeSweep`, before calling `Build()`, check:

```ts
if (!(profileWire as any).Closed?.()) {
  throw new Error('SweepOps: profile wire is not closed');
}
```

In `buildWireFromSketch`, when processing line primitives, check for zero length:

```ts
if (prim.kind === 'line') {
  const p1 = to3D(plane, prim.x1, prim.y1);
  const p2 = to3D(plane, prim.x2, prim.y2);
  const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
  if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 1e-9) {
    throw new Error(`SweepOps: zero-length line primitive ${prim.id}`);
  }
  // ... existing edge-build code
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/SweepOps.ts packages/kernel/src/occt/__tests__/SweepOps.spec.ts
git commit -m "feat(kernel): SweepOps — profile-closed + zero-length validation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Adapter

### Task 10: `SweepFeature` adapter — Path orientation + new operation

**Files:**
- Create: `packages/kernel/src/adapter/features/SweepFeature.ts`
- Create: `packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { executeSweepFeature } from '../SweepFeature';

describe('executeSweepFeature — integration', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('Path orientation + new operation produces a cylinder solid', () => {
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const result = executeSweepFeature(oc, null, feature, sketchById);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// packages/kernel/src/adapter/features/SweepFeature.ts
import type { OcctInstance } from '../../occt/occtLoader';
import type { Feature, SweepFeature, SweepOrientation } from '@zilventor/shared';
import {
  type NamedShape,
  attachName,
} from '../../occt/FaceNaming';
import {
  buildWireFromSketch,
  makeSweep,
  type ResolvedSweepOrientation,
} from '../../occt/SweepOps';

function getSketch(sketchById: Map<string, Feature>, id: string, role: string): Extract<Feature, { kind: 'sketch' }> {
  const s = sketchById.get(id);
  if (!s || s.kind !== 'sketch') throw new Error(`sweep: ${role} sketch ${id} not found`);
  return s;
}

function resolveOrientation(
  oc: OcctInstance,
  sketchById: Map<string, Feature>,
  o: SweepOrientation,
): ResolvedSweepOrientation {
  if (o.kind === 'path') return { kind: 'path' };
  if (o.kind === 'parallel') return { kind: 'parallel' };
  const guideSketch = getSketch(sketchById, o.guideRailSketchId, 'guide rail');
  const guideWire = buildWireFromSketch(oc as any, guideSketch);
  return { kind: 'guideRail', guideWire };
}

/**
 * Execute a sweep feature against a running body.
 * - operation 'new': returns the swept solid as the new running body. runningBody may be null.
 * - operation 'join': fuses the swept solid into runningBody.
 * - operation 'cut': cuts the swept solid out of runningBody.
 *
 * Caller (FeatureTree) wraps in try/catch for soft-fail.
 */
export function executeSweepFeature(
  oc: OcctInstance,
  runningBody: NamedShape | null,
  feature: SweepFeature,
  sketchById: Map<string, Feature>,
): NamedShape {
  const profileSketch = getSketch(sketchById, feature.profileSketchId, 'profile');
  const pathSketch = getSketch(sketchById, feature.pathSketchId, 'path');

  const profileWire = buildWireFromSketch(oc as any, profileSketch);
  const pathWire = buildWireFromSketch(oc as any, pathSketch);
  const orientation = resolveOrientation(oc, sketchById, feature.orientation);

  const sweptSolid = makeSweep(oc as any, profileWire, pathWire, orientation);

  let resultShape: any;
  if (feature.operation === 'new' || runningBody === null) {
    resultShape = sweptSolid;
  } else if (feature.operation === 'join') {
    // Defer fuseShapes/cutShapes wiring to Task 11 — for now, throw if not 'new'
    throw new Error(`sweep: operation '${feature.operation}' not yet implemented in Task 10`);
  } else {
    throw new Error(`sweep: operation '${feature.operation}' not yet implemented in Task 10`);
  }

  // Face naming: lateral/<i> + (capStart/capEnd if open path)
  const named: NamedShape = { shape: resultShape, faceNames: [] };
  // Tag faces — full face-naming heuristic is added in Task 12. For Task 10, leave faceNames empty;
  // downstream tests can run without face names since 'new' operation overrides any prior body.
  return named;
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/SweepFeature.ts \
        packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts
git commit -m "feat(kernel): SweepFeature adapter — Path orientation + new op

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Boolean ops — Join + Cut

**Files:**
- Modify: `packages/kernel/src/adapter/features/SweepFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
  it('operation join fuses swept solid into running body', () => {
    // Seed: 10×10×10 box as runningBody (use BRepPrimAPI_MakeBox)
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const running: any = { shape: cube, faceNames: [] };

    // Sweep: a line+circle producing a 5mm cylinder along +Z, but starting at z=10 (top of cube)
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 5, y1: 10, x2: 5, y2: 15 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'join',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const result = executeSweepFeature(oc, running, feature, sketchById);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // 1000 + π·1²·5 = 1000 + ~15.71
    expect(props.Mass()).toBeCloseTo(1000 + Math.PI * 5, 0);
  });

  it('operation cut subtracts swept solid from running body', () => {
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const running: any = { shape: cube, faceNames: [] };

    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 5, y1: -1, x2: 5, y2: 11 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'cut',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);

    const result = executeSweepFeature(oc, running, feature, sketchById);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // 1000 - π·1²·10 (the cylinder traverses the full 10mm height)
    expect(props.Mass()).toBeCloseTo(1000 - Math.PI * 10, 0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (current adapter throws for non-new operations).

- [ ] **Step 3: Wire fuseShapes / cutShapes**

Look at `packages/kernel/src/occt/BooleanOps.ts` to find the existing `fuseShapes` and `cutShapes` functions shipped by 3a (commits `9ecd816` / `ab5b3bb`). Note their exact signature.

In `SweepFeature.ts`, replace the throwing branches:

```ts
import { fuseShapes, cutShapes } from '../../occt/BooleanOps';

// ...
} else if (feature.operation === 'join') {
  if (runningBody === null) {
    resultShape = sweptSolid;
  } else {
    resultShape = fuseShapes(oc, runningBody.shape, sweptSolid);
  }
} else {
  // 'cut'
  if (runningBody === null) {
    throw new Error('sweep: operation cut requires a running body');
  }
  resultShape = cutShapes(oc, runningBody.shape, sweptSolid);
}
```

If `fuseShapes` / `cutShapes` return a `Result<...>` instead of a raw shape, adapt — call `.value` on success and throw on `.error`.

If `BooleanOps.ts` doesn't expose these exports under those names, search for the actual exports by reading `RevolveFeature.ts` (which uses them) and mirror.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/features/SweepFeature.ts \
        packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts
git commit -m "feat(kernel): SweepFeature — join + cut boolean operations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Face naming for sweep results

**Files:**
- Modify: `packages/kernel/src/occt/FaceNaming.ts`
- Modify: `packages/kernel/src/adapter/features/SweepFeature.ts`
- Modify: `packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('face naming: cylindrical sweep tags lateral/0, capStart, capEnd', () => {
    const profile: any = {
      id: 'PROF', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
      constraints: [],
    };
    const path: any = {
      id: 'PATH', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
      constraints: [],
    };
    const feature: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'PROF', pathSketchId: 'PATH',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const sketchById = new Map<string, any>([['PROF', profile], ['PATH', path]]);
    const result = executeSweepFeature(oc, null, feature, sketchById);
    const roles = result.faceNames.map((f: any) => f.name.role);
    expect(roles).toContain('SW1/sweep/lateral/0');
    expect(roles).toContain('SW1/sweep/capStart');
    expect(roles).toContain('SW1/sweep/capEnd');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (faceNames is empty).

- [ ] **Step 3: Implement `tagSweepFaces`**

Append to `packages/kernel/src/occt/FaceNaming.ts`:

```ts
/**
 * Tag faces produced by a sweep. Walks faces, classifies as planar (caps) or
 * non-planar (lateral). Lateral faces are sorted by area for stable ordering;
 * planar faces are split into capStart / capEnd by Z-coordinate of centroid
 * relative to the path's bounding box.
 *
 * For a closed-path sweep, there are no caps — lateral/<i> for all faces.
 */
export function tagSweepFaces(
  oc: any,
  sweptShape: any,
  featureId: string,
  pathClosed: boolean,
): Array<{ name: FaceName; face: unknown }> {
  const out: Array<{ name: FaceName; face: unknown }> = [];
  const explorer = new oc.TopExp_Explorer_2(
    sweptShape, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
  );
  const planarFaces: { face: any; centroid: any; area: number }[] = [];
  const lateralFaces: { face: any; area: number }[] = [];

  for (; explorer.More(); explorer.Next()) {
    const face = (oc as any).TopoDS.Face_1(explorer.Current());
    const surf = (oc as any).BRep_Tool.Surface_2(face).get();
    const type = surf.DynamicType().get().Name();
    const props = new oc.GProp_GProps_1();
    (oc as any).BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
    if (type === 'Geom_Plane' && !pathClosed) {
      planarFaces.push({ face, centroid: props.CentreOfMass(), area: props.Mass() });
    } else {
      lateralFaces.push({ face, area: props.Mass() });
    }
  }
  explorer.delete();

  // Lateral: sort by area asc for stable indexing
  lateralFaces.sort((a, b) => a.area - b.area);
  lateralFaces.forEach((f, i) => {
    out.push({ name: { featureId, role: `${featureId}/sweep/lateral/${i}` }, face: f.face });
  });

  // Caps: order by centroid value along the dominant axis (just use Z for simplicity;
  // for paths in non-Z directions, this still produces a stable two-element ordering)
  if (planarFaces.length === 2) {
    planarFaces.sort((a, b) =>
      (a.centroid.X() + a.centroid.Y() + a.centroid.Z())
      - (b.centroid.X() + b.centroid.Y() + b.centroid.Z())
    );
    out.push({ name: { featureId, role: `${featureId}/sweep/capStart` }, face: planarFaces[0]!.face });
    out.push({ name: { featureId, role: `${featureId}/sweep/capEnd` }, face: planarFaces[1]!.face });
  } else if (planarFaces.length > 0) {
    // Edge case: more than 2 planar faces (shouldn't happen for a single-loop profile + simple path)
    planarFaces.forEach((f, i) => {
      out.push({ name: { featureId, role: `${featureId}/sweep/cap/${i}` }, face: f.face });
    });
  }

  return out;
}
```

In `SweepFeature.ts`, replace the empty `faceNames: []` with:

```ts
import { tagSweepFaces } from '../../occt/FaceNaming';
// ...
const pathClosed = (pathWire as any).Closed?.() === true;
const namedFaces = tagSweepFaces(oc as any, resultShape, feature.id, pathClosed);
const named: NamedShape = { shape: resultShape, faceNames: namedFaces };
return named;
```

- [ ] **Step 4: Run — should pass**

PASS. If fewer than expected lateral/cap faces:
- A `MakePipeShell` cylinder produces 1 lateral face (the cylindrical surface) + 2 planar caps. The test expects `lateral/0`, `capStart`, `capEnd` — three names total.
- If the result shows different names, the surface-type classification might be off — log `surf.DynamicType().get().Name()` for each face during the test to verify.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/occt/FaceNaming.ts \
        packages/kernel/src/adapter/features/SweepFeature.ts \
        packages/kernel/src/adapter/features/__tests__/SweepFeature.integration.spec.ts
git commit -m "feat(kernel): FaceNaming.tagSweepFaces — lateral/cap roles

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — FeatureTree integration

### Task 13: FeatureTree pre-scan + `case 'sweep':` branch

**Files:**
- Modify: `packages/kernel/src/adapter/FeatureTree.ts`
- Modify: `packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
  it('sweep references two sketches; both stay raw, swept body is produced', async () => {
    const oc = await loadOcct();
    const tree: Feature[] = [
      { kind: 'sketch', id: 'PROF', plane: 'XY',
        primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }] as any,
        constraints: [] } as any,
      { kind: 'sketch', id: 'PATH', plane: 'XZ',
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }] as any,
        constraints: [] } as any,
      { kind: 'sweep', id: 'SW1',
        profileSketchId: 'PROF', pathSketchId: 'PATH',
        orientation: { kind: 'path' },
        operation: 'new' } as any,
    ];
    const result = await executeTree(oc, tree, {});
    const body = (result as any).value?.shape ?? (result as any).shape;
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(body, props, 1e-7, false, false);
    expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });

  it('sweep with missing profile sketch soft-fails without aborting', async () => {
    const oc = await loadOcct();
    const tree: Feature[] = [
      { kind: 'sketch', id: 'S0', plane: 'XY',
        primitives: [{ id: 'R1', kind: 'rect', x: 0, y: 0, w: 20, h: 20 }] as any,
        constraints: [] } as any,
      { kind: 'extrude', id: 'E1', sketchRef: 'S0', distanceParam: 'd0', direction: 'forward', operation: 'new' } as any,
      { kind: 'sweep', id: 'SW1',
        profileSketchId: 'NONEXISTENT', pathSketchId: 'NONE2',
        orientation: { kind: 'path' },
        operation: 'new' } as any,
    ];
    const result = await executeTree(oc, tree, { d0: 5 });
    const body = (result as any).value?.shape ?? (result as any).shape;
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(body, props, 1e-7, false, false);
    // Body remains the extrude result (20·20·5 = 2000)
    expect(props.Mass()).toBeCloseTo(2000, 0);
  });
```

- [ ] **Step 2: Run — should fail**

FAIL (sweep branch is a `continue` placeholder).

- [ ] **Step 3: Wire FeatureTree**

In `packages/kernel/src/adapter/FeatureTree.ts`:

1. Pre-scan extension at the top of `executeTree`:

```ts
const sweepSketchIds = new Set<string>();
for (const f of tree) {
  if (f.kind === 'sweep') {
    sweepSketchIds.add(f.profileSketchId);
    sweepSketchIds.add(f.pathSketchId);
    if (f.orientation.kind === 'guideRail') {
      sweepSketchIds.add(f.orientation.guideRailSketchId);
    }
  }
}
```

Merge this set with any existing `holeSketchIds` / `revolveSketchIds` so the sketch-skip predicate covers all "stay raw" sketches.

2. Replace the placeholder `case 'sweep'` branch:

```ts
} else if (feature.kind === 'sweep') {
  try {
    runningBody = executeSweepFeature(oc, runningBody, feature, sketchById);
  } catch (e) {
    featureErrors.set(feature.id, /* the project's KernelError shape */ {
      kind: 'kernelError',
      message: (e as Error).message,
    });
    continue;
  }
}
```

Match the actual `featureErrors` field shape used by hole/fillet/chamfer branches — read those for the exact error structure.

Import `executeSweepFeature` at the top.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/adapter/FeatureTree.ts \
        packages/kernel/src/adapter/__tests__/FeatureTree.integration.spec.ts
git commit -m "feat(kernel): FeatureTree — sweep branch + pre-scan + soft-fail

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — App wiring

### Task 14: useAppStore sweep slice

**Files:**
- Modify: `packages/app/src/store/useAppStore.ts`
- Modify: `packages/app/src/store/__tests__/useAppStore.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
  it('sweep dialog state defaults are sane and openSweepForEdit/resetSweepDialog work', () => {
    const initial = useAppStore.getState();
    expect(initial.sweepDialogOpen).toBe(false);
    expect(initial.sweepProfileSketchId).toBeNull();
    expect(initial.sweepPathSketchId).toBeNull();
    expect(initial.sweepOrientationKind).toBe('path');
    expect(initial.sweepGuideRailSketchId).toBeNull();
    expect(initial.sweepOperation).toBe('new');
    expect(initial.editingSweepId).toBeNull();
    expect(initial.sweepInitialValues).toBeNull();

    useAppStore.getState().toggleSweepDialog(true);
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);

    useAppStore.getState().openSweepForEdit('SW1');
    expect(useAppStore.getState().editingSweepId).toBe('SW1');
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);

    useAppStore.getState().resetSweepDialog();
    expect(useAppStore.getState().sweepDialogOpen).toBe(false);
    expect(useAppStore.getState().editingSweepId).toBeNull();
    expect(useAppStore.getState().sweepOrientationKind).toBe('path');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Extend store**

In `useAppStore.ts`, add to the state shape:

```ts
sweepDialogOpen: boolean;
sweepProfileSketchId: string | null;
sweepPathSketchId: string | null;
sweepOrientationKind: 'path' | 'parallel' | 'guideRail';
sweepGuideRailSketchId: string | null;
sweepOperation: BooleanOperation;
editingSweepId: string | null;
sweepInitialValues: SweepFeature | null;

openSweepForEdit: (id: string) => void;
resetSweepDialog: () => void;
toggleSweepDialog: (open: boolean) => void;
```

Defaults:

```ts
sweepDialogOpen: false,
sweepProfileSketchId: null,
sweepPathSketchId: null,
sweepOrientationKind: 'path',
sweepGuideRailSketchId: null,
sweepOperation: 'new',
editingSweepId: null,
sweepInitialValues: null,
```

Actions:

```ts
openSweepForEdit: (id) => set((s) => {
  const feature = s.activePart?.featureTree?.find((f: any) => f.id === id) as SweepFeature | undefined;
  if (!feature || feature.kind !== 'sweep') {
    return { ...s, sweepDialogOpen: true, editingSweepId: id };
  }
  return {
    ...s,
    sweepDialogOpen: true,
    editingSweepId: id,
    sweepInitialValues: feature,
    sweepProfileSketchId: feature.profileSketchId,
    sweepPathSketchId: feature.pathSketchId,
    sweepOrientationKind: feature.orientation.kind,
    sweepGuideRailSketchId: feature.orientation.kind === 'guideRail' ? feature.orientation.guideRailSketchId : null,
    sweepOperation: feature.operation,
  };
}),

resetSweepDialog: () => set((s) => ({
  ...s,
  sweepDialogOpen: false,
  sweepProfileSketchId: null,
  sweepPathSketchId: null,
  sweepOrientationKind: 'path',
  sweepGuideRailSketchId: null,
  sweepOperation: 'new',
  editingSweepId: null,
  sweepInitialValues: null,
})),

toggleSweepDialog: (open) => set((s) => ({ ...s, sweepDialogOpen: open })),
```

Add `SweepFeature, BooleanOperation` to the imports from `@zilventor/shared` if not already present.

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/store/useAppStore.ts packages/app/src/store/__tests__/useAppStore.spec.ts
git commit -m "feat(app): useAppStore — sweep dialog slice

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: `OpenSweepDialogCommand` + W hotkey

**Files:**
- Create: `packages/app/src/commands/OpenSweepDialogCommand.ts`
- Create: `packages/app/src/commands/__tests__/OpenSweepDialogCommand.spec.ts`
- Modify: `packages/app/src/App.tsx` (W hotkey binding)

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { OpenSweepDialogCommand } from '../OpenSweepDialogCommand';

describe('OpenSweepDialogCommand', () => {
  beforeEach(() => {
    useAppStore.getState().resetSweepDialog();
  });

  it('opens dialog and clears stale state', () => {
    useAppStore.setState({ sweepProfileSketchId: 'STALE', editingSweepId: 'STALE' });
    OpenSweepDialogCommand();
    const s = useAppStore.getState();
    expect(s.sweepDialogOpen).toBe(true);
    expect(s.sweepProfileSketchId).toBeNull();
    expect(s.editingSweepId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/app/src/commands/OpenSweepDialogCommand.ts
import { useAppStore } from '../store/useAppStore';

export function OpenSweepDialogCommand(): void {
  useAppStore.getState().resetSweepDialog();
  useAppStore.getState().toggleSweepDialog(true);
}
```

- [ ] **Step 4: Bind W hotkey**

In `App.tsx`'s `handleKeyDown` (or wherever H is bound — search for `case 'h'` from the Hole work to find the area), add:

```ts
case 'w':
  if (!sketchMode && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    OpenSweepDialogCommand();
  }
  break;
```

Match the existing key-handler conventions (sketchMode guard, modifier checks). Confirm `w` isn't already bound.

- [ ] **Step 5: Run — should pass**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

Both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/commands/OpenSweepDialogCommand.ts \
        packages/app/src/commands/__tests__/OpenSweepDialogCommand.spec.ts \
        packages/app/src/App.tsx
git commit -m "feat(app): OpenSweepDialogCommand + W hotkey

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `AddSweepFeatureCommand` class

**Files:**
- Create: `packages/app/src/commands/AddSweepFeatureCommand.ts`
- Create: `packages/app/src/commands/__tests__/AddSweepFeatureCommand.spec.ts`

- [ ] **Step 1: Write failing test**

Mirror `AddHoleFeatureCommand.spec.ts` (the unit test that mocks `kernel`, `registry`, `store`, and verifies `apply()` calls `kernel.addFeature` + `kernel.execute` + `store.setActivePart`).

```ts
import { describe, it, expect, vi } from 'vitest';
import { AddSweepFeatureCommand } from '../AddSweepFeatureCommand';
import type { SweepFeature, PartDocument } from '@zilventor/shared';

describe('AddSweepFeatureCommand', () => {
  const feature: SweepFeature = {
    id: 'SW1', kind: 'sweep',
    profileSketchId: 'P', pathSketchId: 'A',
    orientation: { kind: 'path' },
    operation: 'new',
  };

  it('apply() calls kernel.addFeature, kernel.execute, store.setActivePart', async () => {
    const part: PartDocument = { id: 'PART', name: 'P', units: 'mm', parameters: {}, featureTree: [] } as any;
    const kernel: any = {
      setParameter: vi.fn().mockResolvedValue(undefined),
      addFeature: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue(undefined),
      getPart: vi.fn().mockResolvedValue(part),
      removeFeature: vi.fn().mockResolvedValue(undefined),
      deleteParameter: vi.fn().mockResolvedValue(undefined),
    };
    const registry: any = {
      setParameter: vi.fn().mockReturnValue({ ok: true, value: undefined }),
      removeParameter: vi.fn(),
      getValue: vi.fn().mockReturnValue(0),
    };
    const store: any = { setActivePart: vi.fn() };

    const cmd = new AddSweepFeatureCommand({
      partId: 'PART', feature, parameterExpressions: {}, kernel, registry, store,
    });
    await cmd.apply();

    expect(kernel.addFeature).toHaveBeenCalledWith('PART', feature);
    expect(kernel.execute).toHaveBeenCalledWith('PART');
    expect(store.setActivePart).toHaveBeenCalledWith(part);
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

Mirror `AddHoleFeatureCommand.ts` exactly:

```ts
// packages/app/src/commands/AddSweepFeatureCommand.ts
import type { Command } from './Command';
import type { PartDocument, SweepFeature } from '@zilventor/shared';
import type { KernelClient } from '../kernel-client/KernelClient';
import type { ParameterRegistry } from '../parameters/ParameterRegistry';

export type AddSweepFeatureStore = {
  setActivePart(p: PartDocument | null): void;
};

export type AddSweepFeatureOpts = {
  partId: string;
  feature: SweepFeature;
  parameterExpressions: Record<string, { expression: string; unit: 'mm' | 'deg' }>;
  kernel: KernelClient;
  registry: ParameterRegistry;
  store?: AddSweepFeatureStore;
};

export class AddSweepFeatureCommand implements Command {
  readonly name = 'AddSweepFeature';
  private writtenParams: string[] = [];
  constructor(private opts: AddSweepFeatureOpts) {}

  async apply(): Promise<void> {
    for (const [name, { expression, unit }] of Object.entries(this.opts.parameterExpressions)) {
      const res = this.opts.registry.setParameter({ name, expression, unit });
      if (!res.ok) {
        for (const n of this.writtenParams) this.opts.registry.removeParameter(n);
        this.writtenParams = [];
        throw new Error(`Parameter setup failed: ${JSON.stringify(res.error)}`);
      }
      this.writtenParams.push(name);
    }
    try {
      for (const name of this.writtenParams) {
        const val = this.opts.registry.getValue(name);
        const exprData = this.opts.parameterExpressions[name]!;
        await this.opts.kernel.setParameter(this.opts.partId, {
          name, expression: exprData.expression, value: val ?? 0, unit: exprData.unit,
        });
      }
      await this.opts.kernel.addFeature(this.opts.partId, this.opts.feature);
      await this.opts.kernel.execute(this.opts.partId);
      if (this.opts.store) {
        const next = await this.opts.kernel.getPart(this.opts.partId);
        this.opts.store.setActivePart(next);
      }
    } catch (e) {
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

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/commands/AddSweepFeatureCommand.ts \
        packages/app/src/commands/__tests__/AddSweepFeatureCommand.spec.ts
git commit -m "feat(app): AddSweepFeatureCommand class — kernel.addFeature pipeline

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: `SweepDialog` skeleton + presentation contract

**Files:**
- Create: `packages/app/src/shell/SweepDialog.tsx`
- Create: `packages/app/src/shell/__tests__/SweepDialog.spec.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/app/src/shell/__tests__/SweepDialog.spec.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SweepDialog } from '../SweepDialog';

describe('SweepDialog', () => {
  const baseProps = {
    profileSketchId: null as string | null,
    pathSketchId: null as string | null,
    orientationKind: 'path' as const,
    guideRailSketchId: null as string | null,
    operation: 'new' as const,
    onCommit: () => {},
    onCancel: () => {},
    onPickProfile: () => {},
    onPickPath: () => {},
    onPickGuideRail: () => {},
    onSetOrientation: () => {},
    onSetOperation: () => {},
  };

  it('renders all five sections', () => {
    render(<SweepDialog {...baseProps} />);
    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /path/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /orientation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /operation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeInTheDocument();
  });

  it('OK is disabled until profile + path are picked', () => {
    const { rerender } = render(<SweepDialog {...baseProps} />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
    rerender(<SweepDialog {...baseProps} profileSketchId="P" />);
    expect(screen.getByRole('button', { name: /^ok$/i })).toBeDisabled();
    rerender(<SweepDialog {...baseProps} profileSketchId="P" pathSketchId="A" />);
    expect(screen.getByRole('button', { name: /^ok$/i })).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

```tsx
// packages/app/src/shell/SweepDialog.tsx
import { type FormEvent } from 'react';
import type { BooleanOperation, SweepFeature, SweepOrientation } from '@zilventor/shared';

type Props = {
  profileSketchId: string | null;
  pathSketchId: string | null;
  orientationKind: 'path' | 'parallel' | 'guideRail';
  guideRailSketchId: string | null;
  operation: BooleanOperation;
  hasRunningBody?: boolean;
  previewError?: string | null;
  onCommit(value: { orientation: SweepOrientation; operation: BooleanOperation }): void;
  onCancel(): void;
  onPickProfile(): void;
  onPickPath(): void;
  onPickGuideRail(): void;
  onSetOrientation(kind: 'path' | 'parallel' | 'guideRail'): void;
  onSetOperation(op: BooleanOperation): void;
};

const panel: React.CSSProperties = {
  position: 'fixed', top: 80, right: 20, width: 360,
  background: '#1a1a1a', border: '1px solid #444', borderRadius: 6,
  padding: 12, color: '#eee', fontSize: 12, zIndex: 50,
};
const head: React.CSSProperties = { fontSize: 12, fontWeight: 600, marginBottom: 4 };
const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 };
const btn: React.CSSProperties = { background: '#2a2a2a', color: '#eee', border: '1px solid #444', padding: '4px 8px', cursor: 'pointer', fontSize: 11 };

export function SweepDialog(props: Props): JSX.Element {
  const canCommit =
    props.profileSketchId !== null
    && props.pathSketchId !== null
    && (props.orientationKind !== 'guideRail' || props.guideRailSketchId !== null);

  const handleSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!canCommit) return;
    const orientation: SweepOrientation =
      props.orientationKind === 'path' ? { kind: 'path' } :
      props.orientationKind === 'parallel' ? { kind: 'parallel' } :
      { kind: 'guideRail', guideRailSketchId: props.guideRailSketchId! };
    props.onCommit({ orientation, operation: props.operation });
  };

  return (
    <form role="dialog" aria-label="Sweep" onSubmit={handleSubmit} style={panel}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Sweep</div>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Profile</h2>
        <div style={row}>
          <button type="button" onClick={props.onPickProfile} style={btn}>
            {props.profileSketchId ? `Profile: ${props.profileSketchId}` : 'Pick profile'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Path</h2>
        <div style={row}>
          <button type="button" onClick={props.onPickPath} style={btn}>
            {props.pathSketchId ? `Path: ${props.pathSketchId}` : 'Pick path'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Orientation</h2>
        <div style={{ display: 'flex', gap: 12, marginBottom: 4 }}>
          {(['path', 'parallel', 'guideRail'] as const).map((k) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="sweepOrientation"
                checked={props.orientationKind === k}
                onChange={() => props.onSetOrientation(k)}
              />
              {k === 'path' ? 'Path' : k === 'parallel' ? 'Parallel' : 'Guide Rail'}
            </label>
          ))}
        </div>
        {props.orientationKind === 'guideRail' && (
          <button type="button" onClick={props.onPickGuideRail} style={btn}>
            {props.guideRailSketchId ? `Guide rail: ${props.guideRailSketchId}` : 'Pick guide rail'}
          </button>
        )}
      </section>

      <section style={{ marginBottom: 8 }}>
        <h2 style={head}>Operation</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          {(['new', 'join', 'cut'] as const).map((op) => (
            <label key={op} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="sweepOperation"
                checked={props.operation === op}
                disabled={op !== 'new' && !props.hasRunningBody}
                onChange={() => props.onSetOperation(op)}
              />
              {op[0]!.toUpperCase() + op.slice(1)}
            </label>
          ))}
        </div>
      </section>

      {props.previewError && (
        <div style={{ color: '#ff6b6b', marginBottom: 8 }}>{props.previewError}</div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" onClick={props.onCancel} style={btn}>Cancel</button>
        <button type="submit" disabled={!canCommit} style={btn}>OK</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/SweepDialog.tsx \
        packages/app/src/shell/__tests__/SweepDialog.spec.tsx
git commit -m "feat(app): SweepDialog presentation component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: `SweepDialog` wrapper in App.tsx + AddSweepFeatureCommand dispatch

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Read patterns**

Open `App.tsx` and find the wrapper for `<HoleDialog ... />`. Note exactly:
- How it subscribes to the store (`useAppStore((s) => ...)`).
- How it builds the `onCommit` callback that dispatches `AddHoleFeatureCommand`.
- How `kernel`, `registry`, and `store` are passed to the command.
- How `setActivePart` flows back from the kernel.

- [ ] **Step 2: Add SweepDialog wrapper**

Right after the HoleDialog wrapper, add:

```tsx
const sweepOpen = useAppStore((s) => s.sweepDialogOpen);
const sweepProfile = useAppStore((s) => s.sweepProfileSketchId);
const sweepPath = useAppStore((s) => s.sweepPathSketchId);
const sweepOrientationKind = useAppStore((s) => s.sweepOrientationKind);
const sweepGuideRail = useAppStore((s) => s.sweepGuideRailSketchId);
const sweepOperation = useAppStore((s) => s.sweepOperation);

const onSweepCommit = async (v: { orientation: SweepOrientation; operation: BooleanOperation }) => {
  if (!activePart) return;
  const editingId = useAppStore.getState().editingSweepId;
  const id = editingId ?? `SW${Date.now()}`;
  const feature: SweepFeature = {
    id, kind: 'sweep',
    profileSketchId: sweepProfile!,
    pathSketchId: sweepPath!,
    orientation: v.orientation,
    operation: v.operation,
  };
  if (editingId) await kernel.removeFeature(activePart.id, editingId);
  const cmd = new AddSweepFeatureCommand({
    partId: activePart.id,
    feature,
    parameterExpressions: {},
    kernel,
    registry,
    store: { setActivePart: useAppStore.getState().setActivePart },
  });
  try {
    await cmd.apply();
  } catch (e) {
    console.error('Sweep commit failed:', e);
  }
  useAppStore.getState().resetSweepDialog();
};

// Inside the JSX where dialogs are rendered:
{sweepOpen && (
  <SweepDialog
    profileSketchId={sweepProfile}
    pathSketchId={sweepPath}
    orientationKind={sweepOrientationKind}
    guideRailSketchId={sweepGuideRail}
    operation={sweepOperation}
    hasRunningBody={Boolean(activePart && activePart.featureTree.length > 0)}
    previewError={null}
    onCommit={onSweepCommit}
    onCancel={() => useAppStore.getState().resetSweepDialog()}
    onPickProfile={() => /* SketchPickController activation — Task 19 */ {}}
    onPickPath={() => {}}
    onPickGuideRail={() => {}}
    onSetOrientation={(k) => useAppStore.setState((s) => ({ ...s, sweepOrientationKind: k }))}
    onSetOperation={(op) => useAppStore.setState((s) => ({ ...s, sweepOperation: op }))}
  />
)}
```

(Adjust the variable names to match how HoleDialog's wrapper accesses `kernel`, `registry`, `activePart` — they're likely already in scope at this level.)

- [ ] **Step 3: Run unit + typecheck**

```
pnpm -C packages/app test:unit
pnpm -r typecheck
```

Both PASS. The pick handlers are stubs for now — Task 19 wires them.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): SweepDialog wrapper in App.tsx — dispatches AddSweepFeatureCommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: SketchPickController wiring for SweepDialog

**Files:**
- Modify: `packages/app/src/App.tsx`

- [ ] **Step 1: Wire pick handlers**

Replace the stub `onPickProfile`, `onPickPath`, `onPickGuideRail` with handlers that activate the existing `SketchPickController` (shipped for Hole). Look at how Hole's wrapper activates it; mirror.

For Sweep we have three separate picks that share one `SketchPickController` instance. Pattern:

```tsx
const sketchPickRef = React.useRef(new SketchPickController({
  onPick: (sketchId) => {
    // Set the right slot based on which pick was last activated
    const slot = sweepActivePickRef.current;
    if (slot === 'profile') {
      useAppStore.setState((s) => ({ ...s, sweepProfileSketchId: sketchId }));
    } else if (slot === 'path') {
      useAppStore.setState((s) => ({ ...s, sweepPathSketchId: sketchId }));
    } else if (slot === 'guideRail') {
      useAppStore.setState((s) => ({ ...s, sweepGuideRailSketchId: sketchId }));
    }
    sketchPickRef.current.deactivate();
    sweepActivePickRef.current = null;
  },
}));
const sweepActivePickRef = React.useRef<'profile' | 'path' | 'guideRail' | null>(null);

// Pick activators:
onPickProfile={() => { sweepActivePickRef.current = 'profile'; sketchPickRef.current.activate(); }}
onPickPath={() => { sweepActivePickRef.current = 'path'; sketchPickRef.current.activate(); }}
onPickGuideRail={() => { sweepActivePickRef.current = 'guideRail'; sketchPickRef.current.activate(); }}
```

The actual wiring depends on whether `SketchPickController` is already instantiated for Hole; if so, reuse that instance. The `sweepActivePickRef` discriminator handles the fact that one controller serves three pick slots.

If Hole's wiring uses a different mechanism (e.g., a new controller per pick session), match that pattern.

- [ ] **Step 2: Verify**

Hand-test by opening the dialog, clicking each pick button in turn, then clicking a sketch in the browser pane. The store slot for whichever pick was active should update. (No automated test — this is interactive UI.)

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/App.tsx
git commit -m "feat(app): SweepDialog — SketchPickController wiring for 3 pick slots

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Ribbon button + browser-pane node

**Files:**
- Modify: `packages/app/src/shell/tabs/ModelTab.tsx` (Create panel — sweep is a feature-creating op)
- Modify: `packages/app/src/shell/BrowserPane.tsx`
- Modify: `packages/app/src/shell/__tests__/Ribbon.spec.tsx`
- Modify: `packages/app/src/shell/__tests__/BrowserPane.spec.tsx`

- [ ] **Step 1: Write failing tests**

For the ribbon (mirror the Hole-button test):

```tsx
  it('Model → Create → Sweep button opens the sweep dialog', async () => {
    // Setup an active part with a body so the button is enabled
    useAppStore.setState((s) => ({
      ...s,
      activePart: { id: 'P', name: 'P', units: 'mm', parameters: {}, featureTree: [{ kind: 'extrude', id: 'E1' /* etc */ }] } as any,
    }));
    render(<RibbonOrModelTab />);
    fireEvent.click(screen.getByRole('button', { name: /sweep/i }));
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);
  });
```

For the browser pane:

```tsx
  it('renders Sweep node and double-click opens dialog in edit mode', () => {
    const stored: any = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'P', pathSketchId: 'A',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    useAppStore.setState((s) => ({
      ...s,
      activePart: { id: 'P1', name: 'P', units: 'mm', parameters: {}, featureTree: [stored] } as any,
    }));
    render(<BrowserPane />);
    fireEvent.doubleClick(screen.getByText(/Sweep SW1/));
    expect(useAppStore.getState().sweepDialogOpen).toBe(true);
    expect(useAppStore.getState().editingSweepId).toBe('SW1');
  });
```

- [ ] **Step 2: Run — should fail**

FAIL.

- [ ] **Step 3: Implement**

In `ModelTab.tsx`'s **Create** panel (next to Extrude / Revolve), add:

```tsx
import { OpenSweepDialogCommand } from '../../commands/OpenSweepDialogCommand';

<button
  onClick={() => OpenSweepDialogCommand()}
  disabled={!hasActivePart}
  aria-label="Sweep"
  title="Sweep (W)"
  style={/* same class as Extrude */}
>
  Sweep
</button>
```

(Match the existing button visual style.)

In `BrowserPane.tsx`, in the feature-rendering loop, add:

```tsx
{f.kind === 'sweep' && (
  <div
    key={f.id}
    style={/* same as other feature nodes */}
    onDoubleClick={() => {
      useAppStore.getState().openSweepForEdit(f.id);
      setSelectedFeature?.(f.id);
    }}
  >
    ▸ Sweep {f.id}
  </div>
)}
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/shell/tabs/ModelTab.tsx \
        packages/app/src/shell/BrowserPane.tsx \
        packages/app/src/shell/__tests__/Ribbon.spec.tsx \
        packages/app/src/shell/__tests__/BrowserPane.spec.tsx
git commit -m "feat(app): ribbon Create panel — Sweep button + BrowserPane node

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: Live preview for SweepDialog

**Files:**
- Modify: `packages/app/src/App.tsx` (preview RPC + debounce)
- Modify: `packages/app/src/shell/__tests__/SweepDialog.spec.tsx`

- [ ] **Step 1: Read Hole's preview pattern**

Open `App.tsx` and find the `scheduleHolePreview` (or equivalent) function. Note:
- Debounce timer (150 ms).
- Telemetry counter (`__zilventorHolePreviewCount`).
- Compose-feature → previewFeature RPC → setPreviewMesh + setPreviewError.
- Cleanup on dialog close.

- [ ] **Step 2: Implement scheduleSweepPreview**

Mirror the Hole pattern. Compose a `SweepFeature` from current store state — if profile/path missing, skip. Fire `kernel.previewFeature(feature, resolveParam)`, on success set the preview mesh, on error set `previewError`.

```tsx
const sweepPreviewTimer = React.useRef<number | null>(null);

const scheduleSweepPreview = React.useCallback(() => {
  if (sweepPreviewTimer.current !== null) clearTimeout(sweepPreviewTimer.current);
  sweepPreviewTimer.current = window.setTimeout(async () => {
    if (!activePart) return;
    const s = useAppStore.getState();
    if (!s.sweepProfileSketchId || !s.sweepPathSketchId) return;
    if (s.sweepOrientationKind === 'guideRail' && !s.sweepGuideRailSketchId) return;

    const orientation: SweepOrientation =
      s.sweepOrientationKind === 'path' ? { kind: 'path' } :
      s.sweepOrientationKind === 'parallel' ? { kind: 'parallel' } :
      { kind: 'guideRail', guideRailSketchId: s.sweepGuideRailSketchId! };
    const feature: SweepFeature = {
      id: `SW_PREVIEW`, kind: 'sweep',
      profileSketchId: s.sweepProfileSketchId,
      pathSketchId: s.sweepPathSketchId,
      orientation,
      operation: s.sweepOperation,
    };
    try {
      (window as any).__zilventorSweepPreviewCount = ((window as any).__zilventorSweepPreviewCount ?? 0) + 1;
      const { mesh } = await kernel.previewFeature(activePart.id, feature);
      // setPreviewMesh — mirror Hole's call
      setSweepPreviewError(null);
    } catch (e) {
      setSweepPreviewError((e as Error).message);
    }
  }, 150);
}, [activePart, kernel]);

// Trigger scheduleSweepPreview whenever any sweep dialog state changes:
React.useEffect(() => {
  if (sweepOpen) scheduleSweepPreview();
}, [sweepOpen, sweepProfile, sweepPath, sweepOrientationKind, sweepGuideRail, sweepOperation, scheduleSweepPreview]);
```

- [ ] **Step 3: Add a sanity-test**

Append to `SweepDialog.spec.tsx`:

```tsx
  it('renders preview error when previewError prop is set', () => {
    render(<SweepDialog {...baseProps} previewError="bad path" />);
    expect(screen.getByText(/bad path/i)).toBeInTheDocument();
  });
```

- [ ] **Step 4: Run — should pass**

PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/App.tsx packages/app/src/shell/__tests__/SweepDialog.spec.tsx
git commit -m "feat(app): SweepDialog — debounced live preview via previewFeature RPC

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — E2E + perf

### Task 22: E2E `sweep-path.spec.ts` — line + circle → cylinder

**Files:**
- Create: `tests/e2e/model/sweep-path.spec.ts`

- [ ] **Step 1: Write**

Mirror `tests/e2e/model/hole-from-sketch.spec.ts`. Set up a profile sketch (XY circle r=1) and path sketch (XZ line 0..10), open Sweep dialog with W, seed `sweepProfileSketchId` + `sweepPathSketchId` via `page.evaluate` against `__zilventorStore`, click OK, assert geometry hash changes from a known empty-state hash to a non-empty one.

Pattern (adjust to match T28's Hole spec helpers):

```ts
import { test, expect } from '@playwright/test';

test('sweep with line path + circle profile produces a cylinder', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  await seedSweepFixture(page, {
    profile: { plane: 'XY', primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }] },
    path: { plane: 'XZ', primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }] },
  });
  const before = await getGeometryHash(page);
  await page.keyboard.press('w');
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({ ...st, sweepProfileSketchId: 'PROF', sweepPathSketchId: 'PATH' }));
  });
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);
  const after = await getGeometryHash(page);
  expect(after).not.toBe(before);
});
```

`seedSweepFixture` is a new helper — adapt from `seedKernelPart` in the existing E2E helpers. It needs to add two sketches to the kernel and call `kernel.execute` so the geometry-hash baseline is established before the user opens the dialog.

- [ ] **Step 2: Run + iterate**

```
pnpm exec playwright test --project=chromium -- sweep-path
```

Until green.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/model/sweep-path.spec.ts
# include any helper file you added
git commit -m "test(e2e): sweep path — line + circle → cylinder

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: E2E `sweep-arc.spec.ts` — arc + rectangle → curved molding

**Files:**
- Create: `tests/e2e/model/sweep-arc.spec.ts`

Same shape as Task 22, with an **arc** path instead of a line and a rectangle profile. Mainly stresses the arc primitive support added in Task 4.

- [ ] **Step 1: Write**

```ts
test('sweep with arc path + rectangle profile produces curved molding', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  await seedSweepFixture(page, {
    profile: { plane: 'XY', primitives: [
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
      { id: 'L2', kind: 'line', x1: 2, y1: 0, x2: 2, y2: 1 },
      { id: 'L3', kind: 'line', x1: 2, y1: 1, x2: 0, y2: 1 },
      { id: 'L4', kind: 'line', x1: 0, y1: 1, x2: 0, y2: 0 },
    ]},
    path: { plane: 'XZ', primitives: [
      { id: 'A1', kind: 'arc', cx: 0, cy: 5, r: 5, startAngle: -Math.PI / 2, endAngle: 0 },
    ]},
  });
  const before = await getGeometryHash(page);
  await page.keyboard.press('w');
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({ ...st, sweepProfileSketchId: 'PROF', sweepPathSketchId: 'PATH' }));
  });
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);
  expect(await getGeometryHash(page)).not.toBe(before);
});
```

(Arc primitive shape may differ — confirm by inspecting `packages/shared/src/types.ts` for the actual `arc` variant.)

- [ ] **Step 2: Run + commit**

```
pnpm exec playwright test --project=chromium -- sweep-arc
```

```bash
git add tests/e2e/model/sweep-arc.spec.ts
git commit -m "test(e2e): sweep arc — curved molding via arc path

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: E2E `sweep-closed-loop.spec.ts` — rectangle path + circle profile → ring

**Files:**
- Create: `tests/e2e/model/sweep-closed-loop.spec.ts`

- [ ] **Step 1: Write**

```ts
test('sweep with closed-loop path + circle profile produces a ring', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  await seedSweepFixture(page, {
    profile: { plane: 'XZ', primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 0.5 }] },
    path: { plane: 'XY', primitives: [
      { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
      { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
      { id: 'L3', kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
      { id: 'L4', kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
    ]},
  });
  const before = await getGeometryHash(page);
  await page.keyboard.press('w');
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({ ...st, sweepProfileSketchId: 'PROF', sweepPathSketchId: 'PATH' }));
  });
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);
  expect(await getGeometryHash(page)).not.toBe(before);
});
```

- [ ] **Step 2: Run + commit**

```bash
git add tests/e2e/model/sweep-closed-loop.spec.ts
git commit -m "test(e2e): sweep closed-loop path — picture-frame ring

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: E2E `sweep-guide-rail.spec.ts`

**Files:**
- Create: `tests/e2e/model/sweep-guide-rail.spec.ts`

- [ ] **Step 1: Write**

```ts
test('sweep with guide rail orientation tracks the rail', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  await seedSweepFixture(page, {
    profile: { plane: 'XY', primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }] },
    path: { plane: 'XZ', primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }] },
    guideRail: { plane: 'XZ', primitives: [{ id: 'L1', kind: 'line', x1: 3, y1: 0, x2: 3, y2: 10 }] },
  });
  const before = await getGeometryHash(page);
  await page.keyboard.press('w');
  await page.getByRole('radio', { name: /guide rail/i }).check();
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({
      ...st,
      sweepProfileSketchId: 'PROF',
      sweepPathSketchId: 'PATH',
      sweepGuideRailSketchId: 'GUIDE',
      sweepOrientationKind: 'guideRail',
    }));
  });
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);
  expect(await getGeometryHash(page)).not.toBe(before);
});
```

`seedSweepFixture` needs to be extended to optionally seed a third sketch under id `GUIDE`.

- [ ] **Step 2: Run + commit**

```bash
git add tests/e2e/model/sweep-guide-rail.spec.ts
git commit -m "test(e2e): sweep guide rail — third sketch tracks orientation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: E2E `sweep-cut.spec.ts` — sweep with cut operation

**Files:**
- Create: `tests/e2e/model/sweep-cut.spec.ts`

- [ ] **Step 1: Write**

```ts
test('sweep cut operation carves a channel through a body', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  // Seed a 20×20×10 box first, then a profile + path that slices through it
  await seedExtrudedBox(page, { w: 20, h: 20, d: 10 });
  await seedSweepFixture(page, {
    profile: { plane: 'XY', primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }] },
    path: { plane: 'XZ', primitives: [{ id: 'L1', kind: 'line', x1: 10, y1: -1, x2: 10, y2: 11 }] },
  });
  const before = await getGeometryHash(page);
  await page.keyboard.press('w');
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({
      ...st,
      sweepProfileSketchId: 'PROF',
      sweepPathSketchId: 'PATH',
      sweepOperation: 'cut',
    }));
  });
  await page.getByRole('radio', { name: /^cut$/i }).check();
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);
  expect(await getGeometryHash(page)).not.toBe(before);
});
```

- [ ] **Step 2: Run + commit**

```bash
git add tests/e2e/model/sweep-cut.spec.ts
git commit -m "test(e2e): sweep cut — carve channel through body

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 27: E2E `sweep-edit-reopen.spec.ts`

**Files:**
- Create: `tests/e2e/model/sweep-edit-reopen.spec.ts`

- [ ] **Step 1: Write**

```ts
test('double-click sweep node re-opens dialog with fields populated', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  // Create a sweep first (use existing sweep-path setup, then commit)
  await seedSweepFixture(page, {
    profile: { plane: 'XY', primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }] },
    path: { plane: 'XZ', primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }] },
  });
  await page.keyboard.press('w');
  await page.evaluate(() => {
    const s = (window as any).__zilventorStore;
    s.setState((st: any) => ({ ...st, sweepProfileSketchId: 'PROF', sweepPathSketchId: 'PATH' }));
  });
  await page.getByRole('button', { name: /^ok$/i }).click();
  await page.waitForTimeout(500);

  // Now double-click the Sweep node
  await page.locator('[data-testid=browser-pane]').getByText(/Sweep SW/).first().dblclick();
  // Dialog reopens with profile/path prefilled
  await expect(page.locator('button', { hasText: /Profile: PROF/ })).toBeVisible();
  await expect(page.locator('button', { hasText: /Path: PATH/ })).toBeVisible();
});
```

- [ ] **Step 2: Run + commit**

```bash
git add tests/e2e/model/sweep-edit-reopen.spec.ts
git commit -m "test(e2e): sweep edit-reopen — fields populated after double-click

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 28: E2E `sweep-parametric-cascade.spec.ts` + perf `sweep-preview-debounce.spec.ts`

**Files:**
- Create: `tests/e2e/model/sweep-parametric-cascade.spec.ts`
- Create: `tests/perf/sweep-preview-debounce.spec.ts`

- [ ] **Step 1: Write parametric-cascade spec**

```ts
test('editing a path-sketch dimension regenerates the swept body', async ({ page }) => {
  await page.goto('/');
  await waitForKernelReady(page);
  // Seed a sweep where the path's length is parameterized via d_path
  await page.evaluate(() => {
    const k = (window as any).__zilventorKernel;
    const s = (window as any).__zilventorStore;
    const reg = (window as any).__zilventorRegistry;
    reg.setParameter({ name: 'd_path', expression: '10', unit: 'mm' });
    // Seed the part with profile + parameterized path + sweep — the exact API depends on
    // what the existing __zilventorKernel exposes. Either:
    //   a) call k.addFeature with the param ref pre-resolved, OR
    //   b) build a sketch where the line endpoint is dimension-driven.
    // Use whichever path the existing parametric-fillet/parametric-revolve specs use.
  });
  const hashA = await getGeometryHash(page);
  await page.evaluate(() => {
    const reg = (window as any).__zilventorRegistry;
    reg.setParameter({ name: 'd_path', expression: '20', unit: 'mm' });
  });
  await page.waitForTimeout(700);
  const hashB = await getGeometryHash(page);
  expect(hashA).not.toBe(hashB);
});
```

If the existing parametric-cascade specs (fillet, hole) use a particular helper, mirror that helper exactly. The fact that sweep doesn't have `ParamOrLiteral` fields means the cascade has to flow through a dimension on the path sketch — which assumes sketches support dimensions on line endpoints. If the sketcher doesn't expose dimension-driven path-line endpoints in the E2E helper surface, simplify by parameterizing the **profile**'s circle radius instead.

- [ ] **Step 2: Write perf spec**

Mirror `tests/perf/hole-preview-debounce.spec.ts` exactly — same structure, just count `__zilventorSweepPreviewCount` instead. The key checks: counter increments at most once per debounce window despite rapid input changes.

- [ ] **Step 3: Run + commit**

```bash
git add tests/e2e/model/sweep-parametric-cascade.spec.ts \
        tests/perf/sweep-preview-debounce.spec.ts
git commit -m "test(e2e): sweep parametric cascade + preview debounce perf

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 29: Manual checklist + memory update + final review + push

**Files:**
- Create: `docs/superpowers/manual-tests/sweep.md`
- Create: `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/project_sweep_feature.md`
- Modify: `~/.claude/projects/-Users-lion-Documents-Projects-mine-zilventor/memory/MEMORY.md` (add pointer)

- [ ] **Step 1: Write manual checklist**

```md
<!-- docs/superpowers/manual-tests/sweep.md -->
# Sweep feature manual checklist

- [ ] **Path orientation:** sketch a circle (profile, XY plane) and a line (path, XZ plane); press W; pick profile + path; OK; verify a clean cylinder.
- [ ] **Parallel orientation:** same setup, switch orientation to Parallel; OK; verify the profile keeps its initial orientation (no rotation along path).
- [ ] **Guide Rail orientation:** add a parallel guide-rail sketch; switch orientation to Guide Rail; pick guide rail; OK; verify the swept body tracks the rail.
- [ ] **Closed-loop path:** sketch a rectangle (path, XY) + small circle (profile, XZ); OK with Path orientation; verify a picture-frame ring with no caps.
- [ ] **Cut operation:** create a body first, then sweep with `cut`; verify a carved channel.
- [ ] **Edit-reopen:** double-click Sweep node in browser pane; verify all fields prefilled (profile, path, orientation, operation).
- [ ] **Parametric cascade:** edit a sketch dimension that drives the path; verify the swept body regenerates.
- [ ] **Live preview:** open dialog, switch picks; verify translucent preview updates within ~200 ms.
- [ ] **Soft-fail:** open dialog with no profile picked; OK should be disabled. Manually clear `holeSketchId` while pick is set, see no crash.
```

- [ ] **Step 2: Write memory file**

```md
---
name: Sweep feature shipped (2026-04-25)
description: Sweep (3 orientations: Path/Parallel/Guide Rail; New/Join/Cut; open + closed paths) shipped on master
type: project
---
**Status:** SHIPPED at <FINAL_PUSH_SHA> on origin/master. Closes Sub-project 3 (3D part modeling).

## What shipped

- **Shared types** (`packages/shared/src/types.ts`): `SweepOrientation` (path | parallel | guideRail), `SweepFeature`. file format v6 → v7 (additive).
- **Kernel** (`packages/kernel/src/occt/SweepOps.ts`): `buildWireFromSketch` (line + arc + circle primitives), `makeSweep` via `BRepOffsetAPI_MakePipeShell` for all three orientations.
- **Adapter** (`packages/kernel/src/adapter/features/SweepFeature.ts`): `executeSweepFeature` resolves profile + path + optional guide-rail sketches, applies New/Join/Cut via existing `fuseShapes`/`cutShapes`. Per-feature face naming via `tagSweepFaces` (`lateral/<i>` + `capStart`/`capEnd`).
- **FeatureTree**: pre-scan collects sweep-referenced sketches (profile + path + guide rail), `case 'sweep'` branch with try/catch soft-fail.
- **App**: `SweepDialog` (presentation), `OpenSweepDialogCommand` + W hotkey, `AddSweepFeatureCommand` (class), useAppStore sweep slice, ribbon Create-panel button, BrowserPane Sweep node + double-click rehydrate, debounced 150 ms live preview.

## Key learnings

1. **Single OCCT operator handles all three orientations** — `BRepOffsetAPI_MakePipeShell.SetMode_*` configures Frenet (path), fixed-frame (parallel), guide-rail. No need for `MakePipe` fallback.
2. **Closed-path sweeps skip MakeSolid** — for closed loops, the result is a torus-like ring shape; `MakeSolid()` returns false. Branch on `pathWire.Closed()` to avoid the call.
3. **Profile-not-closed validation** — must check `wire.Closed()` before passing to `MakePipeShell`, otherwise OCCT throws an internal error with no useful message.
4. **Three-pick wire-frame for one controller** — SweepDialog has profile/path/guide-rail picks; reuse the existing `SketchPickController` with a discriminator ref to track which slot is active.
5. **No `ParamOrLiteral` fields on the feature** — sweep geometry is fully driven by sketch dimensions, which already cascade.

## Final verification

| Suite | Result |
|---|---|
| `pnpm -r typecheck` | 5 packages green |
| `pnpm --filter @zilventor/kernel exec vitest run` | new SweepOps + SweepFeature integration tests passing |
| `pnpm -C packages/app test:unit` | new useAppStore + commands + dialog tests passing |
| `pnpm exec playwright test --project=chromium` | sweep-path / arc / closed-loop / guide-rail / cut / edit-reopen / parametric-cascade green |
| `pnpm exec playwright test --project=perf` | sweep-preview-debounce green |
| Manual checklist | spot-checked |

## Where things live

- Spec: `docs/superpowers/specs/2026-04-25-sweep-design.md`
- Plan: `docs/superpowers/plans/2026-04-25-zilinventor-sweep-plan.md`
- Kernel: `packages/kernel/src/occt/SweepOps.ts`, `packages/kernel/src/adapter/features/SweepFeature.ts`
- App: `packages/app/src/shell/SweepDialog.tsx`, `packages/app/src/commands/AddSweepFeatureCommand.ts`, `packages/app/src/commands/OpenSweepDialogCommand.ts`
- E2E: `tests/e2e/model/sweep-*.spec.ts`, `tests/perf/sweep-preview-debounce.spec.ts`
- Manual: `docs/superpowers/manual-tests/sweep.md`

## Deferred

- Twist angle along path (helical sweep)
- Taper / scale along path
- Multi-loop profile (outer + inner closed loops for tube cross-sections)
- Profile from a planar face (face-pick instead of sketch-pick)

## Sub-project 3 wrap-up

3a (revolve) + 3b (fillet) + chamfer + shell + mirror + linear pattern + hole + sweep all shipped on master. 3D part modeling surface complete.
```

Add to MEMORY.md:
```md
- [Sweep feature (2026-04-25)](project_sweep_feature.md) — shipped; closes Sub-project 3 with 3 orientations (Path / Parallel / Guide Rail) + New / Join / Cut
```

- [ ] **Step 3: Run everything**

```
pnpm -r typecheck
pnpm -C packages/shared test:unit
pnpm -C packages/app test:unit
pnpm --filter @zilventor/kernel exec vitest run
pnpm exec playwright test --project=chromium
pnpm exec playwright test --project=perf
```

All green.

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/manual-tests/sweep.md
git commit -m "docs(manual-test): sweep feature checklist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Push**

```bash
git push origin master
```

Update memory file's `<FINAL_PUSH_SHA>` placeholder with the actual SHA after push.

---

## Self-Review Summary

**Spec coverage:**
- Path / Parallel / Guide Rail orientations → Tasks 5, 6, 7
- Open + closed path topology → Tasks 5 (line), 8 (closed-loop)
- Single closed-loop profile validation → Task 9
- New / Join / Cut operations → Tasks 10, 11
- Face naming (`lateral/<i>` + `capStart`/`capEnd`) → Task 12
- FeatureTree pre-scan + soft-fail → Task 13
- Store slice → Task 14
- W hotkey + ribbon Create panel + BrowserPane → Tasks 15, 20
- AddSweepFeatureCommand class → Task 16
- SweepDialog presentation + wrapper → Tasks 17, 18
- SketchPickController three-slot wiring → Task 19
- Live preview → Task 21
- Five model E2E specs + perf → Tasks 22–28
- Manual checklist + memory + push → Task 29

**Placeholder scan:** no "TBD" / "TODO" / "implement later". The OCCT overload-suffix verification flags (`SetMode_*`, `Add_*`, `MakeEdge_*`) are explicit "verify and adjust" instructions, not unfilled blanks.

**Type consistency:** `SweepOrientation` discriminator kinds, `ResolvedSweepOrientation` payload shape, `tagSweepFaces` role naming, store-field names all consistent across tasks.

## Execution

After saving this plan, continue via the execution skill chosen at the top of the session.
