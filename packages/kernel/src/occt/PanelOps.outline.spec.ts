// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { buildPanelBox } from './PanelOps';
import { faceNamesEqual } from './FaceNaming';
import { loadOcct } from './occtLoader';
import type { OcctInstance } from './occtLoader';
import type { FaceName } from '@zilventor/shared';
import { classifyPanelFaceRole } from '../adapter/FeatureTree';

let occt: OcctInstance;

beforeAll(async () => {
  occt = await loadOcct();
}, 60000);

const PENTAGON = [
  { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 },
  { x: 300, y: 600 }, { x: 0, y: 600 },
];

/** Compute volume of a TopoDS solid via BRepGProp.VolumeProperties_1. */
function solidVolume(oc: OcctInstance, shape: unknown): number {
  const ocAny = oc as unknown as {
    GProp_GProps_1: new () => { Mass: () => number; delete: () => void };
    BRepGProp: { VolumeProperties_1: (s: unknown, p: unknown, a: boolean, b: boolean, c: boolean) => void };
  };
  const props = new ocAny.GProp_GProps_1();
  ocAny.BRepGProp.VolumeProperties_1(shape, props, true, false, false);
  const vol = props.Mass();
  props.delete();
  return vol;
}

/** Count faces in a TopoDS_Shape via TopExp_Explorer. */
function countFaces(oc: OcctInstance, shape: unknown): number {
  const ocAny = oc as unknown as {
    TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
      More: () => boolean;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
  };
  const expl = new ocAny.TopExp_Explorer_2(
    shape,
    ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
    ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );
  let n = 0;
  while (expl.More()) { n++; expl.Next(); }
  expl.delete();
  return n;
}

