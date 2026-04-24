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

  it('fromSketch on XZ plane drills along Y-axis', async () => {
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20).Shape();
    const running = { shape: body, faceNames: [] };
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XZ',
      primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
      constraints: [],
    };
    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map([['S1', sketch]]));
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // Hole axis is +Y through a 20-thick box: volume loss ≈ π·1²·20
    expect(8000 - props.Mass()).toBeCloseTo(Math.PI * 20, 0);
  });

  it('fromSketch with flipAxis reverses hole direction (axis -Z misses the body above z=0)', async () => {
    const body = new oc.BRepPrimAPI_MakeBox_2(20, 20, 20).Shape();
    const running = { shape: body, faceNames: [] };
    const sketch: any = {
      id: 'S1', kind: 'sketch', plane: 'XY',
      primitives: [{ id: 'C1', kind: 'circle', cx: 10, cy: 10, r: 1 }],
      constraints: [],
    };
    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'S1' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 5 } },
      flipAxis: true,  // axis becomes -Z; sketch at z=0; blind 5mm cutter goes down to z=-5, missing body z=0..20
    };
    const result = await executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map([['S1', sketch]]));
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    // Hole missed body entirely (well, the cutter top is at z=0 which is on the bottom face).
    // The drill-tip cone extends below z=0 into nothing. Volume should be unchanged or reduced
    // by at most a sliver if the cutter top exactly touches the bottom face.
    expect(props.Mass()).toBeCloseTo(8000, 0);
  });
});
