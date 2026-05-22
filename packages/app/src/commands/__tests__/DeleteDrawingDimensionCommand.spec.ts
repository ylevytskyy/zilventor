// packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDrawingDimensionCommand } from '../DeleteDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const dimA: DrawingDimension = {
  id: 'dA', kind: 'linear-h', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};
const dimB: DrawingDimension = {
  id: 'dB', kind: 'linear-v', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
  offsetMm: 20,
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [dimA, dimB], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('DeleteDrawingDimensionCommand', () => {
  it('(a) apply removes the dimension by id', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]!.id).toBe('dB');
  });

  it('(b) revert re-inserts the removed dimension at its original index', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(2);
    expect(dims[0]!.id).toBe('dA');
    expect(dims[1]!.id).toBe('dB');
  });

  it('(c) revert is idempotent — second revert leaves one copy', async () => {
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dA' });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    // Second revert is a no-op: index already re-inserted once; no duplicate.
    expect(doc.sheets[0]!.dimensions).toHaveLength(2);
  });
});

describe('DeleteDrawingDimensionCommand — F5 new kinds', () => {
  function makeDocWithGroup(): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'baseline', id: 'bg1', viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      direction: 'h', baseOffsetMm: 20, spacingMm: 10,
    };
    const mem: DrawingDimension = {
      id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  it('deleting last baseline member leaves group intact (non-cascade)', async () => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDocWithGroup() },
    } as never);
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.dimensions).toHaveLength(0);
    // Group MUST still be present
    expect(sheet.dimensionGroups).toHaveLength(1);
    expect(sheet.dimensionGroups[0]!.id).toBe('bg1');
  });

  it('deleting an angular dim removes it; no group side-effects', async () => {
    const angularDim: DrawingDimension = {
      id: 'ang1', kind: 'angular', viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'e1' }, edge2: { viewId: 'v1', edgeId: 'e2' } },
      arcSide: 'inside', offsetMm: 15,
    } as unknown as DrawingDimension;
    const doc: DrawingDocument = {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [angularDim], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: doc } } as never);
    const cmd = new DeleteDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'ang1' });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    expect(doc2.sheets[0]!.dimensions).toHaveLength(0);
  });
});
