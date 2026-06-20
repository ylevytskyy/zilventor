import type { OcctInstance } from './occtLoader';
import {
  ok,
  err,
  type Result,
  type KernelError,
  newCorrelationId
} from '@zilventor/shared';

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
 * Builds an axis-aligned box spanning two opposite corners `p1`/`p2`
 * (in any order — `BRepPrimAPI_MakeBox_4(p1, p2)` normalises min/max per axis).
 * Unlike `makeBox`, the box is NOT anchored at the origin, so callers can place
 * a cutter directly in panel-local space (e.g. for groove cuts).
 */
export function makeBoxFromCorners(
  oc: OcctInstance,
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number }
): OcctShape {
  const a = new oc.gp_Pnt_3(p1.x, p1.y, p1.z);
  const b = new oc.gp_Pnt_3(p2.x, p2.y, p2.z);
  const mk = new oc.BRepPrimAPI_MakeBox_4(a as never, b as never);
  const shape = mk.Shape();
  mk.delete();
  a.delete();
  b.delete();
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

/**
 * Parameters for `makeRevolve`.
 *   - `profile`: a planar face or wire to sweep.
 *   - `axisOrigin` / `axisDir`: the revolution axis (direction is normalized
 *     internally). A zero-length `axisDir` is rejected up front.
 *   - `angleRad`: sweep angle in radians (use `2 * Math.PI` for full).
 */
export type RevolveSpec = {
  profile: OcctShape;
  axisOrigin: [number, number, number];
  axisDir: [number, number, number];
  angleRad: number;
};

/**
 * Revolves a profile around an axis via `BRepPrimAPI_MakeRevol_1`.
 *
 * Overload notes:
 *   - `gp_Pnt_3(x, y, z)` — three-real point ctor.
 *   - `gp_Dir_4(x, y, z)` — three-real direction ctor (takes a normalized
 *     vector; OCCT will throw if the magnitude is zero, which is why we
 *     guard with a pre-check).
 *   - `gp_Ax1_2(gp_Pnt, gp_Dir)` — origin + direction axis ctor.
 *   - `BRepPrimAPI_MakeRevol_1(S, A, D, Copy)` — shape + axis + angle +
 *     copy-flag. Note this deviates from the plan's draft (`_2`) which is
 *     the no-angle full-360 variant; `_1` is the angle-aware constructor
 *     verified against `opencascade.full.d.ts`.
 *
 * Lifecycle:
 *   - Every `new oc.*` is disposed on every exit path (degenerate-axis
 *     guard, not-done, success, thrown). The `Message_ProgressRange_1`
 *     passed to `Build()` is held in a local and disposed alongside the
 *     builder — matching the pattern in `BooleanOps.ts`.
 */
export function makeRevolve(
  oc: OcctInstance,
  s: RevolveSpec
): Result<OcctShape, KernelError> {
  const [dx, dy, dz] = s.axisDir;
  const mag = Math.hypot(dx, dy, dz);
  if (mag < 1e-9) {
    return err({
      kind: 'revolveFailed',
      message: 'Degenerate axis direction',
      correlationId: newCorrelationId()
    });
  }
  let origin: unknown = null;
  let dir: unknown = null;
  let ax: unknown = null;
  let mk: unknown = null;
  let range: unknown = null;
  try {
    origin = new oc.gp_Pnt_3(s.axisOrigin[0], s.axisOrigin[1], s.axisOrigin[2]);
    dir = new oc.gp_Dir_4(dx / mag, dy / mag, dz / mag);
    ax = new oc.gp_Ax1_2(origin as never, dir as never);
    mk = new oc.BRepPrimAPI_MakeRevol_1(
      s.profile.handle as never,
      ax as never,
      s.angleRad,
      false as never
    );
    range = new oc.Message_ProgressRange_1();
    (mk as { Build: (r: unknown) => void }).Build(range);
    const done = (mk as { IsDone: () => boolean }).IsDone();
    if (!done) {
      (mk as { delete: () => void }).delete();
      (range as { delete: () => void }).delete();
      (ax as { delete: () => void }).delete();
      (dir as { delete: () => void }).delete();
      (origin as { delete: () => void }).delete();
      return err({
        kind: 'revolveFailed',
        message: 'MakeRevol did not converge',
        correlationId: newCorrelationId()
      });
    }
    const shape = (mk as { Shape: () => unknown }).Shape();
    (mk as { delete: () => void }).delete();
    (range as { delete: () => void }).delete();
    (ax as { delete: () => void }).delete();
    (dir as { delete: () => void }).delete();
    (origin as { delete: () => void }).delete();
    return ok({ __brand: 'OcctShape', handle: shape });
  } catch (e) {
    (mk as { delete?: () => void } | null)?.delete?.();
    (range as { delete?: () => void } | null)?.delete?.();
    (ax as { delete?: () => void } | null)?.delete?.();
    (dir as { delete?: () => void } | null)?.delete?.();
    (origin as { delete?: () => void } | null)?.delete?.();
    return err({
      kind: 'revolveFailed',
      message: `MakeRevol threw: ${(e as Error).message}`,
      correlationId: newCorrelationId()
    });
  }
}
