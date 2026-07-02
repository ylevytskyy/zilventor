import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { readStep, splitImportedShapeHelper } from '../StepIO';
import { disposeShape, computeBoundingBox, type OcctShape } from '../SolidOps';

const FIXTURES = resolve(__dirname, 'fixtures/step');

// Local-only Predator fixture — skipped in CI when absent.
const PREDATOR_LOCAL = '/tmp/mq1pred/Assem1.STEP';
const hasPredator = (() => {
  try { readFileSync(PREDATOR_LOCAL); return true; } catch { return false; }
})();

describe('splitImportedShapeHelper (integration)', () => {
  let oc: OcctInstance;
  beforeAll(async () => { oc = await loadOcct(); });

  it('cube-10mm.step → 1 solid, surfaces === null', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'cube-10mm.step'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids.length).toBe(1);
        expect(result.surfaces).toBeNull();
        // Each solid must have a brepBlobId and a valid bbox
        expect(result.solids[0]!.brepBlobId).toMatch(/^imp-/);
        expect(result.solids[0]!.boundingBox).toHaveLength(6);
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  it('two-bodies.step → 2 solids, surfaces === null', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'two-bodies.step'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids.length).toBe(2);
        expect(result.surfaces).toBeNull();
        for (const s of result.solids) {
          expect(s.brepBlobId).toMatch(/^imp-/);
          expect(s.boundingBox).toHaveLength(6);
        }
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  // mixed-solid-surface.step: one 10x10x10 box solid + one free planar face.
  // After STEP AP214 write+read, the free face comes back as a TopAbs_SHELL
  // (STEP always wraps faces in shells), so pass-2 catches it in the surfaces bucket.
  it('mixed-solid-surface.step → 1 solid + non-null surfaces (pass-2 free shell)', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'mixed-solid-surface.step'));
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const parent = readStep(oc, ab);
    try {
      const result = splitImportedShapeHelper(oc, parent.shape);
      try {
        expect(result.solids.length).toBeGreaterThanOrEqual(1);
        expect(result.surfaces).not.toBeNull();
        expect(result.surfaces!.brepBlobId).toMatch(/^imp-/);
        // surfaces bbox must include the 20x20 planar face geometry
        const sb = computeBoundingBox(oc, result.surfaces!.shape);
        expect(sb).toHaveLength(6);
        // The planar face spans 0..20 in X and Y
        expect(Math.max(Math.abs(sb[0]!), Math.abs(sb[3]!))).toBeGreaterThan(10);
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(parent.shape);
    }
  });

  // pass-3 in-memory test: a compound with a box solid + a free face (NOT yet
  // round-tripped through STEP). Before STEP write, the free face is a
  // TopAbs_FACE not inside any shell — pass-3 must catch it in surfaces.
  it('in-memory compound (solid + free face) → 1 solid + non-null surfaces (pass-3 free face)', () => {
    // Build a box solid
    const boxMk = new (oc as { BRepPrimAPI_MakeBox_2: new (x: number, y: number, z: number) => { Shape(): unknown; delete(): void } }).BRepPrimAPI_MakeBox_2(10, 10, 10);
    const boxSolid = boxMk.Shape();
    boxMk.delete();

    // Build a bounded planar face (Z=0 plane, 0..15 x 0..15)
    // gp_Pln_4(A,B,C,D): plane Ax+By+Cz+D=0 → Z=0 plane
    // BRepBuilderAPI_MakeFace_9(plane, umin, umax, vmin, vmax)
    const plane = new (oc as { gp_Pln_4: new (a: number, b: number, c: number, d: number) => unknown }).gp_Pln_4(0, 0, 1, 0);
    const faceMk = new (oc as { BRepBuilderAPI_MakeFace_9: new (p: unknown, u1: number, u2: number, v1: number, v2: number) => { Shape(): unknown; delete?(): void } }).BRepBuilderAPI_MakeFace_9(plane, 0, 15, 0, 15);
    const freeFace = faceMk.Shape();
    faceMk.delete?.();

    // Build a compound: solid + free face (no shell wrapping)
    const builder = new (oc as { BRep_Builder: new () => { MakeCompound(c: unknown): void; Add(c: unknown, s: unknown): void; delete(): void } }).BRep_Builder();
    const rawComp = new (oc as { TopoDS_Compound: new () => unknown }).TopoDS_Compound();
    builder.MakeCompound(rawComp);
    builder.Add(rawComp, boxSolid);
    builder.Add(rawComp, freeFace);
    builder.delete();

    const compound: OcctShape = { __brand: 'OcctShape', handle: rawComp };
    try {
      const result = splitImportedShapeHelper(oc, compound);
      try {
        // pass-1: 1 solid from the box
        expect(result.solids.length).toBe(1);
        // pass-3: 1 free face captured in surfaces (not in any shell before round-trip)
        expect(result.surfaces).not.toBeNull();
        expect(result.surfaces!.brepBlobId).toMatch(/^imp-/);
        const sb = computeBoundingBox(oc, result.surfaces!.shape);
        expect(sb).toHaveLength(6);
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(compound);
    }
  });

  // D7: isManifold is computed per-solid (whichever shape ends up as
  // ImportedFeature.bodyRef), not just at compound level — a compound mixing
  // a watertight solid and a broken one must report per-solid flags, not one
  // stale flag for the whole compound.
  it('in-memory compound (watertight solid + open-shell solid) → per-solid isManifold flags (D7)', () => {
    const ocAny = oc as {
      BRepPrimAPI_MakeBox_2: new (x: number, y: number, z: number) => { Shape(): unknown; delete(): void };
      TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
      TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
        More(): boolean; Next(): void; Current(): unknown; delete?(): void;
      };
      BRepBuilderAPI_Sewing: new (tol: number, a: boolean, b: boolean, c: boolean, d: boolean) => {
        Add(s: unknown): void; Perform(pr: unknown): void; SewedShape(): unknown; delete?(): void;
      };
      Message_ProgressRange_1: new () => unknown;
      TopoDS: { Shell_1(s: unknown): unknown };
      BRepBuilderAPI_MakeSolid_3: new (shell: unknown) => { Solid(): unknown; delete(): void };
      BRep_Builder: new () => { MakeCompound(c: unknown): void; Add(c: unknown, s: unknown): void; delete(): void };
      TopoDS_Compound: new () => unknown;
    };

    // Watertight box solid.
    const goodMk = new ocAny.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const goodSolid = goodMk.Shape();
    goodMk.delete();

    // Broken solid: box with one face removed, sewn into an open shell, then
    // wrapped as a TopoDS_Solid — mirrors ManifoldCheck.integration.spec.ts.
    const badBoxMk = new ocAny.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const badBoxSolid = badBoxMk.Shape();
    badBoxMk.delete();

    const faces: unknown[] = [];
    const faceExp = new ocAny.TopExp_Explorer_2(badBoxSolid, ocAny.TopAbs_ShapeEnum.TopAbs_FACE, ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (faceExp.More()) { faces.push(faceExp.Current()); faceExp.Next(); }
    faceExp.delete?.();

    const sewing = new ocAny.BRepBuilderAPI_Sewing(1.0e-6, true, true, true, false);
    for (let i = 0; i < faces.length - 1; i++) sewing.Add(faces[i]);
    sewing.Perform(new ocAny.Message_ProgressRange_1());
    const sewedShape = sewing.SewedShape();
    sewing.delete?.();

    const shellTyped = ocAny.TopoDS.Shell_1(sewedShape);
    const mkSolid = new ocAny.BRepBuilderAPI_MakeSolid_3(shellTyped);
    const badSolid = mkSolid.Solid();
    mkSolid.delete();

    // Compound: good solid + broken solid.
    const builder = new ocAny.BRep_Builder();
    const rawComp = new ocAny.TopoDS_Compound();
    builder.MakeCompound(rawComp);
    builder.Add(rawComp, goodSolid);
    builder.Add(rawComp, badSolid);
    builder.delete();

    const compound: OcctShape = { __brand: 'OcctShape', handle: rawComp };
    try {
      const result = splitImportedShapeHelper(oc, compound);
      try {
        expect(result.solids.length).toBe(2);
        const flags = result.solids.map((s) => s.isManifold).sort();
        expect(flags).toEqual([false, true]);
      } finally {
        for (const s of result.solids) disposeShape(s.shape);
        if (result.surfaces) disposeShape(result.surfaces.shape);
      }
    } finally {
      disposeShape(compound);
    }
  });

  (hasPredator ? it : it.skip)(
    'REAL Predator → 8 solid blobs + 1 surfaces blob with wingspan bbox',
    () => {
      const bytes = readFileSync(PREDATOR_LOCAL);
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const parent = readStep(oc, ab);
      try {
        const result = splitImportedShapeHelper(oc, parent.shape);
        try {
          expect(result.solids.length).toBe(8);
          expect(result.surfaces).not.toBeNull();
          // Surfaces bbox must reach the wingspan (|x| > 6000)
          const sb = computeBoundingBox(oc, result.surfaces!.shape);
          expect(Math.max(Math.abs(sb[0]), Math.abs(sb[3]))).toBeGreaterThan(6000);
        } finally {
          for (const s of result.solids) disposeShape(s.shape);
          if (result.surfaces) disposeShape(result.surfaces.shape);
        }
      } finally {
        disposeShape(parent.shape);
      }
    }
  );
});
