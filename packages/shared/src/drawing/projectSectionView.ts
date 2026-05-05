// packages/shared/src/drawing/projectSectionView.ts
//
// Pipeline orchestrator for section views.
//
// Plan note: the plan mocked `tessellateForProjection`, `depthBufferTest`, and
// `classifyEdges` from `./projector`, but those functions do not exist in the
// real codebase. The real export is `projectView(source, orientation)`.
// This implementation calls `projectView` directly and derives hatch segments
// from cut-face polygons supplied via FaceTagMap.

import { projectView } from './projector';
import type { ProjectorInput } from './projector';
import type { ProjectedGeometry, Edge2D } from './projectedGeometry';
import type { HatchSegment, Vec2 } from './types';
import type { Mat4, Vec3 } from './viewMatrix';
import { generateHatchSegments } from './hatchGenerator';

// ---------------------------------------------------------------------------
// FaceTag — per-face metadata from the OCCT section cut pipeline.
// tag === 'cut-face' means the face was created by the cutting plane (hatch).
// tag === 'original-face' means it was already on the solid (no hatch).
// polygon is the 2D projected outline of the face in view-space mm.
// ---------------------------------------------------------------------------

export type FaceTag =
  | { tag: 'cut-face'; partId: string; materialId: string; polygon?: Vec2[]; polygon3D?: Vec3[] }
  | { tag: 'original-face'; partId: string; materialId: string; polygon?: Vec2[]; polygon3D?: Vec3[] };

export type FaceTagMap = Map<string, FaceTag>;

// ---------------------------------------------------------------------------
// Default hatch spec — used when there is no material registry lookup
// ---------------------------------------------------------------------------

const DEFAULT_HATCH_SPEC = { angleDeg: 45, spacingMm: 3 } as const;

// ---------------------------------------------------------------------------
// Fingerprint — synchronous, using simple deterministic hash encoding
// (avoids crypto.subtle async in a hot path; SHA-like quality not required
//  here — the SectionView.fingerprint in types.ts is for stale-cascade only)
// ---------------------------------------------------------------------------

function fingerprintResult(
  geometry: ProjectedGeometry,
  hatchSegments: HatchSegment[],
  scale: number,
): string {
  const parts = [
    String(geometry.visibleEdges.length),
    String(geometry.hiddenEdges.length),
    String(hatchSegments.length),
    scale.toFixed(6),
    geometry.bbox.minX.toFixed(3),
    geometry.bbox.minY.toFixed(3),
    geometry.bbox.maxX.toFixed(3),
    geometry.bbox.maxY.toFixed(3),
  ];
  // djb2 hash — deterministic, cheap, no async required
  let hash = 5381;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep 32-bit unsigned
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Helper: project a 3D polygon into 2D view space via a row-major Mat4
// ---------------------------------------------------------------------------

function projectPolygon3D(pts: Vec3[], m: Mat4): Vec2[] {
  // Row-major 4×4: row r at m[r*4 .. r*4+3]
  return pts.map((v) => {
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    const w = m[12]! * v.x + m[13]! * v.y + m[14]! * v.z + m[15]!;
    const x = (m[0]! * v.x + m[1]! * v.y + m[2]!  * v.z + m[3]!)  / w;
    const y = (m[4]! * v.x + m[5]! * v.y + m[6]!  * v.z + m[7]!)  / w;
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
    return { x, y };
  });
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function projectSectionView(
  source: ProjectorInput,
  faceTags: FaceTagMap,
  scale: number,
  getHatchSpec?: (materialId: string) => { angleDeg: number; spacingMm: number },
  sectionViewMatrix?: Mat4,
): {
  edges: Edge2D[];
  hatchSegments: HatchSegment[];
  fingerprint: string;
} {
  // 1. Project geometry using the front orientation as the canonical section view
  //    direction. The caller is expected to provide geometry already transformed
  //    into section-view space (cut compound in world coords relative to the
  //    section plane), so 'front' maps the cut compound to the XY projection.
  const geometry: ProjectedGeometry = projectView(source, 'front');

  // 2. Collect visible + hidden edges
  const edges: Edge2D[] = [...geometry.visibleEdges, ...geometry.hiddenEdges];

  // 3. Hatch: for each cut face in FaceTagMap, use its polygon and generate hatching
  const hatchSegments: HatchSegment[] = [];

  for (const [, faceInfo] of faceTags.entries()) {
    if (faceInfo.tag !== 'cut-face') continue;

    // Prefer pre-projected 2D polygon; fall back to projecting polygon3D via sectionViewMatrix.
    let polygon = faceInfo.polygon;
    if ((!polygon || polygon.length < 3) && faceInfo.polygon3D && faceInfo.polygon3D.length >= 3 && sectionViewMatrix) {
      polygon = projectPolygon3D(faceInfo.polygon3D, sectionViewMatrix);
    }
    if (!polygon || polygon.length < 3) continue;

    const hatchSpec = getHatchSpec ? getHatchSpec(faceInfo.materialId) : DEFAULT_HATCH_SPEC;
    const segments = generateHatchSegments(polygon, faceInfo.materialId, hatchSpec);
    hatchSegments.push(...segments);
  }

  // 4. Fingerprint
  const fingerprint = fingerprintResult(geometry, hatchSegments, scale);

  return { edges, hatchSegments, fingerprint };
}
