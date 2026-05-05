import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { getProjectorInput } from '../getProjectorInput';
import type { OcctInstance } from '../../../occt/occtLoader';

let oc: OcctInstance;

beforeAll(async () => {
  oc = await loadOcct();
}, 30_000);

describe('getProjectorInput — part source', () => {
  it('returns triangles, edges, and bbox for a 100×60×40 box', async () => {
    const part = {
      id: 'box-fixture',
      name: 'BoxFixture',
      units: 'mm' as const,
      parameters: {
        d1: { name: 'd1', expression: '40', value: 40, unit: 'mm' as const },
      },
      properties: {},
      materials: [],
      hardware: [],
      featureTree: [
        {
          kind: 'sketch' as const,
          id: 'sk1',
          plane: { source: 'workPlane', featureId: 'origin.XY' } as const,
          primitives: [{ id: 'r1', kind: 'rectangle' as const, x: 0, y: 0, w: 100, h: 60 }],
          constraints: [],
        },
        {
          kind: 'extrude' as const,
          id: 'ex1',
          sketchRef: 'sk1',
          distanceParam: 'd1',
          direction: 'forward' as const,
          operation: 'new' as const,
        },
      ],
    };

    const execResult = await executeTree(oc, part);
    expect(execResult.ok).toBe(true);
    if (!execResult.ok) return;

    const input = await getProjectorInput(oc, execResult.value.namedShape);

    // triangles: a box has 12 triangles (2 per face × 6 faces)
    expect(input.triangles.length).toBeGreaterThanOrEqual(12);

    // edges: a box has 12 edges — each should appear in tessellateEdges output
    expect(input.edges.length).toBeGreaterThanOrEqual(12);

    // bbox: roughly matches the 100×60×40 box
    expect(input.bbox[3] - input.bbox[0]).toBeCloseTo(100, 0);
    expect(input.bbox[4] - input.bbox[1]).toBeCloseTo(60, 0);
    expect(input.bbox[5] - input.bbox[2]).toBeCloseTo(40, 0);
  });
});
