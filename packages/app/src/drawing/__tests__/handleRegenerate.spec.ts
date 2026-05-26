// packages/app/src/drawing/__tests__/handleRegenerate.spec.ts
/**
 * Unit tests for the handleRegenerate dispatch logic in handleRegenerateHelpers.
 * We test buildHandleRegenerate directly rather than mounting the full component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SectionView, DetailView, BaseView } from '@zilventor/shared';

// ── mock-hoisting: constants referenced inside vi.mock factories MUST be declared
//    via vi.hoisted (factories are hoisted above all other code by Vitest) ─────
const { mockRegenerateSectionView, mockRegenerateDetailView } = vi.hoisted(() => ({
  mockRegenerateSectionView: vi.fn().mockResolvedValue(undefined),
  mockRegenerateDetailView: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../regenerateSectionView', () => ({
  regenerateSectionView: mockRegenerateSectionView,
}));
vi.mock('../regenerateDetailView', () => ({
  regenerateDetailView: mockRegenerateDetailView,
}));

// Import after mock setup
import { buildHandleRegenerate } from '../handleRegenerateHelpers';

const SECTION_VIEW: SectionView = {
  id: 'sec-1', kind: 'section', parentViewId: 'base-1',
  sectionLine: { p0: { x: 5, y: 15 }, p1: { x: 45, y: 15 } },
  arrowDirection: 1, label: 'A',
  positionMm: { x: 200, y: 80 }, scale: { numerator: 1, denominator: 1 },
  showHidden: false, mode: 'full',
  plane: { origin: { x: 0, y: 25, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
  hatchSegments: [], fingerprint: 'fp',
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 0 },
  },
  inputFingerprint: 'stale-fp',
};

const DETAIL_VIEW: DetailView = {
  id: 'det-1', kind: 'detail', parentViewId: 'base-1',
  regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 8 },
  label: 'B',
  positionMm: { x: 300, y: 200 }, scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-1', kind: 'outline', points: [[2,2],[6,2]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
  },
  inputFingerprint: 'stale-detail-fp',
};

const BASE_VIEW: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 80, y: 80 }, scale: { numerator: 1, denominator: 1 },
  orientation: 'front', showHidden: false,
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline', points: [[0,0],[50,0]], sourceFaceIds: [] }],
    hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  },
  inputFingerprint: 'stale-base-fp',
};

const views = [BASE_VIEW, SECTION_VIEW, DETAIL_VIEW];
const fakeBus = { execute: vi.fn() };
const mockClearStale = vi.fn();

describe('buildHandleRegenerate — section dispatch', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('calls regenerateSectionView for section view kind', async () => {
    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['sec-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('sec-1');

    expect(mockRegenerateSectionView).toHaveBeenCalledOnce();
    expect(mockRegenerateSectionView).toHaveBeenCalledWith(SECTION_VIEW, 'sheet-1', fakeBus);
    expect(mockClearStale).toHaveBeenCalledWith('sec-1');
  });

  it('does NOT clear stale marker when regenerateSectionView throws', async () => {
    mockRegenerateSectionView.mockRejectedValueOnce(new Error('cut failed'));

    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['sec-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('sec-1');

    expect(mockClearStale).not.toHaveBeenCalled();
  });

  it('calls regenerateDetailView for detail view kind', async () => {
    const handleRegen = buildHandleRegenerate({
      views,
      sheetId: 'sheet-1',
      bus: fakeBus as never,
      staleViews: new Set(['det-1']),
      clearStaleView: mockClearStale,
      projectViewFromSourceFn: vi.fn(),
    });

    await handleRegen('det-1');

    expect(mockRegenerateDetailView).toHaveBeenCalledOnce();
    const [detView, sid, , parentIsStale] = mockRegenerateDetailView.mock.calls[0]! as [DetailView, string, unknown, (id: string) => boolean];
    expect(detView.id).toBe('det-1');
    expect(sid).toBe('sheet-1');
    // parentIsStale: base-1 is NOT in staleViews (only det-1 is), so false
    expect(parentIsStale('base-1')).toBe(false);
    expect(mockClearStale).toHaveBeenCalledWith('det-1');
  });
});
