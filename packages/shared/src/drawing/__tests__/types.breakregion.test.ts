import { describe, it, expect } from 'vitest';
import type { BreakRegion, BaseView, ViewScale, ProjectedView, IsoView, SectionView, DrawingView } from '../types';
import type { Edge2D, ProjectedGeometry } from '../projectedGeometry';
import type { ProjectFile } from '../../types';

describe('BreakRegion shape (spec §5.1)', () => {
  it('has all 6 required fields with correct types', () => {
    const br: BreakRegion = {
      id: 'br-1',
      axis: 'x',
      coordA: 50,
      coordB: 150,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.id).toBe('br-1');
    expect(br.axis).toBe('x');
    expect(br.coordA).toBe(50);
    expect(br.coordB).toBe(150);
    expect(br.gapMm).toBe(5);
    expect(br.style).toBe('zigzag');
  });

  it('accepts axis: "y"', () => {
    const br: BreakRegion = {
      id: 'br-y',
      axis: 'y',
      coordA: 30,
      coordB: 80,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.axis).toBe('y');
  });

  it('survives JSON round-trip without drift', () => {
    const br: BreakRegion = {
      id: 'br-rt',
      axis: 'x',
      coordA: 100.5,
      coordB: 200.75,
      gapMm: 5,
      style: 'zigzag',
    };
    const parsed = JSON.parse(JSON.stringify(br)) as BreakRegion;
    expect(parsed.coordA).toBe(100.5);
    expect(parsed.coordB).toBe(200.75);
    expect(parsed.style).toBe('zigzag');
  });
});

describe('Edge2D.kind — break tier (spec §5.3)', () => {
  it('accepts kind: "break" at the type level and survives round-trip', () => {
    const breakEdge: Edge2D = {
      id: 'break_br1',
      kind: 'break',
      points: [[100, -5], [100.75, 0], [99.25, 3], [100, 6]],
    };
    const parsed = JSON.parse(JSON.stringify(breakEdge)) as Edge2D;
    expect(parsed.kind).toBe('break');
    expect(parsed.sourceFaceIds).toBeUndefined();
  });

  it('existing kinds silhouette/feature/outline still assignable', () => {
    const e1: Edge2D = { id: 'a', kind: 'silhouette', points: [[0, 0], [1, 1]] };
    const e2: Edge2D = { id: 'b', kind: 'feature',    points: [[0, 0], [1, 1]] };
    const e3: Edge2D = { id: 'c', kind: 'outline',    points: [[0, 0], [1, 1]] };
    expect(e1.kind).toBe('silhouette');
    expect(e2.kind).toBe('feature');
    expect(e3.kind).toBe('outline');
  });
});

describe('BaseView — breaks and rawProjection fields (spec §5.2)', () => {
  const scale: ViewScale = { numerator: 1, denominator: 1 };

  it('BaseView compiles without breaks (existing views unaffected)', () => {
    const v: BaseView = {
      id: 'v1', kind: 'base',
      positionMm: { x: 0, y: 0 }, scale,
      orientation: 'front', showHidden: false,
    };
    expect(v.breaks).toBeUndefined();
    expect(v.rawProjection).toBeUndefined();
  });

  it('BaseView accepts breaks array with BreakRegion entries', () => {
    const br: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
    const rawProj: ProjectedGeometry = {
      visibleEdges: [], hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 400, maxY: 50 },
    };
    const v: BaseView = {
      id: 'v2', kind: 'base',
      positionMm: { x: 0, y: 0 }, scale,
      orientation: 'front', showHidden: false,
      breaks: [br],
      rawProjection: rawProj,
    };
    expect(v.breaks).toHaveLength(1);
    expect(v.rawProjection?.bbox.maxX).toBe(400);
  });

  it('α-conditional: rawProjection absent when breaks absent (compile-time semantics)', () => {
    const v: BaseView = {
      id: 'v3', kind: 'base',
      positionMm: { x: 10, y: 10 }, scale,
      orientation: 'top', showHidden: true,
    };
    expect(v.breaks).toBeUndefined();
    expect(v.rawProjection).toBeUndefined();
  });
});

describe('ProjectedView — breaks and rawProjection fields (spec §5.2)', () => {
  it('ProjectedView compiles without breaks', () => {
    const v: ProjectedView = {
      id: 'pv1', kind: 'projected',
      positionMm: { x: 0, y: 0 },
      baseViewId: 'bv1',
      direction: 'right',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    expect(v.breaks).toBeUndefined();
    expect(v.rawProjection).toBeUndefined();
  });

  it('ProjectedView accepts breaks array', () => {
    const v: ProjectedView = {
      id: 'pv2', kind: 'projected',
      positionMm: { x: 100, y: 0 },
      baseViewId: 'bv1',
      direction: 'top',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      breaks: [{ id: 'b1', axis: 'x', coordA: 10, coordB: 60, gapMm: 5, style: 'zigzag' }],
      rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 40 } },
    };
    expect(v.breaks).toHaveLength(1);
  });
});

