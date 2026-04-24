import { describe, it, expect, beforeAll } from 'vitest';
import type { BooleanOperation, PartDocument } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from '../../occt/occtLoader';
import { executeTree } from '../FeatureTree';
import { computeBoundingBox, disposeShape } from '../../occt/SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

// ---- Test helpers ----------------------------------------------------------

/** Build a PartDocument with one rectangle sketch (id `s${n}`) + one extrude
 *  (id `e${n}`) referencing it. Kept small so callers can chain multiple. */
function makePart(opts: {
  parameters?: Record<string, { name: string; expression: string; value: number; unit: 'mm' }>;
  features: Array<
    | { kind: 'rectSketch'; id: string; x: number; y: number; w: number; h: number }
    | { kind: 'extrude'; id: string; sketchRef: string; distanceParam: string; operation: BooleanOperation }
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
