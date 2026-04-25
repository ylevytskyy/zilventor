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
