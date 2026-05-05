import type { DrawingDocument, DrawingSheet, DrawingView, DetailView } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

export function makeFixturePart(): PartDocument {
  return {
    id: 'p1',
    name: 'Test Part',
    units: 'mm',
    parameters: {},
    featureTree: [],
    properties: {},
    materials: [{ id: 'm1', name: 'Birch Ply', defaultThickness: 18, color: '#c8a96e' }],
    hardware: [],
  };
}

function makeFixtureSheet(id: string, name: string, viewCount = 1): DrawingSheet {
  const views: DrawingView[] = Array.from({ length: viewCount }, (_, i) => ({
    id: `view-${id}-${i}`,
    kind: 'base' as const,
    positionMm: { x: 50 + i * 80, y: 50 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [
        {
          id: `edge-vis-${id}-${i}`,
          kind: 'outline' as const,
          points: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]] as ReadonlyArray<readonly [number, number]>,
        },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    },
  }));

  return {
    id,
    name,
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views,
    dimensions: [],
    annotations: [],
    titleBlock: {},
  };
}

export interface MakeFixtureDrawingOpts {
  sheetCount?: number;
  viewCount?: number;
}

export function makeFixtureDrawing(opts: MakeFixtureDrawingOpts = {}): DrawingDocument {
  const { sheetCount = 1, viewCount = 1 } = opts;
  const sheets = Array.from({ length: sheetCount }, (_, i) =>
    makeFixtureSheet(`sheet-${i + 1}`, `Sheet ${i + 1}`, viewCount),
  );
  return {
    id: 'drawing-1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
    properties: {},
    sheets,
    activeSheetId: sheets[0]?.id ?? 'sheet-1',
  };
}

export function makeFixtureDetailView(id = 'detail-1'): DetailView {
  return {
    id,
    kind: 'detail',
    parentViewId: 'view-sheet-1-0',
    regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
    label: 'A',
    positionMm: { x: 200, y: 80 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'de0', kind: 'outline' as const, points: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    },
    inputFingerprint: 'fp-detail-1',
  };
}

export function makeFixtureDrawingWithDetailView(): DrawingDocument {
  const base = makeFixtureDrawing({ viewCount: 1 });
  const sheet = base.sheets[0]!;
  const detail = makeFixtureDetailView();
  return {
    ...base,
    sheets: [{ ...sheet, views: [...sheet.views, detail] }],
  };
}

export function makeFixtureDrawingWithParentAndDetail(): DrawingDocument {
  const parentView: DrawingView = {
    id: 'parent-view-1',
    kind: 'base' as const,
    positionMm: { x: 80, y: 80 },
    scale: { numerator: 1, denominator: 1 },
    orientation: 'front' as const,
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'pv-e0', kind: 'outline' as const, points: [[0, 0], [50, 0], [50, 30], [0, 30], [0, 0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
    },
    inputFingerprint: 'fp-parent',
  };
  const detailView: DetailView = {
    id: 'detail-overlay-1',
    kind: 'detail',
    parentViewId: 'parent-view-1',
    regionParent: { center: { x: 25, y: 15 }, radiusMm: 10 },
    label: 'A',
    positionMm: { x: 200, y: 80 },
    scale: { numerator: 2, denominator: 1 },
    showHidden: false,
    projection: {
      visibleEdges: [
        { id: 'dov-e0', kind: 'outline' as const, points: [[0, 0], [8, 0], [8, 6], [0, 6], [0, 0]] as ReadonlyArray<readonly [number, number]> },
      ],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 8, maxY: 6 },
    },
    inputFingerprint: 'fp-detail-overlay',
  };
  const sheetId = 'sheet-overlay-1';
  return {
    id: 'drawing-overlay-1',
    name: 'Overlay Drawing',
    units: 'mm',
    source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: sheetId,
      name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [parentView, detailView],
      dimensions: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: sheetId,
  };
}
