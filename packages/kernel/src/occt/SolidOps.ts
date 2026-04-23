import type { OcctInstance } from './occtLoader';

/**
 * Opaque branded wrapper around an OCCT TopoDS_Shape.
 *
 * We keep `handle` as `unknown` so callers cannot accidentally treat it as
 * a plain JS object; every consumer that needs to call OCCT methods on the
 * shape goes through helpers in this module (or in Tessellator).
 */
export type OcctShape = { __brand: 'OcctShape'; handle: unknown };

/**
 * Builds an axis-aligned box at the origin with dimensions (dx, dy, dz).
 * The underlying `BRepPrimAPI_MakeBox_2` takes three reals and constructs a
 * box spanning [0,dx] x [0,dy] x [0,dz].
 */
export function makeBox(
  oc: OcctInstance,
  dx: number,
  dy: number,
  dz: number
): OcctShape {
  const mk = new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz);
  const shape = mk.Shape();
  mk.delete();
  return { __brand: 'OcctShape', handle: shape };
}

/**
 * Returns the axis-aligned bounding box of a shape as a 6-tuple
 * [xmin, ymin, zmin, xmax, ymax, zmax].
 *
 * The pinned opencascade.js build exposes `Bnd_Box.CornerMin()` /
 * `CornerMax()` returning `gp_Pnt`, which is the ergonomic path. The
 * alternative `Bnd_Box.Get(xmin, ymin, zmin, xmax, ymax, zmax)` expects
 * mutable out-references that are awkward to call from JS, so we avoid it.
 *
 * `BRepBndLib.Add` is static; the third `useTriangulation` parameter is
 * passed as `false` so the box is computed from the exact geometry rather
 * than from any cached mesh (which may not exist yet for a freshly-built
 * solid).
 */
export function computeBoundingBox(
  oc: OcctInstance,
  shape: OcctShape
): [number, number, number, number, number, number] {
  const bb = new oc.Bnd_Box_1();
  oc.BRepBndLib.Add(shape.handle as never, bb, false as never);
  const pmin = bb.CornerMin();
  const pmax = bb.CornerMax();
  const result: [number, number, number, number, number, number] = [
    pmin.X(),
    pmin.Y(),
    pmin.Z(),
    pmax.X(),
    pmax.Y(),
    pmax.Z()
  ];
  pmin.delete();
  pmax.delete();
  bb.delete();
  return result;
}

/**
 * Frees the underlying OCCT shape. Calling after dispose is undefined
 * behavior — callers must null out their references.
 */
export function disposeShape(shape: OcctShape): void {
  (shape.handle as { delete?: () => void }).delete?.();
}
