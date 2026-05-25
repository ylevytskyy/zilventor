// packages/app/src/commands/__tests__/reprojectDetailRegion.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock @zilventor/shared BEFORE importing reprojectDetailRegion
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockReturnValue({
      visibleEdges: [
        { id: 'rr-e1', kind: 'outline' as const, points: [[1, 0], [5, 0]] as [number,number][], sourceFaceIds: [] },
      ],
      hiddenEdges: [],
      bbox: { minX: 1, minY: 0, maxX: 5, maxY: 0 },
    }),
    fingerprintDetailView: vi.fn().mockReturnValue('fp-rr-mock'),
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

// `satisfies` (not `: BaseView`) so the inferred type keeps `projection` as a
// present, required property — assignable to reprojectDetailRegion's
// `parentView: DrawingView & { projection: NonNullable<...> }` param under
// exactOptionalPropertyTypes (a plain `BaseView` annotation makes projection
// optional and fails to assign).
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

const DETAIL_VIEW: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { center: { x: 20, y: 15 }, radiusMm: 8 },
  label: 'A',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  },
  inputFingerprint: 'old-fp',
};

describe('reprojectDetailRegion', () => {
  it('returns a new DetailView with updated regionParent.center', () => {
    const newRegion = { center: { x: 30, y: 25 }, radiusMm: 8 };
    const result = reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(result.regionParent.center).toEqual({ x: 30, y: 25 });
    expect(result.regionParent.radiusMm).toBe(8);
  });

  it('returns a new DetailView with updated radiusMm', () => {
    const newRegion = { center: { x: 20, y: 15 }, radiusMm: 12 };
    const result = reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(result.regionParent.radiusMm).toBe(12);
  });

  it('recomputes projection (calls projectDetailView)', async () => {
    const { projectDetailView } = vi.mocked(await import('@zilventor/shared'));
    const newRegion = { center: { x: 30, y: 25 }, radiusMm: 8 };
    reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(projectDetailView).toHaveBeenCalled();
  });

  it('recomputes fingerprint (calls fingerprintDetailView)', async () => {
    const { fingerprintDetailView } = vi.mocked(await import('@zilventor/shared'));
    const newRegion = { center: { x: 30, y: 25 }, radiusMm: 8 };
    reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(fingerprintDetailView).toHaveBeenCalled();
  });

  it('preserves all other DetailView fields (id, label, positionMm, scale, showHidden, parentViewId)', () => {
    const newRegion = { center: { x: 5, y: 5 }, radiusMm: 3 };
    const result = reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(result.id).toBe('dv1');
    expect(result.label).toBe('A');
    expect(result.positionMm).toEqual({ x: 200, y: 100 });
    expect(result.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(result.showHidden).toBe(false);
    expect(result.parentViewId).toBe('pv1');
  });

  it('empty-region (center near edge, zero edges in result) — no throw, empty projection', async () => {
    const { projectDetailView } = vi.mocked(await import('@zilventor/shared'));
    projectDetailView.mockReturnValueOnce({
      visibleEdges: [],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    });
    const newRegion = { center: { x: 999, y: 999 }, radiusMm: 1 };
    const result = reprojectDetailRegion(DETAIL_VIEW, PARENT_VIEW, newRegion);
    expect(result.projection!.visibleEdges).toHaveLength(0);
    expect(result.projection!.bbox).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
