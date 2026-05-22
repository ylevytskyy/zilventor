// packages/app/src/commands/__tests__/AddDetailViewCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AddDetailViewCommand } from '../AddDetailViewCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, DetailView, BaseView } from '@zilventor/shared';

// ── Shared-package mocks ──────────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    allocateCalloutLabel: vi.fn((existing: string[]) => {
      // Real gap-fill: return first unused in A-Z (no I/O) order
      const skip = new Set(['I', 'O']);
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(c => !skip.has(c));
      const used = new Set(existing);
      for (const c of chars) {
        if (!used.has(c)) return c;
      }
      return 'AA';
    }),
    projectDetailView: vi.fn().mockReturnValue({
      visibleEdges: [
        { id: 'clip-e1', kind: 'outline', points: [[2, 1], [8, 1]], sourceFaceIds: [] },
        { id: 'clip-e2', kind: 'outline', points: [[8, 1], [8, 7]], sourceFaceIds: [] },
      ],
      hiddenEdges: [],
      bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
    }),
    fingerprintDetailView: vi.fn().mockReturnValue('detail-fp-mock'),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const PARENT_PROJ = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0, 0], [100, 0]] as [number, number][], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline' as const, points: [[100, 0], [100, 60]] as [number, number][], sourceFaceIds: [] },
    { id: 'e3', kind: 'outline' as const, points: [[0, 0], [0, 60]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};

const PARENT_VIEW: BaseView = {
  id: 'v1',
  kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: PARENT_PROJ,
  inputFingerprint: 'parent-fp-abc',
};

const makeSheet = (): DrawingSheet => ({
  id: 's1',
  name: 'Sheet 1',
  size: { kind: 'iso', size: 'A3' },
  orientation: 'landscape',
  views: [PARENT_VIEW],
  dimensions: [],
  dimensionGroups: [],
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

const basePayload = {
  drawingId: 'd1',
  sheetId: 's1',
  parentViewId: 'v1',
  regionCenter: { x: 10, y: 8 },
  regionRadiusMm: 5,
  dropAt: { x: 20, y: 150 },
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe('AddDetailViewCommand.apply() — happy path', () => {
  it('adds one DetailView with kind=detail and label=A', async () => {
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;

    expect(sheet.views).toHaveLength(2);
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv).toBeDefined();
    expect(dv.kind).toBe('detail');
    expect(dv.label).toBe('A');
    expect(dv.parentViewId).toBe('v1');
    expect(dv.positionMm).toEqual({ x: 20, y: 150 });
    expect(dv.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(dv.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(dv.projection).toBeDefined();
    expect(dv.projection!.visibleEdges.length).toBeGreaterThan(0);
    expect(dv.inputFingerprint).toBe('detail-fp-mock');
  });

  it('parent view is structurally unchanged after apply', async () => {
    const before = JSON.parse(JSON.stringify(
      useAppStore.getState().activeDocument!
        // @ts-expect-error accessing .document
        .document.sheets[0].views.find((v: { id: string }) => v.id === 'v1')
    ));
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const parent = doc.document.sheets[0]!.views.find(v => v.id === 'v1')!;
    expect(parent).toEqual(before);
  });
});

describe('AddDetailViewCommand.revert()', () => {
  it('apply then revert — state deep-equals pre-apply state (byte-level)', async () => {
    const snapshot = JSON.parse(
      JSON.stringify(useAppStore.getState().activeDocument),
    );
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();
    const after = useAppStore.getState().activeDocument;
    expect(after).toEqual(snapshot);
  });

  it('revert after apply — sheet.views length restored to 1', async () => {
    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    expect(sheet.views).toHaveLength(1);
    expect(sheet.views.find(v => v.kind === 'detail')).toBeUndefined();
  });

  it('apply → revert → re-apply: label "A" is re-allocated (gap-fill semantics)', async () => {
    const cmd1 = new AddDetailViewCommand(basePayload);
    await cmd1.apply();
    await cmd1.revert();

    // After revert, no detail views exist; next allocation should return 'A' again.
    const cmd2 = new AddDetailViewCommand(basePayload);
    await cmd2.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv.label).toBe('A');
  });
});

describe('AddDetailViewCommand.apply() — error variants', () => {
  it('throws "parent-not-found" when parentViewId is absent from sheet.views', async () => {
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
    await expect(cmd.apply()).rejects.toThrow('parent-not-found');
  });

  it('sheet is untouched when parent-not-found is thrown', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'no-such-view' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });

  it('throws "parent-projection-missing" when parent view has no projection', async () => {
    // Set up a drawing where parent exists but has no projection field.
    const parentWithoutProj: BaseView = {
      id: 'v-no-proj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // projection is intentionally absent
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [parentWithoutProj],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'v-no-proj' });
    await expect(cmd.apply()).rejects.toThrow('parent-projection-missing');
  });

  it('sheet is untouched when parent-projection-missing is thrown', async () => {
    const parentWithoutProj: BaseView = {
      id: 'v-no-proj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
    };
    const drawingWithUnprojected = {
      ...makeDrawing(),
      sheets: [{ ...makeSheet(), views: [parentWithoutProj] }],
    };
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: drawingWithUnprojected },
    } as never);

    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new AddDetailViewCommand({ ...basePayload, parentViewId: 'v-no-proj' });
    try { await cmd.apply(); } catch { /* expected */ }
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});

describe('AddDetailViewCommand — shared callout label pool', () => {
  it('allocates "B" when SectionView with label "A" already exists on the sheet', async () => {
    // Inject a sheet that already has a SectionView labelled "A".
    const sectionA = {
      id: 'sect-a',
      kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-a',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [PARENT_VIEW, sectionA],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets[0]!;
    const dv = sheet.views.find(v => v.kind === 'detail') as DetailView;
    expect(dv.label).toBe('B');
  });

  it('fills gap: allocates "B" when existing labels are ["A", "C"]', async () => {
    // "A" used by section, "C" used by existing detail; next should be "B" (gap-fill).
    const sectionA = {
      id: 'sect-a', kind: 'section' as const,
      parentViewId: 'v1',
      sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 100, y: 50 } },
      arrowDirection: 1 as const,
      label: 'A',
      positionMm: { x: 250, y: 100 },
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      hatchSegments: [],
      fingerprint: 'fp-sect-a',
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
    };
    const detailC = {
      id: 'det-c', kind: 'detail' as const,
      parentViewId: 'v1',
      regionParent: { center: { x: 5, y: 5 }, radiusMm: 3 },
      label: 'C',
      positionMm: { x: 300, y: 150 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'det-c-fp',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [PARENT_VIEW, sectionA, detailC],
          }],
        },
      },
    } as never);

    const cmd = new AddDetailViewCommand(basePayload);
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error('no drawing');
    const sheet = doc.document.sheets[0]!;
    // Find the newly added detail (not det-c)
    const newDetail = sheet.views.find(
      v => v.kind === 'detail' && (v as DetailView).label !== 'C'
    ) as DetailView;
    expect(newDetail.label).toBe('B');
  });
});

describe('AddDetailViewCommand — bus registration', () => {
  it('AddDetailViewCommand is importable from the commands index', async () => {
    // Dynamic import verifies the barrel export exists.
    const mod = await import('../index');
    expect(typeof mod.AddDetailViewCommand).toBe('function');
  });

  it('AddDetailViewOpts type is exported (compile-time check — verifies no import error)', () => {
    // If AddDetailViewOpts is not re-exported, this file would fail to import it.
    type Opts = import('../AddDetailViewCommand').AddDetailViewOpts;
    const opts: Opts = {
      drawingId: 'd1',
      sheetId: 's1',
      parentViewId: 'v1',
      regionCenter: { x: 5, y: 5 },
      regionRadiusMm: 3,
      dropAt: { x: 10, y: 100 },
    };
    const cmd = new AddDetailViewCommand(opts);
    expect(cmd.name).toBe('AddDetailView');
  });
});
