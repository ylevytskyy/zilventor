// packages/app/src/commands/__tests__/AddDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawingDimensionCommand } from '../AddDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(dims: DrawingDimension[] = []): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: dims,
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

const dim1: DrawingDimension = {
  id: 'dim1',
  kind: 'linear-h',
  viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('AddDrawingDimensionCommand', () => {
  it('(a) apply appends the dimension to the sheet', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(1);
    expect(sheet.dimensions[0]!.id).toBe('dim1');
  });

  it('(b) revert removes the appended dimension', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(0);
  });

  it('(c) revert is idempotent — second revert is a no-op', async () => {
    const cmd = new AddDrawingDimensionCommand({ sheetId: 'sh1', dim: dim1 });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets.find((s) => s.id === 'sh1')!;
    expect(sheet.dimensions).toHaveLength(0);
  });
});
