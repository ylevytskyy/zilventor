// packages/shared/src/drawing/__tests__/holeTable.spec.ts
import { describe, it, expect } from 'vitest';
import type { HoleTableAnnotation, DrawingAnnotation, DrawingView } from '../types';
import {
  extractHolesInView,
  assignHoleTags,
  formatHoleDescription,
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

// ---------------------------------------------------------------------------
// HT-TAGS-1: initial assignment — two holes with different specs → A1, B1
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-1: initial assignment', () => {
  it('assigns A1 and B1 to two holes with different diameters', () => {
    const h1 = makeSimpleHole('H1', 8);
    const h2 = makeSimpleHole('H2', 10);
    const holes: ExtractedHole[] = [
      { featureId: 'H1', centerMm: [0, 0], feature: h1 },
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
    ];
    const result = assignHoleTags(holes, new Map(), (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-2: stability — add a new hole, existing tags unchanged
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-2: add hole stability', () => {
  it('keeps existing tags intact when a new same-spec hole is added', () => {
    const h1 = makeSimpleHole('H1', 8);
    const h2 = makeSimpleHole('H2', 10);
    const h3 = makeSimpleHole('H3', 8); // same spec as H1 → shares letter A
    const holes: ExtractedHole[] = [
      { featureId: 'H1', centerMm: [0, 0],  feature: h1 },
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
      { featureId: 'H3', centerMm: [40, 0], feature: h3 },
    ];
    const existing: ReadonlyMap<string, string> = new Map([
      ['H1', 'A1'],
      ['H2', 'B1'],
    ]);
    const result = assignHoleTags(holes, existing, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    // Existing tags must be unchanged
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
    // H3 same spec as H1 (dia=8, throughAll) → A2
    expect(result.get('H3')).toBe('A2');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-3: stability — remove a hole from the holes array, others unchanged
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-3: remove hole stability', () => {
  it('does not renumber remaining holes when one is removed from holes array', () => {
    const h2 = makeSimpleHole('H2', 10);
    const h3 = makeSimpleHole('H3', 8);
    // H1 removed from holes (model edit) but its tag persists in existing
    const holes: ExtractedHole[] = [
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
      { featureId: 'H3', centerMm: [40, 0], feature: h3 },
    ];
    const existing: ReadonlyMap<string, string> = new Map([
      ['H1', 'A1'],
      ['H2', 'B1'],
      ['H3', 'A2'],
    ]);
    const result = assignHoleTags(holes, existing, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    // All tags preserved (H2 and H3 are in holes; H1 is in existing but not holes → kept in result)
    expect(result.get('H1')).toBe('A1');
    expect(result.get('H2')).toBe('B1');
    expect(result.get('H3')).toBe('A2');
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-4: spec-signature grouping — same resolved diameter via different ParamOrLiteral forms
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-4: param vs literal grouping', () => {
  it('groups two holes together when their resolved diameters are equal', () => {
    // H4: diameter via param 'd1'; H5: diameter via literal 8
    // Both resolve to 8 → same spec signature → same letter
    const h4: HoleFeature = {
      id: 'H4', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'd1' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const h5 = makeSimpleHole('H5', 8); // literal 8
    const holes: ExtractedHole[] = [
      { featureId: 'H4', centerMm: [0, 0],  feature: h4 },
      { featureId: 'H5', centerMm: [20, 0], feature: h5 },
    ];
    // resolveParam: 'd1' → 8, literals → as-is
    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 8; // 'd1'=8

    const result = assignHoleTags(holes, new Map(), resolveParam);
    // Same resolved diameter → same letter (A); instances 1 and 2
    const tag4 = result.get('H4')!;
    const tag5 = result.get('H5')!;
    expect(tag4[0]).toBe(tag5[0]); // same letter
    expect(tag4).toBe('A1');
    expect(tag5).toBe('A2');
  });
});

// ---------------------------------------------------------------------------
// formatHoleDescription tests
// ---------------------------------------------------------------------------

const resolve = (p: ParamOrLiteral): number =>
  p.kind === 'literal' ? p.value : 0;

// ---------------------------------------------------------------------------
// HT-DESC-1: simple + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-1: simple throughAll', () => {
  it('produces "⌀8 THRU"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-2: simple + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-2: simple distance', () => {
  it('produces "⌀8 ↧12"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-3: simple + toFace (MVP → THRU)
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-3: simple toFace (MVP THRU)', () => {
  it('produces "⌀8 THRU" for toFace (MVP)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'toFace', targetFaceName: { featureId: 'F1', role: 'face' } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-4: simple + toNext (MVP → THRU)
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-4: simple toNext (MVP THRU)', () => {
  it('produces "⌀8 THRU" for toNext (MVP)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: 8 } },
      termination: { kind: 'toNext' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-5: counterbore + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-5: counterbore throughAll', () => {
  it('produces "⌀8 THRU ⌴⌀14 ↧6"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'counterbore',
        diameter: { kind: 'literal', value: 8 },
        cboreDiameter: { kind: 'literal', value: 14 },
        cboreDepth: { kind: 'literal', value: 6 },
      },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU ⌴⌀14 ↧6');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-6: counterbore + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-6: counterbore distance', () => {
  it('produces "⌀8 ↧12 ⌴⌀14 ↧6"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'counterbore',
        diameter: { kind: 'literal', value: 8 },
        cboreDiameter: { kind: 'literal', value: 14 },
        cboreDepth: { kind: 'literal', value: 6 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12 ⌴⌀14 ↧6');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-7: countersink + throughAll
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-7: countersink throughAll', () => {
  it('produces "⌀8 THRU ⌵⌀14×82°"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'countersink',
        diameter: { kind: 'literal', value: 8 },
        cskDiameter: { kind: 'literal', value: 14 },
        cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 THRU ⌵⌀14×82°');
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-8: countersink + distance
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-8: countersink distance', () => {
  it('produces "⌀8 ↧12 ⌵⌀14×82°"', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: {
        kind: 'countersink',
        diameter: { kind: 'literal', value: 8 },
        cskDiameter: { kind: 'literal', value: 14 },
        cskAngle: { kind: 'literal', value: 82 },
      },
      termination: { kind: 'distance', depth: { kind: 'literal', value: 12 } },
      flipAxis: false,
    };
    expect(formatHoleDescription(feature, resolve)).toBe('⌀8 ↧12 ⌵⌀14×82°');
  });
});

