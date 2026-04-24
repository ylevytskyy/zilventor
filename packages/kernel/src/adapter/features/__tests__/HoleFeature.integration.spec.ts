import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { makeHole } from '../../../occt/HoleOps';
import { executeHoleFeature } from '../HoleFeature';

describe('makeHole — integration (kernel)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('drills a simple through-hole through a cube, reducing volume', () => {
    const cube = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, 15);  // above top face
    const axis = new oc.gp_Dir_4(0, 0, -1);    // pointing down
    const body = makeHole(oc, cube, [{ origin, axis }], {
      kind: 'simple', diameter: 4,
    }, { kind: 'throughAll' });

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(body, props, 1e-7, false, false);
    const volume = props.Mass();
    const expectedHole = Math.PI * 2 * 2 * 10;
    const expected = 1000 - expectedHole;
    expect(volume).toBeCloseTo(expected, -1);
  });

  it('fromSketch placement drills one hole per circle center on an XY sketch', async () => {
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 10).Shape();
    const running = { shape: body, faceNames: [] };

    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [
        { id: 'C1', kind: 'circle', cx: 5, cy: 5, r: 1 },
        { id: 'C2', kind: 'circle', cx: 15, cy: 15, r: 1 },
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

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const volume = props.Mass();
    const expected = 20 * 20 * 10 - 2 * Math.PI * 1 * 1 * 10;
    expect(volume).toBeCloseTo(expected, 0);
  });
});
