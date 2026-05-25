// packages/shared/src/drawing/__tests__/holeTable.spec.ts
import { describe, it, expect } from 'vitest';
import type { HoleTableAnnotation, DrawingAnnotation, DrawingView } from '../types';
import {
  extractHolesInView,
  assignHoleTags,
  formatHoleDescription,
  computeHoleTableRows,
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

// ---------------------------------------------------------------------------
// HT-ROWS-1: end-to-end — datum subtraction, markerCenterSheetMm transform
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-1: single hole end-to-end', () => {
  it('produces correct xDim/yDim and markerCenterSheetMm', () => {
    // Datum point at part-mm (0, 0); hole center at part-mm (20, 15); scale 1:1
    // Expected: xDim=20, yDim=15, markerCenter={x: 50+20=70, y: 30+15=45}
    const holeCx = 20, holeCy = 15, holeR = 4;
    const hole = makeSimpleHole('H1', holeR * 2); // dia=8
    const part = makePart([hole]);

    const view = makeBaseView([
      // Datum edge: single-point edge at origin (no sourceFaceIds — not a hole edge)
      { id: 'datum-edge', points: [[0, 0]] },
      // Hole circle
      {
        id: 'e-hole',
        points: circlePoints(holeCx, holeCy, holeR),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);

    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'datum-edge', end: 'start' },
      positionMm: { x: 10, y: 10 },
      entries: [],
    };

    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 0;

    const rows = computeHoleTableRows(annotation, view, part, resolveParam);
    expect(rows).toHaveLength(1);

    const row = rows[0]!;
    expect(row.tag).toBe('A1');
    expect(row.xDim).toBeCloseTo(holeCx, 2);     // 20 - 0 = 20
    expect(row.yDim).toBeCloseTo(holeCy, 2);     // 15 - 0 = 15
    expect(row.description).toBe('⌀8 THRU'); // ⌀8 THRU

    // markerCenter = view.positionMm + centerMm * scale (1:1)
    // view.positionMm = {x:50, y:30}, scale=1
    expect(row.markerCenterSheetMm.x).toBeCloseTo(50 + holeCx, 2); // 70
    expect(row.markerCenterSheetMm.y).toBeCloseTo(30 + holeCy, 2); // 45
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-2: two holes, different specs → sorted tags A1, B1
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-2: two holes sorted by tag', () => {
  it('returns two rows sorted by tag with correct dimensions', () => {
    // hole A at (10, 5), hole B at (30, 5); datum at (0, 0); scale 2:1
    const hA = makeSimpleHole('HA', 8);
    const hB = makeSimpleHole('HB', 12); // different spec → different letter
    const part = makePart([hA, hB]);

    // Build view with scale 2:1
    const viewWith2xScale: DrawingView = {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 2, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      projection: {
        visibleEdges: [
          { id: 'datum-edge', kind: 'feature', points: [[0, 0]] },
          {
            id: 'e-hA',
            kind: 'feature',
            points: circlePoints(10, 5, 4),
            sourceFaceIds: ['HA|hole|0'],
          },
          {
            id: 'e-hB',
            kind: 'feature',
            points: circlePoints(30, 5, 6),
            sourceFaceIds: ['HB|hole|0'],
          },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 50, maxY: 20 },
      },
    };

    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-2',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'datum-edge', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };

    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'literal' ? p.value : 0;

    const rows = computeHoleTableRows(annotation, viewWith2xScale, part, resolveParam);
    expect(rows).toHaveLength(2);

    // Sorted by tag: A1 before B1
    expect(rows[0]!.tag).toBe('A1');
    expect(rows[1]!.tag).toBe('B1');

    // xDim/yDim are in part-mm (NOT scaled)
    expect(rows[0]!.xDim).toBeCloseTo(10, 2);
    expect(rows[0]!.yDim).toBeCloseTo(5, 2);

    // markerCenterSheetMm IS scaled: positionMm(0,0) + centerMm * scale(2)
    expect(rows[0]!.markerCenterSheetMm.x).toBeCloseTo(20, 2); // 0 + 10*2
    expect(rows[0]!.markerCenterSheetMm.y).toBeCloseTo(10, 2); // 0 + 5*2
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-3: no projection → returns empty array
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-3: no projection', () => {
  it('returns [] when view has no projection', () => {
    const viewNoProj: DrawingView = {
      id: 'v-noproj',
      kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
    };
    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-3',
      viewId: 'v-noproj',
      datum: { kind: 'edge-endpoint', edgeId: 'missing', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };
    const rows = computeHoleTableRows(annotation, viewNoProj, makePart([]), (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HT-ROWS-4: datum edge missing → returns empty array
// ---------------------------------------------------------------------------

describe('computeHoleTableRows — HT-ROWS-4: datum edge not found', () => {
  it('returns [] when the datum PointRef resolves to null', () => {
    const hole = makeSimpleHole('H1', 8);
    const part = makePart([hole]);
    const view = makeBaseView([
      {
        id: 'e-hole',
        points: circlePoints(20, 15, 4),
        sourceFaceIds: ['H1|hole|0'],
      },
    ]);
    const annotation: HoleTableAnnotation = {
      kind: 'holeTable',
      id: 'ht-4',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'nonexistent-edge', end: 'start' },
      positionMm: { x: 0, y: 0 },
      entries: [],
    };
    const rows = computeHoleTableRows(annotation, view, part, (p) =>
      p.kind === 'literal' ? p.value : 0,
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// HT-TAGS-5: float-noise grouping — near-equal resolved diameters must get same letter
// ---------------------------------------------------------------------------

describe('assignHoleTags — HT-TAGS-5: float-noise grouping', () => {
  it('groups two holes whose resolved diameters differ by float noise (8 vs 8.00000001) into the same letter', () => {
    const h1: HoleFeature = {
      id: 'H1', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'exact' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const h2: HoleFeature = {
      id: 'H2', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk1' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'noisy' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const holes: ExtractedHole[] = [
      { featureId: 'H1', centerMm: [0, 0],  feature: h1 },
      { featureId: 'H2', centerMm: [20, 0], feature: h2 },
    ];
    // H1 resolves to exact 8; H2 resolves to 8.00000001 (float noise from computed expr)
    const resolveParam = (p: ParamOrLiteral): number => {
      if (p.kind === 'param') {
        if (p.paramName === 'exact') return 8;
        if (p.paramName === 'noisy') return 8.00000001;
      }
      return p.kind === 'literal' ? p.value : 0;
    };

    const result = assignHoleTags(holes, new Map(), resolveParam);
    const tag1 = result.get('H1')!;
    const tag2 = result.get('H2')!;
    // Both must share the same letter (same group)
    expect(tag1[0]).toBe(tag2[0]); // same letter prefix
    // Instance numbers must be 1 and 2 (same letter)
    expect(new Set([tag1, tag2])).toEqual(new Set(['A1', 'A2']));
  });
});

// ---------------------------------------------------------------------------
// HT-DESC-9: float-value description — clean formatting (no float noise)
// ---------------------------------------------------------------------------

describe('formatHoleDescription — HT-DESC-9: float-value formatting', () => {
  it('formats a resolved diameter of 16.666666667 as "⌀16.667" (3 decimal, trimmed)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'd' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    // Simulate param = 50/3 → 16.666666...7
    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'param' ? 50 / 3 : (p.kind === 'literal' ? p.value : 0);

    const desc = formatHoleDescription(feature, resolveParam);
    expect(desc).toContain('⌀16.667');
    expect(desc).not.toContain('16.666666');
  });

  it('formats an exact integer resolved diameter of 8 as "⌀8" (no trailing zeros)', () => {
    const feature: HoleFeature = {
      id: 'H', kind: 'hole',
      placement: { kind: 'fromSketch', sketchId: 'sk' },
      profile: { kind: 'simple', diameter: { kind: 'param', paramName: 'd' } },
      termination: { kind: 'throughAll' },
      flipAxis: false,
    };
    const resolveParam = (p: ParamOrLiteral): number =>
      p.kind === 'param' ? 8 : (p.kind === 'literal' ? p.value : 0);

    const desc = formatHoleDescription(feature, resolveParam);
    expect(desc).toBe('⌀8 THRU');
  });
});
