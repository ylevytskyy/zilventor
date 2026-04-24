import { describe, it, expect, beforeAll } from 'vitest';
import type {
  BooleanOperation,
  FilletFeature,
  PartDocument
} from '@zilventor/shared';
import { canonicalEdgeName } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from '../../occt/occtLoader';
import { executeTree } from '../FeatureTree';
import { computeBoundingBox, disposeShape, type OcctShape } from '../../occt/SolidOps';
import { namedFace } from '../../occt/FaceNaming';

/** Test-local volume helper: mirrors the private shapeVolume in BooleanOps.ts. */
function computeVolume(oc: OcctInstance, shape: OcctShape): number {
  const props = new oc.GProp_GProps_1();
  try {
    oc.BRepGProp.VolumeProperties_1(shape.handle as never, props, true as never, false as never, false as never);
    return props.Mass();
  } finally {
    props.delete();
  }
}

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

// ---- Test helpers ----------------------------------------------------------

/** Build a PartDocument with one rectangle sketch (id `s${n}`) + one extrude
 *  (id `e${n}`) referencing it. Kept small so callers can chain multiple.
 *
 *  Extended in T8 to also support revolve features + a "rectAxisSketch" that
 *  contains a rectangle profile and an in-sketch axis line (the shape a
 *  revolve needs to consume). */
function makePart(opts: {
  parameters?: Record<string, { name: string; expression: string; value: number; unit: 'mm' | 'deg' }>;
  features: Array<
    | { kind: 'rectSketch'; id: string; x: number; y: number; w: number; h: number }
    | {
        kind: 'rectAxisSketch';
        id: string;
        // Rectangle profile
        x: number; y: number; w: number; h: number;
        // Axis line endpoints
        ax1: number; ay1: number; ax2: number; ay2: number;
      }
    | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; operation: BooleanOperation }
    | {
        kind: 'revolve';
        id: string;
        sketchRef: string;
        axisPrimitiveId: string;
        angleParam: string;
        operation: BooleanOperation;
      }
    // A fillet case forwards a pre-built FilletFeature object — this keeps
    // the helper thin for callers that already have canonicalEdgeName/
    // namedFace wiring in-hand.
    | { kind: 'fillet'; feature: FilletFeature }
  >;
}): PartDocument {
  const parameters = opts.parameters ?? {
    d1: { name: 'd1', expression: '10', value: 10, unit: 'mm' as const }
  };
  const featureTree = opts.features.map((f) => {
    if (f.kind === 'rectSketch') {
      return {
        kind: 'sketch' as const,
        id: f.id,
        plane: 'XY' as const,
        primitives: [{ id: `${f.id}-r`, kind: 'rectangle' as const, x: f.x, y: f.y, w: f.w, h: f.h }],
        constraints: []
      };
    }
    if (f.kind === 'rectAxisSketch') {
      return {
        kind: 'sketch' as const,
        id: f.id,
        plane: 'XY' as const,
        primitives: [
          { id: `${f.id}-r`, kind: 'rectangle' as const, x: f.x, y: f.y, w: f.w, h: f.h },
          { id: `${f.id}-axis`, kind: 'line' as const, x1: f.ax1, y1: f.ay1, x2: f.ax2, y2: f.ay2 }
        ],
        constraints: []
      };
    }
    if (f.kind === 'revolve') {
      return {
        kind: 'revolve' as const,
        id: f.id,
        sketchRef: f.sketchRef,
        axisPrimitiveId: f.axisPrimitiveId,
        angleParam: f.angleParam,
        direction: 'normal' as const,
        operation: f.operation
      };
    }
    if (f.kind === 'fillet') {
      return f.feature;
    }
    return {
      kind: 'extrude' as const,
      id: f.id,
      sketchRef: f.sketchRef,
      distanceParam: f.distanceParam,
      direction: 'forward' as const,
      operation: f.operation
    };
  });
  return {
    id: 'p1',
    name: 'Part1',
    units: 'mm',
    parameters,
    featureTree
  } as PartDocument;
}

// ---- Existing tests --------------------------------------------------------

