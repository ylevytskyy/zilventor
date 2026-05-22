// packages/app/src/commands/__tests__/RenameSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RenameSheetCommand } from '../RenameSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

describe('RenameSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply renames the specified sheet', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Front Views' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.name).toBe('Front Views');
  });

  it('revert restores the prior name', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'sheet-1', name: 'Front Views' });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.name).toBe('Sheet 1');
  });

  it('apply is a no-op when sheetId not found', async () => {
    const cmd = new RenameSheetCommand({ sheetId: 'no-such-sheet', name: 'X' });
    await expect(cmd.apply()).resolves.toBeUndefined();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.name).toBe('Sheet 1');
  });
});
