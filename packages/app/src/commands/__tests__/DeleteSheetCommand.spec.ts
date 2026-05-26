// packages/app/src/commands/__tests__/DeleteSheetCommand.spec.ts
import { describe, it, expect } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { DeleteSheetCommand } from '../DeleteSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawingTwoSheets(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [
      { id: 'sheet-1', name: 'Sheet 1', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape', views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {} },
      { id: 'sheet-2', name: 'Sheet 2', size: { kind: 'iso', size: 'A3' }, orientation: 'landscape', views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {} },
    ],
    activeSheetId: 'sheet-2',
  };
}

function makeDrawingOneSheet(): DrawingDocument {
  return { ...makeDrawingTwoSheets(), sheets: [makeDrawingTwoSheets().sheets[0]!], activeSheetId: 'sheet-1' };
}

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

describe('DeleteSheetCommand', () => {
  it('apply removes the specified sheet from a 2-sheet drawing', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets.find(s => s.id === 'sheet-2')).toBeUndefined();
  });

  it('apply sets activeSheetId to remaining sheet when active sheet is deleted', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.activeSheetId).toBe('sheet-1');
  });

  it('revert restores the deleted sheet and prior activeSheetId', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingTwoSheets() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-2' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(2);
    expect(doc.sheets[1]!.id).toBe('sheet-2');
    expect(doc.activeSheetId).toBe('sheet-2');
  });

  it('refuses to delete the last sheet — no mutation', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingOneSheet() } } as never);
    const cmd = new DeleteSheetCommand({ sheetId: 'sheet-1' });
    await expect(cmd.apply()).rejects.toThrow(/LAST_SHEET/);

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(1);
  });
});
