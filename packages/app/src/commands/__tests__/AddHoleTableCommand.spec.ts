// packages/app/src/commands/__tests__/AddHoleTableCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddHoleTableCommand } from '../AddHoleTableCommand';
import { useAppStore } from '../../store/useAppStore';
import type {
  DrawingDocument,
  HoleTableAnnotation,
} from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeHoleTableAnn(id = 'ht1'): HoleTableAnnotation {
  return {
    kind: 'holeTable',
    id,
    viewId: 'v1',
    datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
    positionMm: { x: 150, y: 20 },
    entries: [
      { holeFeatureId: 'H1', tag: 'A1' },
      { holeFeatureId: 'H2', tag: 'B1' },
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
  } as never);
});

describe('AddHoleTableCommand', () => {
  it('(a) apply() pushes the annotation onto the sheet', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const anns = doc.sheets[0]!.annotations;
    expect(anns).toHaveLength(1);
    expect(anns[0]!.id).toBe('ht1');
    expect(anns[0]!.kind).toBe('holeTable');
  });

  it('(b) revert() removes the annotation by id', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(c) revert() is idempotent — double revert leaves zero annotations', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(0);
  });

  it('(d) apply() → revert() → apply() (redo cycle) re-adds the annotation', async () => {
    const ann = makeHoleTableAnn();
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(1);
    expect(doc.sheets[0]!.annotations[0]!.id).toBe('ht1');
  });

  it('(e) apply() does not mutate an existing annotation on the sheet', async () => {
    // Seed a pre-existing annotation
    const existing = makeHoleTableAnn('ht0');
    useAppStore.setState(
      (s) => {
        const prev = (s as unknown as { activeDocument: DrawingActive }).activeDocument.document;
        return {
          activeDocument: {
            kind: 'drawing',
            document: {
              ...prev,
              sheets: prev.sheets.map((sh) =>
                sh.id === 'sh1' ? { ...sh, annotations: [existing] } : sh,
              ),
            },
          },
        } as never;
      },
    );
    const ann = makeHoleTableAnn('ht1');
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.annotations).toHaveLength(2);
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('ht0');
    expect(doc.sheets[0]!.annotations.map((a) => a.id)).toContain('ht1');
  });

  it('(f) command.name is "AddHoleTable"', () => {
    const cmd = new AddHoleTableCommand({ sheetId: 'sh1', ann: makeHoleTableAnn() });
    expect(cmd.name).toBe('AddHoleTable');
  });
});
