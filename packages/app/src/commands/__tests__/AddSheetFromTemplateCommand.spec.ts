import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddSheetFromTemplateCommand } from '../AddSheetFromTemplateCommand';
import { exportDrawingTemplate } from '@zilventor/shared';
import type { DrawingDocument, DrawingTemplate, DrawingSheet } from '@zilventor/shared';

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'Test Drawing', units: 'mm',
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

function makeTemplate(): DrawingTemplate {
  const sheet: DrawingSheet = {
    id: 'ignored', name: 'Shop A2',
    size: { kind: 'iso', size: 'A2' }, orientation: 'portrait',
    views: [], dimensions: [], annotations: [],
    titleBlock: { drawnBy: 'YL', revision: 'B', notes: 'shop' }, dimensionGroups: [],
  };
  return exportDrawingTemplate(sheet, 'Shop A2');
}

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

describe('AddSheetFromTemplateCommand (slice 5)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a sheet built from the template and activates it', async () => {
    await new AddSheetFromTemplateCommand({ template: makeTemplate() }).apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(2);
    const added = doc.sheets[1]!;
    expect(doc.activeSheetId).toBe(added.id);
    expect(added.size).toEqual({ kind: 'iso', size: 'A2' });
    expect(added.orientation).toBe('portrait');
    expect(added.titleBlock).toEqual({ drawnBy: 'YL', revision: 'B', notes: 'shop' });
    expect(added.views).toEqual([]);
    expect(added.name).toBe('Shop A2');
  });

  it('revert removes the new sheet and restores prior activeSheetId', async () => {
    const cmd = new AddSheetFromTemplateCommand({ template: makeTemplate() });
    await cmd.apply();
    const newId = (useAppStore.getState().activeDocument as unknown as DrawingActive).document.sheets[1]!.id;
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets).toHaveLength(1);
    expect(doc.sheets.find((s) => s.id === newId)).toBeUndefined();
    expect(doc.activeSheetId).toBe('sheet-1');
  });

  it('apply is a no-op when no drawing is active', async () => {
    useAppStore.setState({ activeDocument: null } as never);
    await expect(new AddSheetFromTemplateCommand({ template: makeTemplate() }).apply()).resolves.toBeUndefined();
  });
});
