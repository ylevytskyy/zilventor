import { describe, expect, it, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { checkManifold } from '../ManifoldCheck';
import { disposeShape, type OcctShape } from '../SolidOps';

/**
 * checkManifold wraps BRepCheck_Analyzer(shape, GeomControls=false, parallel=false)
 * per D2 (topology-only rigor — closed/free-edge checks, not full geometric
 * self-intersection analysis).
 */
describe('checkManifold (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); });

  it('a watertight box solid is manifold', () => {
    const boxMk = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape: OcctShape = { __brand: 'OcctShape', handle: boxMk.Shape() };
    boxMk.delete();
    try {
      expect(checkManifold(oc, shape)).toBe(true);
    } finally {
      disposeShape(shape);
    }
  });

  it('a solid built from an open shell (one face of a box removed) is not manifold', () => {
    // Build a box, then sew together only 5 of its 6 faces into a shell —
    // this leaves one side open (a free-edge boundary), then wrap the open
    // shell in a TopoDS_Solid via BRepBuilderAPI_MakeSolid. BRepCheck_Analyzer
    // flags the missing 6th face as BRepCheck_NotClosed on the contained shell.
    const boxMk = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxSolid = boxMk.Shape();
    boxMk.delete();

    const TAS = (oc as { TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown } }).TopAbs_ShapeEnum;
    const ExplorerCtor = (oc as {
      TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
        More(): boolean;
        Next(): void;
        Current(): unknown;
        delete?(): void;
      };
    }).TopExp_Explorer_2;

    const faces: unknown[] = [];
    const faceExp = new ExplorerCtor(boxSolid, TAS.TopAbs_FACE, TAS.TopAbs_SHAPE);
    while (faceExp.More()) {
      faces.push(faceExp.Current());
      faceExp.Next();
    }
    faceExp.delete?.();
    expect(faces.length).toBe(6);

    const SewingCtor = (oc as {
      BRepBuilderAPI_Sewing: new (tol: number, a: boolean, b: boolean, c: boolean, d: boolean) => {
        Add(s: unknown): void;
        Perform(pr: unknown): void;
        SewedShape(): unknown;
        delete?(): void;
      };
    }).BRepBuilderAPI_Sewing;
    const ProgressRange = (oc as { Message_ProgressRange_1: new () => unknown }).Message_ProgressRange_1;

    const sewing = new SewingCtor(1.0e-6, true, true, true, false);
    // Skip the last face → open shell.
    for (let i = 0; i < faces.length - 1; i++) {
      sewing.Add(faces[i]);
    }
    sewing.Perform(new ProgressRange());
    const sewedShape = sewing.SewedShape();
    sewing.delete?.();

    const ShellCast = (oc as { TopoDS: { Shell_1(s: unknown): unknown } }).TopoDS.Shell_1;
    const MakeSolidCtor = (oc as {
      BRepBuilderAPI_MakeSolid_3: new (shell: unknown) => { Solid(): unknown; delete(): void };
    }).BRepBuilderAPI_MakeSolid_3;

    const shellTyped = ShellCast(sewedShape);
    const mkSolid = new MakeSolidCtor(shellTyped);
    const openSolid = mkSolid.Solid();
    mkSolid.delete();

    const shape: OcctShape = { __brand: 'OcctShape', handle: openSolid };
    try {
      expect(checkManifold(oc, shape)).toBe(false);
    } finally {
      disposeShape(shape);
    }
  });
});
