// packages/shared/src/drawing/__tests__/holeTable.spec.ts
import { describe, it, expect } from 'vitest';
import type { HoleTableAnnotation, DrawingAnnotation, DrawingView } from '../types';
import {
  extractHolesInView,
  type ExtractedHole,
} from '../holeTable';
import type { HoleFeature, PartDocument, ParamOrLiteral } from '../../types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Generate N equally-spaced points on a circle (cx, cy, r) in part-mm. */
function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n = 8,
): ReadonlyArray<readonly [number, number]> {
  return Array.from({ length: n }, (_, i) => {
    const θ = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(θ), cy + r * Math.sin(θ)] as const;
  });
}

/** Build a minimal HoleFeature (simple, throughAll) for test fixtures. */
function makeSimpleHole(id: string, diameterMm: number): HoleFeature {
  return {
    id,
    kind: 'hole',
    placement: { kind: 'fromSketch', sketchId: 'sk1' },
    profile: { kind: 'simple', diameter: { kind: 'literal', value: diameterMm } },
    termination: { kind: 'throughAll' },
    flipAxis: false,
  };
}

/** Build a minimal PartDocument containing the given HoleFeatures. */
function makePart(holes: HoleFeature[]): PartDocument {
  return {
    id: 'part-1',
    name: 'TestPart',
    units: 'mm',
    parameters: {},
    featureTree: holes,
    properties: {},
    materials: [],
    hardware: [],
  };
}

/** Build a BaseView whose projection contains the given edges. */
function makeBaseView(
  edges: Array<{
    id: string;
    points: ReadonlyArray<readonly [number, number]>;
    sourceFaceIds?: readonly string[];
  }>,
): DrawingView {
  return {
    id: 'v1',
    kind: 'base',
    positionMm: { x: 50, y: 30 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front',
    showHidden: false,
    projection: {
      visibleEdges: edges.map((e) => ({
        id: e.id,
        kind: 'feature' as const,
        points: e.points,
        ...(e.sourceFaceIds !== undefined ? { sourceFaceIds: e.sourceFaceIds } : {}),
      })),
      hiddenEdges: [],
      bbox: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
    },
  };
}

// ---------------------------------------------------------------------------
// HT-TYPE-1: HoleTableAnnotation structural shape + union membership
// ---------------------------------------------------------------------------

describe('HoleTableAnnotation — HT-TYPE-1: structural shape', () => {
  it('has kind holeTable and all required fields', () => {
    // This runtime check proves the type is usable as a DrawingAnnotation.
    // TypeScript type-checks the assignment at build/typecheck time.
    const ann = {
      kind: 'holeTable' as const,
      id: 'ht-1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'start' as const },
      positionMm: { x: 10, y: 20 },
      entries: [{ holeFeatureId: 'H1', tag: 'A1' }],
    } satisfies HoleTableAnnotation;

    const asAnnotation: DrawingAnnotation = ann;
    expect(asAnnotation.kind).toBe('holeTable');
    expect(ann.id).toBe('ht-1');
    expect(ann.viewId).toBe('v1');
    expect(ann.datum.kind).toBe('edge-endpoint');
    expect(ann.positionMm).toEqual({ x: 10, y: 20 });
    expect(ann.entries).toHaveLength(1);
    const firstEntry = ann.entries[0];
    expect(firstEntry?.tag).toBe('A1');
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-1: circle-fit on a single circular hole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-1: single circular hole', () => {
  it('returns one ExtractedHole with center near (20, 15) for a known circle', () => {
    const cx = 20, cy = 15, r = 4;
    const hole = makeSimpleHole('H1', r * 2);
    const part = makePart([hole]);
    const view = makeBaseView([
      {
        id: 'e-circle',
        points: circlePoints(cx, cy, r),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(1);
    expect(result[0]!.featureId).toBe('H1');
    expect(result[0]!.centerMm[0]).toBeCloseTo(cx, 2);
    expect(result[0]!.centerMm[1]).toBeCloseTo(cy, 2);
    expect(result[0]!.feature.id).toBe('H1');
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-2: reject edge-on (non-circular) hole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-2: reject edge-on hole', () => {
  it('returns empty array when the projected edge is a straight line (degenerate fit)', () => {
    const hole = makeSimpleHole('H2', 8);
    const part = makePart([hole]);
    // Straight horizontal line — circle fit will be degenerate (det ≈ 0)
    const linePoints: ReadonlyArray<readonly [number, number]> = [
      [0, 3], [2, 3], [4, 3], [6, 3], [8, 3], [10, 3], [12, 3], [14, 3],
    ];
    const view = makeBaseView([
      { id: 'e-line', points: linePoints, sourceFaceIds: ['H2|hole|0'] },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-3: through-hole dedupe — two concentric edge rings → one ExtractedHole
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-3: through-hole dedupe by featureId', () => {
  it('dedupes two concentric circles sharing a featureId into ONE ExtractedHole', () => {
    const cx = 10, cy = 5, r = 4;
    const hole = makeSimpleHole('H1', r * 2);
    const part = makePart([hole]);
    // Two separate edge entries, both tagged H1 — top and bottom circles of a through-hole
    const view = makeBaseView([
      {
        id: 'e-top',
        points: circlePoints(cx, cy, r, 8),
        sourceFaceIds: ['H1|hole|0'],
      },
      {
        id: 'e-bot',
        points: circlePoints(cx, cy, r, 8),
        sourceFaceIds: ['H1|hole|1'],
      },
    ]);

    const result = extractHolesInView(view, part);
    expect(result).toHaveLength(1);
    expect(result[0]!.featureId).toBe('H1');
    expect(result[0]!.centerMm[0]).toBeCloseTo(cx, 2);
    expect(result[0]!.centerMm[1]).toBeCloseTo(cy, 2);
  });
});

// ---------------------------------------------------------------------------
// HT-EXTRACT-4: view with no projection returns empty array
// ---------------------------------------------------------------------------

describe('extractHolesInView — HT-EXTRACT-4: no projection', () => {
  it('returns [] when view.projection is undefined', () => {
    const hole = makeSimpleHole('H1', 8);
    const part = makePart([hole]);
    const viewNoProj: DrawingView = {
      id: 'v-empty',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection absent
    };
    expect(extractHolesInView(viewNoProj, part)).toHaveLength(0);
  });
});
