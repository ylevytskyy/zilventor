// packages/shared/src/drawing/holeTable.ts
//
// Pure hole-table extraction helpers. Imports ONLY @zilventor/shared types.
// NEVER imports the app store — preserves the acyclic static-import rule (F2.4).

import type { DrawingView, PointRef, HoleTableAnnotation } from './types';
import type { HoleFeature, HoleTermination, PartDocument, ParamOrLiteral } from '../types';
import { circumcenterFromPolyline } from './circumcenter';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExtractedHole = {
  readonly featureId: string;
  readonly centerMm: readonly [number, number]; // circle-fit center, part-mm (pre-scale)
  readonly feature: HoleFeature;
};

export type HoleTableRow = {
  readonly tag: string;
  readonly xDim: number;        // (centerMm.x - datumMm.x), part-mm — TRUE model dims, NOT scaled
  readonly yDim: number;        // (centerMm.y - datumMm.y), part-mm
  readonly description: string; // Inventor-style, e.g. "⌀8 THRU"
  readonly markerCenterSheetMm: { readonly x: number; readonly y: number }; // leader target, sheet-mm
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reject a circle fit if the root-mean-square radius error exceeds this value (mm). */
export const HOLE_CIRCLE_FIT_TOL_MM = 0.5;

// ---------------------------------------------------------------------------
// Internal: Kasa algebraic circle fit
// ---------------------------------------------------------------------------

type CircleFit = { cx: number; cy: number; r: number; rms: number };

/**
 * Kasa least-squares circle fit over the given points.
 * Returns null if N < 3 or the system is degenerate (collinear points).
 */
function fitCircle(
  points: ReadonlyArray<readonly [number, number]>,
): CircleFit | null {
  const n = points.length;
  if (n < 3) return null;

  let sumX = 0, sumY = 0;
  for (const [x, y] of points) { sumX += x; sumY += y; }
  const mx = sumX / n;
  const my = sumY / n;

  let Suu = 0, Suv = 0, Svv = 0;
  let Suuu = 0, Suvv = 0, Svvv = 0, Svuu = 0;

  for (const [x, y] of points) {
    const u = x - mx;
    const v = y - my;
    Suu  += u * u;
    Suv  += u * v;
    Svv  += v * v;
    Suuu += u * u * u;
    Suvv += u * v * v;
    Svvv += v * v * v;
    Svuu += v * v * u;
  }

  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-10) return null; // collinear or degenerate

  const uc = (0.5 * (Suuu + Suvv) * Svv - 0.5 * (Svvv + Svuu) * Suv) / det;
  const vc = (0.5 * (Svvv + Svuu) * Suu - 0.5 * (Suuu + Suvv) * Suv) / det;

  const r = Math.sqrt(uc * uc + vc * vc + (Suu + Svv) / n);
  const cx = uc + mx;
  const cy = vc + my;

  let sumSqErr = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sumSqErr += d * d;
  }
  const rms = Math.sqrt(sumSqErr / n);

  return { cx, cy, r, rms };
}

// ---------------------------------------------------------------------------
// Internal: parse featureId from a face-key string "featureId|role|instance"
// ---------------------------------------------------------------------------

function faceKeyToFeatureId(faceKey: string): string {
  return faceKey.split('|')[0] ?? faceKey;
}

// ---------------------------------------------------------------------------
// Internal: PointRef → part-mm tuple resolver (replicated from renderDrawingSvg.ts;
// pure + store-free; do NOT import the app's private resolver — see anchors §G).
// ---------------------------------------------------------------------------

type MinimalProjection = {
  readonly visibleEdges: ReadonlyArray<{
    readonly id: string;
    readonly points: ReadonlyArray<readonly [number, number]>;
  }>;
  readonly hiddenEdges: ReadonlyArray<{
    readonly id: string;
    readonly points: ReadonlyArray<readonly [number, number]>;
  }>;
};

function resolvePointRefLocal(
  ref: PointRef,
  proj: MinimalProjection,
): readonly [number, number] | null {
  const edge =
    proj.visibleEdges.find((e) => e.id === ref.edgeId) ??
    proj.hiddenEdges.find((e) => e.id === ref.edgeId);
  if (!edge || edge.points.length === 0) return null;

  if (ref.kind === 'edge-endpoint') {
    return ref.end === 'end'
      ? (edge.points[edge.points.length - 1] ?? null)
      : (edge.points[0] ?? null);
  }
  if (ref.kind === 'edge-midpoint') {
    return edge.points[Math.floor(edge.points.length / 2)] ?? null;
  }
  if (ref.kind === 'arc-center') {
    const { cx, cy } = circumcenterFromPolyline(edge.points);
    return [cx, cy] as const;
  }
  return edge.points[0] ?? null;
}

// ---------------------------------------------------------------------------
// Exported: extractHolesInView
// ---------------------------------------------------------------------------

