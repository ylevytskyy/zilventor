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

import type { Result, KernelError, WorkFeatureValue } from '@zilventor/shared';
import { newCorrelationId } from '@zilventor/shared';
import type { NamedShape } from '../occt/FaceNaming';

export type ExtractorBundle = {
  extractFacePlane(shape: NamedShape | null, face: FaceName):
    Result<{ P: Vec3; N: Vec3 }, KernelError>;
  extractCylinderAxis(shape: NamedShape | null, face: FaceName):
    Result<{ P: Vec3; D: Vec3 }, KernelError>;
  extractEdgeLine(shape: NamedShape | null, edge: EdgeName):
    Result<{ P: Vec3; D: Vec3 }, KernelError>;
  extractEdgeEndpoint(shape: NamedShape | null, edge: EdgeName, end: 'start' | 'end'):
    Result<{ P: Vec3 }, KernelError>;
  extractEdgeMidpoint(shape: NamedShape | null, edge: EdgeName):
    Result<{ P: Vec3 }, KernelError>;
};

function missing(what: string): KernelError {
  return { kind: 'invalidGeometry', message: what, correlationId: newCorrelationId() };
}

export function resolveRef(
  ref: AssemblyConstraintRef,
  shape: NamedShape | null,
  wfs: Map<string, WorkFeatureValue>,
  ex: ExtractorBundle,
): Result<PartLocalGeometry, KernelError> {
  if (ref.kind === 'face') {
    const r = ex.extractFacePlane(shape, ref.face);
    if (!r.ok) return r;
    return { ok: true, value: { kind: 'plane', P: r.value.P, N: r.value.N } };
  }
  if (ref.kind === 'point') {
    if (ref.point.source === 'vertex') {
      const r = ex.extractEdgeEndpoint(shape, ref.point.edge, ref.point.end);
      if (!r.ok) return r;
      return { ok: true, value: { kind: 'point', P: r.value.P } };
    }
    const wf = wfs.get(ref.point.featureId);
    if (!wf || wf.kind !== 'point')
      return { ok: false, error: missing(`workPoint ${ref.point.featureId} not found`) };
    return { ok: true, value: { kind: 'point', P: wf.position } };
  }
  // axis
  if (ref.axis.source === 'cylindricalFace') {
    const r = ex.extractCylinderAxis(shape, ref.axis.face);
    if (!r.ok) return r;
    return { ok: true, value: { kind: 'axis', P: r.value.P, D: r.value.D } };
  }
  if (ref.axis.source === 'edge') {
    const r = ex.extractEdgeLine(shape, ref.axis.edge);
    if (!r.ok) return r;
    return { ok: true, value: { kind: 'axis', P: r.value.P, D: r.value.D } };
  }
  const wf = wfs.get(ref.axis.featureId);
  if (!wf || wf.kind !== 'axis')
    return { ok: false, error: missing(`workAxis ${ref.axis.featureId} not found`) };
  return { ok: true, value: { kind: 'axis', P: wf.origin, D: wf.direction } };
}

export function resolveCircularEdgeRef(
  edge: EdgeName,
  shape: NamedShape | null,
  ex: ExtractorBundle,
): Result<PartLocalGeometry, KernelError> {
  // Treat the circular edge as a cylinder + planar enclosing face.
  // The edge's faceA is conventionally the planar face; faceB is cylindrical.
  const planeR = ex.extractFacePlane(shape, edge.faceA);
  if (!planeR.ok) return planeR;
  const axisR = ex.extractCylinderAxis(shape, edge.faceB);
  if (!axisR.ok) return axisR;
  return { ok: true, value: {
    kind: 'circularEdge',
    axisP: axisR.value.P, axisD: axisR.value.D,
    planeP: planeR.value.P, planeN: planeR.value.N,
  }};
}
