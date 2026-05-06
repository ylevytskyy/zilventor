// packages/app/src/commands/__tests__/AddBreakCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddBreakCommand } from '../AddBreakCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, BaseView, BreakRegion, ProjectedGeometry } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    applyBreaks: vi.fn().mockReturnValue({
      edges: [{ id: 'frag-1', kind: 'outline', points: [[0, 0], [40, 0]], sourceFaceIds: [] }],
      breakSymbolEdges: [{ id: 'sym-1', kind: 'break', points: [[40, -3], [43, 3], [46, -3]], sourceFaceIds: [] }],
    }),
    fingerprintBreaksArray: vi.fn().mockReturnValue('breaks-fp-mock'),
  };
});

const BASE_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0, 0], [200, 0]] as [number, number][], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline' as const, points: [[0, 0], [0, 80]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BASE_VIEW: BaseView = {
  id: 'v1',
  kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: BASE_PROJECTION,
  inputFingerprint: 'base-fp-000',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [BASE_VIEW],
  dimensions: [],
  annotations: [],
  titleBlock: {},
});

const makeDrawing = (): DrawingDocument => ({
  id: 'd1',
  name: 'Test',
  units: 'mm',
  source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
  properties: {},
  sheets: [makeSheet()],
  activeSheetId: 's1',
});

const baseOpts = {
  drawingId: 'd1',
  sheetId: 's1',
  viewId: 'v1',
  axis: 'x' as const,
  coordA: 60,
  coordB: 140,
};

