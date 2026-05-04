import { describe, it, expect, beforeAll } from 'vitest';
import type {
  BooleanOperation,
  FilletFeature,
  HoleFeature,
  SweepFeature,
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
        plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
        primitives: [{ id: `${f.id}-r`, kind: 'rectangle' as const, x: f.x, y: f.y, w: f.w, h: f.h }],
        constraints: []
      };
    }
    if (f.kind === 'rectAxisSketch') {
      return {
        kind: 'sketch' as const,
        id: f.id,
        plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
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
    properties: {},
    featureTree,
    materials: [],
    hardware: [],
  } as PartDocument;
}

// ---- Existing tests --------------------------------------------------------

describe('FeatureTree.executeTree', () => {
  it('runs sketch → extrude and returns the tessellated mesh', async () => {
    const part = {
      id: 'p1', name: 'Part1', units: 'mm' as const,
      parameters: { d1: { name: 'd1', expression: '50', value: 50, unit: 'mm' as const } },
      properties: {},
      featureTree: [
        { kind: 'sketch' as const, id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' } as const, primitives: [{ id: 'p1', kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 200 }], constraints: [] },
        { kind: 'extrude' as const, id: 'e1', sketchRef: 's1', distanceParam: 'd1', direction: 'forward' as const, operation: 'new' as const }
      ],
      materials: [],
      hardware: [],
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
      properties: {},
      featureTree: [
        { kind: 'extrude' as const, id: 'e1', sketchRef: 'missing', distanceParam: 'd1', direction: 'forward' as const, operation: 'new' as const }
      ],
      materials: [],
      hardware: [],
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

// ---- New tests: hole feature execution ----------------------------------------

describe('FeatureTree — hole feature integration', () => {
  it('hole references a fromSketch sketch, sketch is not extruded, body is drilled', async () => {
    // 20×20×5 box, then drill a ⌀2 throughAll hole at (10,10) from XY sketch.
    // The hole-referenced sketch (S1) must NOT be processed by executeSketchFeature
    // (it would be rejected as a lone circle); the pre-scan must keep it raw.
    // Expected volume after drilling: 20*20*5 - π*(1²)*5 = 2000 - 5π ≈ 1984.3
    const part: PartDocument = {
      id: 'p1',
      name: 'Part1',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '5', value: 5, unit: 'mm' }
      },
      properties: {},
      featureTree: [
        {
          kind: 'sketch',
          id: 'S0',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
          constraints: []
        },
        {
          kind: 'extrude',
          id: 'E1',
          sketchRef: 'S0',
          distanceParam: 'd0',
          direction: 'forward',
          operation: 'new'
        },
        {
          kind: 'sketch',
          id: 'S1',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
          constraints: []
        },
        {
          kind: 'hole',
          id: 'H1',
          placement: { kind: 'fromSketch', sketchId: 'S1' },
          profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
          termination: { kind: 'throughAll' },
          flipAxis: false
        } as HoleFeature
      ] as PartDocument['featureTree'],
      materials: [],
      hardware: [],
    };

    const result = await executeTree(occt, part);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const props = new occt.GProp_GProps_1();
    try {
      occt.BRepGProp.VolumeProperties_1(
        result.value.finalSolid.handle as never,
        props,
        true as never,
        false as never,
        false as never
      );
      // 2000 - π·r²·h = 2000 - π·1²·5 = 2000 - 5π
      expect(props.Mass()).toBeCloseTo(2000 - Math.PI * 5, 0);
    } finally {
      props.delete();
    }
    // No errors on the happy path
    expect(result.value.featureErrors).toBeUndefined();
    disposeShape(result.value.finalSolid);
  });

  it('hole referencing missing sketch soft-fails without aborting tree', async () => {
    // 20×20×5 box, then a hole whose sketchId doesn't exist.
    // The body should remain the pre-hole extrude (volume ≈ 2000).
    // featureErrors should record an entry for H1.
    const part: PartDocument = {
      id: 'p1',
      name: 'Part1',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '5', value: 5, unit: 'mm' }
      },
      properties: {},
      featureTree: [
        {
          kind: 'sketch',
          id: 'S0',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
          constraints: []
        },
        {
          kind: 'extrude',
          id: 'E1',
          sketchRef: 'S0',
          distanceParam: 'd0',
          direction: 'forward',
          operation: 'new'
        },
        {
          kind: 'hole',
          id: 'H1',
          placement: { kind: 'fromSketch', sketchId: 'NONEXISTENT' },
          profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
          termination: { kind: 'throughAll' },
          flipAxis: false
        } as HoleFeature
      ] as PartDocument['featureTree'],
      materials: [],
      hardware: [],
    };

    const result = await executeTree(occt, part);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Body remains the pre-hole extrude: 20×20×5 = 2000 mm³
    const props = new occt.GProp_GProps_1();
    try {
      occt.BRepGProp.VolumeProperties_1(
        result.value.finalSolid.handle as never,
        props,
        true as never,
        false as never,
        false as never
      );
      expect(props.Mass()).toBeCloseTo(2000, 0);
    } finally {
      props.delete();
    }

    // Error is recorded for H1 in the featureErrors map
    expect(result.value.featureErrors?.get('H1')).toBeDefined();
    disposeShape(result.value.finalSolid);
  });
});

// ---- New tests: sweep feature execution ----------------------------------------

describe('FeatureTree — sweep feature integration', () => {
  it('sweep references two sketches; both stay raw, swept body is produced', async () => {
    // Profile: circle r=1 in XY. Path: line from (0,0) to (0,0,10) in XZ plane.
    // Sweep volume = π * r² * length = π * 1 * 10 ≈ 31.4 mm³
    const part: PartDocument = {
      id: 'p1',
      name: 'Part1',
      units: 'mm',
      parameters: {},
      properties: {},
      featureTree: [
        {
          kind: 'sketch',
          id: 'PROF',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 1 }],
          constraints: []
        },
        {
          kind: 'sketch',
          id: 'PATH',
          plane: { source: 'workPlane', featureId: 'origin.XZ' },
          primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 0, y2: 10 }],
          constraints: []
        },
        {
          kind: 'sweep',
          id: 'SW1',
          profileSketchId: 'PROF',
          pathSketchId: 'PATH',
          orientation: { kind: 'path' },
          operation: 'new'
        } as SweepFeature
      ] as PartDocument['featureTree'],
      materials: [],
      hardware: [],
    };

    const result = await executeTree(occt, part);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const props = new occt.GProp_GProps_1();
    try {
      occt.BRepGProp.VolumeProperties_1(
        result.value.finalSolid.handle as never,
        props,
        true as never,
        false as never,
        false as never
      );
      // π * 1² * 10 = 10π ≈ 31.4
      expect(props.Mass()).toBeCloseTo(Math.PI * 10, 0);
    } finally {
      props.delete();
    }
    expect(result.value.featureErrors).toBeUndefined();
    disposeShape(result.value.finalSolid);
  });

  it('sweep with missing profile sketch soft-fails without aborting', async () => {
    // 20×20×5 box from extrude, then a sweep with nonexistent sketch refs.
    // Tree should continue; final body is the pre-sweep extrude (volume ≈ 2000).
    const part: PartDocument = {
      id: 'p1',
      name: 'Part1',
      units: 'mm',
      parameters: {
        d0: { name: 'd0', expression: '5', value: 5, unit: 'mm' }
      },
      properties: {},
      featureTree: [
        {
          kind: 'sketch',
          id: 'S0',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
          constraints: []
        },
        {
          kind: 'extrude',
          id: 'E1',
          sketchRef: 'S0',
          distanceParam: 'd0',
          direction: 'forward',
          operation: 'new'
        },
        {
          kind: 'sweep',
          id: 'SW1',
          profileSketchId: 'NONEXISTENT',
          pathSketchId: 'NONE2',
          orientation: { kind: 'path' },
          operation: 'new'
        } as SweepFeature
      ] as PartDocument['featureTree'],
      materials: [],
      hardware: [],
    };

    const result = await executeTree(occt, part);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Body remains the pre-sweep extrude: 20×20×5 = 2000 mm³
    const props = new occt.GProp_GProps_1();
    try {
      occt.BRepGProp.VolumeProperties_1(
        result.value.finalSolid.handle as never,
        props,
        true as never,
        false as never,
        false as never
      );
      expect(props.Mass()).toBeCloseTo(2000, 0);
    } finally {
      props.delete();
    }

    // Error is recorded for SW1 in the featureErrors map
    expect(result.value.featureErrors?.get('SW1')).toBeDefined();
    disposeShape(result.value.finalSolid);
  });
});