describe('buildPanelBox — outline path (prism from polygon)', () => {
  it('rectangle without outline still works (regression)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    expect(result.bbox).toEqual([-300, -200, 0, 300, 200, 18]);
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
    expect(result.faceNames.Front).toBeDefined();
  });

  it('pentagon outline produces a solid with 7 faces (5 sides + top + bottom)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // shape must exist (prism built successfully)
    expect(typeof result.shape).toBe('object');
    expect(result.shape).not.toBeNull();
    // 7 faces: top + bottom + 5 sides
    expect(countFaces(occt, result.shape)).toBe(7);
    // Top and Bottom face names are present
    expect(result.faceNames.Top).toBeDefined();
    expect(result.faceNames.Bottom).toBeDefined();
  });

  it('pentagon outline AABB is full bounding rectangle (conservative for cut-list)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // bbox = [-L/2, -W/2, 0, L/2, W/2, T]
    expect(result.bbox).toEqual([-300, -300, 0, 300, 300, 18]);
  });

  it('pentagon faceNames does NOT have Front/Back/Left/Right (side faces unclassified)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    // Side faces are not classified for outline panels in Slice E
    expect((result.faceNames as Record<string, unknown>).Front).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Back).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Left).toBeUndefined();
    expect((result.faceNames as Record<string, unknown>).Right).toBeUndefined();
  });

  it('outline with fewer than 3 vertices throws a clear error', () => {
    expect(() =>
      buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, [{ x: 0, y: 0 }, { x: 600, y: 0 }])
    ).toThrow(/at least 3 vertices/);

    expect(() =>
      buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, [])
    ).toThrow(/at least 3 vertices/);
  });

  it('outline panel: classifyPanelFaceRole (real FeatureTree logic) produces exactly Top+Bottom for pentagon caps', () => {
    // This test locks the REAL classification function used by FeatureTree.ts's
    // panel face-attachment loop (exported as classifyPanelFaceRole).
    // The old "FeatureTree simulation" reimplemented Z-proximity in the test,
    // giving false confidence: production used dominant-axis and would misclassify
    // a 600×600 pentagon (XY centroid offset ~28 mm > Z half-thickness 9 mm →
    // both caps classified as 'Back' → panelFaceNames['Back']=undefined → skipped).
    //
    // This test was RED against the dominant-axis implementation and GREEN only
    // after classifyPanelFaceRole was fixed to use Z-proximity for outline panels.
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);

    const ocAny = occt as unknown as {
      Bnd_Box_1: new () => {
        CornerMin: () => { X: () => number; Y: () => number; Z: () => number };
        CornerMax: () => { X: () => number; Y: () => number; Z: () => number };
        delete: () => void;
      };
      BRepBndLib: { Add: (s: unknown, b: unknown, useTri: unknown) => void };
      TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
        More: () => boolean;
        Current: () => unknown;
        Next: () => void;
        delete: () => void;
      };
      TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
      GProp_GProps_1: new () => {
        CentreOfMass: () => { X: () => number; Y: () => number; Z: () => number };
        delete: () => void;
      };
      BRepGProp: { SurfaceProperties_1: (s: unknown, p: unknown, eps: number, useTri: boolean) => void };
    };

    const bb = new ocAny.Bnd_Box_1();
    ocAny.BRepBndLib.Add(result.shape, bb, false as never);
    const cmin = bb.CornerMin();
    const cmax = bb.CornerMax();
    const cx = (cmin.X() + cmax.X()) / 2;
    const cy = (cmin.Y() + cmax.Y()) / 2;
    const cz = (cmin.Z() + cmax.Z()) / 2;
    const minZ = cmin.Z();
    const maxZ = cmax.Z();
    (cmin as unknown as { delete: () => void }).delete();
    (cmax as unknown as { delete: () => void }).delete();
    bb.delete();

    const namedFaces: Array<{ name: FaceName; face: unknown }> = [];
    const expl = new ocAny.TopExp_Explorer_2(
      result.shape,
      ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
      ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (expl.More()) {
      const face = expl.Current();
      const props = new ocAny.GProp_GProps_1();
      ocAny.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const com = props.CentreOfMass();
      const dx = com.X() - cx;
      const dy = com.Y() - cy;
      const dz = com.Z() - cz;
      const faceZ = cz + dz;
      (com as unknown as { delete: () => void }).delete();
      props.delete();
      // Call the REAL FeatureTree classifier (not a reimplementation).
      const role = classifyPanelFaceRole(dx, dy, dz, faceZ, minZ, maxZ, /*isOutline=*/true);
      if (role) {
        const fn = (result.faceNames as Record<string, FaceName | undefined>)[role];
        if (fn !== undefined) namedFaces.push({ name: fn, face });
      }
      expl.Next();
    }
    expl.delete();

    // Exactly Top and Bottom named (§2.3: side faces deferred).
    expect(namedFaces.length).toBe(2);
    expect(namedFaces.some(e => e.name.role === 'Top')).toBe(true);
    expect(namedFaces.some(e => e.name.role === 'Bottom')).toBe(true);
    // No undefined-named entries.
    for (const entry of namedFaces) {
      expect(entry.name.featureId).toBeDefined();
      expect(entry.name.role).toBeDefined();
    }
  });

  it('faceNamesEqual does not crash when first arg is undefined (Defect 1 — Fix E defensive guard)', () => {
    // RED before Fix E: faceNamesEqual(undefined, validName) throws
    //   TypeError: Cannot read properties of undefined (reading 'featureId')
    // because FeatureTree.ts can call attachName with undefined (panelFaceNames[sideRole])
    // and FaceNaming.faceNamesEqual is later called on the stored undefined name.
    // GREEN after Fix E adds `if (!a || !b) return false` guard.
    const validName: FaceName = { featureId: 'panel', role: 'Top', instance: 0 };
    expect(() => faceNamesEqual(undefined as unknown as FaceName, validName)).not.toThrow();
    expect(faceNamesEqual(undefined as unknown as FaceName, validName)).toBe(false);
    expect(faceNamesEqual(validName, undefined as unknown as FaceName)).toBe(false);
  });

  it('pentagon prism has positive volume (CCW input — winding check)', () => {
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, PENTAGON);
    const vol = solidVolume(occt, result.shape);
    // Shoelace signed area of PENTAGON in centered coords ≈ 315 000 mm²; vol = 315 000 × 18.
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeCloseTo(5_670_000, -3); // within 1 000 mm³
  });

  it('pentagon prism CW-wound input also has positive volume (winding normalization)', () => {
    const CW_PENTAGON = [...PENTAGON].reverse();
    const result = buildPanelBox(occt, { length: 600, width: 600, thickness: 18 }, CW_PENTAGON);
    const vol = solidVolume(occt, result.shape);
    expect(vol).toBeGreaterThan(0);
  });
});
