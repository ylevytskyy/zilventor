// packages/app/src/commands/__tests__/reprojectDetailRegion.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { RegionParent } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockImplementation(
      (input: { regionParent: RegionParent }) => ({
        visibleEdges: [
          {
            id: input.regionParent.kind === 'circle'
              ? `rr-circle-${input.regionParent.radiusMm}`
              : `rr-rect-${(input.regionParent as Extract<RegionParent, { kind: 'rect' }>).widthMm}`,
            kind: 'outline' as const,
            points: [[0, 0], [1, 0]] as [number, number][],
            sourceFaceIds: [],
          },
        ],
        hiddenEdges: [],
        bbox: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
      }),
    ),
    fingerprintDetailView: vi.fn().mockImplementation(
      (_pFp: string, region: RegionParent) =>
        region.kind === 'circle'
          ? `fp-circle-${region.radiusMm}`
          : `fp-rect-${(region as Extract<RegionParent, { kind: 'rect' }>).widthMm}`,
    ),
  };
});

import { reprojectDetailRegion } from '../reprojectDetailRegion';
import type { DetailView, BaseView } from '@zilventor/shared';

const PARENT_PROJ = {
  visibleEdges: [
    { id: 'p1', kind: 'outline' as const, points: [[0,0],[100,0]] as [number,number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};

const PARENT_VIEW = {
  id: 'pv1',
  kind: 'base',
  positionMm: { x: 10, y: 10 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: PARENT_PROJ,
  inputFingerprint: 'parent-fp-123',
} satisfies BaseView;

const DETAIL_CIRCLE: DetailView = {
  id: 'dv-circle',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 },
  label: 'A',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'old-fp-circle',
};

const DETAIL_RECT: DetailView = {
  id: 'dv-rect',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 12, heightMm: 8 },
  label: 'B',
  positionMm: { x: 300, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'old-fp-rect',
};

describe('reprojectDetailRegion — circle region', () => {
  it('returns new DetailView with updated circle regionParent', () => {
    const newRegion: RegionParent = { kind: 'circle', center: { x: 30, y: 25 }, radiusMm: 8 };
    const result = reprojectDetailRegion(DETAIL_CIRCLE, PARENT_VIEW, newRegion);
    expect(result.regionParent).toEqual(newRegion);
    expect(result.id).toBe('dv-circle');
  });

  it('circle: recomputes projection (mock returns kind-tagged id)', () => {
    const newRegion: RegionParent = { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 12 };
    const result = reprojectDetailRegion(DETAIL_CIRCLE, PARENT_VIEW, newRegion);
    expect(result.projection?.visibleEdges[0]?.id).toBe('rr-circle-12');
  });

  it('circle: recomputes fingerprint via mock', () => {
    const newRegion: RegionParent = { kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 12 };
    const result = reprojectDetailRegion(DETAIL_CIRCLE, PARENT_VIEW, newRegion);
    expect(result.inputFingerprint).toBe('fp-circle-12');
  });

  it('does not mutate the original DETAIL_CIRCLE', () => {
    const newRegion: RegionParent = { kind: 'circle', center: { x: 50, y: 50 }, radiusMm: 5 };
    reprojectDetailRegion(DETAIL_CIRCLE, PARENT_VIEW, newRegion);
    expect(DETAIL_CIRCLE.regionParent).toEqual({ kind: 'circle', center: { x: 20, y: 15 }, radiusMm: 8 });
  });

  it('preserves all other DetailView fields', () => {
    const newRegion: RegionParent = { kind: 'circle', center: { x: 5, y: 5 }, radiusMm: 3 };
    const result = reprojectDetailRegion(DETAIL_CIRCLE, PARENT_VIEW, newRegion);
    expect(result.id).toBe('dv-circle');
    expect(result.label).toBe('A');
    expect(result.positionMm).toEqual({ x: 200, y: 100 });
    expect(result.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(result.showHidden).toBe(false);
    expect(result.parentViewId).toBe('pv1');
  });
});

describe('reprojectDetailRegion — rect region', () => {
  it('returns new DetailView with updated rect regionParent', () => {
    const newRegion: RegionParent = { kind: 'rect', center: { x: 40, y: 30 }, widthMm: 12, heightMm: 8 };
    const result = reprojectDetailRegion(DETAIL_RECT, PARENT_VIEW, newRegion);
    expect(result.regionParent).toEqual(newRegion);
    expect(result.id).toBe('dv-rect');
  });

  it('rect: recomputes projection (mock returns kind-tagged id with widthMm)', () => {
    const newRegion: RegionParent = { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 20, heightMm: 8 };
    const result = reprojectDetailRegion(DETAIL_RECT, PARENT_VIEW, newRegion);
    expect(result.projection?.visibleEdges[0]?.id).toBe('rr-rect-20');
  });

  it('rect: recomputes fingerprint via mock', () => {
    const newRegion: RegionParent = { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 20, heightMm: 8 };
    const result = reprojectDetailRegion(DETAIL_RECT, PARENT_VIEW, newRegion);
    expect(result.inputFingerprint).toBe('fp-rect-20');
  });

  it('rect: does not mutate original DETAIL_RECT', () => {
    const newRegion: RegionParent = { kind: 'rect', center: { x: 99, y: 99 }, widthMm: 1, heightMm: 1 };
    reprojectDetailRegion(DETAIL_RECT, PARENT_VIEW, newRegion);
    expect(DETAIL_RECT.regionParent).toEqual({ kind: 'rect', center: { x: 30, y: 20 }, widthMm: 12, heightMm: 8 });
  });

  it('rect→rect: region kind is preserved (no circle fields on result)', () => {
    const newRegion: RegionParent = { kind: 'rect', center: { x: 30, y: 20 }, widthMm: 15, heightMm: 6 };
    const result = reprojectDetailRegion(DETAIL_RECT, PARENT_VIEW, newRegion);
    expect(result.regionParent.kind).toBe('rect');
    expect('radiusMm' in result.regionParent).toBe(false);
  });
});
