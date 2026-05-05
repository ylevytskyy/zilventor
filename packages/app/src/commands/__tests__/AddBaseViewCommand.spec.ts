// packages/app/src/commands/__tests__/AddBaseViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddBaseViewCommand } from '../AddBaseViewCommand';
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

describe('AddBaseViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a base view with correct fields and undefined projection', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 50, y: 60 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    expect(sheet.views).toHaveLength(1);
    const view = sheet.views[0]!;
    expect(view.kind).toBe('base');
    if (view.kind !== 'base') return;
    expect(view.orientation).toBe('front');
    expect(view.positionMm).toEqual({ x: 50, y: 60 });
    expect(view.scale).toEqual({ numerator: 1, denominator: 1 });
    expect(view.showHidden).toBe(true);
    expect(view.projection).toBeUndefined();
    expect(view.inputFingerprint).toBeUndefined();
  });

  it('showHidden defaults to true when not provided', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the added view', async () => {
    const cmd = new AddBaseViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      orientation: 'right',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });
});
