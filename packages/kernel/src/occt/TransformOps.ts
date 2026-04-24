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
