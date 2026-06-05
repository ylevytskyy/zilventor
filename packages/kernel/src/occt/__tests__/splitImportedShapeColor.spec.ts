import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { splitImportedShapeHelper } from '../StepIO';
import type { OcctShape } from '../SolidOps';

/**
 * Builds an in-memory compound with two disjoint 10×10×10 boxes,
 * offset along X by 20mm. Uses BRepPrimAPI_MakeBox_2 (dx,dy,dz) + a
 * gp_Trsf_1/gp_Vec_4/BRepBuilderAPI_Transform_2 for the second box
 * (no STEP round-trip — color assignment is purely in-memory).
 */
function twoBoxCompound(oc: OcctInstance): OcctShape {
  const BRepBuilder = (oc as {
    BRep_Builder: new () => { MakeCompound(c: unknown): void; Add(c: unknown, s: unknown): void; delete(): void };
  }).BRep_Builder;
  const Compound = (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound;
  const MakeBox = (oc as {
    BRepPrimAPI_MakeBox_2: new (dx: number, dy: number, dz: number) => { Shape(): unknown; delete(): void };
  }).BRepPrimAPI_MakeBox_2;
  const GpTrsf = (oc as { gp_Trsf_1: new () => { SetTranslation_1(v: unknown): void; delete?(): void } }).gp_Trsf_1;
  const GpVec = (oc as { gp_Vec_4: new (x: number, y: number, z: number) => { delete?(): void } }).gp_Vec_4;
  const BRepTransform = (oc as {
    BRepBuilderAPI_Transform_2: new (shape: unknown, trsf: unknown, copy: boolean) => { Shape(): unknown; delete?(): void };
  }).BRepBuilderAPI_Transform_2;

  const b = new BRepBuilder();
  const comp = new Compound();
  b.MakeCompound(comp);

  // First box at origin
  const mk1 = new MakeBox(10, 10, 10);
  b.Add(comp, mk1.Shape());
  mk1.delete();

  // Second box offset +20mm along X
  const mk2 = new MakeBox(10, 10, 10);
  const trsf = new GpTrsf();
  const vec = new GpVec(20, 0, 0);
  trsf.SetTranslation_1(vec);
  vec.delete?.();
  const xf = new BRepTransform(mk2.Shape(), trsf, false);
  b.Add(comp, xf.Shape());
  xf.delete?.();
  trsf.delete?.();
  mk2.delete();

  b.delete();
  return { __brand: 'OcctShape', handle: comp };
}

describe('splitImportedShapeHelper color assignment', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); }, 120_000);

  it('assigns solidColors index-aligned to extracted solids', () => {
    const res = splitImportedShapeHelper(oc, twoBoxCompound(oc), ['#ff0000', null]);
    expect(res.solids).toHaveLength(2);
    expect(res.solids[0]!.color).toBe('#ff0000');
    expect(res.solids[1]!.color).toBeUndefined();
  });

  it('leaves color undefined when no colors array is passed', () => {
    const res = splitImportedShapeHelper(oc, twoBoxCompound(oc));
    expect(res.solids[0]!.color).toBeUndefined();
  });
});