describe('IsoView — breaks and rawProjection fields (spec §5.2)', () => {
  it('IsoView compiles without breaks', () => {
    const v: IsoView = {
      id: 'iv1', kind: 'iso',
      positionMm: { x: 0, y: 0 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    expect(v.breaks).toBeUndefined();
  });

  it('IsoView accepts breaks and rawProjection', () => {
    const v: IsoView = {
      id: 'iv2', kind: 'iso',
      positionMm: { x: 200, y: 50 },
      corner: 'SW',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      breaks: [{ id: 'b2', axis: 'y', coordA: 20, coordB: 70, gapMm: 5, style: 'zigzag' }],
      rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 } },
    };
    expect(v.breaks![0]!.axis).toBe('y');
  });
});

describe('SectionView — breaks and rawProjection fields (forward compat, spec §5.2)', () => {
  it('SectionView compiles with breaks field present (no behavioral test — F3.6 deferred)', () => {
    const v: SectionView = {
      id: 'sv1', kind: 'section',
      parentViewId: 'bv1',
      sectionLine: { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
      arrowDirection: 1,
      label: 'A',
      positionMm: { x: 200, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'abc',
    };
    expect(v.breaks).toBeUndefined();
    expect(v.rawProjection).toBeUndefined();
  });

  it('SectionView accepts breaks + rawProjection without TypeScript error', () => {
    const v: SectionView = {
      id: 'sv2', kind: 'section',
      parentViewId: 'bv1',
      sectionLine: { p0: { x: 50, y: 0 }, p1: { x: 50, y: 100 } },
      arrowDirection: -1,
      label: 'B',
      positionMm: { x: 300, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'def',
      breaks: [{ id: 'bsv', axis: 'x', coordA: 10, coordB: 50, gapMm: 5, style: 'zigzag' }],
      rawProjection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 } },
    };
    expect(v.breaks).toHaveLength(1);
  });
});

describe('ProjectFile formatVersion union — v17 arm (spec §5.4)', () => {
  it('a formatVersion:17 part document is assignable to ProjectFile', () => {
    const pf: ProjectFile = {
      formatVersion: 17,
      kind: 'part',
      createdAt: '2026-05-06T00:00:00.000Z',
      appVersion: '0.0.1',
      document: {
        id: 'p1', name: 'Test', units: 'mm',
        parameters: {}, featureTree: [], properties: {},
        materials: [], hardware: [],
      },
    };
    expect(pf.formatVersion).toBe(17);
  });

  it('a formatVersion:17 drawing document is assignable to ProjectFile', () => {
    const pf: ProjectFile = {
      formatVersion: 17,
      kind: 'drawing',
      createdAt: '2026-05-06T00:00:00.000Z',
      appVersion: '0.0.1',
      document: {
        id: 'draw-1', name: 'Drawing', units: 'mm',
        source: { partPath: 'parts/x.zipt', sourceKind: 'part' },
        properties: {},
        sheets: [],
        activeSheetId: '',
      },
    };
    expect(pf.formatVersion).toBe(17);
    expect(pf.kind).toBe('drawing');
  });
});

describe('DrawingView union — exhaustiveness check with breaks/rawProjection fields', () => {
  it('switch over DrawingView.kind still compiles with never fallthrough', () => {
    function describeView(v: DrawingView): string {
      switch (v.kind) {
        case 'base':      return `base, breaks=${v.breaks?.length ?? 0}`;
        case 'projected': return `projected, breaks=${v.breaks?.length ?? 0}`;
        case 'iso':       return `iso, breaks=${v.breaks?.length ?? 0}`;
        case 'section':   return `section, breaks=${v.breaks?.length ?? 0}`;
        case 'detail':    return 'detail';
        default: {
          const _exhaustive: never = v;
          return _exhaustive;
        }
      }
    }

    const bv: DrawingView = {
      id: 'bv', kind: 'base',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front', showHidden: false,
      breaks: [{ id: 'b1', axis: 'x', coordA: 10, coordB: 50, gapMm: 5, style: 'zigzag' }],
    };
    expect(describeView(bv)).toBe('base, breaks=1');
  });

  it('detail view does NOT have breaks field (spec §5.2: DetailView excluded)', () => {
    const dv: DrawingView = {
      id: 'dv', kind: 'detail',
      parentViewId: 'bv',
      regionParent: { center: { x: 0, y: 0 }, radiusMm: 5 },
      label: 'A',
      positionMm: { x: 0, y: 0 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
    };
    // DetailView has no breaks field — TypeScript compile check implicitly verifies this
    // by not allowing `dv.breaks` (if added to test, it would be a TS error on 'detail').
    expect(dv.kind).toBe('detail');
  });
});
