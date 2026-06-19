import { describe, it, expect, beforeEach } from 'vitest';
import { AutoBalloonCommand } from '../AutoBalloonCommand';
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
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
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

const balloons: ReadonlyArray<Extract<DrawingAnnotation, { kind: 'balloon' }>> = [
  { id: 'b1', kind: 'balloon', viewId: 'v1', targetMm: { x: 1, y: 1 }, textPosMm: { x: 2, y: 2 }, itemNumber: 1 },
  { id: 'b2', kind: 'balloon', viewId: 'v1', targetMm: { x: 3, y: 3 }, textPosMm: { x: 4, y: 4 }, itemNumber: 2 },
];

// A pre-existing annotation that must survive revert
const preExisting: DrawingAnnotation = {
  id: 'pre1', kind: 'leader', viewId: 'v1',
  targetMm: { x: 50, y: 50 }, textPosMm: { x: 80, y: 30 }, text: 'Pre-existing',
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    activeAssembly: makeActiveAssembly(),
  } as never);
});

describe('AutoBalloonCommand', () => {
  it('(a) apply appends all balloons to the sheet', async () => {
    const cmd = new AutoBalloonCommand({ sheetId: 'sh1', balloons });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(2);
    expect(anns.map((a) => a.id)).toEqual(['b1', 'b2']);
  });

  it('(b) revert removes exactly the balloons it added, leaving pre-existing annotations intact', async () => {
    // Seed a pre-existing annotation before the command runs
    const { AddDrawingAnnotationCommand } = await import('../AddDrawingAnnotationCommand');
    await new AddDrawingAnnotationCommand({ sheetId: 'sh1', ann: preExisting }).apply();

    const cmd = new AutoBalloonCommand({ sheetId: 'sh1', balloons });
    await cmd.apply();

    // Sheet should have pre-existing + 2 balloons
    const docMid = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(docMid.sheets[0]!.annotations).toHaveLength(3);

    await cmd.revert();
    const docAfter = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = docAfter.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('pre1');
  });

  it('(c) revert is a no-op if applied twice (idempotent)', async () => {
    const cmd = new AutoBalloonCommand({ sheetId: 'sh1', balloons });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });
});
