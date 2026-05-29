// packages/app/src/commands/__tests__/AddPartsListCommand.spec.ts
// SLICE 2 RED: AddPartsListCommand unit tests
import { describe, it, expect, beforeEach } from 'vitest';
import { AddPartsListCommand } from '../AddPartsListCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, PartsListAnnotation } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makePartsListAnn(id = 'pl1'): PartsListAnnotation {
  return {
    kind: 'partsList',
    id,
    positionMm: { x: 10, y: 20 },
    rows: [
      { item: 1, qty: 2, partName: 'Side Panel', material: 'Oak', dimensions: '720×400×18', edgeBands: 'R' },
    ],
  };
}

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1',
    name: 'Test Drawing',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    activeSheetId: 'sh1',
    sheets: [
      {
        id: 'sh1',
        name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' },
        orientation: 'landscape',
        views: [],
        dimensions: [],
        dimensionGroups: [],
        annotations: [],
        titleBlock: {},
      },
    ],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
    activeDrawing: makeDrawingDoc(),
  } as never);
});

describe('AddPartsListCommand', () => {
  it('(a) apply() appends the partsList annotation to the sheet', async () => {
    const ann = makePartsListAnn();
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('pl1');
    expect(anns[0]!.kind).toBe('partsList');
  });

  it('(b) revert() removes the annotation by id', async () => {
    const ann = makePartsListAnn();
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(c) apply() sets activeDrawing === activeDocument.document (drawingDocState invariant)', async () => {
    const ann = makePartsListAnn();
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(d) revert() also maintains activeDrawing === activeDocument.document', async () => {
    const ann = makePartsListAnn();
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(e) apply() → revert() → apply() (redo) re-adds the annotation', async () => {
    const ann = makePartsListAnn();
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(1);
    expect(doc.sheets[0]!.annotations[0]!.id).toBe('pl1');
  });

  it('(f) apply() does not mutate pre-existing annotations on the sheet', async () => {
    const existing = makePartsListAnn('pl0');
    useAppStore.setState(
      (s) => {
        const prev = (s as unknown as { activeDocument: DrawingActive }).activeDocument.document;
        const next = { ...prev, sheets: prev.sheets.map((sh) =>
          sh.id === 'sh1' ? { ...sh, annotations: [existing] } : sh) };
        return { activeDocument: { kind: 'drawing', document: next }, activeDrawing: next } as never;
      },
    );
    const ann = makePartsListAnn('pl1');
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(2);
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('pl0');
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('pl1');
  });

  it('(g) command.name is "AddPartsList"', () => {
    const cmd = new AddPartsListCommand({ sheetId: 'sh1', ann: makePartsListAnn() });
    expect(cmd.name).toBe('AddPartsList');
  });
});
