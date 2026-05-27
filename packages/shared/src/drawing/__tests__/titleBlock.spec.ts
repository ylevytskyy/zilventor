// packages/shared/src/drawing/__tests__/titleBlock.spec.ts
import { describe, it, expect } from 'vitest';
import { resolveTitleBlock } from '../titleBlock';
import type { DrawingDocument, DrawingSheet } from '../types';
import type { PartDocument, AssemblyDocument } from '../../types';

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

// Minimal DrawingDocument stub (spec §2.2 — 7 fields, no createdAt)
const drawing: DrawingDocument = {
  id: 'd1',
  name: 'Cabinet Panel — Drawing',
  units: 'mm',
  source: { partPath: 'parts/cabinet.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [],
  activeSheetId: 's1',
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
  dimensionGroups: [],
};

const CREATED_AT = '2026-05-05T10:00:00Z';
// sheetIndex=0, sheetCount=1 for single-sheet tests

describe('resolveTitleBlock — no overrides', () => {
  it('auto-derives drawingName from drawing.name', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
    expect(r.drawingName).toBe('Cabinet Panel — Drawing');
  });

  it('auto-derives partName from source.name', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
    expect(r.partName).toBe('Cabinet Panel');
  });

  it('auto-derives material from part.materials[0].name', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
    expect(r.material).toBe('Birch Ply');
  });

  it('auto-derives scaleText from primary base view scale', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
    expect(r.scaleText).toBe('1:5');
  });

  it('auto-derives sheetNumber from sheet index', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
    expect(r.sheetNumber).toEqual({ current: 1, total: 1 });
  });

  it('auto-derives date as ISO yyyy-mm-dd from createdAt', () => {
    const r = resolveTitleBlock(drawing, sheet, part, 0, 1, CREATED_AT);
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
    const r = resolveTitleBlock(drawing, sheetWithOverrides, part, 0, 1, CREATED_AT);
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
    const r = resolveTitleBlock(drawing, sheetPartial, part, 0, 1, CREATED_AT);
    expect(r.drawingName).toBe('Override Only Name');
    expect(r.partName).toBe('Cabinet Panel');   // auto-derived
    expect(r.material).toBe('Birch Ply');       // auto-derived
    expect(r.scaleText).toBe('1:5');            // auto-derived
  });
});

describe('resolveTitleBlock — edge cases', () => {
  it('no base view on sheet → scaleText defaults to 1:1', () => {
    const sheetNoViews: DrawingSheet = { ...sheet, views: [] };
    const r = resolveTitleBlock(drawing, sheetNoViews, part, 0, 1, CREATED_AT);
    expect(r.scaleText).toBe('1:1');
  });

  it('part with no materials → material is empty string', () => {
    const partNoMat: PartDocument = { ...part, materials: [] };
    const r = resolveTitleBlock(drawing, sheet, partNoMat, 0, 1, CREATED_AT);
    expect(r.material).toBe('');
  });
});

describe('resolveTitleBlock — assembly source', () => {
  const assembly: AssemblyDocument = {
    id: 'a1',
    name: 'Cabinet Assembly',
    units: 'mm',
    parameters: {},
    components: [],
    constraints: [],
    groundedComponentPaths: [],
    colors: {},
    bomItemNumbers: {},
    cutListItemNumbers: {},
    colorOverrides: {},
    properties: {},
    materials: [],
    hardware: [],
  };

  it('assembly source yields material = empty string (spec §2.8)', () => {
    const r = resolveTitleBlock(drawing, sheet, assembly, 0, 1, CREATED_AT);
    expect(r.material).toBe('');
  });
});

function nullSourceSheet(overrides: Partial<DrawingSheet['titleBlock']> = {}): DrawingSheet {
  return {
    id: 'sh1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [],
    dimensions: [],
    annotations: [],
    titleBlock: overrides,
    dimensionGroups: [],
  };
}

function nullSourceDrawing(sh: DrawingSheet): DrawingDocument {
  return {
    id: 'dw1',
    name: 'My Drawing',
    units: 'mm',
    source: { partPath: 'parts/dummy.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [sh],
    activeSheetId: 'sh1',
  };
}

describe('resolveTitleBlock — null source', () => {
  it('degrades partName and material to blank when source is null and no override', () => {
    const sh = nullSourceSheet();
    const tb = resolveTitleBlock(nullSourceDrawing(sh), sh, null, 0, 1, '');
    expect(tb.partName).toBe('');
    expect(tb.material).toBe('');
    expect(tb.drawingName).toBe('My Drawing');
    expect(tb.scaleText).toBe('1:1');
    expect(tb.sheetNumber).toEqual({ current: 1, total: 1 });
  });

  it('uses sheet overrides for partName and material when source is null', () => {
    const sh = nullSourceSheet({ partName: 'Widget', material: 'Steel' });
    const tb = resolveTitleBlock(nullSourceDrawing(sh), sh, null, 0, 1, '');
    expect(tb.partName).toBe('Widget');
    expect(tb.material).toBe('Steel');
  });
});
