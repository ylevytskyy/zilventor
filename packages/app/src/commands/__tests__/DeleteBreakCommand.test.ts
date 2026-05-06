// packages/app/src/commands/__tests__/DeleteBreakCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddBreakCommand } from '../AddBreakCommand';
import { DeleteBreakCommand } from '../DeleteBreakCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, BaseView, BreakRegion, ProjectedGeometry } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    applyBreaks: vi.fn().mockReturnValue({
      edges: [{ id: 'frag-1', kind: 'outline', points: [[0, 0], [40, 0]], sourceFaceIds: [] }],
      breakSymbolEdges: [{ id: 'sym-1', kind: 'break', points: [[40, -3], [43, 3]], sourceFaceIds: [] }],
    }),
    fingerprintBreaksArray: vi.fn().mockReturnValue('breaks-fp-mock'),
  };
});

const BASE_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0, 0], [200, 0]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BASE_VIEW: BaseView = {
  id: 'v1', kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: BASE_PROJECTION,
  inputFingerprint: 'base-fp-000',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1', name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
  views: [BASE_VIEW], dimensions: [], annotations: [], titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1', name: 'Test', units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

const addBreakOpts = { drawingId: 'd1', sheetId: 's1', viewId: 'v1', axis: 'x' as const, coordA: 60, coordB: 140 };

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null, activeAssembly: null,
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.11 — skeleton + break-not-found
// ─────────────────────────────────────────────────────────────────────────────
describe('DeleteBreakCommand — skeleton', () => {
  it('instantiates with name DeleteBreak', () => {
    const cmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: 'b-none' });
    expect(cmd.name).toBe('DeleteBreak');
  });

  it('throws "break-not-found" when breakId is absent from view.breaks', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();
    const cmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: 'no-such-break' });
    await expect(cmd.apply()).rejects.toThrow('break-not-found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.12 — middle break removed
// ─────────────────────────────────────────────────────────────────────────────
describe('DeleteBreakCommand — middle break removed', () => {
  it('after removing one-of-two: breaks.length=1, rawProjection unchanged, projection updated', async () => {
    // Set up two breaks
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const viewWith2 = docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    const rawRef = viewWith2.rawProjection;
    const breakIdToDelete = viewWith2.breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: breakIdToDelete });
    await delCmd.apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const viewAfter = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    expect(viewAfter.breaks).toHaveLength(1);
    expect(viewAfter.rawProjection).toEqual(rawRef);   // rawProjection unchanged
    expect(viewAfter.projection).not.toEqual(rawRef);  // projection recomputed
  });

  it('α-conditional: rawProjection defined ⟺ breaks.length > 0 (1 break remaining)', async () => {
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const breakIdToDelete = (docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: breakIdToDelete }).apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const view = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    expect((view.breaks?.length ?? 0) > 0).toBe(view.rawProjection !== undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.13 — last break removed
// ─────────────────────────────────────────────────────────────────────────────
describe('DeleteBreakCommand — last break removed', () => {
  it('after removing last break: breaks=[], rawProjection=undefined, projection=rawProjection content', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const viewWith1 = docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    const rawContent = viewWith1.rawProjection!;
    const breakId = viewWith1.breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId }).apply();

    const docAfter = useAppStore.getState().activeDocument;
    if (!docAfter || docAfter.kind !== 'drawing') throw new Error();
    const view = docAfter.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    expect(view.breaks?.length ?? 0).toBe(0);
    expect(view.rawProjection).toBeUndefined();
    // projection content should equal what rawProjection was (the un-broken geometry)
    expect(view.projection).toEqual(rawContent);
  });

  it('α-conditional: rawProjection undefined ⟺ breaks empty after last break removed', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const breakId = (docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId }).apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    expect((view.breaks?.length ?? 0) > 0).toBe(view.rawProjection !== undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.14 — revert
// ─────────────────────────────────────────────────────────────────────────────
describe('DeleteBreakCommand — revert', () => {
  it('revert restores state after removing last break (full round-trip)', async () => {
    const addCmd = new AddBreakCommand(addBreakOpts);
    await addCmd.apply();

    const docWith1 = useAppStore.getState().activeDocument;
    if (!docWith1 || docWith1.kind !== 'drawing') throw new Error();
    const breakId = (docWith1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId });
    await delCmd.apply();
    await delCmd.revert();

    // After revert, state should match what it was right after the add
    const docAfterRevert = useAppStore.getState().activeDocument;
    if (!docAfterRevert || docAfterRevert.kind !== 'drawing') throw new Error();
    const viewAfter = docAfterRevert.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    expect(viewAfter.breaks).toHaveLength(1);
    expect(viewAfter.rawProjection).toBeDefined();
  });

  it('revert after removing middle break: breaks.length back to 2', async () => {
    const cmd1 = new AddBreakCommand({ ...addBreakOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();
    const cmd2 = new AddBreakCommand({ ...addBreakOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docWith2 = useAppStore.getState().activeDocument;
    if (!docWith2 || docWith2.kind !== 'drawing') throw new Error();
    const breakId = (docWith2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] }).breaks![0]!.id;

    const delCmd = new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId });
    await delCmd.apply();
    await delCmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    expect(view.breaks).toHaveLength(2);
    expect(view.rawProjection).toBeDefined();
  });
});
