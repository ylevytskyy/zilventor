// packages/app/src/commands/__tests__/DeleteDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDrawingAnnotationCommand } from '../DeleteDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const annA: DrawingAnnotation = {
  id: 'annA', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};
const annB: DrawingAnnotation = {
  id: 'annB', kind: 'center-mark', viewId: 'v1', edgeId: 'arc1',
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [annA, annB], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('DeleteDrawingAnnotationCommand', () => {
  it('(a) apply removes the annotation by id', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('annB');
  });

  it('(b) revert re-inserts the removed annotation at its original index', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(2);
    expect(anns[0]!.id).toBe('annA');
    expect(anns[1]!.id).toBe('annB');
  });

  it('(c) revert is idempotent — second revert leaves two annotations without duplicating', async () => {
    const cmd = new DeleteDrawingAnnotationCommand({ sheetId: 'sh1', annId: 'annA' });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(2);
  });
});