describe('FeatureTree.executeTree', () => {
  it('runs sketch → extrude and returns the tessellated mesh', async () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const,
      parameters: { d1: { name: 'd1', expression: '50', value: 50, unit: 'mm' as const } },
      featureTree: [
        { kind: 'sketch' as const, id: 's1', plane: 'XY' as const, primitives: [{ id: 'p1', kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 200 }], constraints: [] },
        { kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const, operation: 'new' as const }
      ]
    };
    const res = await executeTree(occt, part);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mesh.boundingBox[3]).toBeCloseTo(100, 5);
    expect(res.value.mesh.boundingBox[4]).toBeCloseTo(200, 5);
    expect(res.value.mesh.boundingBox[5]).toBeCloseTo(50, 5);
    expect(res.value.mesh.indices.length % 3).toBe(0);
    expect(res.value.mesh.indices.length).toBeGreaterThan(0);
    disposeShape(res.value.finalSolid);
  });

  it('reports degenerateSketch when feature tree produces no solid', async () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const,
      parameters: {},
      featureTree: [] as unknown[]
    };
    const res = await executeTree(occt, part as unknown as Parameters<typeof executeTree>[1]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('degenerateSketch');
  });

  it('reports featureNotFound when extrude references a missing sketch', async () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const,
      parameters: { d1: { name: 'd1', expression: '50', value: 50, unit: 'mm' as const } },
      featureTree: [
        { kind: 'extrude' as const, id: 'e1', sketchRef: 'missing', distanceParam: 'd1', direction: 'forward' as const, operation: 'new' as const }
      ]
    };
    const res = await executeTree(occt, part);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('featureNotFound');
  });
});

// ---- New tests: single-body accumulator ------------------------------------

