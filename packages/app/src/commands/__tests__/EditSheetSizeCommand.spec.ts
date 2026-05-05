// packages/app/src/commands/__tests__/EditSheetSizeCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditSheetSizeCommand } from '../EditSheetSizeCommand';
import type { DrawingDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
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

describe('EditSheetSizeCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply updates size and orientation', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'iso', size: 'A1' },
      orientation: 'portrait',
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A1' });
    expect(doc.sheets[0]!.orientation).toBe('portrait');
  });

  it('revert restores prior size and orientation', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'iso', size: 'A1' },
      orientation: 'portrait',
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'iso', size: 'A3' });
    expect(doc.sheets[0]!.orientation).toBe('landscape');
  });

  it('custom sheet size round-trips', async () => {
    const cmd = new EditSheetSizeCommand({
      sheetId: 'sheet-1',
      size: { kind: 'custom', widthMm: 500, heightMm: 350 },
      orientation: 'landscape',
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.size).toEqual({ kind: 'custom', widthMm: 500, heightMm: 350 });
  });
});
