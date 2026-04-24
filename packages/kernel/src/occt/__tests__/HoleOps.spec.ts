import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import { makeSimpleCutter, makeCounterboreCutter, makeCountersinkCutter, axisSolidCrossings } from '../HoleOps';

describe('HoleOps — simple cutter', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); }, 60_000);

  it('through-cutter is a cylinder with no tip', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, 1);
    const cutter = makeSimpleCutter(oc, origin, axis, {
      diameter: 5,
      cylinderLength: 20,
      drillTipAngleDeg: null,
    });
    expect(cutter).toBeDefined();
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );
    let cylCount = 0;
    let conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(1);
    expect(conCount).toBe(0);
  });


  it('blind simple cutter has 1 cylinder + 1 cone face at 118°', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeSimpleCutter(oc, origin, axis, {
      diameter: 5,
      cylinderLength: 10,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );
    let cylCount = 0;
    let conCount = 0;
    let coneHalfAngle = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') {
        conCount++;
        coneHalfAngle = (surf as any).SemiAngle();
      }
    }
    expect(cylCount).toBe(1);
    expect(conCount).toBe(1);
    // 118° included → 59° half
    expect(Math.abs(coneHalfAngle) * (180 / Math.PI)).toBeCloseTo(59, 0);
  });
});

describe('HoleOps — counterbore cutter', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); }, 60_000);

  it('CBORE cutter has 2 concentric cylinders + tip cone (blind)', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeCounterboreCutter(oc, origin, axis, {
      diameter: 5, cylinderLength: 20,
      cboreDiameter: 10, cboreDepth: 3,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );
    let cylCount = 0, conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(2);
    expect(conCount).toBe(1);
  });
});

describe('HoleOps — countersink cutter', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); }, 60_000);

  it('CSK cutter has 1 cylinder + 1 conical CSK face + tip cone (blind)', () => {
    const origin = new oc.gp_Pnt_3(0, 0, 0);
    const axis = new oc.gp_Dir_4(0, 0, -1);
    const cutter = makeCountersinkCutter(oc, origin, axis, {
      diameter: 5, cylinderLength: 20,
      cskDiameter: 10, cskAngleDeg: 82,
      drillTipAngleDeg: 118,
    });
    const explorer = new oc.TopExp_Explorer_2(
      cutter, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
    );
    let cylCount = 0, conCount = 0;
    for (; explorer.More(); explorer.Next()) {
      const face = oc.TopoDS.Face_1(explorer.Current());
      const surf = oc.BRep_Tool.Surface_2(face).get();
      const type = surf.DynamicType().get().Name();
      if (type === 'Geom_CylindricalSurface') cylCount++;
      if (type === 'Geom_ConicalSurface') conCount++;
    }
    expect(cylCount).toBe(1);
    // CSK conical + tip cone = 2
    expect(conCount).toBe(2);
  });
});

describe('axisSolidCrossings', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); }, 60_000);

  it('finds both front and back faces of a cube along +Z axis', () => {
    const cubeShape = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, -5);  // outside cube, below -Z face
    const axis = new oc.gp_Dir_4(0, 0, 1);     // pointing up through cube
    const crossings = axisSolidCrossings(oc, cubeShape, origin, axis);
    expect(crossings.length).toBe(2);
    // First crossing: -Z face at z=0 → distance 5
    expect(crossings[0]!.distance).toBeCloseTo(5, 3);
    // Second: +Z face at z=10 → distance 15
    expect(crossings[1]!.distance).toBeCloseTo(15, 3);
  });

  it('crossings are sorted ascending by distance', () => {
    const cubeShape = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, -5);
    const axis = new oc.gp_Dir_4(0, 0, 1);
    const crossings = axisSolidCrossings(oc, cubeShape, origin, axis);
    for (let i = 1; i < crossings.length; i++) {
      expect(crossings[i]!.distance).toBeGreaterThanOrEqual(crossings[i - 1]!.distance);
    }
  });

  it('ignores crossings behind the origin', () => {
    const cubeShape = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10).Shape();
    const origin = new oc.gp_Pnt_3(5, 5, 5);   // inside cube
    const axis = new oc.gp_Dir_4(0, 0, 1);     // +Z; only the +Z face (z=10, distance 5) should appear
    const crossings = axisSolidCrossings(oc, cubeShape, origin, axis);
    expect(crossings.length).toBe(1);
    expect(crossings[0]!.distance).toBeCloseTo(5, 3);
  });
});
