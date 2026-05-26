// packages/app/src/drawing/__tests__/regenerateDetailView.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { regenerateDetailView } from '../regenerateDetailView';
import type { DrawingDocument, DetailView, BaseView } from '@zilventor/shared';

// ── mock projectDetailView ────────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockReturnValue({
      visibleEdges: [{ id: 'clip-new', kind: 'outline', points: [[2,2],[8,2]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 2, minY: 2, maxX: 8, maxY: 8 },
    }),
    fingerprintDetailView: vi.fn().mockReturnValue('new-detail-fp'),
  };
});

const mockExecute = vi.fn().mockResolvedValue(undefined);
vi.mock('../../commands/RegenerateViewCommand', () => ({
  RegenerateViewCommand: vi.fn().mockImplementation((opts: unknown) => ({ name: 'RegenerateView', opts })),
}));

const fakeBus = { execute: mockExecute };

const BASE_VIEW_FRESH: BaseView = {
  id: 'base-v1',
  kind: 'base',
  positionMm: { x: 80, y: 80 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'b-e1', kind: 'outline', points: [[0,0],[60,0]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 60, maxY: 60 },
  },
  inputFingerprint: 'new-source-fp',
};

const DETAIL_VIEW: DetailView = {
  id: 'det-1',
  kind: 'detail',
  parentViewId: 'base-v1',
  regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 8 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'clip-old', kind: 'outline', points: [[2,2],[6,2]], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 2, maxX: 6, maxY: 6 },
  },
  inputFingerprint: 'old-detail-fp',
};

function makeDrawingWithDetail(): DrawingDocument {
  return {
    id: 'drw-d', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-d', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE_VIEW_FRESH as never, DETAIL_VIEW],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-d',
  };
}

describe('regenerateDetailView — basic re-clip (parent fresh, not stale)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() },
      activeDrawing: makeDrawingWithDetail(),
      activeDrawingSourceFingerprint: 'new-source-fp',
    });
  });

  it('calls projectDetailView with fresh parent projection, calls bus.execute with new fingerprint', async () => {
    const { projectDetailView, fingerprintDetailView } = await import('@zilventor/shared');

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => false, // parent not stale
      async (_view: unknown) => { /* cascade noop */ },
    );

    expect(projectDetailView).toHaveBeenCalledOnce();
    const callArg = (projectDetailView as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      parentView: { projection: { visibleEdges: unknown[] } };
      regionParent: { kind: string };
    };
    // Must clip against the LIVE parent projection (not stale closure)
    expect(callArg.parentView.projection.visibleEdges).toEqual(BASE_VIEW_FRESH.projection!.visibleEdges);
    expect(callArg.regionParent).toEqual(DETAIL_VIEW.regionParent);

    expect(fingerprintDetailView).toHaveBeenCalledOnce();
    expect(mockExecute).toHaveBeenCalledOnce();

    const cmdArg = mockExecute.mock.calls[0]![0] as { opts: { viewId: string; inputFingerprint: string } };
    expect(cmdArg.opts.viewId).toBe('det-1');
    expect(cmdArg.opts.inputFingerprint).toBe('new-detail-fp');
  });
});

describe('regenerateDetailView — cascade: stale parent regenerated before re-clip', () => {
  it('calls regenerateParent callback when parent is stale', async () => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);

    // Start with stale parent (projection present but stale).
    const staleParent: BaseView = {
      ...BASE_VIEW_FRESH,
      inputFingerprint: 'stale-parent-fp', // differs from activeDrawingSourceFingerprint
    };
    const drawing = makeDrawingWithDetail();
    const drawingWithStaleParent: DrawingDocument = {
      ...drawing,
      sheets: drawing.sheets.map((s) => ({
        ...s,
        views: [staleParent as never, DETAIL_VIEW],
      })),
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingWithStaleParent },
      activeDrawing: drawingWithStaleParent,
      activeDrawingSourceFingerprint: 'new-source-fp',
    });

    const mockRegenerateParent = vi.fn().mockImplementation(async () => {
      // Simulate parent regen: update the parent's projection in the store.
      const liveDoc = useAppStore.getState().activeDocument!.document as DrawingDocument;
      const refreshed: DrawingDocument = {
        ...liveDoc,
        sheets: liveDoc.sheets.map((s) => ({
          ...s,
          views: s.views.map((v) =>
            v.id === staleParent.id
              ? { ...v, projection: BASE_VIEW_FRESH.projection!, inputFingerprint: 'new-source-fp' } as never
              : v
          ),
        })),
      };
      useAppStore.setState({ activeDocument: { kind: 'drawing', document: refreshed }, activeDrawing: refreshed });
    });

    const { projectDetailView } = await import('@zilventor/shared');

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => true, // parent IS stale
      mockRegenerateParent,
    );

    // 1. regenerateParent was called with the parent view object.
    expect(mockRegenerateParent).toHaveBeenCalledOnce();
    expect(mockRegenerateParent.mock.calls[0]![0]).toMatchObject({ id: 'base-v1', kind: 'base' });

    // 2. projectDetailView was called AFTER regenerateParent (reads fresh projection).
    expect(projectDetailView).toHaveBeenCalledOnce();
    const clipArg = (projectDetailView as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      parentView: { projection: { visibleEdges: unknown[] }; inputFingerprint?: string };
    };
    // Fresh projection (set by mockRegenerateParent above).
    expect(clipArg.parentView.inputFingerprint).toBe('new-source-fp');
  });

  it('does NOT call regenerateParent when parent is not stale', async () => {
    vi.clearAllMocks();
    mockExecute.mockResolvedValue(undefined);
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithDetail() },
      activeDrawing: makeDrawingWithDetail(),
      activeDrawingSourceFingerprint: 'new-source-fp',
    });

    const mockRegenerateParent = vi.fn();

    await regenerateDetailView(
      DETAIL_VIEW,
      'sheet-d',
      fakeBus as never,
      (_id: string) => false, // parent NOT stale
      mockRegenerateParent,
    );

    expect(mockRegenerateParent).not.toHaveBeenCalled();
    expect(mockExecute).toHaveBeenCalledOnce();
  });
});
