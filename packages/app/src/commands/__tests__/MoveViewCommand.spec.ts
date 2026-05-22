// packages/app/src/commands/__tests__/MoveViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MoveViewCommand } from '../MoveViewCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const VIEW: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('MoveViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply moves the view to the new position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'view-1', positionMm: { x: 150, y: 200 } });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 150, y: 200 });
  });

  it('revert restores the prior position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'view-1', positionMm: { x: 150, y: 200 } });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 50, y: 50 });
  });

  it('is a no-op when viewId not found', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'no-such', positionMm: { x: 0, y: 0 } });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views[0]!.positionMm).toEqual({ x: 50, y: 50 });
  });
});
