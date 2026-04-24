import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occtLoader';
import { makeSimpleCutter } from '../HoleOps';

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
