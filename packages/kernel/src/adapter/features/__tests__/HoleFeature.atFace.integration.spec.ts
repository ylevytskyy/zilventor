import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import type { NamedShape } from '../../../occt/FaceNaming';

describe('executeHoleFeature — atFace (integration, real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  it('drills a blind hole INTO an offset panel face — the void really exists (volume drops)', () => {
    const dims = { length: 600, width: 400, thickness: 18 };
    // buildPanelBox places the box [-300,-200,0]..[300,200,18].
    // Front=+Y: centroid at (0,200,9), outward normal +Y.
    const panel = buildPanelBox(oc, dims);

    // Build a NamedShape with real face handles, classifying by centroid position.
    // Front=+Y means centroid y≈+200 (=W/2=200).
    const faceNamesArr: NamedShape['faceNames'] = [];
    const map = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    for (let i = 1; i <= map.Extent(); i++) {
      const faceShape = map.FindKey(i);
      const face = oc.TopoDS.Face_1(faceShape);
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const c = props.CentreOfMass();
      const x = c.X(), y = c.Y(), z = c.Z();
      props.delete?.();
      let role: string;
      if (Math.abs(z - 18) < 0.5) role = 'Top';      // z=T=18
      else if (Math.abs(z) < 0.5) role = 'Bottom';   // z=0
      else if (Math.abs(y - 200) < 0.5) role = 'Front';  // y=+W/2=+200 → Front=+Y convention
      else if (Math.abs(y + 200) < 0.5) role = 'Back';   // y=-W/2=-200
      else if (Math.abs(x + 300) < 0.5) role = 'Left';   // x=-L/2=-300
      else role = 'Right';                                // x=+L/2=+300
      faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    const running: NamedShape = { shape: panel.shape, faceNames: faceNamesArr };

    // face2DFrame('Front'): origin={x:-300,y:200,z:0}, uDir={x:0,y:0,z:1} (along thickness),
    // vDir={x:1,y:0,z:0} (along length). Physical center: u=T/2=9, v=L/2=300 → P={0,200,9}.
    const feature: any = {
      id: 'bake:Front:8:20:0', kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: { featureId: 'panel', role: 'Front', instance: 0 },
        points: [{ u: 9, v: 300 }],  // center of Front face: u=T/2=9, v=L/2=300
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 20 } },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, running, feature, (p: any) => p.value, new Map());

    // Measure volume via BRepGProp.VolumeProperties_1 (same pattern as existing integration tests).
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const volumeAfter = props.Mass();
    props.delete?.();

    const volumeBefore = dims.length * dims.width * dims.thickness; // 600*400*18 = 4_320_000
    const cylinderVol = Math.PI * 4 * 4 * 20;  // π·r²·depth, r=4, depth=20 ≈ 1005.3
    const drop = volumeBefore - volumeAfter;

    // Volume drop must equal the cylinder body (±10%). A blind drill-tip cone adds a small
    // extra (π·r²·(r/tan(59°)) ≈ small), so upper bound is 1.3× cylinder.
    expect(drop).toBeGreaterThan(100);                    // sanity: not a no-op soft-fail
    expect(drop).toBeGreaterThan(cylinderVol * 0.9);
    expect(drop).toBeLessThan(cylinderVol * 1.3);
  });
});
