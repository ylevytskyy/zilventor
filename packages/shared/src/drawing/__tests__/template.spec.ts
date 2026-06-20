import { describe, it, expect } from 'vitest';
import {
  exportDrawingTemplate,
  importDrawingTemplate,
  applyTemplateToNewSheet,
  DRAWING_TEMPLATE_FORMAT_VERSION,
} from '../template';
import type { DrawingSheet, DrawingView, DrawingDimension, DimensionGroup } from '../types';

function makeSheet(over: Partial<DrawingSheet> = {}): DrawingSheet {
  return {
    id: 'sheet-1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [{ id: 'v1' } as unknown as DrawingView],
    dimensions: [{ id: 'd1' } as unknown as DrawingDimension],
    annotations: [
      { id: 'a1', kind: 'balloon', viewId: 'v1', targetMm: { x: 0, y: 0 }, textPosMm: { x: 5, y: 5 }, itemNumber: 1 },
    ],
    titleBlock: { drawnBy: 'YL', notes: 'shop notes', revision: 'A' },
    dimensionGroups: [{ id: 'g1' } as unknown as DimensionGroup],
    ...over,
  };
}

describe('exportDrawingTemplate (slice 1)', () => {
  it('strips views, dimensions, annotations, dimensionGroups', () => {
    const t = exportDrawingTemplate(makeSheet());
    expect(t).not.toHaveProperty('views');
    expect(t).not.toHaveProperty('dimensions');
    expect(t).not.toHaveProperty('annotations');
    expect(t).not.toHaveProperty('dimensionGroups');
  });

  it('keeps size, orientation and the title block', () => {
    const t = exportDrawingTemplate(makeSheet());
    expect(t.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(t.orientation).toBe('landscape');
    expect(t.titleBlock).toEqual({ drawnBy: 'YL', notes: 'shop notes', revision: 'A' });
    expect(t.formatVersion).toBe(DRAWING_TEMPLATE_FORMAT_VERSION);
  });

  it('carries the underlay when present and omits it when absent', () => {
    const underlay = { name: 'frame.dxf', entities: [] };
    const withU = exportDrawingTemplate(makeSheet({ underlay }));
    expect(withU.underlay).toEqual(underlay);
    const withoutU = exportDrawingTemplate(makeSheet());
    expect(withoutU).not.toHaveProperty('underlay');
  });

  it('defaults the template name to the sheet name; explicit name overrides', () => {
    expect(exportDrawingTemplate(makeSheet()).name).toBe('Sheet 1');
    expect(exportDrawingTemplate(makeSheet(), 'Shop A3').name).toBe('Shop A3');
  });
});

describe('applyTemplateToNewSheet (slice 2)', () => {
  it('produces a sheet with empty content and the template chrome', () => {
    const t = exportDrawingTemplate(makeSheet());
    const sheet = applyTemplateToNewSheet(t, { id: 'new-id', name: 'Sheet 2' });
    expect(sheet.id).toBe('new-id');
    expect(sheet.name).toBe('Sheet 2');
    expect(sheet.views).toEqual([]);
    expect(sheet.dimensions).toEqual([]);
    expect(sheet.annotations).toEqual([]);
    expect(sheet.dimensionGroups).toEqual([]);
    expect(sheet.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(sheet.orientation).toBe('landscape');
    expect(sheet.titleBlock).toEqual({ drawnBy: 'YL', notes: 'shop notes', revision: 'A' });
  });

  it('carries the underlay from the template and omits it when absent', () => {
    const underlay = { name: 'frame.dxf', entities: [] };
    const withU = applyTemplateToNewSheet(exportDrawingTemplate(makeSheet({ underlay })), { id: 'x', name: 'X' });
    expect(withU.underlay).toEqual(underlay);
    const withoutU = applyTemplateToNewSheet(exportDrawingTemplate(makeSheet()), { id: 'y', name: 'Y' });
    expect(withoutU.underlay).toBeUndefined();
  });
});

describe('importDrawingTemplate (slice 3)', () => {
  it('round-trips a serialized template and preserves the title block', () => {
    const t = exportDrawingTemplate(makeSheet(), 'Shop A3');
    const back = importDrawingTemplate(JSON.stringify(t));
    expect(back).toEqual(t);
    expect(back.titleBlock).toEqual({ drawnBy: 'YL', notes: 'shop notes', revision: 'A' });
  });

  it('throws on non-JSON', () => {
    expect(() => importDrawingTemplate('not json{')).toThrow();
  });

  it('throws on a JSON object missing required fields', () => {
    expect(() => importDrawingTemplate(JSON.stringify({ name: 'x' }))).toThrow();
    expect(() => importDrawingTemplate(JSON.stringify({ formatVersion: 1, name: 'x', orientation: 'sideways', size: {}, titleBlock: {} }))).toThrow();
  });
});
