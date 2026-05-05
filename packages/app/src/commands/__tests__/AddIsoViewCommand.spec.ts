// packages/app/src/commands/__tests__/AddIsoViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddIsoViewCommand } from '../AddIsoViewCommand';
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

describe('AddIsoViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends an iso view with correct corner and defaults showHidden=false', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 200, y: 200 },
      corner: 'NE',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    expect(view.kind).toBe('iso');
    if (view.kind !== 'iso') return;
    expect(view.corner).toBe('NE');
    expect(view.showHidden).toBe(false); // engineering convention default
    expect(view.projection).toBeUndefined();
  });

  it('respects explicit showHidden=true', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'SW',
      scale: { numerator: 1, denominator: 2 },
      showHidden: true,
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'iso') return;
    expect(view.showHidden).toBe(true);
  });

  it('revert removes the iso view', async () => {
    const cmd = new AddIsoViewCommand({
      sheetId: 'sheet-1',
      positionMm: { x: 0, y: 0 },
      corner: 'NW',
      scale: { numerator: 1, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(0);
  });
});
