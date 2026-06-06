import type { BoundingBox, Mesh, TessellatedEdge, TessellatedFace, Vec3, FaceName, UvProjection } from '@zilventor/shared';
import { canonicalEdgeName } from '@zilventor/shared';
import type { OcctInstance } from './occtLoader';
import { computeBoundingBox, type OcctShape } from './SolidOps';

/**
 * Compute an adaptive `linearDeflection` from a bounding box.
 *
 * Formula: longestEdge × 0.001, floored at 0.1 mm.
 * This keeps tessellation quality reasonable for small parts (≤100 mm) while
 * dramatically reducing triangle counts for large assemblies (e.g. 2000 mm
 * furniture panels produce deflection 2.0 instead of the previous fixed 0.1).
 */
export function adaptiveLinearDeflection(bbox: BoundingBox): number {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bbox;
  const longestEdge = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return Math.max(0.1, longestEdge * 0.001);
}

export type TessellateOptions = {
  linearDeflection: number;
  angularDeflection?: number;
};

/**
 * `Poly_MeshPurpose_NONE`. The pinned opencascade.js build requires a
 * Poly_MeshPurpose enum value on `BRep_Tool.Triangulation` but does not
 * expose the enum constants by name — they are plain integers in the glue.
 * 0 = NONE, which is the correct default for "whatever triangulation is
 * already attached to the face."
 */
const POLY_MESH_PURPOSE_NONE = 0;

/**
 * Tessellates every face of `shape` into a single interleaved Mesh.
 *
 * API adaptation notes (vs. the textbook OCCT walkthrough):
 *   - `BRepMesh_IncrementalMesh_2` has a `Perform_1(Message_ProgressRange)`
 *     method rather than a parameterless `Perform()`, so we construct a
 *     throwaway `Message_ProgressRange_1` and pass it in.
 *   - `BRep_Tool.Triangulation` takes a third `Poly_MeshPurpose` argument
 *     in this build; we pass the integer 0 (NONE) because the enum is not
 *     exported by name.
 *   - Triangle vertex indices come from `Poly_Triangle.Value(i)` where i is
 *     1-based; OCCT node indices are likewise 1-based.
 */
export function tessellate(
  oc: OcctInstance,
  shape: OcctShape,
  opts: TessellateOptions,
  projection?: UvProjection
): Mesh {
  const angular = opts.angularDeflection ?? 0.5;
  const meshTool = new oc.BRepMesh_IncrementalMesh_2(
    shape.handle as never,
    opts.linearDeflection,
    false as never,
    angular,
    false as never
  );
  const progress = new oc.Message_ProgressRange_1();
  meshTool.Perform_1(progress);
  progress.delete();

  const positions: number[] = [];
  const indices: number[] = [];

  const explorer = new oc.TopExp_Explorer_2(
    shape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );

  while (explorer.More()) {
    const faceShape = explorer.Current();
    const face = oc.TopoDS.Face_1(faceShape);
    const loc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(
      face,
      loc,
      POLY_MESH_PURPOSE_NONE as never
    );

    if (!triHandle.IsNull()) {
      const t = triHandle.get();
      const nbNodes = t.NbNodes();
      const nbTris = t.NbTriangles();
      const baseIndex = positions.length / 3;

      for (let i = 1; i <= nbNodes; i++) {
        const p = t.Node(i);
        positions.push(p.X(), p.Y(), p.Z());
        p.delete();
      }
      for (let i = 1; i <= nbTris; i++) {
        const tri = t.Triangle(i);
        indices.push(
          baseIndex + tri.Value(1) - 1,
          baseIndex + tri.Value(2) - 1,
          baseIndex + tri.Value(3) - 1
        );
        tri.delete();
      }
    }

    triHandle.delete();
    loc.delete();
    face.delete();
    faceShape.delete();
    explorer.Next();
  }
  explorer.delete();
  meshTool.delete();

  let uv: Float32Array | undefined;
  if (projection) {
    if (projection.mode === 'planar') {
      const { origin, uAxis, vAxis } = projection;
      const uvArr: number[] = [];
      for (let i = 0; i < positions.length; i += 3) {
        const px = positions[i]! - origin.x;
        const py = positions[i + 1]! - origin.y;
        const pz = positions[i + 2]! - origin.z;
        uvArr.push(
          px * uAxis.x + py * uAxis.y + pz * uAxis.z,
          px * vAxis.x + py * vAxis.y + pz * vAxis.z,
        );
      }
      uv = new Float32Array(uvArr);
    }
    // 'box' mode handled in Task 4
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    boundingBox: computeBoundingBox(oc, shape),
    ...(uv !== undefined ? { uv } : {}),
  };
}

