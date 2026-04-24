import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { makeHole } from '../../../occt/HoleOps';
import { executeHoleFeature } from '../HoleFeature';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { FaceName, EdgeName } from '@zilventor/shared';
import { canonicalEdgeName } from '@zilventor/shared';

function nameCylinderTopologies(oc: any, cyl: any, featureId: string): {
  named: NamedShape;
  faceNameOf: Record<string, FaceName>;
  circularEdge: EdgeName;
} {
  const faceNameOf: Record<string, FaceName> = {};
  const named: NamedShape = { shape: cyl, faceNames: [] };

  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(cyl, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  for (let i = 1; i <= map.Extent(); i++) {
    const faceShape = map.FindKey(i);
    const face = oc.TopoDS.Face_1(faceShape);
    const surfAdaptor = new oc.BRepAdaptor_Surface_2(face, true);
    const surfType = surfAdaptor.GetType();
    surfAdaptor.delete?.();

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
    const c = props.CentreOfMass();
    props.delete?.();

    let role: string;
    if (surfType === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
      role = 'side';
    } else if (c.Z() > 5) {
      role = 'top';
    } else {
      role = 'bottom';
    }

    const name: FaceName = { featureId, role, instance: 0 };
    faceNameOf[role] = name;
    named.faceNames.push({ name, face });
  }
  map.delete();

  const circularEdge = canonicalEdgeName(faceNameOf['top']!, faceNameOf['side']!);
  return { named, faceNameOf, circularEdge };
}

function nameCubeFaces(oc: any, cube: any, featureId: string): {
  named: NamedShape;
  faceNameOf: Record<string, FaceName>;
  edgeOf: Record<string, EdgeName>;
} {
  const faceNameOf: Record<string, FaceName> = {};
  const named: NamedShape = { shape: cube, faceNames: [] };

  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(cube, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  for (let i = 1; i <= map.Extent(); i++) {
    const faceShape = map.FindKey(i);
    const face = oc.TopoDS.Face_1(faceShape);
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
    const c = props.CentreOfMass();
    const x = c.X(), y = c.Y(), z = c.Z();
    let role: string;
    if (Math.abs(z - 10) < 0.5) role = 'top';
    else if (Math.abs(z) < 0.5) role = 'bottom';
    else if (Math.abs(x - 20) < 0.5) role = 'right';
    else if (Math.abs(x) < 0.5) role = 'left';
    else if (Math.abs(y - 20) < 0.5) role = 'back';
    else role = 'front';
    const name: FaceName = { featureId, role, instance: 0 };
    faceNameOf[role] = name;
    named.faceNames.push({ name, face });
  }
  map.delete();

  const ce = (a: FaceName, b: FaceName): EdgeName => canonicalEdgeName(a, b);
  const edgeOf: Record<string, EdgeName> = {
    top_front: ce(faceNameOf['top']!, faceNameOf['front']!),
    top_left: ce(faceNameOf['top']!, faceNameOf['left']!),
  };
  return { named, faceNameOf, edgeOf };
}

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

  it('linear placement drills at offset from two perpendicular edges', () => {
    const cube = new oc.BRepPrimAPI_MakeBox_2(20, 20, 10).Shape();
    const { named, faceNameOf, edgeOf } = nameCubeFaces(oc, cube, 'B1');

    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: {
        kind: 'linear', faceName: faceNameOf['top'],
        refEdge1: edgeOf['top_front'], offset1: { kind: 'literal', value: 3 },
        refEdge2: edgeOf['top_left'], offset2: { kind: 'literal', value: 4 },
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, named, feature, (p: any) => p.value, new Map());
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    expect(20 * 20 * 10 - props.Mass()).toBeCloseTo(Math.PI * 10, 0);
  });

  it('concentric placement centers hole on a circular edge', () => {
    const cyl = new oc.BRepPrimAPI_MakeCylinder_1(5, 10).Shape();
    const { named, faceNameOf, circularEdge } = nameCylinderTopologies(oc, cyl, 'C1');

    const feature: any = {
      id: 'H1', kind: 'hole',
      placement: {
        kind: 'concentric',
        faceName: faceNameOf['top'],
        circularEdgeName: circularEdge,
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 2 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const result = executeHoleFeature(oc, named, feature, (p: any) => p.value, new Map());

    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(result.shape, props, 1e-7, false, false);
    const origVol = Math.PI * 25 * 10;        // R²·π·H = 25π·10
    const holeVol = Math.PI * 1 * 1 * 10;     // r²·π·H = π·10
    expect(origVol - props.Mass()).toBeCloseTo(holeVol, 0);
  });
});
