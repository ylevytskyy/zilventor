// packages/app/src/commands/__tests__/DeleteDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDrawingDimensionCommand } from '../DeleteDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

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
      views: [], dimensions: [dimA, dimB], annotations: [], titleBlock: {},
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
