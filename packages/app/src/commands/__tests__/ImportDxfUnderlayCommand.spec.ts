// packages/app/src/commands/__tests__/ImportDxfUnderlayCommand.spec.ts
// F5a RED: ImportDxfUnderlayCommand unit tests
import { describe, it, expect, beforeEach } from 'vitest';
import { ImportDxfUnderlayCommand } from '../ImportDxfUnderlayCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

// Minimal DXF text with a single LINE entity (group-code format)
const MINIMAL_DXF = `
  0
SECTION
  2
HEADER
  9
$ACADVER
  1
AC1015
  0
ENDSEC
  0
SECTION
  2
ENTITIES
  0
LINE
  8
0
 10
0.0
 20
0.0
 30
0.0
 11
100.0
 21
50.0
 31
0.0
  0
ENDSEC
  0
EOF
`.trim();

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

describe('ImportDxfUnderlayCommand', () => {
  it('(a) apply() parses DXF and sets underlay on the active sheet', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;

    expect(sheet.underlay).toBeDefined();
    expect(sheet.underlay!.name).toBe('floor-plan');
    expect(sheet.underlay!.entities.length).toBeGreaterThan(0);
    // The LINE entity should produce a line-kind entity
    const lineEntity = sheet.underlay!.entities.find((e) => e.kind === 'line');
    expect(lineEntity).toBeDefined();
  });

  it('(b) apply() sets activeDrawing === activeDocument.document (drawingDocState invariant)', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();

    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(c) revert() restores prior underlay (undefined when there was none)', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();
    await cmd.revert();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.underlay).toBeUndefined();
  });

  it('(d) revert() also maintains drawingDocState invariant', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();
    await cmd.revert();

    const state = useAppStore.getState();
    const docState = state.activeDocument as unknown as DrawingActive;
    expect(state.activeDrawing).toBe(docState.document);
  });

  it('(e) apply() → revert() → apply() (redo) re-applies underlay', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.underlay).toBeDefined();
    expect(doc.sheets[0]!.underlay!.entities.length).toBeGreaterThan(0);
  });

  it('(f) revert() restores a pre-existing underlay', async () => {
    // Set up a drawing with an existing underlay
    const existingUnderlay = {
      name: 'prior-plan',
      entities: [{ kind: 'circle' as const, cx: 10, cy: 10, r: 5 }],
    };
    useAppStore.setState((s) => {
      const prev = (s as unknown as { activeDocument: DrawingActive }).activeDocument.document;
      const next: DrawingDocument = {
        ...prev,
        sheets: prev.sheets.map((sh) =>
          sh.id === 'sh1' ? { ...sh, underlay: existingUnderlay } : sh,
        ),
      };
      return { activeDocument: { kind: 'drawing', document: next }, activeDrawing: next } as never;
    });

    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'new-plan.dxf' });
    await cmd.apply();
    await cmd.revert();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.underlay).toEqual(existingUnderlay);
  });

  it('(g) command.name is "ImportDxfUnderlay"', () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: '', fileName: 'x.dxf' });
    expect(cmd.name).toBe('ImportDxfUnderlay');
  });

  it('(h) apply() with empty/malformed DXF sets underlay with empty entities', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: 'NOT_VALID_DXF', fileName: 'bad.dxf' });
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    // parseDxfUnderlay never throws; malformed DXF → empty entities
    expect(doc.sheets[0]!.underlay).toBeDefined();
    expect(doc.sheets[0]!.underlay!.entities).toHaveLength(0);
    expect(doc.sheets[0]!.underlay!.name).toBe('bad');
  });

  it('(i) apply() computes and stores offsetMm on the underlay (fit-to-sheet centering)', async () => {
    // MINIMAL_DXF has a LINE from (0,0)→(100,50); bbox center = (50,25)
    // Sheet: A3 landscape, sheetW=420, sheetH=297, MARGIN=10, TITLE_H=20
    // drawableCx = 10 + (420-20)/2 = 210
    // drawableCy = 10 + (297-20-20)/2 = 10 + 128.5 = 138.5
    // offsetX = 210 - 50 = 160
    // flippedCy = 297 - 25 = 272 → offsetY = 138.5 - 272 = -133.5
    const cmd = new ImportDxfUnderlayCommand({ dxfText: MINIMAL_DXF, fileName: 'floor-plan.dxf' });
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    const underlay = doc.sheets[0]!.underlay!;
    expect(underlay.offsetMm).toBeDefined();
    expect(underlay.offsetMm!.x).toBeCloseTo(160, 1);
    expect(underlay.offsetMm!.y).toBeCloseTo(-133.5, 1);
  });

  it('(j) apply() sets offsetMm to {0,0} when DXF has no valid entities (no bbox)', async () => {
    const cmd = new ImportDxfUnderlayCommand({ dxfText: 'NOT_VALID_DXF', fileName: 'bad.dxf' });
    await cmd.apply();

    const state = useAppStore.getState();
    const doc = (state.activeDocument as unknown as DrawingActive).document;
    const underlay = doc.sheets[0]!.underlay!;
    // No bbox → offsetMm = {x:0, y:0}
    expect(underlay.offsetMm).toEqual({ x: 0, y: 0 });
  });
});
