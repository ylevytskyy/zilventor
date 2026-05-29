// packages/app/src/drawing/__tests__/renderPartsList.spec.ts
import { describe, it, expect } from 'vitest';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartsListAnnotation } from '@zilventor/shared';
import { renderDrawingSvg } from '../renderDrawingSvg';

const plAnn: PartsListAnnotation = {
  kind: 'partsList',
  id: 'pl-svg-1',
  positionMm: { x: 10, y: 20 },
  rows: [
    {
      item: 1,
      qty: 2,
      partName: 'Side Panel',
      material: 'Oak',
      dimensions: '600×400×18',
      edgeBands: 'T,B',
    },
    {
      item: 2,
      qty: 4,
      partName: 'M6 Screw',
      material: '',
      dimensions: '',
      edgeBands: '',
    },
  ],
};

const mockSheet: DrawingSheet = {
  id: 's-1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [],
  dimensions: [],
  dimensionGroups: [],
  annotations: [plAnn],
  titleBlock: {},
} as unknown as DrawingSheet;

const mockDrawing: DrawingDocument = {
  id: 'd-1',
  name: 'Test Drawing',
  sheets: [mockSheet],
  activeSheetId: 's-1',
  source: { partPath: 'parts/test.zipt', sourceKind: 'part' },
  units: 'mm',
  properties: {},
} as unknown as DrawingDocument;

describe('renderDrawingSvg — partsList annotation', () => {
  it('emits data-ann-kind="partsList"', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('data-ann-kind="partsList"');
  });

  it('includes data-ann-id with the annotation id', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('data-ann-id="pl-svg-1"');
  });

  it('emits header cell ITEM', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>ITEM<');
  });

  it('emits header cell QTY', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>QTY<');
  });

  it('emits header cell PART NAME', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>PART NAME<');
  });

  it('emits header cell MATERIAL', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>MATERIAL<');
  });

  it('emits header cell DIMENSIONS', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>DIMENSIONS<');
  });

  it('emits the part name from data row', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>Side Panel<');
  });

  it('emits the hardware row (empty material/dims) without throwing', () => {
    const svg = renderDrawingSvg(mockDrawing, mockSheet, null);
    expect(svg).toContain('>M6 Screw<');
  });
});
