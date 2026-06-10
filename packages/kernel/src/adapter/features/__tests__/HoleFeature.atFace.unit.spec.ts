import { describe, it, expect } from 'vitest';
import { resolveAtFaceLocations } from '../HoleFeature';
import { face2DFrame } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { FaceName, HolePlacement } from '@zilventor/shared';

// A Front face at y=+W/2 (panel local: Front=+Y per face2DFrame, face2DFrame origin at y=+200, normal=+Y),
// plane origin at the face. The fake oc returns this plane for the named face.
function fakeOc(faceOrigin: { x: number; y: number; z: number }, faceNormal: { x: number; y: number; z: number }) {
  const pnts: Array<{ x: number; y: number; z: number }> = [];
  const dirs: Array<{ x: number; y: number; z: number }> = [];
  return {
    rec: { pnts, dirs },
    oc: {
      TopoDS: { Face_1: (f: unknown) => f },
      BRepAdaptor_Surface_2: class {
        constructor(_f: unknown, _b: boolean) {}
        Plane() {
          return {
            Location: () => ({ X: () => faceOrigin.x, Y: () => faceOrigin.y, Z: () => faceOrigin.z }),
            Axis: () => ({ Direction: () => ({ X: () => faceNormal.x, Y: () => faceNormal.y, Z: () => faceNormal.z }) }),
          };
        }
        delete() {}
      },
      gp_Pnt_3: class { constructor(x: number, y: number, z: number) { pnts.push({ x, y, z }); } },
      gp_Dir_4: class { constructor(x: number, y: number, z: number) { dirs.push({ x, y, z }); } },
    } as unknown,
  };
}

const faceName: FaceName = { featureId: 'panel', role: 'Front', instance: 0 };

function runningBodyFor(name: FaceName): NamedShape {
  // findFaceByName matches on faceNamesEqual; the face handle is opaque.
  return { shape: {}, faceNames: [{ name, face: { __face: true } }] } as unknown as NamedShape;
}

describe('resolveAtFaceLocations', () => {
  it('drills the hole axis INTO the material (negated outward normal)', () => {
    // panel L=600 W=400 T=18 — Front face outward normal is +Y (Front=+Y per face2DFrame).
    const { oc, rec } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    const dims = { length: 600, width: 400, thickness: 18 };
    const locs = resolveAtFaceLocations(oc as never, runningBodyFor(faceName), placement, dims, false);
    expect(locs).toHaveLength(1);
    // Outward normal +Y → drill axis must point -Y (into the panel, toward center).
    // Use Object.is-safe comparison: negating 0 → -0, both equal for arithmetic.
    expect(rec.dirs[0]!.x).toBeCloseTo(0);
    expect(rec.dirs[0]!.y).toBeCloseTo(-1);
    expect(rec.dirs[0]!.z).toBeCloseTo(0);
  });

  it('maps (u,v)=(0,0) to the face2DFrame origin in panel-local 3D space', () => {
    const { oc, rec } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const dims = { length: 600, width: 400, thickness: 18 };
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    resolveAtFaceLocations(oc as never, runningBodyFor(faceName), placement, dims, false);
    // face2DFrame('Front') origin must equal the recorded gp_Pnt for (0,0).
    const fr = face2DFrame(dims, 'Front');
    expect(rec.pnts[0]).toEqual(fr.origin);
  });

  it('throws when the named face is absent (so the soft-fail caller drops the hole loudly in tests)', () => {
    const { oc } = fakeOc({ x: 0, y: +200, z: 9 }, { x: 0, y: +1, z: 0 });
    const placement: Extract<HolePlacement, { kind: 'atFace' }> = {
      kind: 'atFace', faceName, points: [{ u: 0, v: 0 }], axis: 'into-face',
    };
    const dims = { length: 600, width: 400, thickness: 18 };
    const empty = { shape: {}, faceNames: [] } as unknown as NamedShape;
    expect(() => resolveAtFaceLocations(oc as never, empty, placement, dims, false)).toThrow(/face .* not found/);
  });
});
