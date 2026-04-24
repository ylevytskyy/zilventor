import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { makeBox, computeBoundingBox, disposeShape } from '../SolidOps';
import { makeFillet } from '../FilletOps';

let oc: OcctInstance;
beforeAll(async () => {
  oc = await loadOcct();
}, 60_000);

function enumerateEdges(oc: OcctInstance, shape: unknown): unknown[] {
  // TopExp::MapShapes returns each sub-shape exactly once, unlike
  // TopExp_Explorer which walks edges per-owner (yielding every edge twice
  // on a closed solid because two faces share each edge).
  const map = new oc.TopTools_IndexedMapOfShape_1();
  oc.TopExp.MapShapes_1(
    shape as never,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    map
  );
  const edges: unknown[] = [];
  const n = (map as { Size: () => number }).Size();
  for (let i = 1; i <= n; i++) {
    const raw = (map as { FindKey: (i: number) => unknown }).FindKey(i);
    edges.push((oc.TopoDS as { Edge_1: (s: unknown) => unknown }).Edge_1(raw as never));
  }
  map.delete();
  return edges;
}

describe('makeFillet constant radius (integration)', () => {
  it('fillets all 12 edges of a cube at 2mm', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    expect(edges.length).toBe(12);
    const r = makeFillet(oc, box, {
      edges: edges.map((e) => ({ edge: e, radius: 2 })),
      setbacks: []
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const bbox = computeBoundingBox(oc, r.value);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(box);
  });

  it('returns filletFailed when radius exceeds curvature', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    const r = makeFillet(oc, box, {
      // Radius 20 is twice the cube side — OCCT cannot fit a 20mm fillet
      // onto a 10mm cube and must bail. The plan draft used r=6 but OCCT
      // actually absorbs 6mm fillets on a 10mm cube (they collide but
      // IsDone still returns true), so we use a radius that unambiguously
      // exceeds the half-extent.
      edges: edges.map((e) => ({ edge: e, radius: 20 })),
      setbacks: []
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('filletFailed');
    disposeShape(box);
  });
});