// also used in property test
const addBreakOpts = baseOpts;

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.1 — skeleton + view-not-found
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — skeleton', () => {
  it('instantiates with name AddBreak', () => {
    const cmd = new AddBreakCommand(baseOpts);
    expect(cmd.name).toBe('AddBreak');
  });

  it('apply throws "view-not-found" when viewId is absent from sheet.views', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'no-such-view' });
    await expect(cmd.apply()).rejects.toThrow('view-not-found');
  });

  it('store is untouched when view-not-found is thrown', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'no-such-view' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.2 — first break happy path
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — first break happy path', () => {
  it('after apply: breaks.length === 1, rawProjection is defined, projection changed', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    const v = view as BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    expect(v.breaks).toHaveLength(1);
    expect(v.rawProjection).toBeDefined();
    // rawProjection should equal the original BASE_PROJECTION (snapshotted before breaks)
    expect(v.rawProjection).toEqual(BASE_PROJECTION);
    // projection should differ (applyBreaks was called)
    expect(v.projection).not.toEqual(BASE_PROJECTION);
  });

  it('α-conditional: rawProjection !== undefined ⟺ breaks.length > 0 (first break)', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks).toBe(hasRaw);
  });

  it('new break has correct axis, coordA, coordB, gapMm, style=zigzag', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: BreakRegion[] };
    const br = view.breaks![0]!;
    expect(br.axis).toBe('x');
    expect(br.coordA).toBe(60);
    expect(br.coordB).toBe(140);
    expect(br.gapMm).toBe(5);
    expect(br.style).toBe('zigzag');
    expect(typeof br.id).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.3 — subsequent break
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — subsequent break', () => {
  it('second break: breaks.length === 2, rawProjection ref unchanged, projection updated', async () => {
    const cmd1 = new AddBreakCommand({ ...baseOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();

    const docAfter1 = useAppStore.getState().activeDocument;
    if (!docAfter1 || docAfter1.kind !== 'drawing') throw new Error();
    const viewAfter1 = docAfter1.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: ProjectedGeometry };
    const rawAfterFirst = viewAfter1.rawProjection;

    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();

    const docAfter2 = useAppStore.getState().activeDocument;
    if (!docAfter2 || docAfter2.kind !== 'drawing') throw new Error();
    const viewAfter2 = docAfter2.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: ProjectedGeometry };

    expect(viewAfter2.breaks).toHaveLength(2);
    // rawProjection must equal what was snapshotted on first break (structural equality)
    expect(viewAfter2.rawProjection).toEqual(rawAfterFirst);
    // projection differs (applyBreaks called with both breaks)
    expect(viewAfter2.projection).not.toEqual(rawAfterFirst);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.4 — revert first break
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — revert first break', () => {
  it('apply then revert: state deep-equals pre-apply state', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });

  it('revert: breaks is [] or has no entries, rawProjection undefined, projection restored', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    const breakCount = view.breaks?.length ?? 0;
    expect(breakCount).toBe(0);
    expect(view.rawProjection).toBeUndefined();
    expect(view.projection).toEqual(BASE_PROJECTION);
  });

  it('α-conditional after revert: rawProjection undefined ⟺ no breaks', async () => {
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks).toBe(hasRaw);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.5 — revert subsequent break (not last)
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — revert subsequent break', () => {
  it('revert second-of-two: breaks.length=1, rawProjection still defined', async () => {
    const cmd1 = new AddBreakCommand({ ...baseOpts, coordA: 20, coordB: 50 });
    await cmd1.apply();

    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 120, coordB: 170 });
    await cmd2.apply();
    await cmd2.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };

    expect(view.breaks).toHaveLength(1);
    expect(view.rawProjection).toBeDefined();  // α-conditional: 1 break → rawProjection present
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.6 — view-not-breakable
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — view-not-breakable', () => {
  it('throws "view-not-breakable" when view.kind is "section"', async () => {
    const sectionView = {
      id: 'v-sect',
      kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false as const,
      hatchSegments: [],
      fingerprint: 'fp-s',
      projection: BASE_PROJECTION,
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [sectionView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-sect' });
    await expect(cmd.apply()).rejects.toThrow('view-not-breakable');
  });

  it('throws "view-not-breakable" when view.kind is "detail"', async () => {
    const detailView = {
      id: 'v-det',
      kind: 'detail' as const,
      parentViewId: 'v1',
      regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
      label: 'B',
      positionMm: { x: 300, y: 100 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: BASE_PROJECTION,
      inputFingerprint: 'det-fp',
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [detailView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-det' });
    await expect(cmd.apply()).rejects.toThrow('view-not-breakable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.7 — view-projection-missing
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — view-projection-missing', () => {
  it('throws "view-projection-missing" when view has no projection', async () => {
    const unprojectView: BaseView = {
      id: 'v-unproj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection intentionally absent
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: { ...makeDrawing(), sheets: [{ ...makeSheet(), views: [unprojectView] }] } },
    } as never);
    const cmd = new AddBreakCommand({ ...baseOpts, viewId: 'v-unproj' });
    await expect(cmd.apply()).rejects.toThrow('view-projection-missing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.8 — overlapping-break
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — overlapping-break', () => {
  it('throws "overlapping-break" when new band overlaps existing break on same axis', async () => {
    // First break at x:[60, 140]
    const cmd1 = new AddBreakCommand(baseOpts);
    await cmd1.apply();
    // Second break at x:[100, 180] — overlaps [60,140] on x-axis
    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 100, coordB: 180 });
    await expect(cmd2.apply()).rejects.toThrow('overlapping-break');
  });

  it('does NOT throw for non-overlapping break on same axis', async () => {
    const cmd1 = new AddBreakCommand(baseOpts); // x:[60,140]
    await cmd1.apply();
    // Non-overlapping: x:[150,180]
    const cmd2 = new AddBreakCommand({ ...baseOpts, coordA: 150, coordB: 180 });
    await expect(cmd2.apply()).resolves.toBeUndefined();
  });

  it('does NOT throw for overlapping band on different axis', async () => {
    const cmd1 = new AddBreakCommand(baseOpts); // x:[60,140]
    await cmd1.apply();
    // Same coordinate range but on y-axis — independent axis, no overlap error
    const cmd2 = new AddBreakCommand({ ...baseOpts, axis: 'y', coordA: 60, coordB: 140 });
    await expect(cmd2.apply()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.9 — invalid-band
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — invalid-band', () => {
  it('throws "invalid-band" when coordB === coordA', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, coordA: 80, coordB: 80 });
    await expect(cmd.apply()).rejects.toThrow('invalid-band');
  });

  it('throws "invalid-band" when coordB < coordA', async () => {
    const cmd = new AddBreakCommand({ ...baseOpts, coordA: 80, coordB: 40 });
    await expect(cmd.apply()).rejects.toThrow('invalid-band');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.10 — fingerprint update
// ─────────────────────────────────────────────────────────────────────────────
describe('AddBreakCommand — fingerprint', () => {
  it('inputFingerprint changes after apply', async () => {
    const priorFp = BASE_VIEW.inputFingerprint; // 'base-fp-000'
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    const newFp = (view as BaseView & { inputFingerprint?: string }).inputFingerprint;
    expect(newFp).not.toBe(priorFp);
  });

  it('fingerprintBreaksArray is called with the new breaks array', async () => {
    const { fingerprintBreaksArray } = await import('@zilventor/shared');
    const cmd = new AddBreakCommand(baseOpts);
    await cmd.apply();
    expect(fingerprintBreaksArray).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.16 (partial) — α-conditional invariant property sequence test
// Placed here since it uses AddBreakCommand + DeleteBreakCommand + RegenerateViewCommand
// Full sequences defined after DeleteBreakCommand.test.ts exists.
// The full property test is in this file since it imports AddBreakCommand.
// ─────────────────────────────────────────────────────────────────────────────
describe('α-conditional invariant — sequence property test', () => {
  type DispatchStep =
    | { op: 'add'; coordA: number; coordB: number; axis?: 'x' | 'y' }
    | { op: 'delete'; breakIndex: number }
    | { op: 'regen' };

  function checkInvariant(viewId: string, label: string): void {
    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error(`[${label}] no drawing`);
    const view = doc.document.sheets[0]!.views.find(v => v.id === viewId)! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    const hasBreaks = (view.breaks?.length ?? 0) > 0;
    const hasRaw = view.rawProjection !== undefined;
    expect(hasBreaks, `[${label}] α-conditional: hasBreaks(${hasBreaks}) !== hasRaw(${hasRaw})`).toBe(hasRaw);
  }

  const sequences: Array<{ name: string; steps: DispatchStep[] }> = [
    { name: 'add then delete', steps: [{ op: 'add', coordA: 60, coordB: 140 }, { op: 'delete', breakIndex: 0 }] },
    { name: 'add two then delete first', steps: [
      { op: 'add', coordA: 20, coordB: 50 },
      { op: 'add', coordA: 120, coordB: 170 },
      { op: 'delete', breakIndex: 0 },
    ]},
    { name: 'add two then delete both', steps: [
      { op: 'add', coordA: 20, coordB: 50 },
      { op: 'add', coordA: 120, coordB: 170 },
      { op: 'delete', breakIndex: 0 },
      { op: 'delete', breakIndex: 0 },
    ]},
    { name: 'add then regen with break', steps: [{ op: 'add', coordA: 60, coordB: 140 }, { op: 'regen' }] },
    { name: 'regen then add', steps: [{ op: 'regen' }, { op: 'add', coordA: 60, coordB: 140 }] },
    { name: 'add x, add y, delete x', steps: [
      { op: 'add', coordA: 20, coordB: 50, axis: 'x' },
      { op: 'add', coordA: 10, coordB: 30, axis: 'y' },
      { op: 'delete', breakIndex: 0 },
    ]},
  ];

  for (const { name, steps } of sequences) {
    it(`invariant holds through sequence: ${name}`, async () => {
      let stepLabel = 'initial';
      checkInvariant('v1', stepLabel);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        stepLabel = `step-${i}-${step.op}`;

        if (step.op === 'add') {
          const cmd = new AddBreakCommand({ ...addBreakOpts, axis: step.axis ?? 'x', coordA: step.coordA, coordB: step.coordB });
          try { await cmd.apply(); } catch (e) {
            const msg = (e as Error).message;
            if (msg !== 'overlapping-break' && msg !== 'invalid-band') throw e;
          }
        } else if (step.op === 'delete') {
          const doc = useAppStore.getState().activeDocument;
          if (!doc || doc.kind !== 'drawing') continue;
          const view = doc.document.sheets[0]!.views.find(v => v.id === 'v1')! as
            BaseView & { breaks?: BreakRegion[] };
          const br = view.breaks?.[step.breakIndex];
          if (!br) continue;
          const { DeleteBreakCommand } = await import('../DeleteBreakCommand');
          await new DeleteBreakCommand({ drawingId: 'd1', sheetId: 's1', viewId: 'v1', breakId: br.id }).apply();
        } else if (step.op === 'regen') {
          const { RegenerateViewCommand } = await import('../RegenerateViewCommand');
          const regenProj: ProjectedGeometry = { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 } };
          await new RegenerateViewCommand({ sheetId: 's1', viewId: 'v1', projection: regenProj, inputFingerprint: 'regen-fp' }).apply();
        }

        checkInvariant('v1', stepLabel);
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.17 — barrel exports
// ─────────────────────────────────────────────────────────────────────────────
describe('Barrel exports', () => {
  it('AddBreakCommand is importable from the commands index', async () => {
    const mod = await import('../index');
    expect(typeof mod.AddBreakCommand).toBe('function');
  });

  it('DeleteBreakCommand is importable from the commands index', async () => {
    const mod = await import('../index');
    expect(typeof mod.DeleteBreakCommand).toBe('function');
  });
});
