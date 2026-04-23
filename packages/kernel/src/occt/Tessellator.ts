import type { Mesh } from '@zilventor/shared';
import type { OcctInstance } from './occtLoader';
import { computeBoundingBox, type OcctShape } from './SolidOps';

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
  opts: TessellateOptions
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
  const normals: number[] = [];
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
        // Placeholder normals — per-face smooth normals are Task 9 territory.
        normals.push(0, 0, 1);
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

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    boundingBox: computeBoundingBox(oc, shape)
  };
}
