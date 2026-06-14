// packages/kernel/src/__tests__/faceFrameBake.integration.spec.ts
//
// Proves the panel dims that faceFrameMath produces build into real solids of
// the expected size in the kernel. Uses the producer's output (layoutFaceFrame),
// never hand-authored geometry. Signature confirmed against PanelOps.ts:
//   buildPanelBox(occt, dims: { length, width, thickness }) => PanelBoxResult
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occt/occtLoader';
import { buildPanelBox } from '../occt/PanelOps';
import { layoutFaceFrame } from '@zilventor/shared';

describe('face-frame member bake (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  function massAndBbox(shape: unknown) {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const mass = props.Mass();
    props.delete?.();
    const box = new oc.Bnd_Box_1();
    oc.BRepBndLib.Add(shape, box, false);
    const lo = box.CornerMin(); const hi = box.CornerMax();
    const dims = [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()].sort((a, b) => a - b);
    lo.delete?.();
    hi.delete?.();
    box.delete();
    return { mass, dims };
  }

  it('a stile and a rail build to solids whose bbox edge-lengths match their producer dims', () => {
    const members = layoutFaceFrame({
      width: 600, height: 720, toekickHeight: 100, depth: 560,
      rows: 1, cols: 1, stileWidth: 38, railWidth: 38, thickness: 19,
    });
    const stile = members.find((m) => m.role === 'faceFrameStile')!;
    const rail = members.find((m) => m.role === 'faceFrameRail')!;

    for (const m of [stile, rail]) {
      // buildPanelBox signature: (occt, dims: { length, width, thickness }) => PanelBoxResult
      const result = buildPanelBox(oc, m.dims);
      const { mass, dims } = massAndBbox(result.shape);
      const expected = [m.dims.length, m.dims.width, m.dims.thickness].sort((a, b) => a - b);
      expect(mass).toBeCloseTo(m.dims.length * m.dims.width * m.dims.thickness, 1);
      expect(dims[0]).toBeCloseTo(expected[0]!, 3);
      expect(dims[1]).toBeCloseTo(expected[1]!, 3);
      expect(dims[2]).toBeCloseTo(expected[2]!, 3);
    }
  });
});
