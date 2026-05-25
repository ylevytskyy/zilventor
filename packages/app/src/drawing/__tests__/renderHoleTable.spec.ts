// packages/app/src/drawing/__tests__/renderHoleTable.spec.ts
import { describe, it, expect, vi } from 'vitest';
import type { DrawingDocument, DrawingSheet, DrawingView } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';
import type { HoleTableAnnotation } from '@zilventor/shared';
import type { HoleTableRow } from '@zilventor/shared/src/drawing/holeTable';

vi.mock('@zilventor/shared/src/drawing/holeTable', () => ({
  computeHoleTableRows: vi.fn(),
}));

import { computeHoleTableRows } from '@zilventor/shared/src/drawing/holeTable';
import { renderDrawingSvg } from '../renderDrawingSvg';

const mockRows: HoleTableRow[] = [
  {
    tag: 'A1',
    xDim: 20,
    yDim: -15,
    description: '⌀8 THRU',
    markerCenterSheetMm: { x: 130, y: 80 },
  },
];

const htAnn: HoleTableAnnotation = {
  kind: 'holeTable',
  id: 'ht-svg-1',
  viewId: 'v-1',
  datum: { kind: 'edge-endpoint', edgeId: 'e-1', end: 'start' },
  positionMm: { x: 200, y: 50 },
  entries: [{ holeFeatureId: 'H1', tag: 'A1' }],
};

const mockView: DrawingView = {
  id: 'v-1',
  kind: 'base',
  positionMm: { x: 100, y: 50 },
  scale: { numerator: 1, denominator: 1 },
  projection: {
    visibleEdges: [],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  },
} as unknown as DrawingView;

const mockSheet = {
  id: 's-1',
  activeSheetId: 's-1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [mockView],
  dimensions: [],
  dimensionGroups: [],
  annotations: [htAnn],
  titleBlock: {},
} as unknown as DrawingSheet;

// mockSource has featureTree (PartDocument structural check) but no `kind` field
const mockSource = {
  id: 'p-1',
  name: 'TestPart',
  parameters: {},
  featureTree: [],
  properties: {},
  materials: [],
  hardware: [],
  units: 'mm',
} as unknown as PartDocument;

const mockDrawing = {
  id: 'd-1',
  name: 'Test Drawing',
  sheets: [mockSheet],
  activeSheetId: 's-1',
  source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
  units: 'mm',
  properties: {},
} as unknown as DrawingDocument;

describe('renderDrawingSvg — holeTable annotation', () => {
  it('includes data-ann-kind="holeTable" in the SVG output', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-ann-kind="holeTable"');
  });

  it('includes data-ann-id with the annotation id', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-ann-id="ht-svg-1"');
  });

  it('includes tag text in the SVG output', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('>A1<');
  });

  it('includes XDIM and YDIM header cells', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('>XDIM<');
    expect(svg).toContain('>YDIM<');
  });

  it('emits a per-hole balloon circle', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    // balloon circle with role
    expect(svg).toContain('data-role="hole-balloon"');
  });

  it('emits a per-hole leader line', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(svg).toContain('data-role="hole-leader"');
  });

  it('calls computeHoleTableRows with the correct part + resolveParam', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue(mockRows);
    renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    expect(computeHoleTableRows).toHaveBeenCalledWith(
      htAnn,
      mockView,
      mockSource,
      expect.any(Function),
    );
  });

  it('returns empty string fragment when computeHoleTableRows returns []', () => {
    vi.mocked(computeHoleTableRows).mockReturnValue([]);
    const svg = renderDrawingSvg(mockDrawing, mockSheet, mockSource);
    // The annotation group should be empty (or absent entirely)
    expect(svg).not.toContain('data-ann-id="ht-svg-1"');
  });
});