/**
 * Extract tessellated edges from a named shape. Call AFTER `tessellate()`
 * has run on the same shape so that `BRepMesh_IncrementalMesh` has populated
 * each face's triangulation and edge polygon-on-triangulation.
 *
 * For every edge of `namedShape.shape`:
 *   1. Look up adjacent faces via `TopExp.MapShapesAndAncestors` — the same
 *      enumeration the fillet adapter relies on, except scoped to
 *      (edge → face) instead of (face → edge).
 *   2. Resolve each adjacent face to its `FaceName` via `IsSame` against
 *      `namedShape.faceNames`. Skip the edge if fewer than 2 adjacent
 *      faces carry a known name (free-wire, seam, or boolean-op remnant
 *      not captured by `mergeFaceNames`).
 *   3. Fetch the face's `Poly_Triangulation` via `BRep_Tool.Triangulation`
 *      and the edge's index-array via `BRep_Tool.PolygonOnTriangulation_1`.
 *      `Polygon3D` is NOT populated by `BRepMesh_IncrementalMesh` on solid
 *      edges — only `PolygonOnTriangulation` is — so we read node indices
 *      from the polygon and dereference them against the face's node array.
 *   4. Transform nodes by `faceLoc.Transformation()` for world-space points.
 *   5. Build the canonical edge name from the two FaceNames.
 *
 * Memory: every TopoDS handle pulled out of the OCCT maps is deleted
 * before we return. The returned TessellatedEdge[] is plain data.
 */
export function tessellateEdges(
  oc: OcctInstance,
  namedShape: { shape: OcctShape; faceNames: Array<{ name: FaceName; face: unknown }> }
): TessellatedEdge[] {
  const result: TessellatedEdge[] = [];
  const edgeToFaces = new oc.TopTools_IndexedDataMapOfShapeListOfShape_1();
  (oc.TopExp as {
    MapShapesAndAncestors: (
      s: unknown,
      ts: unknown,
      ta: unknown,
      m: unknown
    ) => void;
  }).MapShapesAndAncestors(
    namedShape.shape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_EDGE as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    edgeToFaces as never
  );
  const extent = (edgeToFaces as { Extent: () => number }).Extent();

  for (let i = 1; i <= extent; i++) {
    const edgeShape = (edgeToFaces as { FindKey: (i: number) => unknown }).FindKey(i);
    const faceList = ((edgeToFaces as unknown) as {
      FindFromIndex: (i: number) => {
        Size: () => number;
        First_1: () => unknown;
        Last_1: () => unknown;
      };
    }).FindFromIndex(i);
    const nFaces = faceList.Size();
    if (nFaces < 2) continue;
    const faceAHandle = faceList.First_1();
    const faceBHandle = faceList.Last_1();

    const nameA = findFaceName(namedShape.faceNames, faceAHandle);
    const nameB = findFaceName(namedShape.faceNames, faceBHandle);
    if (!nameA || !nameB) continue;

    const edge = (oc.TopoDS as { Edge_1: (s: unknown) => unknown }).Edge_1(
      edgeShape as never
    );
    const face = (oc.TopoDS as { Face_1: (s: unknown) => unknown }).Face_1(
      faceAHandle as never
    );
    const faceLoc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(
      face as never,
      faceLoc,
      POLY_MESH_PURPOSE_NONE as never
    );
    if (triHandle.IsNull()) {
      triHandle.delete();
      faceLoc.delete();
      continue;
    }
    const triangulation = triHandle.get() as {
      Node: (i: number) => { X: () => number; Y: () => number; Z: () => number; Transform: (t: unknown) => void; delete: () => void };
    };
    const polyOnTriHandle = (oc.BRep_Tool as {
      PolygonOnTriangulation_1: (e: unknown, t: unknown, l: unknown) => {
        IsNull: () => boolean;
        get: () => {
          NbNodes: () => number;
          Nodes: () => {
            Lower: () => number;
            Upper: () => number;
            Value: (i: number) => number;
          };
        };
        delete: () => void;
      };
    }).PolygonOnTriangulation_1(edge as never, triHandle as never, faceLoc as never);

    if (polyOnTriHandle.IsNull()) {
      polyOnTriHandle.delete();
      triHandle.delete();
      faceLoc.delete();
      continue;
    }

    const polygon = polyOnTriHandle.get();
    const nodeIndices = polygon.Nodes();
    const transformation = (faceLoc as { Transformation: () => unknown }).Transformation();
    const pts: Vec3[] = [];
    for (let k = nodeIndices.Lower(); k <= nodeIndices.Upper(); k++) {
      const nodeIdx = nodeIndices.Value(k);
      const p = triangulation.Node(nodeIdx);
      p.Transform(transformation as never);
      pts.push({ x: p.X(), y: p.Y(), z: p.Z() });
      p.delete();
    }

    polyOnTriHandle.delete();
    triHandle.delete();
    faceLoc.delete();

    if (pts.length < 2) continue;
    const segments: Array<[Vec3, Vec3]> = [];
    for (let k = 0; k < pts.length - 1; k++) {
      segments.push([pts[k]!, pts[k + 1]!]);
    }

    result.push({
      edgeName: canonicalEdgeName(nameA, nameB),
      segments,
      faceNames: [nameA, nameB]
    });
  }

  (edgeToFaces as { delete: () => void }).delete();
  return result;
}

