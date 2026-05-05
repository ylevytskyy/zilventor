// packages/shared/src/drawing/fingerprint.ts
// fingerprintSectionView uses djb2 (browser-safe); async functions use crypto.subtle.
import type { ProjectorInput, EdgeMesh3D } from './projector';
import type { ViewOrientation } from './viewMatrix';
import { fingerprintPlane } from './planeFingerprint';
import type { SectionView } from './types';

export type ViewSpec = {
  readonly orientation: ViewOrientation;
  readonly scale: { readonly numerator: number; readonly denominator: number };
  readonly showHidden: boolean;
};

/** Round a float to 1e-3 mm for canonical determinism. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Canonical string for a triangle (floats rounded to 1e-3 mm). */
function encodeTriangle(
  t: readonly [readonly [number,number,number], readonly [number,number,number], readonly [number,number,number]],
): string {
  return t.map(v => v.map(round3).join(',')).join(';');
}

/** Canonical string for an edge. */
function encodeEdge(e: EdgeMesh3D): string {
  return e.id + ':' + e.points.map(p => p.map(round3).join(',')).join(';');
}

async function sha256hex(data: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await globalThis.crypto.subtle.digest('SHA-256', enc.encode(data));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash the source geometry (triangles + edges), with floats rounded to 1e-3 mm.
 * Deterministic across runs regardless of object reference identity.
 */
export async function computeSourceGeometryHash(
  triangles: ProjectorInput['triangles'],
  edges: ProjectorInput['edges'],
): Promise<string> {
  const triStr = [...triangles].map(encodeTriangle).sort().join('|');
  const edgeStr = [...edges].map(encodeEdge).sort().join('|');
  return sha256hex(`tris:${triStr}§edges:${edgeStr}`);
}

/**
 * Compute the per-view input fingerprint.
 * Returns a 64-char hex SHA-256 string.
 * Spec §7.1.
 */
export async function computeViewFingerprint(
  viewSpec: ViewSpec,
  sourceGeometry: ProjectorInput,
): Promise<string> {
  const [bboxHash, triHash, edgeHash] = await Promise.all([
    sha256hex(sourceGeometry.bbox.map(round3).join(',')),
    computeSourceGeometryHash(sourceGeometry.triangles, sourceGeometry.edges),
    // edgeHash is already embedded in computeSourceGeometryHash, but we keep the
    // canonical spec shape with named fields
    sha256hex([...sourceGeometry.edges].map(encodeEdge).sort().join('|')),
  ]);

  const canonical = JSON.stringify({
    orientation: viewSpec.orientation,
    scale: viewSpec.scale,
    showHidden: viewSpec.showHidden,
    sourceBboxHash: bboxHash,
    sourceTrianglesHash: triHash,
    sourceEdgesHash: edgeHash,
  });
  return sha256hex(canonical);
}

/** djb2 hash — browser-safe, synchronous. */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Synchronous djb2 fingerprint for a DetailView.
 * Incorporates the parent view's source fingerprint, the region definition, and the scale.
 * Matches the fingerprintSectionView pattern in this file.
 * Floats rounded to 1e-3 mm via .toFixed(3) for determinism.
 */
export function fingerprintDetailView(
  parentInputFingerprint: string,
  regionParent: { center: { x: number; y: number }; radiusMm: number },
  scale: { numerator: number; denominator: number },
): string {
  const payload = [
    parentInputFingerprint,
    regionParent.center.x.toFixed(3),
    regionParent.center.y.toFixed(3),
    regionParent.radiusMm.toFixed(3),
    scale.numerator,
    scale.denominator,
  ].join('|');
  return djb2(payload);
}

/**
 * Compute a synchronous fingerprint for a SectionView.
 * Used for stale-cascade detection: incorporates the parent view's source
 * fingerprint, the cut plane, and the view parameters.
 */
export function fingerprintSectionView(
  view: SectionView,
  parentSourceFingerprint: string,
): string {
  const planeFp = view.plane ? fingerprintPlane(view.plane) : 'no-plane';
  const payload = [
    parentSourceFingerprint,
    planeFp,
    view.scale.numerator,
    view.scale.denominator,
    view.arrowDirection,
    view.sectionLine.p0.x.toFixed(3),
    view.sectionLine.p0.y.toFixed(3),
    view.sectionLine.p1.x.toFixed(3),
    view.sectionLine.p1.y.toFixed(3),
  ].join('|');
  return djb2(payload);
}
