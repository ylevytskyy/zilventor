// packages/app/src/commands/__tests__/ToggleHiddenLinesCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { ToggleHiddenLinesCommand } from '../ToggleHiddenLinesCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

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
      views: [VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('ToggleHiddenLinesCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } });
  });

  it('apply sets showHidden to false', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.showHidden).toBe(false);
  });

  it('revert restores prior showHidden value', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.showHidden).toBe(true);
  });

  it('apply → revert round-trip: true → false → true', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'view-1', showHidden: false });
    await cmd.apply();
    expect((useAppStore.getState().activeDocument).document.sheets[0]!.views[0]!.showHidden).toBe(false);
    await cmd.revert();
    expect((useAppStore.getState().activeDocument).document.sheets[0]!.views[0]!.showHidden).toBe(true);
  });

  it('apply is a no-op when viewId not found', async () => {
    const cmd = new ToggleHiddenLinesCommand({ sheetId: 'sheet-1', viewId: 'no-such', showHidden: false });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument).document;
    expect(doc.sheets[0]!.views[0]!.showHidden).toBe(true);
  });
});
