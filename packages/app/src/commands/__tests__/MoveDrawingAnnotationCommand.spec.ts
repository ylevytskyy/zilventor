// packages/app/src/commands/__tests__/MoveDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MoveDrawingAnnotationCommand } from '../MoveDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation } from '@zilventor/shared';

const leaderAnn: DrawingAnnotation = {
  id: 'ann1', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [leaderAnn], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('MoveDrawingAnnotationCommand', () => {
  it('(a) apply updates textPosMm when provided', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 120, y: 60 });
    // targetMm should be unchanged
    expect(ann.targetMm).toEqual({ x: 50, y: 50 });
  });

  it('(a) apply updates targetMm when provided', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      targetMm: { x: 200, y: 150 },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.targetMm).toEqual({ x: 200, y: 150 });
  });

  it('(b) revert restores prior textPosMm and targetMm', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
      targetMm: { x: 200, y: 150 },
    });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 80, y: 30 });
    expect(ann.targetMm).toEqual({ x: 50, y: 50 });
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new MoveDrawingAnnotationCommand({
      sheetId: 'sh1', annId: 'ann1',
      textPosMm: { x: 120, y: 60 },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as { kind: 'drawing'; document: DrawingDocument }).document;
    const ann = doc.sheets[0]!.annotations[0]! as Extract<DrawingAnnotation, { kind: 'leader' }>;
    expect(ann.textPosMm).toEqual({ x: 80, y: 30 });
  });
});