describe('executeTree work features', () => {
  it('returns workFeatures for parts with origin + derived work features', async () => {
    const part: PartDocument = {
      id: 'P1', name: 'p', units: 'mm', parameters: {
        d: { name: 'd', expression: '5', value: 5, unit: 'mm' },
      },
      properties: {},
      featureTree: [
        { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } },
        { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } },
        { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } },
        { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
        { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
        { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
        { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } },
        { kind: 'sketch', id: 'S1',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          primitives: [
            { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
            { id: 'L2', kind: 'line', x1: 10, y1: 0, x2: 10, y2: 10 },
            { id: 'L3', kind: 'line', x1: 10, y1: 10, x2: 0, y2: 10 },
            { id: 'L4', kind: 'line', x1: 0, y1: 10, x2: 0, y2: 0 },
          ],
          constraints: [],
        },
        { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'd', direction: 'forward', operation: 'new' },
        { kind: 'workPlane', id: 'WP1', visible: true, source: {
          mode: 'offsetFromPlane',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          offset: { kind: 'literal', value: 10 },
        } },
        { kind: 'workPoint', id: 'PT1', visible: true, source: {
          mode: 'axisIntersectsPlane',
          axis: { source: 'workAxis', featureId: 'origin.Z' },
          plane: { source: 'workPlane', featureId: 'WP1' },
        } },
      ],
      materials: [],
      hardware: [],
    };
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const wfs = r.value.workFeatures;
    expect(wfs).toBeDefined();
    const wp1 = wfs!.find((w) => w.featureId === 'WP1');
    expect(wp1?.kind).toBe('plane');
    if (wp1?.kind === 'plane') expect(wp1.origin.z).toBeCloseTo(10, 5);
    const pt1 = wfs!.find((w) => w.featureId === 'PT1');
    expect(pt1?.kind).toBe('point');
    if (pt1?.kind === 'point') expect(pt1.position.z).toBeCloseTo(10, 5);
    // Origin features are also present
    const originXY = wfs!.find((w) => w.featureId === 'origin.XY');
    expect(originXY?.kind).toBe('plane');
    disposeShape(r.value.finalSolid);
  });
});
