// packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MoveDrawingDimensionCommand } from '../MoveDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const dim1: DrawingDimension = {
  id: 'dim1',
  kind: 'linear-h',
  viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [dim1], annotations: [], titleBlock: {}, dimensionGroups: [],
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('MoveDrawingDimensionCommand', () => {
  it('(a) apply updates offsetMm on the target dimension', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as { offsetMm: number }).offsetMm).toBe(25);
  });

  it('(a) apply updates angleDeg on radial dimensions when provided', async () => {
    // Seed a radial dim
    const radialDim: DrawingDimension = { id: 'dim2', kind: 'radial', viewId: 'v1', edgeId: 'arc1', offsetMm: 5, angleDeg: 0 };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'dw1', name: 'Test Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {}, activeSheetId: 'sh1',
          sheets: [{
            id: 'sh1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [], dimensions: [radialDim], annotations: [], titleBlock: {}, dimensionGroups: [],
          }],
        },
      },
    } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim2', offsetMm: 12, angleDeg: 45 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number; angleDeg: number };
    expect(dim.offsetMm).toBe(12);
    expect(dim.angleDeg).toBe(45);
  });

  it('(b) revert restores prior offsetMm', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });
});
