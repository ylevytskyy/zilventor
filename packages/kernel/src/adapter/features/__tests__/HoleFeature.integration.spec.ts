import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { makeHole } from '../../../occt/HoleOps';

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
});
