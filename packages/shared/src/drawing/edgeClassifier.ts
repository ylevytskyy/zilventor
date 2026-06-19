// packages/shared/src/drawing/edgeClassifier.ts
import type { BoundingBox } from '../types';

export type Edge3D = {
  readonly id: string;
  readonly points: ReadonlyArray<readonly [number, number, number]>;
  readonly adjacentFaces?: readonly string[];
  readonly componentPath?: string;
};

export type Edge2D = {
  readonly id: string;
  readonly kind: 'silhouette' | 'feature' | 'outline';
  readonly points: ReadonlyArray<readonly [number, number]>;
  readonly sourceFaceIds?: readonly string[];
  readonly componentPath?: string;
};

export type ClassifiedEdges = {
  readonly visibleEdges: Edge2D[];
  readonly hiddenEdges: Edge2D[];
};

/**
 * Classify each 3D edge (in view space) as visible or hidden using the pre-built depth buffer.
 * Splits edges into runs via run-length encoding.
 *
 * Edge id format: <edgeKey>_<runIndex>
 */
export function classifyEdges(
  edgesVS: readonly Edge3D[],
  depthBuf: Float32Array,
  bbox: BoundingBox,
  pixelPitchMm: number,
): ClassifiedEdges {
  const [minX, minY, , maxX, maxY] = bbox;
  const cols = Math.ceil((maxX - minX) / pixelPitchMm) + 1;
  const rows = Math.ceil((maxY - minY) / pixelPitchMm) + 1;

  const visibleEdges: Edge2D[] = [];
  const hiddenEdges: Edge2D[] = [];

  for (const edge of edgesVS) {
    const samples = sampleEdge(edge, pixelPitchMm);
    if (samples.length === 0) continue;

    const epsilon = Math.max(1e-4, 0.5 * pixelPitchMm);

    // Determine visibility per sample
    const visible: boolean[] = samples.map(([px, py, pz]) => {
      const col = Math.round((px - minX) / pixelPitchMm);
      const row = Math.round((py - minY) / pixelPitchMm);
      if (col < 0 || col >= cols || row < 0 || row >= rows) return true; // outside buffer → visible
      const bufZ = depthBuf[row * cols + col];
      return bufZ === undefined || pz <= bufZ + epsilon;
    });

    // Run-length encode into runs of same visibility
    type Run = { vis: boolean; pts: ReadonlyArray<readonly [number, number]> };
    const runs: Run[] = [];
    let runStart = 0;

    for (let i = 1; i <= samples.length; i++) {
      if (i === samples.length || visible[i] !== visible[runStart]) {
        const runPts = samples.slice(runStart, i).map(
          ([px, py]) => [px, py] as readonly [number, number],
        );
        const vis = visible[runStart];
        runs.push({ vis: vis ?? true, pts: runPts });
        runStart = i;
      }
    }

    // runIndex is per-edge (resets when we move to the next edge). Final Edge2D.id
    // embeds edgeKey + runIndex; two runs from the SAME edge are guaranteed unique
    // (separate counters for visible vs hidden classes), but two edges sharing an
    // edgeKey is the caller's invariant to maintain.
    let visIdx = 0, hidIdx = 0;
    for (const run of runs) {
      if (run.pts.length < 2) continue; // skip degenerate single-point runs
      const runIndex = run.vis ? visIdx++ : hidIdx++;
      const e2d: Edge2D = {
        id: `${edge.id}_${runIndex}`,
        kind: 'outline',
        points: run.pts,
        ...(edge.adjacentFaces !== undefined && { sourceFaceIds: edge.adjacentFaces }),
        ...(edge.componentPath !== undefined && { componentPath: edge.componentPath }),
      };
      if (run.vis) {
        visibleEdges.push(e2d);
      } else {
        hiddenEdges.push(e2d);
      }
    }
  }

  return { visibleEdges, hiddenEdges };
}

/**
 * Returns the number of samples that would be generated for the given edge at the given pitch.
 * Exported only for unit-testing the min-8 floor; not part of the public API.
 */
export function __test_sampleCount(edge: Edge3D, pixelPitchMm: number): number {
  const pts = edge.points;
  if (pts.length <= 1) return pts.length;
  let arcLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    if (p0 === undefined || p1 === undefined) continue;
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    arcLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return Math.max(8, Math.ceil(arcLen / (0.5 * pixelPitchMm)));
}

/** Sample N evenly-spaced points along the polyline. N = ceil(arc_length / (0.5 * pitch)), min 8. */
function sampleEdge(
  edge: Edge3D,
  pixelPitchMm: number,
): Array<[number, number, number]> {
  const pts = edge.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const p = pts[0];
    if (p === undefined) return [];
    return [[p[0], p[1], p[2]]];
  }

  // Compute total arc length
  let arcLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    if (p0 === undefined || p1 === undefined) continue;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    arcLen += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  const N = Math.max(8, Math.ceil(arcLen / (0.5 * pixelPitchMm)));
  const result: Array<[number, number, number]> = [];

  for (let i = 0; i <= N; i++) {
    const t = i / N;
    result.push(interpolatePolyline(pts, t));
  }
  return result;
}

function interpolatePolyline(
  pts: ReadonlyArray<readonly [number, number, number]>,
  t: number,
): [number, number, number] {
  if (pts.length === 1) {
    const p = pts[0];
    if (p === undefined) return [0, 0, 0];
    return [p[0], p[1], p[2]];
  }

  // Compute cumulative arc lengths
  const lens: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    if (p0 === undefined || p1 === undefined) {
      lens.push(lens[lens.length - 1] ?? 0);
      continue;
    }
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const dz = p1[2] - p0[2];
    lens.push((lens[lens.length - 1] ?? 0) + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const totalLen = lens[lens.length - 1] ?? 0;
  const target = t * totalLen;

  for (let i = 1; i < pts.length; i++) {
    const lensI = lens[i] ?? 0;
    if (lensI >= target - 1e-12) {
      const lensIPrev = lens[i - 1] ?? 0;
      const segLen = lensI - lensIPrev;
      const u = segLen < 1e-12 ? 0 : (target - lensIPrev) / segLen;
      const p0 = pts[i - 1];
      const p1 = pts[i];
      if (p0 === undefined || p1 === undefined) continue;
      return [
        p0[0] + u * (p1[0] - p0[0]),
        p0[1] + u * (p1[1] - p0[1]),
        p0[2] + u * (p1[2] - p0[2]),
      ];
    }
  }
  // Clamp to last point
  const last = pts[pts.length - 1];
  if (last === undefined) return [0, 0, 0];
  return [last[0], last[1], last[2]];
}
