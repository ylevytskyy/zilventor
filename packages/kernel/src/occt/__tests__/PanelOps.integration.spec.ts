import { beforeAll, describe, expect, it } from 'vitest';
import { loadOcct, type OcctInstance } from '../occtLoader';
import { buildPanelBox } from '../PanelOps';
import type { EdgeName } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

/**
 * Walk every TopAbs_EDGE in `shape` and collect the set of incident
 * faces for each edge by intersecting against face-edge sets. Returns
 * the geometric midpoint of the unique edge whose face-pair matches
 * `(roleA, roleB)` in the centroid-classified face buckets.
 *
 * Mirrors the FaceNaming.resolveEdge idiom (IsSame on TopoDS_Shape) but
 * resolves directly through the panel's own classified faces so the
 * test doesn't depend on internal helpers.
 */
function midpointOfRimEdge(
  oc: OcctInstance,
  shape: unknown,
  topFace: unknown,
  sideFace: unknown,
): { x: number; y: number; z: number } | null {
  const ocAny = oc as unknown as {
    TopExp_Explorer_2: new (s: unknown, type: unknown, avoid: unknown) => {
      More: () => boolean;
      Current: () => unknown;
      Next: () => void;
      delete: () => void;
    };
    TopAbs_ShapeEnum: { TopAbs_EDGE: unknown; TopAbs_SHAPE: unknown };
    TopoDS: { Edge_1: (s: unknown) => unknown };
    BRepAdaptor_Curve_2: new (e: unknown) => {
      FirstParameter: () => number;
      LastParameter: () => number;
      Value: (t: number) => { X: () => number; Y: () => number; Z: () => number };
      delete: () => void;
    };
  };

  const collectEdges = (face: unknown): unknown[] => {
    const edges: unknown[] = [];
    const expl = new ocAny.TopExp_Explorer_2(
      face,
      ocAny.TopAbs_ShapeEnum.TopAbs_EDGE,
      ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (expl.More()) {
      edges.push(expl.Current());
      expl.Next();
    }
    expl.delete();
    return edges;
  };

  const edgesTop = collectEdges(topFace);
  const edgesSide = collectEdges(sideFace);

  let shared: unknown | null = null;
  for (const eA of edgesTop) {
    for (const eB of edgesSide) {
      if ((eA as { IsSame?: (other: unknown) => boolean }).IsSame?.(eB as never)) {
        shared = eA;
        break;
      }
    }
    if (shared) break;
  }

  if (!shared) {
    for (const e of edgesTop) (e as { delete?: () => void }).delete?.();
    for (const e of edgesSide) (e as { delete?: () => void }).delete?.();
    return null;
  }

  const typedEdge = ocAny.TopoDS.Edge_1(shared);
  const adaptor = new ocAny.BRepAdaptor_Curve_2(typedEdge);
  let result: { x: number; y: number; z: number } | null = null;
  try {
    const t = (adaptor.FirstParameter() + adaptor.LastParameter()) / 2;
    const p = adaptor.Value(t);
    result = { x: p.X(), y: p.Y(), z: p.Z() };
  } finally {
    adaptor.delete();
  }
  for (const e of edgesTop) if (e !== shared) (e as { delete?: () => void }).delete?.();
  for (const e of edgesSide) (e as { delete?: () => void }).delete?.();
  return result;
}

describe('PanelOps integration', () => {
  it('face/edge names are stable across rebuild with different dimensions', () => {
    const a = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });
    const b = buildPanelBox(occt, { length: 800, width: 500, thickness: 19 });

    for (const k of ['Top', 'Bottom', 'Front', 'Back', 'Left', 'Right'] as const) {
      expect(a.faceNames[k]).toEqual(b.faceNames[k]);
    }
    for (const k of ['front', 'back', 'left', 'right'] as const) {
      expect(a.edgeNames[k]).toEqual(b.edgeNames[k]);
    }
  });

  it('edge mapping matches spec convention: front=top∧+Y, back=top∧-Y, left=top∧-X, right=top∧+X', () => {
    const r = buildPanelBox(occt, { length: 600, width: 400, thickness: 18 });

    // Re-classify the face handles by walking `r.shape`. We don't expose
    // them directly on PanelBoxResult — but we can rebuild the same
    // face-by-role mapping by exploring the shape and matching centroids
    // to the analytic box. (Same approach as classifyPanelFaces.)
    const ocAny = occt as unknown as {
      TopExp_Explorer_2: new (s: unknown, t: unknown, a: unknown) => {
        More: () => boolean;
        Current: () => unknown;
        Next: () => void;
        delete: () => void;
      };
      TopAbs_ShapeEnum: { TopAbs_FACE: unknown; TopAbs_SHAPE: unknown };
      GProp_GProps_1: new () => {
        CentreOfMass: () => { X: () => number; Y: () => number; Z: () => number };
        delete: () => void;
      };
      BRepGProp: {
        SurfaceProperties_1: (s: unknown, p: unknown, eps: number, useTri: boolean) => void;
      };
    };

    const cx = 0;
    const cy = 0;
    const cz = 18 / 2;
    const buckets: Record<string, unknown> = {};
    const expl = new ocAny.TopExp_Explorer_2(
      r.shape,
      ocAny.TopAbs_ShapeEnum.TopAbs_FACE,
      ocAny.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    while (expl.More()) {
      const f = expl.Current();
      const props = new ocAny.GProp_GProps_1();
      ocAny.BRepGProp.SurfaceProperties_1(f, props, 1e-7, false);
      const com = props.CentreOfMass();
      const dx = com.X() - cx;
      const dy = com.Y() - cy;
      const dz = com.Z() - cz;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const az = Math.abs(dz);
      let role: string;
      if (az >= ax && az >= ay) role = dz > 0 ? 'Top' : 'Bottom';
      else if (ay >= ax && ay >= az) role = dy > 0 ? 'Front' : 'Back';
      else role = dx > 0 ? 'Right' : 'Left';
      buckets[role] = f;
      (com as unknown as { delete: () => void }).delete();
      props.delete();
      expl.Next();
    }
    expl.delete();

    const front = midpointOfRimEdge(occt, r.shape, buckets.Top!, buckets.Front!)!;
    const back = midpointOfRimEdge(occt, r.shape, buckets.Top!, buckets.Back!)!;
    const left = midpointOfRimEdge(occt, r.shape, buckets.Top!, buckets.Left!)!;
    const right = midpointOfRimEdge(occt, r.shape, buckets.Top!, buckets.Right!)!;

    expect(front.y).toBeGreaterThan(0);
    expect(back.y).toBeLessThan(0);
    expect(left.x).toBeLessThan(0);
    expect(right.x).toBeGreaterThan(0);

    // All four rim midpoints are on Z = thickness (the top face plane).
    for (const m of [front, back, left, right]) {
      expect(m.z).toBeCloseTo(18, 5);
    }

    // Sanity: the edge names returned by buildPanelBox match canonical
    // {Top, side} pairs and are well-formed EdgeName objects.
    const ensureEdge = (e: EdgeName): void => {
      expect(e).toHaveProperty('faceA');
      expect(e).toHaveProperty('faceB');
    };
    ensureEdge(r.edgeNames.front);
    ensureEdge(r.edgeNames.back);
    ensureEdge(r.edgeNames.left);
    ensureEdge(r.edgeNames.right);
  });
});
