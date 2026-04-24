import type { EdgeName, FaceName } from '@zilventor/shared';
import type { OcctShape } from './SolidOps';
import type { OcctInstance } from './occtLoader';

export type NamedShape = {
  shape: OcctShape;
  /** Parallel array of (name, TopoDS_Face handle). Linear lookup is fine
   *  at the scale of a single part's face count (dozens, not millions). */
  faceNames: Array<{ name: FaceName; face: unknown }>;
};

/**
 * Construct a FaceName. `instance` defaults to 0 (so roles with a single
 * face don't need the caller to pass 0 explicitly).
 */
export function namedFace(featureId: string, role: string, instance: number = 0): FaceName {
  return { featureId, role, instance };
}

export function faceNamesEqual(a: FaceName, b: FaceName): boolean {
  return a.featureId === b.featureId && a.role === b.role && (a.instance ?? 0) === (b.instance ?? 0);
}

/**
 * Attach a name to a face on a NamedShape. Mutates `nm.faceNames`.
 */
export function attachName(nm: NamedShape, face: unknown, name: FaceName): void {
  nm.faceNames.push({ name, face });
}

/** Re-export `canonicalEdgeName` so callers can import everything naming-
 *  related from this module. */
export { canonicalEdgeName } from '@zilventor/shared';

/**
 * Resolve a stored EdgeName to the current TopoDS_Edge in a NamedShape.
 *
 * Strategy: find both faces by name lookup. Then enumerate edges of one
 * face via TopExp_Explorer, looking for the edge that is also present
 * on the other face (via TopoDS_Shape.IsSame or a shared-edge comparison).
 *
 * Returns the TopoDS_Edge handle on hit, null on miss. The returned
 * handle's lifetime is tied to the parent shape; callers should not
 * dispose it independently.
 */
export function resolveEdge(
  oc: OcctInstance,
  nm: NamedShape,
  edgeName: EdgeName
): unknown | null {
  const a = nm.faceNames.find((e) => faceNamesEqual(e.name, edgeName.faceA))?.face;
  const b = nm.faceNames.find((e) => faceNamesEqual(e.name, edgeName.faceB))?.face;
  if (!a || !b) return null;

  const explA = new oc.TopExp_Explorer_2(
    a as never,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  const edgesA: unknown[] = [];
  while (explA.More()) {
    edgesA.push(explA.Current());
    explA.Next();
  }
  explA.delete();

  const explB = new oc.TopExp_Explorer_2(
    b as never,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while (explB.More()) {
    const eB = explB.Current();
    for (const eA of edgesA) {
      if ((eA as { IsSame?: (other: unknown) => boolean }).IsSame?.(eB as never)) {
        // Found the shared edge. Clean up remaining exploration.
        for (const e of edgesA) if (e !== eA) (e as { delete?: () => void }).delete?.();
        (eB as { delete?: () => void }).delete?.();
        explB.delete();
        return eA;
      }
    }
    (eB as { delete?: () => void }).delete?.();
    explB.Next();
  }
  explB.delete();
  for (const e of edgesA) (e as { delete?: () => void }).delete?.();
  return null;
}

/**
 * Resolve a stored vertex (identified by its >=3 converging edges) to
 * a TopoDS_Vertex in the shape. Returns null if any edge is missing or
 * the edges don't share a common vertex.
 */
export function resolveVertex(
  oc: OcctInstance,
  nm: NamedShape,
  vertexId: { edges: EdgeName[] }
): unknown | null {
  if (vertexId.edges.length < 2) return null;
  const resolved = vertexId.edges.map((en) => resolveEdge(oc, nm, en));
  if (resolved.some((e) => e === null)) return null;
  // Walk vertices of the first edge and check each is present on all others.
  const explV = new oc.TopExp_Explorer_2(
    resolved[0] as never,
    oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );
  while (explV.More()) {
    const v = explV.Current();
    let sharedByAll = true;
    for (let i = 1; i < resolved.length; i++) {
      const explOther = new oc.TopExp_Explorer_2(
        resolved[i] as never,
        oc.TopAbs_ShapeEnum.TopAbs_VERTEX as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
      );
      let foundOnThisEdge = false;
      while (explOther.More()) {
        const other = explOther.Current();
        if ((v as { IsSame?: (x: unknown) => boolean }).IsSame?.(other as never)) {
          foundOnThisEdge = true;
        }
        (other as { delete?: () => void }).delete?.();
        explOther.Next();
      }
      explOther.delete();
      if (!foundOnThisEdge) {
        sharedByAll = false;
        break;
      }
    }
    if (sharedByAll) {
      explV.delete();
      return v;
    }
    (v as { delete?: () => void }).delete?.();
    explV.Next();
  }
  explV.delete();
  return null;
}