function findFaceName(
  entries: Array<{ name: FaceName; face: unknown }>,
  target: unknown
): FaceName | null {
  for (const e of entries) {
    if ((e.face as { IsSame?: (o: unknown) => boolean }).IsSame?.(target as never)) {
      return e.name;
    }
  }
  return null;
}

/**
 * Extract per-face triangle ranges from a named shape. Call AFTER
 * `tessellate()` has run on the same shape, and walk faces in the same
 * order as `tessellate` (TopExp_Explorer_2 on TopAbs_FACE) so triangle
 * ranges line up with the mesh.indices array.
 *
 * The returned `TessellatedFace[]` has one entry per face with a known
 * name — unnamed faces (not in `namedShape.faceNames`) are skipped.
 * Callers (e.g. the viewport face-pick controller) binary-search into
 * this array by triangle index to recover the FaceName of a hit.
 */
export function tessellateFaces(
  oc: OcctInstance,
  namedShape: { shape: OcctShape; faceNames: Array<{ name: FaceName; face: unknown }> }
): TessellatedFace[] {
  const result: TessellatedFace[] = [];
  let triCursor = 0;

  const explorer = new oc.TopExp_Explorer_2(
    namedShape.shape.handle as never,
    oc.TopAbs_ShapeEnum.TopAbs_FACE as never,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never
  );

  while (explorer.More()) {
    const faceShape = explorer.Current();
    const face = oc.TopoDS.Face_1(faceShape);
    const loc = new oc.TopLoc_Location_1();
    const triHandle = oc.BRep_Tool.Triangulation(
      face,
      loc,
      POLY_MESH_PURPOSE_NONE as never
    );

    if (!triHandle.IsNull()) {
      const t = triHandle.get();
      const nbTris = t.NbTriangles();
      const name = findFaceName(namedShape.faceNames, face);
      if (name) {
        result.push({
          name,
          triangleStart: triCursor,
          triangleCount: nbTris
        });
      }
      triCursor += nbTris;
    }

    triHandle.delete();
    loc.delete();
    face.delete();
    faceShape.delete();
    explorer.Next();
  }
  explorer.delete();
  return result;
}
