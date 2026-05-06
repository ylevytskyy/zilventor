import { describe, it, expect } from 'vitest';
import type { BreakRegion, BaseView, ViewScale, ProjectedView, IsoView, SectionView, DrawingView } from '../types';
import type { Edge2D, ProjectedGeometry } from '../projectedGeometry';

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
