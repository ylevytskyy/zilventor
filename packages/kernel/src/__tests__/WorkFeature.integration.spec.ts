import { describe, it, expect, beforeAll } from 'vitest';
import type { PartDocument } from '@zilventor/shared';
import { loadOcct, type OcctInstance } from '../occt/occtLoader';
import { executeTree } from '../adapter/FeatureTree';
import { computeBoundingBox, disposeShape } from '../occt/SolidOps';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

describe('WorkFeature integration — sketch on derived work plane', () => {
  it('rectangle on origin.XY + workPlane offset 10mm + rectangle on WP1 + extrude joins into one solid', async () => {
    const part: PartDocument = {
      id: 'P1', name: 'p', units: 'mm', parameters: {
        h1: { name: 'h1', expression: '10', value: 10, unit: 'mm' },
        h2: { name: 'h2', expression: '5', value: 5, unit: 'mm' },
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
          primitives: [{ id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 20, h: 20 }],
          constraints: [],
        },
        { kind: 'extrude', id: 'E1', sketchRef: 'S1', distanceParam: 'h1', direction: 'forward', operation: 'new' },
        { kind: 'workPlane', id: 'WP1', visible: true, source: {
          mode: 'offsetFromPlane',
          plane: { source: 'workPlane', featureId: 'origin.XY' },
          offset: { kind: 'literal', value: 10 },
        } },
        { kind: 'sketch', id: 'S2',
          plane: { source: 'workPlane', featureId: 'WP1' },
          primitives: [{ id: 'R2', kind: 'rectangle', x: 5, y: 5, w: 10, h: 10 }],
          constraints: [],
        },
        { kind: 'extrude', id: 'E2', sketchRef: 'S2', distanceParam: 'h2', direction: 'forward', operation: 'join' },
      ],
      materials: [],
      hardware: [],
    };
    const r = await executeTree(occt, part);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Combined solid bounding box: x [0,20], y [0,20], z [0,15]. The first
    // extrude reaches z=10, the second sits on the WP1 plane (z=10) and grows
    // to z=15. So overall z extent is [0, 15].
    const bbox = computeBoundingBox(occt, r.value.finalSolid);
    const [xMin, yMin, zMin, xMax, yMax, zMax] = bbox;
    expect(zMin).toBeCloseTo(0, 4);
    expect(zMax).toBeCloseTo(15, 4);
    expect(xMin).toBeCloseTo(0, 4);
    expect(xMax).toBeCloseTo(20, 4);
    expect(yMin).toBeCloseTo(0, 4);
    expect(yMax).toBeCloseTo(20, 4);
    // workFeatures should include WP1 at z=10
    const wp1 = r.value.workFeatures?.find((w) => w.featureId === 'WP1');
    expect(wp1?.kind).toBe('plane');
    if (wp1?.kind === 'plane') expect(wp1.origin.z).toBeCloseTo(10, 5);
    disposeShape(r.value.finalSolid);
  });
});
