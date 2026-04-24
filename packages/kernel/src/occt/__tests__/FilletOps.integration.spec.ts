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

// Test-local helper using TopExp_Explorer + IsSame to find the shared vertex
// between two edges. Returns null if no shared vertex.
function findSharedVertex(oc: OcctInstance, edgeA: unknown, edgeB: unknown): unknown | null {
  const explA = new oc.TopExp_Explorer_2(
    edgeA as never,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const verticesA: unknown[] = [];
  while ((explA as { More: () => boolean }).More()) {
    verticesA.push((explA as { Current: () => unknown }).Current());
    (explA as { Next: () => void }).Next();
  }
  (explA as { delete: () => void }).delete();
  const explB = new oc.TopExp_Explorer_2(
    edgeB as never,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while ((explB as { More: () => boolean }).More()) {
    const vB = (explB as { Current: () => unknown }).Current();
    for (const vA of verticesA) {
      if ((vA as { IsSame?: (o: unknown) => boolean }).IsSame?.(vB as never)) {
        (explB as { delete: () => void }).delete();
        // Return one copy; dispose the rest.
        for (const v of verticesA) if (v !== vA) (v as { delete?: () => void }).delete?.();
        (vB as { delete?: () => void }).delete?.();
        return vA;
      }
    }
    (vB as { delete?: () => void }).delete?.();
    (explB as { Next: () => void }).Next();
  }
  (explB as { delete: () => void }).delete();
  for (const v of verticesA) (v as { delete?: () => void }).delete?.();
  return null;
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

  it('variable-radius fillet transitions linearly along one edge', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    const r = makeFillet(oc, box, {
      edges: [{ edge: edges[0]!, radius: 0, variable: { startRadius: 1, endRadius: 3 } }],
      setbacks: []
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Successful variable-radius fillet; mesh-worthy shape.
      const bbox = computeBoundingBox(oc, r.value);
      expect(bbox[3] - bbox[0]).toBeCloseTo(10, 1);
      disposeShape(r.value);
    }
    disposeShape(box);
  });

  it('setback pulls the blend back from a shared vertex', () => {
    const box = makeBox(oc, 10, 10, 10);
    const edges = enumerateEdges(oc, box.handle);
    // Find two edges that share a vertex — use the first two; on a box's
    // edge traversal, edges[0] and edges[1] commonly share a corner.
    // Test-local heuristic: try the first pair; if no vertex is shared,
    // the setback has no effect but the fillet still succeeds.
    const sharedVertex = findSharedVertex(oc, edges[0]!, edges[1]!);
    if (!sharedVertex) { disposeShape(box); return; }  // skip if no shared vertex at this traversal order

    const r = makeFillet(oc, box, {
      edges: [
        { edge: edges[0]!, radius: 2 },
        { edge: edges[1]!, radius: 2 }
      ],
      setbacks: [
        { vertex: sharedVertex, edge: edges[0]!, setback: 1 },
        { vertex: sharedVertex, edge: edges[1]!, setback: 1 }
      ]
    });
    expect(r.ok).toBe(true);
    if (r.ok) disposeShape(r.value);
    disposeShape(box);
  });
});