/**
 * Scan the view's visible edges, group by featureId where the feature is a
 * 'hole', run a circle fit over each group's pooled points, and return the
 * face-on holes (edge-on holes and degenerate fits are rejected).
 *
 * Through-holes and counterbores produce multiple edges sharing one featureId;
 * pooling them into one fit dedupes them to a single ExtractedHole.
 */
export function extractHolesInView(
  view: DrawingView,
  part: PartDocument,
): ExtractedHole[] {
  const proj = view.projection;
  if (!proj) return [];

  // Accumulate all edge points per featureId (for hole features only)
  const holePoints = new Map<string, Array<readonly [number, number]>>();

  for (const edge of proj.visibleEdges) { // visible edges only — per F6 MVP spec §5.1 (hidden-edge holes deferred to F6.x)
    if (!edge.sourceFaceIds) continue;

    for (const faceKey of edge.sourceFaceIds) {
      const featureId = faceKeyToFeatureId(faceKey);
      const feature = part.featureTree.find(
        (f) => f.kind === 'hole' && f.id === featureId,
      );
      if (!feature) continue;

      const existing = holePoints.get(featureId) ?? [];
      for (const pt of edge.points) {
        existing.push(pt as readonly [number, number]);
      }
      holePoints.set(featureId, existing);
      break; // Credit this edge to the first matching featureId only
    }
  }

  const result: ExtractedHole[] = [];

  for (const [featureId, points] of holePoints) {
    const fit = fitCircle(points);
    if (!fit || fit.rms > HOLE_CIRCLE_FIT_TOL_MM) continue; // reject non-circular

    const feature = part.featureTree.find(
      (f) => f.kind === 'hole' && f.id === featureId,
    ) as HoleFeature; // narrowed: we checked above

    result.push({
      featureId,
      centerMm: [fit.cx, fit.cy],
      feature,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal: number-formatting helpers
// ---------------------------------------------------------------------------

/**
 * Quantize a number to 4 decimal places for use in grouping/signature keys.
 * This ensures near-equal values (e.g. 8 vs 8.00000001 from float arithmetic)
 * produce identical signature strings and are grouped into the same hole tag letter.
 */
function quantizeForSignature(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * Format a resolved numeric parameter value for display in hole descriptions.
 * Rounds to 3 decimal places then strips trailing zeros so:
 *   16.666666667 → "16.667"
 *   8.0          → "8"
 *   8            → "8"
 */
function fmtNum(v: number): string {
  return parseFloat(v.toFixed(3)).toString();
}

// ---------------------------------------------------------------------------
// Internal: tag helpers
// ---------------------------------------------------------------------------

/**
 * Convert a 0-based index to a letter sequence: 0→A, 1→B, …, 25→Z, 26→AA, 27→AB, …
 */
function indexToLetter(i: number): string {
  if (i < 26) return String.fromCharCode(65 + i);
  return indexToLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26));
}

/**
 * Build a canonical spec signature string used to group holes sharing the same
 * logical spec (same profile kind, resolved dimensions, and termination).
 * Uses resolved numeric values so param/literal variants for the same number group together.
 */
function buildSpecSignature(
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  const p = feature.profile;
  const t = feature.termination;
  // Quantize depth for distance termination to avoid float-noise key splits
  const termStr =
    t.kind === 'distance' ? `dist:${quantizeForSignature(resolveParam(t.depth))}` : t.kind;

  if (p.kind === 'simple') {
    return `simple:${quantizeForSignature(resolveParam(p.diameter))}:${termStr}`;
  }
  if (p.kind === 'counterbore') {
    return [
      'cbore',
      quantizeForSignature(resolveParam(p.diameter)),
      quantizeForSignature(resolveParam(p.cboreDiameter)),
      quantizeForSignature(resolveParam(p.cboreDepth)),
      termStr,
    ].join(':');
  }
  // countersink
  return [
    'csk',
    quantizeForSignature(resolveParam(p.diameter)),
    quantizeForSignature(resolveParam(p.cskDiameter)),
    quantizeForSignature(resolveParam(p.cskAngle)),
    termStr,
  ].join(':');
}

// ---------------------------------------------------------------------------
// Exported: assignHoleTags
// ---------------------------------------------------------------------------

export function assignHoleTags(
  holes: readonly ExtractedHole[],
  existing: ReadonlyMap<string, string>,
  resolveParam: (p: ParamOrLiteral) => number,
): Map<string, string> {
  // Start from persisted entries (stability guarantee)
  const result = new Map<string, string>(existing);

  // Reconstruct letter-count and spec→letter maps from existing tags
  const letterCounts = new Map<string, number>();
  const specToLetter = new Map<string, string>();

  for (const [featureId, tag] of existing) {
    const match = tag.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const letter = match[1] as string;
    const instance = parseInt(match[2] as string, 10);
    const prev = letterCounts.get(letter) ?? 0;
    if (instance > prev) letterCounts.set(letter, instance);
    // Rebuild specToLetter from holes currently in view (best-effort; new holes extend it)
    const hole = holes.find((h) => h.featureId === featureId);
    if (hole) {
      const sig = buildSpecSignature(hole.feature, resolveParam);
      if (!specToLetter.has(sig)) specToLetter.set(sig, letter);
    }
  }

  // Track all letters used (from existing) to find the next free letter
  const usedLetters = new Set<string>(
    Array.from(existing.values())
      .map((t) => t.match(/^([A-Z]+)/)?.[1] ?? '')
      .filter(Boolean),
  );
  let nextLetterIndex = 0;
  const getNextLetter = (): string => {
    while (true) {
      const letter = indexToLetter(nextLetterIndex++);
      if (!usedLetters.has(letter)) {
        usedLetters.add(letter);
        return letter;
      }
    }
  };

  // Assign new holes (those not already in `existing`)
  for (const hole of holes) {
    if (result.has(hole.featureId)) continue; // already tagged — stable
    const sig = buildSpecSignature(hole.feature, resolveParam);
    let letter = specToLetter.get(sig);
    if (!letter) {
      letter = getNextLetter();
      specToLetter.set(sig, letter);
    }
    const instance = (letterCounts.get(letter) ?? 0) + 1;
    letterCounts.set(letter, instance);
    result.set(hole.featureId, `${letter}${instance}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal: Unicode constants (Inventor hole-description symbols)
// ---------------------------------------------------------------------------

const DIA   = '⌀'; // ⌀ DIAMETER SIGN
const DMAP  = '↧'; // ↧ DOWNWARDS ARROW FROM BAR (depth)
const CBORE = '⌴'; // ⌴ COUNTERBORE
const CSK   = '⌵'; // ⌵ COUNTERSINK
const TIMES = '×'; // × MULTIPLICATION SIGN
const DEG   = '°'; // ° DEGREE SIGN

function formatTermination(
  t: HoleTermination,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  // throughAll, toFace, toNext all map to THRU for MVP (spec §5.3)
  if (t.kind === 'throughAll' || t.kind === 'toFace' || t.kind === 'toNext') {
    return 'THRU';
  }
  return `${DMAP}${fmtNum(resolveParam(t.depth))}`;
}

// ---------------------------------------------------------------------------
// Exported: formatHoleDescription
// ---------------------------------------------------------------------------

export function formatHoleDescription(
  feature: HoleFeature,
  resolveParam: (p: ParamOrLiteral) => number,
): string {
  const profile = feature.profile;
  const termination = feature.termination;
  const termStr = formatTermination(termination, resolveParam);

  if (profile.kind === 'simple') {
    const dia = fmtNum(resolveParam(profile.diameter));
    return `${DIA}${dia} ${termStr}`;
  }

  if (profile.kind === 'counterbore') {
    const dia      = fmtNum(resolveParam(profile.diameter));
    const cboreDia = fmtNum(resolveParam(profile.cboreDiameter));
    const cboreD   = fmtNum(resolveParam(profile.cboreDepth));
    return `${DIA}${dia} ${termStr} ${CBORE}${DIA}${cboreDia} ${DMAP}${cboreD}`;
  }

  // countersink
  const dia    = fmtNum(resolveParam(profile.diameter));
  const cskDia = fmtNum(resolveParam(profile.cskDiameter));
  const cskAng = fmtNum(resolveParam(profile.cskAngle));
  return `${DIA}${dia} ${termStr} ${CSK}${DIA}${cskDia}${TIMES}${cskAng}${DEG}`;
}

// ---------------------------------------------------------------------------
// Exported: computeHoleTableRows
// ---------------------------------------------------------------------------

export function computeHoleTableRows(
  annotation: HoleTableAnnotation,
  view: DrawingView,
  part: PartDocument,
  resolveParam: (p: ParamOrLiteral) => number,
): HoleTableRow[] {
  const proj = view.projection;
  if (!proj) return [];

  // Resolve datum to part-mm
  const datumMm = resolvePointRefLocal(annotation.datum, proj as MinimalProjection);
  if (!datumMm) return [];

  const holes = extractHolesInView(view, part);
  const existingMap: ReadonlyMap<string, string> = new Map(
    annotation.entries.map((e) => [e.holeFeatureId, e.tag]),
  );
  const tagMap = assignHoleTags(holes, existingMap, resolveParam);

  const s = view.scale.numerator / view.scale.denominator;

  const rows: HoleTableRow[] = [];
  for (const hole of holes) {
    const tag = tagMap.get(hole.featureId);
    if (!tag) continue;
    rows.push({
      tag,
      xDim: hole.centerMm[0] - datumMm[0],
      yDim: hole.centerMm[1] - datumMm[1],
      description: formatHoleDescription(hole.feature, resolveParam),
      markerCenterSheetMm: {
        x: view.positionMm.x + hole.centerMm[0] * s,
        y: view.positionMm.y + hole.centerMm[1] * s,
      },
    });
  }

  // Sort by tag: lexicographic with numeric instance (A1 < A2 < A10 < B1)
  rows.sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { numeric: true }),
  );

  return rows;
}
