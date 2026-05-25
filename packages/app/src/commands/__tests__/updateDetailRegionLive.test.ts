// packages/app/src/commands/__tests__/updateDetailRegionLive.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, DetailView, BaseView, RegionParent } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockImplementation(
      (input: { regionParent: RegionParent }) => ({
        visibleEdges: [
          {
            id: `live-${input.regionParent.center.x}`,
            kind: 'outline' as const,
            points: [[input.regionParent.center.x, 0], [input.regionParent.center.x + 3, 0]] as [number,number][],
            sourceFaceIds: [],
          },
        ],
        hiddenEdges: [],
        bbox: { minX: input.regionParent.center.x, minY: 0, maxX: input.regionParent.center.x + 3, maxY: 0 },
      })
    ),
    fingerprintDetailView: vi.fn().mockReturnValue('fp-live'),
  };
});

const PARENT_PROJ = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0,0],[100,0]] as [number,number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};
const PARENT_VIEW: BaseView = {
  id: 'pv1', kind: 'base', positionMm: { x: 0, y: 0 },
  scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
  projection: PARENT_PROJ, inputFingerprint: 'pv1-fp',
};
const DETAIL_VIEW: DetailView = {
  id: 'dv1', kind: 'detail', parentViewId: 'pv1',
  regionParent: { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 5 },
  label: 'A', positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 }, showHidden: false,
  projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
  inputFingerprint: 'old-fp',
};

function makeSheet(): DrawingSheet {
  return {
    id: 's1', name: 'S1',
    size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
    views: [PARENT_VIEW, { ...DETAIL_VIEW }],
    dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
  };
}
function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D1', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, sheets: [makeSheet()], activeSheetId: 's1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null, activeAssembly: null,
  } as never);
});

describe('updateDetailRegionLive', () => {
  it('updates regionParent.center immediately in the store (circle)', () => {
    useAppStore.getState().updateDetailRegionLive(
      's1', 'dv1', { kind: 'circle', center: { x: 45, y: 30 }, radiusMm: 5 }
    );
    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') throw new Error('no drawing');
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.center).toEqual({ x: 45, y: 30 });
  });

  it('updates radiusMm immediately in the store (circle)', () => {
    useAppStore.getState().updateDetailRegionLive(
      's1', 'dv1', { kind: 'circle', center: { x: 10, y: 10 }, radiusMm: 20 }
    );
    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.kind).toBe('circle');
    if (dv.regionParent.kind === 'circle') {
      expect(dv.regionParent.radiusMm).toBe(20);
    }
  });

  it('recomputes projection (edge id reflects new center)', () => {
    useAppStore.getState().updateDetailRegionLive(
      's1', 'dv1', { kind: 'circle', center: { x: 77, y: 10 }, radiusMm: 5 }
    );
    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.projection!.visibleEdges[0]?.id).toBe('live-77');
  });

  it('accepts a rect RegionParent without throwing', () => {
    const rectRegion: RegionParent = { kind: 'rect', center: { x: 5, y: 5 }, widthMm: 10, heightMm: 8 };
    expect(() =>
      useAppStore.getState().updateDetailRegionLive('s1', 'dv1', rectRegion)
    ).not.toThrow();
    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.kind).toBe('rect');
  });

  it('is a no-op when parent projection is missing', () => {
    const parentNoProj: BaseView = {
      id: 'pv-noproj', kind: 'base', positionMm: { x: 0, y: 0 },
      scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
    };
    const detailForNoProj: DetailView = {
      id: 'dv-noproj', kind: 'detail', parentViewId: 'pv-noproj',
      regionParent: { kind: 'circle', center: { x: 5, y: 5 }, radiusMm: 3 },
      label: 'B', positionMm: { x: 200, y: 100 },
      scale: { numerator: 2, denominator: 1 }, showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'fp-B',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing', document: {
          ...makeDrawing(),
          sheets: [{ ...makeSheet(), views: [parentNoProj, detailForNoProj] }],
        },
      },
    } as never);

    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    useAppStore.getState().updateDetailRegionLive(
      's1', 'dv-noproj', { kind: 'circle', center: { x: 99, y: 99 }, radiusMm: 1 }
    );
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});
