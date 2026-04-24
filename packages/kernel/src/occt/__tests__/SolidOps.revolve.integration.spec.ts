import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeRevolve, computeBoundingBox, disposeShape } from '../SolidOps';
import { makeRectangleWireXY } from '../SketchOps';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

/**
 * Builds a planar face from a rectangular wire on the XY plane. Returns
 * both the face handle (for consumption by MakeRevol) and the wire (so
 * the caller can dispose it at the end of the test).
 *
 * `makeRectangleWireXY` takes positional args `(oc, x, y, w, h)` — not
 * an object — so we forward them that way.
 */
function faceFromRectangle(
  oc: OcctInstance,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const wire = makeRectangleWireXY(oc, x, y, w, h);
  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(
    wire.wire as never,
    true as never
  );
  const face = mkFace.Face();
  mkFace.delete();
  return { handle: face, wire };
}

describe('makeRevolve (integration)', () => {
  it('full 360° revolve of a 10x5 rectangle at x=5 around Y axis → cylinder-like solid', () => {
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 1, 0],
      angleRad: 2 * Math.PI
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      // Outer radius = 15; inner = 5 (hole); height = 5.
      expect(bbox[3] - bbox[0]).toBeCloseTo(30, 0.5); // diameter
      expect(bbox[4] - bbox[1]).toBeCloseTo(5, 0.5); // height
      expect(bbox[5] - bbox[2]).toBeCloseTo(30, 0.5); // diameter
      disposeShape(r.value);
    }
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });

  it('partial 90° revolve → quarter-slice; bbox smaller than full', () => {
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 1, 0],
      angleRad: Math.PI / 2
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      expect(bbox[3] - bbox[0]).toBeLessThan(30);
      disposeShape(r.value);
    }
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });

  it('degenerate axis (origin == direction) returns err', () => {
    const { handle, wire } = faceFromRectangle(oc, 5, 0, 10, 5);
    const r = makeRevolve(oc, {
      profile: { __brand: 'OcctShape', handle },
      axisOrigin: [0, 0, 0],
      axisDir: [0, 0, 0], // zero vector
      angleRad: Math.PI
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('revolveFailed');
    (handle as { delete?: () => void }).delete?.();
    (wire.wire as { delete?: () => void }).delete?.();
  });
});
