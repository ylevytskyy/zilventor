// packages/shared/src/drawing/projector.ts
import type { BoundingBox } from '../types';
import { buildViewMatrix, apply, type ViewOrientation } from './viewMatrix';
import { buildDepthBuffer, adaptivePixelPitch } from './depthBuffer';
import { classifyEdges, type Edge3D } from './edgeClassifier';
import type { ProjectedGeometry } from './projectedGeometry';

export type { ProjectedGeometry };

export type EdgeMesh3D = {
  readonly id: string;
  readonly points: ReadonlyArray<[number, number, number]>;
  readonly adjacentFaces?: readonly string[];
};

export type ProjectorInput = {
  readonly triangles: ReadonlyArray<[[number,number,number],[number,number,number],[number,number,number]]>;
  readonly edges: readonly EdgeMesh3D[];
  readonly bbox: BoundingBox;
};

/**
 * Pure projection: transforms source geometry into 2D visible/hidden Edge2D sets.
 * Same input always produces byte-identical output (deterministic).
 */
export function projectView(
  source: ProjectorInput,
  orientation: ViewOrientation,
): ProjectedGeometry {
  const Mview = buildViewMatrix(orientation, source.bbox);

  // Transform triangles to view space
  const trisVS = source.triangles.map(
    ([v0, v1, v2]) =>
      [
        [apply(Mview, { x: v0[0], y: v0[1], z: v0[2] })].map(v => [v.x, v.y, v.z])[0],
        [apply(Mview, { x: v1[0], y: v1[1], z: v1[2] })].map(v => [v.x, v.y, v.z])[0],
        [apply(Mview, { x: v2[0], y: v2[1], z: v2[2] })].map(v => [v.x, v.y, v.z])[0],
      ] as [[number,number,number],[number,number,number],[number,number,number]],
  );

  // Transform edges to view space
  const edgesVS: Edge3D[] = source.edges.map(e => ({
    id: e.id,
    points: e.points.map(p => {
      const v = apply(Mview, { x: p[0], y: p[1], z: p[2] });
      return [v.x, v.y, v.z] as [number, number, number];
    }),
    adjacentFaces: e.adjacentFaces ? [...e.adjacentFaces] : [],
  }));

  const pitch = adaptivePixelPitch(source.bbox);
  const viewBBox = computeViewBBox(trisVS, edgesVS);
  const buf = buildDepthBuffer(trisVS, viewBBox, pitch);

  const { visibleEdges, hiddenEdges } = classifyEdges(edgesVS, buf, viewBBox, pitch);

  // Compute 2D bbox from all edge points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of [...visibleEdges, ...hiddenEdges]) {
    for (const [px, py] of e.points) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0; }

  return { visibleEdges, hiddenEdges, bbox: { minX, minY, maxX, maxY } };
}

/** Compute the view-space bounding box from transformed triangles + edges. */
function computeViewBBox(
  trisVS: ReadonlyArray<[[number,number,number],[number,number,number],[number,number,number]]>,
  edgesVS: readonly Edge3D[],
): BoundingBox {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  function expand(x: number, y: number, z: number) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  for (const [v0, v1, v2] of trisVS) {
    expand(v0[0], v0[1], v0[2]);
    expand(v1[0], v1[1], v1[2]);
    expand(v2[0], v2[1], v2[2]);
  }
  for (const e of edgesVS) {
    for (const [x, y, z] of e.points) expand(x, y, z);
  }

  // Ensure non-degenerate (add small pad to Z for edge-only inputs)
  if (!isFinite(minX)) return [0, 0, 0, 1, 1, 1];
  return [minX, minY, minZ - 1, maxX, maxY, maxZ + 1];
}
