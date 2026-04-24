import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape, type OcctShape } from '../SolidOps';
import { fuseShapes, cutShapes } from '../BooleanOps';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

describe('BooleanOps (integration)', () => {
  it('fuses two overlapping boxes into one shape whose bbox equals the union', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 10, 10, 10);
    // translate b by (5, 0, 0) so it overlaps a.
    const translated = translateShape(oc, b, 5, 0, 0);
    const r = fuseShapes(oc, a, translated);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      expect(bbox[3] - bbox[0]).toBeCloseTo(15, 1);
      expect(bbox[4] - bbox[1]).toBeCloseTo(10, 1);
      expect(bbox[5] - bbox[2]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(a);
    disposeShape(translated);
  });

  it('cuts an overlapping region; bbox preserves original extents', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 6, 6, 6);
    const translated = translateShape(oc, b, 2, 2, 2); // fully inside a
    const r = cutShapes(oc, a, translated);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(a);
    disposeShape(translated);
  });

  it('cut with no overlap returns err', () => {
    const a = makeBox(oc, 10, 10, 10);
    const b = makeBox(oc, 5, 5, 5);
    const translated = translateShape(oc, b, 100, 0, 0);
    const r = cutShapes(oc, a, translated);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('booleanFailed');
    disposeShape(a);
    disposeShape(translated);
  });
});

// Helper: move a shape by (dx, dy, dz).
function translateShape(
  oc: OcctInstance,
  s: OcctShape,
  dx: number,
  dy: number,
  dz: number
): OcctShape {
  const trsf = new oc.gp_Trsf_1();
  const vec = new oc.gp_Vec_4(dx, dy, dz);
  trsf.SetTranslation_1(vec);
  const builder = new oc.BRepBuilderAPI_Transform_2(
    s.handle as never,
    trsf as never,
    false as never
  );
  const shape = builder.Shape();
  builder.delete();
  vec.delete();
  trsf.delete();
  return { __brand: 'OcctShape', handle: shape };
}
