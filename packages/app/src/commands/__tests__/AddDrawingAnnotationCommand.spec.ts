// packages/app/src/commands/__tests__/AddDrawingAnnotationCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDrawingAnnotationCommand } from '../AddDrawingAnnotationCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingAnnotation, AssemblyDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'assemblies/cabinet.ziasm', sourceKind: 'assembly' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], annotations: [], titleBlock: {},
    }],
  };
}

function makeActiveAssembly(): AssemblyDocument {
  return {
    id: 'a1', name: 'Cabinet', units: 'mm', parameters: {},
    components: [
      { id: 'c1', partPath: 'parts/side.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
      { id: 'c2', partPath: 'parts/shelf.zipt', position: { x: 0, y: 0, z: 0 }, rotation: { rx: 0, ry: 0, rz: 0 }, visible: true },
    ],
    constraints: [], groundedComponentPaths: [],
    colors: {}, bomItemNumbers: { 'c1': 1, 'c2': 2 }, cutListItemNumbers: {},
    colorOverrides: {}, properties: {}, materials: [], hardware: [],
  };
}

const leaderAnn: DrawingAnnotation = {
  id: 'ann1', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Note A',
};

const balloonAnn: DrawingAnnotation = {
  id: 'ann2', kind: 'balloon', viewId: 'v1',
  targetMm: { x: 100, y: 100 }, textPosMm: { x: 130, y: 80 }, itemNumber: 1,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    activeAssembly: makeActiveAssembly(),
  } as never);
});

describe('AddDrawingAnnotationCommand', () => {
  it('(a) apply appends a leader annotation to the sheet', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('ann1');
  });

  it('(a) apply appends a balloon annotation whose itemNumber resolves against assembly bomItemNumbers', async () => {
    // itemNumber: 1 corresponds to component 'c1' in bomItemNumbers
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: balloonAnn });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    const balloon = anns[0] as Extract<DrawingAnnotation, { kind: 'balloon' }>;
    expect(balloon.itemNumber).toBe(1);
    // Verify itemNumber=1 is present in the assembly's bomItemNumbers values
    const asm = useAppStore.getState().activeAssembly!;
    const bomValues = Object.values(asm.bomItemNumbers);
    expect(bomValues).toContain(balloon.itemNumber);
  });

  it('(b) revert removes the appended annotation', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: leaderAnn });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });
});
