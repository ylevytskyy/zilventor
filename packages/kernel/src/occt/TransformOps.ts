import type { OcctInstance } from './occtLoader';
import type { OcctShape } from './SolidOps';

/**
 * Return a new shape that is `shape` translated by `(dx, dy, dz)`. Uses
 * `gp_Trsf_1 + SetTranslation_1 + BRepBuilderAPI_Transform_2(copy=true)`.
 * The caller owns the returned shape and must `disposeShape` it.
 *
 * `copy=true` is deliberate: the source shape may be referenced by other
 * boolean ops (e.g. a source extrude already applied to the running body),
 * and we don't want the transform to mutate it in place.
 */
export function translateShape(
  oc: OcctInstance,
  shape: OcctShape,
  dx: number,
  dy: number,
  dz: number
): OcctShape {
  const vec = new oc.gp_Vec_4(dx, dy, dz);
  const trsf = new oc.gp_Trsf_1();
  (trsf as { SetTranslation_1: (v: unknown) => void }).SetTranslation_1(vec as never);
  const transform = new oc.BRepBuilderAPI_Transform_2(
    shape.handle as never,
    trsf as never,
    true as never
  );
  const out = (transform as { Shape: () => unknown }).Shape();
  (transform as { delete: () => void }).delete();
  (trsf as { delete: () => void }).delete();
  (vec as unknown as { delete: () => void }).delete();
  return { __brand: 'OcctShape', handle: out };
}

/**
 * Return a new shape that is `shape` posed by `pose` (rotation then translation).
 * Builds a gp_Trsf via SetValues from the quaternion-derived 3×3 rotation matrix
 * + translation column, then BRepBuilderAPI_Transform_2(copy=true).
 * The caller owns the returned shape and must disposeShape it.
 */
export function transformShapeByPose(
  oc: OcctInstance,
  shape: OcctShape,
  pose: {
    translation: { x: number; y: number; z: number };
    quaternion: readonly [number, number, number, number];
  },
): OcctShape {
  const [x, y, z, w] = pose.quaternion;
  const { x: tx, y: ty, z: tz } = pose.translation;
  // Quaternion [x,y,z,w] → row-major 3×3 rotation matrix.
  const r00 = 1 - 2 * (y * y + z * z);
  const r01 = 2 * (x * y - w * z);
  const r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y);
  const r21 = 2 * (y * z + w * x);
  const r22 = 1 - 2 * (x * x + y * y);

  const trsf = new oc.gp_Trsf_1();
  (trsf as { SetValues: (...a: number[]) => void }).SetValues(
    r00, r01, r02, tx,
    r10, r11, r12, ty,
    r20, r21, r22, tz,
  );
  const transform = new oc.BRepBuilderAPI_Transform_2(
    shape.handle as never,
    trsf as never,
    true as never,
  );
  const out = (transform as { Shape: () => unknown }).Shape();
  (transform as { delete: () => void }).delete();
  (trsf as { delete: () => void }).delete();
  return { __brand: 'OcctShape', handle: out };
}

export type MirrorPlane = 'xy' | 'yz' | 'xz';

/**
 * Mirror `shape` across one of the three world coordinate planes. Uses
 * `gp_Trsf.SetMirror_3(gp_Ax2)` where the Ax2's normal is the axis
 * perpendicular to the reflection plane.
 *
 * Ownership mirrors `translateShape`: returned shape is caller-owned.
 */
export function mirrorShape(
  oc: OcctInstance,
  shape: OcctShape,
  plane: MirrorPlane
): OcctShape {
  const origin = new oc.gp_Pnt_3(0, 0, 0);
  const normal = new oc.gp_Dir_4(
    plane === 'yz' ? 1 : 0,
    plane === 'xz' ? 1 : 0,
    plane === 'xy' ? 1 : 0
  );
  const ax2 = new oc.gp_Ax2_3(origin as never, normal as never);
  const trsf = new oc.gp_Trsf_1();
  (trsf as { SetMirror_3: (a: unknown) => void }).SetMirror_3(ax2 as never);
  const transform = new oc.BRepBuilderAPI_Transform_2(
    shape.handle as never,
    trsf as never,
    true as never
  );
  const out = (transform as { Shape: () => unknown }).Shape();
  (transform as { delete: () => void }).delete();
  (trsf as { delete: () => void }).delete();
  (ax2 as unknown as { delete: () => void }).delete();
  (normal as unknown as { delete: () => void }).delete();
  (origin as unknown as { delete: () => void }).delete();
  return { __brand: 'OcctShape', handle: out };
}
