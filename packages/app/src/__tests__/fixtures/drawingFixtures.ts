import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';
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
