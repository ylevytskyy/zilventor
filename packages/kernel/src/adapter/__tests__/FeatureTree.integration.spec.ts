import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../occt/occtLoader';
import { executeTree } from '../FeatureTree';
import { disposeShape } from '../../occt/SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

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
