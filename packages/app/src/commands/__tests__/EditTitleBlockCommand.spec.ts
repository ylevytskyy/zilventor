// packages/app/src/commands/__tests__/EditTitleBlockCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EditTitleBlockCommand } from '../EditTitleBlockCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, TitleBlockOverrides } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(titleBlock: TitleBlockOverrides = {}): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock,
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: {
      kind: 'drawing',
      document: makeDrawingDoc({ drawingName: 'Original Name', drawnBy: 'Alice' }),
    },
  } as never);
});

describe('EditTitleBlockCommand', () => {
  it('(a) apply merges overrides onto the sheet titleBlock', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name', revision: 'A' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const tb = doc.sheets[0]!.titleBlock;
    expect(tb.drawingName).toBe('New Name');
    expect(tb.revision).toBe('A');
    // Pre-existing field not in overrides is overwritten by the full replacement
    // (overrides is the complete new value, not a merge — per §2.8)
  });

  it('(a) apply replaces the entire titleBlock with the provided overrides', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const tb = doc.sheets[0]!.titleBlock;
    // drawnBy was in original but not in the new overrides — should be absent
    expect(tb.drawnBy).toBeUndefined();
    expect(tb.drawingName).toBe('New Name');
  });

  it('(b) revert restores the prior titleBlock', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name', revision: 'A' },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const tb = doc.sheets[0]!.titleBlock;
    expect(tb.drawingName).toBe('Original Name');
    expect(tb.drawnBy).toBe('Alice');
    expect(tb.revision).toBeUndefined();
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new EditTitleBlockCommand({
      sheetId: 'sh1',
      overrides: { drawingName: 'New Name' },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.titleBlock.drawingName).toBe('Original Name');
  });
});
