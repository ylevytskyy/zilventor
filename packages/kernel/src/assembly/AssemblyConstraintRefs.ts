import type { AssemblyConstraintRef, EdgeName, FaceName, Vec3 } from '@zilventor/shared';
import { canonicalEdgeName } from '@zilventor/shared';

export type PartLocalGeometry =
  | { kind: 'plane'; P: Vec3; N: Vec3 }
  | { kind: 'axis';  P: Vec3; D: Vec3 }
  | { kind: 'point'; P: Vec3 }
  | { kind: 'circularEdge'; axisP: Vec3; axisD: Vec3; planeP: Vec3; planeN: Vec3 };

function faceKey(f: FaceName): string {
  return `${f.featureId}|${f.role}|${f.instance ?? 0}`;
}
function edgeKey(e: EdgeName): string {
  const c = canonicalEdgeName(e.faceA, e.faceB);
  return `${faceKey(c.faceA)}~${faceKey(c.faceB)}`;
}

/**
 * Deterministic key for caching part-local extracts per (partPath, refKey).
 * `componentId` is intentionally excluded — the same ref on a different
 * component should hit the same cache entry as long as both components
 * point at the same partPath.
 */
export function refKey(r: AssemblyConstraintRef): string {
  if (r.kind === 'face')  return `face|${faceKey(r.face)}`;
  if (r.kind === 'point') {
    if (r.point.source === 'vertex')
      return `point|vertex|${edgeKey(r.point.edge)}|${r.point.end}`;
    return `point|workPoint|${r.point.featureId}`;
  }
  // axis
  if (r.axis.source === 'cylindricalFace')
    return `axis|cylFace|${faceKey(r.axis.face)}`;
  if (r.axis.source === 'edge')
    return `axis|edge|${edgeKey(r.axis.edge)}`;
  return `axis|workAxis|${r.axis.featureId}`;
}

export function circularEdgeRefKey(_componentId: string, edge: EdgeName): string {
  return `circularEdge|${edgeKey(edge)}`;
}
