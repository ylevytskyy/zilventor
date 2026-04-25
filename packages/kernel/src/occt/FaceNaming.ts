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
 * Tag faces produced by a hole cut. Walks faces, classifies by surface type,
 * and assigns names under the `{featureId}/hole/{locationIndex}/{role}` convention.
 *
 * - Cylinders: smallest radius = shank; second smallest = cbore (if counterbore).
 * - Cones: smallest area = tip (if blind); remainder = csk (if countersink).
 *
 * This heuristic works because the hole cutter deliberately produces at most one
 * face per role per location, and radii/areas separate roles unambiguously for
 * the shapes we build.
 */
export function tagHoleFaces(
  oc: OcctInstance,
  cutBody: OcctShape,
  featureId: string,
  locationIndex: number,
  profileKind: 'simple' | 'counterbore' | 'countersink',
  blind: boolean,
): Map<unknown, FaceName> {
  const out = new Map<unknown, FaceName>();
  const explorer = new oc.TopExp_Explorer_2(
    cutBody as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
  );

  const cylFaces: { face: unknown; radius: number }[] = [];
  const conFaces: { face: unknown; area: number }[] = [];

  for (; explorer.More(); explorer.Next()) {
    const face = (oc as any).TopoDS.Face_1(explorer.Current());
    const surf = (oc as any).BRep_Tool.Surface_2(face).get();
    const type = surf.DynamicType().get().Name();
    if (type === 'Geom_CylindricalSurface') {
      const r = (surf as any).Radius();
      cylFaces.push({ face, radius: r });
    } else if (type === 'Geom_ConicalSurface') {
      const props = new (oc as any).GProp_GProps_1();
      (oc as any).BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      conFaces.push({ face, area: props.Mass() });
    }
  }
  explorer.delete();

  // Cylinders — ascending radius: smallest = shank, next = cbore
  cylFaces.sort((a, b) => a.radius - b.radius);
  if (cylFaces[0]) {
    out.set(cylFaces[0].face, { featureId, role: `${featureId}/hole/${locationIndex}/shank` });
  }
  if (profileKind === 'counterbore' && cylFaces[1]) {
    out.set(cylFaces[1].face, { featureId, role: `${featureId}/hole/${locationIndex}/cbore` });
  }

  // Cones — ascending area: smallest = tip (blind drill point), next = csk
  conFaces.sort((a, b) => a.area - b.area);
  let coneIdx = 0;
  if (blind && conFaces[coneIdx]) {
    out.set(conFaces[coneIdx]!.face, { featureId, role: `${featureId}/hole/${locationIndex}/tip` });
    coneIdx++;
  }
  if (profileKind === 'countersink' && conFaces[coneIdx]) {
    out.set(conFaces[coneIdx]!.face, { featureId, role: `${featureId}/hole/${locationIndex}/csk` });
  }

  return out;
}

/**
 * Tag faces produced by a sweep operation. Walks all faces, classifies as
 * planar (caps) vs non-planar (lateral).
 *
 * - Lateral faces are sorted by surface area (ascending) for stable indexing.
 * - For open paths: two planar faces become capStart / capEnd, ordered by
 *   centroid coordinate sum (smallest = start).
 * - For closed paths: skip cap classification entirely (pass `pathClosed: true`)
 *   — all faces become lateral/<i>.
 */
export function tagSweepFaces(
  oc: any,
  sweptShape: any,
  featureId: string,
  pathClosed: boolean,
): Array<{ name: FaceName; face: unknown }> {
  const out: Array<{ name: FaceName; face: unknown }> = [];
  const explorer = new oc.TopExp_Explorer_2(
    sweptShape, oc.TopAbs_ShapeEnum.TopAbs_FACE as any, oc.TopAbs_ShapeEnum.TopAbs_SHAPE as any,
  );
  const planarFaces: { face: any; centroidSum: number; area: number }[] = [];
  const lateralFaces: { face: any; area: number }[] = [];

  for (; explorer.More(); explorer.Next()) {
    const face = (oc as any).TopoDS.Face_1(explorer.Current());
    const surf = (oc as any).BRep_Tool.Surface_2(face).get();
    const type = surf.DynamicType().get().Name();
    const props = new oc.GProp_GProps_1();
    (oc as any).BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
    if (type === 'Geom_Plane' && !pathClosed) {
      const c = props.CentreOfMass();
      planarFaces.push({ face, centroidSum: c.X() + c.Y() + c.Z(), area: props.Mass() });
    } else {
      lateralFaces.push({ face, area: props.Mass() });
    }
  }
  explorer.delete();

  // Lateral: sort ascending by area for stable indexing
  lateralFaces.sort((a, b) => a.area - b.area);
  lateralFaces.forEach((f, i) => {
    out.push({ name: { featureId, role: `${featureId}/sweep/lateral/${i}` }, face: f.face });
  });

  // Caps: order by centroid value
  if (planarFaces.length === 2) {
    planarFaces.sort((a, b) => a.centroidSum - b.centroidSum);
    out.push({ name: { featureId, role: `${featureId}/sweep/capStart` }, face: planarFaces[0]!.face });
    out.push({ name: { featureId, role: `${featureId}/sweep/capEnd` }, face: planarFaces[1]!.face });
  } else if (planarFaces.length > 0) {
    // Edge case — more than 2 planar faces for unusual profiles. Number them.
    planarFaces.forEach((f, i) => {
      out.push({ name: { featureId, role: `${featureId}/sweep/cap/${i}` }, face: f.face });
    });
  }

  return out;
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