describe('FeatureTree single-body execution', () => {
  it('extrude New produces the running body', async () => {
    const part = makePart({
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(occt, r.value.finalSolid);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1); // rectangle x-extent
      disposeShape(r.value.finalSolid);
    }
  });

  it('extrude New + extrude Join fuses into a single solid', async () => {
    // First extrude: 10x10x10 box at origin. Second extrude (Join): 10x10x10 at x=5.
    // Fused x-extent: [0, 15] → 15.
    const part = makePart({
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' },
        { kind: 'rectSketch', id: 's2', x: 5, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e2', sketchRef: 's2', distanceParam: 'd1', operation: 'join' }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(occt, r.value.finalSolid);
      expect(bbox[3] - bbox[0]).toBeCloseTo(15, 1); // fused extent
      disposeShape(r.value.finalSolid);
    }
  });

  it('first-feature Join acts as seed (becomes the running body)', async () => {
    // Chose option 1 from the plan: when there's no running body, Join is
    // treated as seed (matches the plan's applyBooleanOp code). Unambiguous
    // error behavior is covered by the Cut-with-no-running case below.
    const part = makePart({
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'join' }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(occt, r.value.finalSolid);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value.finalSolid);
    }
  });

  it('Cut with no running body returns booleanFailed', async () => {
    const part = makePart({
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'cut' }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('booleanFailed');
      expect(r.error.featureId).toBe('e1');
    }
  });
});

// ---- New tests: revolve execution -----------------------------------------

describe('FeatureTree revolve execution', () => {
  it('extrude New + revolve Join produces a fused body', async () => {
    // Extrude 1: 10x10x10 box at origin (spans [0,10] on X/Y/Z).
    // Revolve (Join): rectangle [5,15]x[0,5] revolved 360 deg around Y axis
    //   (axis line x1=0,y1=0 -> x2=0,y2=10). Produces an annular disk with
    //   x-extent [-15,15] and z-extent [-15,15]. Fused with the cube, the
    //   final bbox x-extent spans [-15, 15] = 30 (the annulus dominates).
    const part = makePart({
      parameters: {
        d1: { name: 'd1', expression: '10', value: 10, unit: 'mm' as const },
        a1: { name: 'a1', expression: '360', value: 360, unit: 'deg' as const }
      },
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' },
        {
          kind: 'rectAxisSketch', id: 's2',
          x: 5, y: 0, w: 10, h: 5,
          ax1: 0, ay1: 0, ax2: 0, ay2: 10
        },
        {
          kind: 'revolve', id: 'r1', sketchRef: 's2',
          axisPrimitiveId: 's2-axis', angleParam: 'a1', operation: 'join'
        }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(occt, r.value.finalSolid);
      // The 360-deg annular revolve around Y spans X:[-15,15], Z:[-15,15].
      // Fused with the 10x10x10 cube at origin, min is -15 and max is 15 on
      // X/Z (the cube is wholly contained on the positive octant and doesn't
      // extend the bbox). Extent on X ~ 30.
      expect(bbox[3] - bbox[0]).toBeCloseTo(30, 1);
      expect(bbox[5] - bbox[2]).toBeCloseTo(30, 1);
      disposeShape(r.value.finalSolid);
    }
  });

  it('extrude New + revolve Cut removes material', async () => {
    // Start with a 30x30x30 cube centered on origin via extrude at (-15,-15).
    // Then Cut with a narrow cylinder produced by revolving a small rectangle
    // [1,3]x[0,30] around the Y axis 360 deg -> an annulus/cylinder that
    // punches through the cube around the Y axis.
    const part = makePart({
      parameters: {
        d1: { name: 'd1', expression: '30', value: 30, unit: 'mm' as const },
        a1: { name: 'a1', expression: '360', value: 360, unit: 'deg' as const }
      },
      features: [
        { kind: 'rectSketch', id: 's1', x: -15, y: -15, w: 30, h: 30 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' },
        {
          kind: 'rectAxisSketch', id: 's2',
          x: 1, y: 0, w: 2, h: 30,
          ax1: 0, ay1: 0, ax2: 0, ay2: 30
        },
        {
          kind: 'revolve', id: 'r1', sketchRef: 's2',
          axisPrimitiveId: 's2-axis', angleParam: 'a1', operation: 'cut'
        }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(occt, r.value.finalSolid);
      // Outer bbox still matches the 30x30x30 cube since the cut is internal.
      expect(bbox[3] - bbox[0]).toBeCloseTo(30, 1);
      expect(bbox[4] - bbox[1]).toBeCloseTo(30, 1);
      expect(bbox[5] - bbox[2]).toBeCloseTo(30, 1);
      // Prove the cut actually removed material: the cube is 30^3 = 27000 mm^3
      // and the annular cut (r=1..3, h=30, 360 deg) removes ~754 mm^3, so the
      // final volume should be ~26246 mm^3. 26000 < vol < 27000 is a wide but
      // proof-positive band for "material was removed, approximately as
      // expected".
      const vol = computeVolume(occt, r.value.finalSolid);
      expect(vol).toBeLessThan(27000);
      expect(vol).toBeGreaterThan(26000);
      disposeShape(r.value.finalSolid);
    }
  });
});

// ---- New tests: fillet execution -------------------------------------------

describe('FeatureTree fillet execution', () => {
  it('extrude New + fillet top edges produces a blended body', async () => {
    const filletFeature: FilletFeature = {
      kind: 'fillet',
      id: 'f1',
      mode: 'constant',
      edges: [
        {
          edgeId: canonicalEdgeName(
            namedFace('e1', 'top'),
            namedFace('e1', 'side', 0)
          ),
          selectionMode: 'edge',
          radius: { kind: 'param', paramName: 'r1' }
        }
      ],
      setbacks: []
    };
    const part = makePart({
      parameters: {
        d1: { name: 'd1', expression: '10', value: 10, unit: 'mm' as const },
        r1: { name: 'r1', expression: '2', value: 2, unit: 'mm' as const }
      },
      features: [
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' },
        { kind: 'fillet', feature: filletFeature }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.finalSolid).toBeDefined();
      // No featureErrors should be populated for this happy path.
      expect(r.value.featureErrors).toBeUndefined();
      disposeShape(r.value.finalSolid);
    }
  });

  it('records a featureErrors entry when fillet runs without a body', async () => {
    // A fillet with no prior solid is a soft error: the tree still completes
    // (with no solid) and returns degenerateSketch, while featureErrors logs
    // the fillet's complaint. But since the tree has no surviving solid, the
    // whole executeTree returns degenerateSketch. To exercise the soft-error
    // path with a valid final solid we put a fillet ahead of an extrude — the
    // fillet records its error, then the extrude seeds the body.
    const filletFeature: FilletFeature = {
      kind: 'fillet',
      id: 'f1',
      mode: 'constant',
      edges: [
        {
          edgeId: canonicalEdgeName(namedFace('x', 'y'), namedFace('x', 'z')),
          selectionMode: 'edge',
          radius: { kind: 'literal', value: 1 }
        }
      ],
      setbacks: []
    };
    const part = makePart({
      features: [
        { kind: 'fillet', feature: filletFeature },
        { kind: 'rectSketch', id: 's1', x: 0, y: 0, w: 10, h: 10 },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd1', operation: 'new' }
      ]
    });
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.featureErrors?.get('f1')?.kind).toBe('invalidParameter');
      disposeShape(r.value.finalSolid);
    }
  });
});
