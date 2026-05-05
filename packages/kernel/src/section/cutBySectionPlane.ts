import type { OcctInstance } from '../occt/occtLoader';
import type { OcctShape } from '../occt/SolidOps';
import type { Vec3 } from '@zilventor/shared';

export type Plane = { origin: Vec3; normal: Vec3 };

// Half-space box dimensions (mm): face-coincident side has zero extent along normal.
const BOX_HALF = 2_000_000; // 2 km half-width in both transverse axes
const BOX_DEPTH = 1_000_000; // 1 km depth along the normal

/**
 * Build a 2km×2km×1km solid whose face at local Z=0 is coincident with
 * `plane`. The solid grows in the direction OPPOSITE to `arrowDirection*normal`.
 *
 * arrowDirection=1  → solid is on the -normal side of the plane
 * arrowDirection=-1 → solid is on the +normal side of the plane
 */
export function buildHalfSpace(
  oc: OcctInstance,
  plane: Plane,
  arrowDirection: -1 | 1
): OcctShape {
  // 1. Make a box at the OCCT origin: [0,BOX_HALF]×[0,BOX_HALF]×[0,BOX_DEPTH]
  const mk = new oc.BRepPrimAPI_MakeBox_2(BOX_HALF, BOX_HALF, BOX_DEPTH);
  const rawBox = mk.Shape();
  mk.delete();

  // 2. Translate so the Z=0 face is centred at the local origin.
  const tx = new oc.gp_Trsf_1();
  const tv = new oc.gp_Vec_4(-BOX_HALF / 2, -BOX_HALF / 2, 0);
  (tx as unknown as { SetTranslation_1(v: unknown): void }).SetTranslation_1(tv as never);
  const centred = new oc.BRepBuilderAPI_Transform_2(rawBox as never, tx as never, true as never);
  const centredShape = (centred as unknown as { Shape(): unknown }).Shape();
  (centred as unknown as { delete(): void }).delete();
  (tx as unknown as { delete(): void }).delete();
  (tv as unknown as { delete(): void }).delete();

  // 3. Compute the keep-direction: opposite to arrowDirection*normal.
  const { normal, origin } = plane;
  const sign = -arrowDirection as number;
  const nx = normal.x * sign;
  const ny = normal.y * sign;
  const nz = normal.z * sign;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

  const keepDir = new oc.gp_Dir_4(nx / len, ny / len, nz / len);
  const orig    = new oc.gp_Pnt_3(origin.x, origin.y, origin.z);

  // gp_Ax3_4(origin, dir) → Z-axis = keepDir
  // NOTE: the plan used gp_Ax3_2(orig, keepDir) but in this OCCT build
  //       gp_Ax3_2 takes a gp_Ax2 argument. The correct ctor is gp_Ax3_4(gp_Pnt, gp_Dir).
  const worldAx3 = new oc.gp_Ax3_4(orig as never, keepDir as never);
  // gp_Ax3_1() = no-arg default: origin (0,0,0), Z-axis (0,0,1)
  // NOTE: the plan used gp_Ax3_4() (no-arg), but that ctor takes (gp_Pnt, gp_Dir).
  //       The correct no-arg ctor is gp_Ax3_1().
  const localAx3 = new oc.gp_Ax3_1();
  const align = new oc.gp_Trsf_1();
  (align as unknown as { SetTransformation_1(a: unknown, b: unknown): void })
    .SetTransformation_1(worldAx3 as never, localAx3 as never);

  const xform = new oc.BRepBuilderAPI_Transform_2(centredShape as never, align as never, true as never);
  const result = (xform as unknown as { Shape(): unknown }).Shape();
  (xform as unknown as { delete(): void }).delete();
  (align as unknown as { delete(): void }).delete();
  (localAx3 as unknown as { delete(): void }).delete();
  (worldAx3 as unknown as { delete(): void }).delete();
  (orig as unknown as { delete(): void }).delete();
  (keepDir as unknown as { delete(): void }).delete();
  (centredShape as unknown as { delete?(): void }).delete?.();

  return { __brand: 'OcctShape', handle: result };
}
