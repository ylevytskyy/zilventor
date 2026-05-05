// packages/shared/src/drawing/__tests__/titleBlock.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveTitleBlock } from '../titleBlock';
import type { DrawingDocument, DrawingSheet } from '../drawingTypes';
import type { PartDocument } from '../../types';

// Minimal PartDocument stub
const part: PartDocument = {
  id: 'p1',
  name: 'Cabinet Panel',
  units: 'mm',
  parameters: {},
  featureTree: [],
  properties: {},
  materials: [{ id: 'm1', name: 'Birch Ply', defaultThickness: 18, color: '#c8a96e' }],
  hardware: [],
};

// Minimal DrawingDocument stub
const drawing: DrawingDocument = {
  id: 'd1',
  name: 'Cabinet Panel — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: 's1',
  createdAt: '2026-05-05T10:00:00Z',
};

// Sheet with a base view scale 1:5
const sheet: DrawingSheet = {
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [
    {
      id: 'v1',
      kind: 'base',
      positionMm: { x: 10, y: 10 },
      scale: { numerator: 1, denominator: 5 },
      orientation: 'front',
      showHidden: true,
    },
  ],
  dimensions: [],
  annotations: [],
  titleBlock: {},
};

const allSheets: DrawingSheet[] = [sheet];

describe('resolveTitleBlock — no overrides', () => {
  it('auto-derives drawingName from drawing.name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.drawingName).toBe('Cabinet Panel — Drawing');
  });

  it('auto-derives partName from source.name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.partName).toBe('Cabinet Panel');
  });

  it('auto-derives material from part.materials[0].name', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.material).toBe('Birch Ply');
  });

  it('auto-derives scaleText from primary base view scale', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.scaleText).toBe('1:5');
  });

  it('auto-derives sheetNumber from sheet index', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.sheetNumber).toEqual({ current: 1, total: 1 });
  });

  it('auto-derives date as ISO yyyy-mm-dd from drawing.createdAt', () => {
    const r = resolveTitleBlock(drawing, sheet, allSheets, part);
    expect(r.date).toBe('2026-05-05');
  });
});

describe('resolveTitleBlock — full overrides', () => {
  const sheetWithOverrides: DrawingSheet = {
    ...sheet,
    titleBlock: {
      drawingName: 'Custom Name',
      partName: 'Custom Part',
      drawnBy: 'JD',
      approvedBy: 'SM',
      scaleText: '1:10',
      date: '2025-01-01',
      material: 'MDF',
      revision: 'B',
      notes: 'For review only',
    },
  };

  it('full overrides win over all auto-derived values', () => {
    const r = resolveTitleBlock(drawing, sheetWithOverrides, allSheets, part);
    expect(r.drawingName).toBe('Custom Name');
    expect(r.partName).toBe('Custom Part');
    expect(r.drawnBy).toBe('JD');
    expect(r.approvedBy).toBe('SM');
    expect(r.scaleText).toBe('1:10');
    expect(r.date).toBe('2025-01-01');
    expect(r.material).toBe('MDF');
    expect(r.revision).toBe('B');
    expect(r.notes).toBe('For review only');
  });
});

describe('resolveTitleBlock — mixed overrides', () => {
  const sheetPartial: DrawingSheet = {
    ...sheet,
    titleBlock: { drawingName: 'Override Only Name' },
  };

  it('overridden fields use override; non-overridden fields use auto-derived', () => {
    const r = resolveTitleBlock(drawing, sheetPartial, allSheets, part);
    expect(r.drawingName).toBe('Override Only Name');
    expect(r.partName).toBe('Cabinet Panel');   // auto-derived
    expect(r.material).toBe('Birch Ply');       // auto-derived
    expect(r.scaleText).toBe('1:5');            // auto-derived
  });
});

describe('resolveTitleBlock — edge cases', () => {
  it('no base view on sheet → scaleText defaults to 1:1', () => {
    const sheetNoViews: DrawingSheet = { ...sheet, views: [] };
    const r = resolveTitleBlock(drawing, sheetNoViews, allSheets, part);
    expect(r.scaleText).toBe('1:1');
  });

  it('part with no materials → material is empty string', () => {
    const partNoMat: PartDocument = { ...part, materials: [] };
    const r = resolveTitleBlock(drawing, sheet, allSheets, partNoMat);
    expect(r.material).toBe('');
  });
});
