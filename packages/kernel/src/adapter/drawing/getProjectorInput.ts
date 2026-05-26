import type { OcctInstance } from '../../occt/occtLoader';
import type { ProjectorInput } from '@zilventor/shared';
import { tessellate, tessellateEdges } from '../../occt/Tessellator';
import type { NamedShape } from '../../occt/FaceNaming';
import { quatRotateVec } from '../../assembly/quat';

export type AssemblyComponentInput = {
  partId: string;
  pose: {
    translation: { x: number; y: number; z: number };
    quaternion: readonly [number, number, number, number];
  };
};

export type GetProjectorInputArgs =
  | { kind: 'part'; partId: string }
  | { kind: 'assembly'; components: ReadonlyArray<AssemblyComponentInput> };

/**
 * Build a ProjectorInput for a single part's NamedShape.
 */
function getPartProjectorInput(
  oc: OcctInstance,
  namedShape: NamedShape,
): ProjectorInput {
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

  // Convert TessellatedEdge[] → EdgeMesh3D[]
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

function applyPose(
  pt: [number, number, number],
  pose: AssemblyComponentInput['pose'],
): [number, number, number] {
  const q = pose.quaternion as [number, number, number, number];
  const rotated = quatRotateVec(q, { x: pt[0], y: pt[1], z: pt[2] });
  return [
    rotated.x + pose.translation.x,
    rotated.y + pose.translation.y,
    rotated.z + pose.translation.z,
  ];
}

type Bbox6 = [number, number, number, number, number, number];

function unionBbox(a: Bbox6, b: Bbox6): Bbox6 {
  return [
    Math.min(a[0], b[0]),
    Math.min(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.max(a[3], b[3]),
    Math.max(a[4], b[4]),
    Math.max(a[5], b[5]),
  ];
}

function transformBbox(
  bbox: readonly [number, number, number, number, number, number],
  pose: AssemblyComponentInput['pose'],
): Bbox6 {
  // Transform all 8 corners and compute new bbox
  const [xMin, yMin, zMin, xMax, yMax, zMax] = bbox;
  const corners: Array<[number, number, number]> = [
    [xMin, yMin, zMin], [xMax, yMin, zMin],
    [xMin, yMax, zMin], [xMax, yMax, zMin],
    [xMin, yMin, zMax], [xMax, yMin, zMax],
    [xMin, yMax, zMax], [xMax, yMax, zMax],
  ];
  const transformed = corners.map((c) => applyPose(c, pose));
  const xs = transformed.map((c) => c[0]);
  const ys = transformed.map((c) => c[1]);
  const zs = transformed.map((c) => c[2]);
  return [
    Math.min(...xs), Math.min(...ys), Math.min(...zs),
    Math.max(...xs), Math.max(...ys), Math.max(...zs),
  ];
}

/**
 * Build a ProjectorInput for an assembly by concatenating transformed
 * triangle/edge data from all provided components.
 *
 * Suppression/visibility filtering is the caller's responsibility — the
 * kernel processes every component in the list.
 */
function getAssemblyProjectorInput(
  oc: OcctInstance,
  components: ReadonlyArray<AssemblyComponentInput>,
  lookupNamedShape: (partId: string) => NamedShape | undefined,
): ProjectorInput {
  const allTriangles: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
  const allEdges: import('@zilventor/shared').EdgeMesh3D[] = [];
  let bbox: Bbox6 | null = null;

  for (let compIdx = 0; compIdx < components.length; compIdx++) {
    const comp = components[compIdx]!;
    const ns = lookupNamedShape(comp.partId);
    if (!ns) {
      throw new Error(`getAssemblyProjectorInput: partId "${comp.partId}" not in cache — call execute() first`);
    }
    const partInput = getPartProjectorInput(oc, ns);

    // Transform triangles
    for (const [a, b, c] of partInput.triangles) {
      allTriangles.push([
        applyPose(a, comp.pose),
        applyPose(b, comp.pose),
        applyPose(c, comp.pose),
      ]);
    }

    // Transform edges — namespace by component index so that two instances of the
    // same part (same partId, different poses) never share an edge id.  The index
    // is always unique across the loop; the partId is included for debuggability.
    for (const edge of partInput.edges) {
      allEdges.push({
        ...edge,
        id: `${compIdx}::${comp.partId}::${edge.id}`,
        points: edge.points.map((p) => applyPose(p, comp.pose)),
      });
    }

    // Union bboxes (transformedBbox is always Bbox6; spread to satisfy readonly constraint)
    const transformedBbox = transformBbox(partInput.bbox, comp.pose);
    bbox = bbox === null ? [...transformedBbox] as Bbox6 : unionBbox(bbox, transformedBbox);
  }

  return {
    triangles: allTriangles,
    edges: allEdges,
    bbox: bbox ?? [0, 0, 0, 0, 0, 0],
  };
}

/**
 * Build a ProjectorInput for either a single part or an assembly.
 *
 * For `kind: 'part'`: looks up the NamedShape via `lookupNamedShape` and
 * tessellates it directly.
 *
 * For `kind: 'assembly'`: concatenates transformed geometry from each
 * component in the pre-flattened list. Suppression/visibility filtering
 * must be done on the main thread before calling this function.
 */
export async function getProjectorInput(
  oc: OcctInstance,
  args: GetProjectorInputArgs,
  lookupNamedShape: (partId: string) => NamedShape | undefined,
): Promise<ProjectorInput> {
  if (args.kind === 'part') {
    const ns = lookupNamedShape(args.partId);
    if (!ns) {
      throw new Error(`getProjectorInput: partId "${args.partId}" not in cache — call execute() first`);
    }
    return getPartProjectorInput(oc, ns);
  }
  return getAssemblyProjectorInput(oc, args.components, lookupNamedShape);
}

// Re-export so kernel callers don't need to import from @zilventor/shared directly.
export { resolveSectionSource } from '@zilventor/shared';
