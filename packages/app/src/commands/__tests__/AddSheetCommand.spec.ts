// packages/app/src/commands/__tests__/AddSheetCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddSheetCommand } from '../AddSheetCommand';
import type { DrawingDocument } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

describe('AddSheetCommand', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawing() },
    } as never);
  });

  it('apply appends a new sheet and sets it as active', async () => {
    const cmd = new AddSheetCommand({});
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(2);
    expect(doc.activeSheetId).toBe(doc.sheets[1]!.id);
    expect(doc.sheets[1]!.name).toBe('Sheet 2');
  });

  it('apply uses provided size and orientation', async () => {
    const cmd = new AddSheetCommand({ size: { kind: 'iso', size: 'A2' }, orientation: 'portrait' });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[1]!.size).toEqual({ kind: 'iso', size: 'A2' });
    expect(doc.sheets[1]!.orientation).toBe('portrait');
  });

  it('revert removes the new sheet and restores prior activeSheetId', async () => {
    const cmd = new AddSheetCommand({});
    await cmd.apply();

    const docAfterApply = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const newSheetId = docAfterApply.sheets[1]!.id;

    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets.find(s => s.id === newSheetId)).toBeUndefined();
    expect(doc.activeSheetId).toBe('sheet-1');
  });

  it('apply is a no-op when no drawing is active', async () => {
    useAppStore.setState({ activeDocument: null } as never);
    const cmd = new AddSheetCommand({});
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
