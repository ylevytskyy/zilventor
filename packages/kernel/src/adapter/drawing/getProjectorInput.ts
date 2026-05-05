import type { OcctInstance } from '../../occt/occtLoader';
import type { ProjectorInput } from '@zilventor/shared';
import { tessellate, tessellateEdges } from '../../occt/Tessellator';
import type { NamedShape } from '../../occt/FaceNaming';

/**
 * Build a ProjectorInput for a single part's NamedShape.
 *
 * Calls `tessellate` (which runs BRepMesh_IncrementalMesh on the shape to
 * populate face triangulations) then `tessellateEdges` (which reads the
 * edge polygon-on-triangulation populated by the same mesh pass).
 *
 * linearDeflection = 0.05 mm gives adequate silhouette resolution for A3
 * drawings at 1:1 scale; angularDeflection = 0.3 rad ≈ 17° keeps curved
 * surfaces smooth at print scale.
 */
export async function getProjectorInput(
  oc: OcctInstance,
  namedShape: NamedShape,
): Promise<ProjectorInput> {
  const mesh = tessellate(oc, namedShape.shape, {
    linearDeflection: 0.05,
    angularDeflection: 0.3,
  });

  const tessEdges = tessellateEdges(oc, namedShape);

  // Convert flat Float32Array positions + Uint32Array indices into triangle triples
  const triangles: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
  const pos = mesh.positions;
  const idx = mesh.indices;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]! * 3;
    const b = idx[i + 1]! * 3;
    const c = idx[i + 2]! * 3;
    triangles.push([
      [pos[a]!, pos[a + 1]!, pos[a + 2]!],
      [pos[b]!, pos[b + 1]!, pos[b + 2]!],
      [pos[c]!, pos[c + 1]!, pos[c + 2]!],
    ]);
  }

  // Convert TessellatedEdge[] (segments + edgeName) → EdgeMesh3D[] (id + points)
  // Each edge's segments form a polyline; flatten to a unique point sequence.
  const edges = tessEdges.map((te) => {
    const points: Array<[number, number, number]> = [];
    for (let k = 0; k < te.segments.length; k++) {
      const [a, b] = te.segments[k]!;
      if (k === 0) {
        points.push([a.x, a.y, a.z]);
      }
      points.push([b.x, b.y, b.z]);
    }
    const faceKey = (f: { featureId: string; role: string; instance?: number }) =>
      `${f.featureId}|${f.role}|${f.instance ?? 0}`;
    return {
      id: `${faceKey(te.edgeName.faceA)}~${faceKey(te.edgeName.faceB)}`,
      points,
      adjacentFaces: [
        faceKey(te.faceNames[0]),
        faceKey(te.faceNames[1]),
      ],
    };
  });

  return {
    triangles,
    edges,
    bbox: mesh.boundingBox,
  };
}
