// packages/app/src/commands/__tests__/EditDetailRegionCommand.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditDetailRegionCommand } from '../EditDetailRegionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingSheet, DetailView, BaseView } from '@zilventor/shared';

// ── Mock @zilventor/shared ──────────────────────────────────────────────────
vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    projectDetailView: vi.fn().mockImplementation(
      (input: { regionParent: { center: { x: number; y: number }; radiusMm: number } }) => ({
        visibleEdges: [
          {
            id: `clip-${input.regionParent.center.x}`,
            kind: 'outline' as const,
            points: [[input.regionParent.center.x, 0], [input.regionParent.center.x + 5, 0]] as [number,number][],
            sourceFaceIds: [],
          },
        ],
        hiddenEdges: [],
        bbox: {
          minX: input.regionParent.center.x,
          minY: 0,
          maxX: input.regionParent.center.x + 5,
          maxY: 0,
        },
      }),
    ),
    fingerprintDetailView: vi.fn().mockImplementation(
      (_pFp: string, region: { center: { x: number; y: number }; radiusMm: number }) =>
        `fp-${region.center.x}-${region.center.y}-r${region.radiusMm}`,
    ),
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────
const PARENT_PROJ = {
  visibleEdges: [
    { id: 'e1', kind: 'outline' as const, points: [[0,0],[100,0]] as [number,number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};

const PARENT_VIEW: BaseView = {
  id: 'pv1',
  kind: 'base',
  positionMm: { x: 20, y: 20 },
  scale: { numerator: 1, denominator: 1 },
  orientation: 'front',
  showHidden: false,
  projection: PARENT_PROJ,
  inputFingerprint: 'parent-fp-abc',
};

const DETAIL_VIEW: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'pv1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [
      { id: 'old-e1', kind: 'outline' as const, points: [[0,0],[1,0]] as [number,number][], sourceFaceIds: [] },
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 1, maxY: 0 },
  },
  inputFingerprint: 'fp-10-8-r5',
};

function makeSheet(): DrawingSheet {
  return {
    id: 's1',
    name: 'Sheet 1',
    size: { kind: 'iso', size: 'A3' },
    orientation: 'landscape',
    views: [PARENT_VIEW, { ...DETAIL_VIEW }],
    dimensions: [],
    dimensionGroups: [],
    annotations: [],
    titleBlock: {},
  };
}

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1',
    name: 'Test',
    units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [makeSheet()],
    activeSheetId: 's1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawing() },
    activePart: null,
    activeAssembly: null,
  } as never);
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe('EditDetailRegionCommand — apply changes center', () => {
  it('i. apply updates regionParent.center in the store', async () => {
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv1',
      prevRegion: { center: { x: 10, y: 8 }, radiusMm: 5 },
      newRegion:  { center: { x: 30, y: 20 }, radiusMm: 5 },
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    expect(doc?.kind).toBe('drawing');
    if (doc?.kind !== 'drawing') return;
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    const dv = sheet.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.center).toEqual({ x: 30, y: 20 });
  });

  it('ii. apply updates radiusMm in the store', async () => {
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv1',
      prevRegion: { center: { x: 10, y: 8 }, radiusMm: 5 },
      newRegion:  { center: { x: 10, y: 8 }, radiusMm: 15 },
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const sheet = doc.document.sheets.find(s => s.id === 's1')!;
    const dv = sheet.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.radiusMm).toBe(15);
  });

  it('iii. apply recomputes projection (edge id reflects new center)', async () => {
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv1',
      prevRegion: { center: { x: 10, y: 8 }, radiusMm: 5 },
      newRegion:  { center: { x: 40, y: 20 }, radiusMm: 5 },
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    // Mock returns edge id `clip-${center.x}` → expect `clip-40`
    expect(dv.projection!.visibleEdges[0]?.id).toBe('clip-40');
  });
});

describe('EditDetailRegionCommand — revert', () => {
  it('iv. revert restores prevRegion exactly (region + fingerprint)', async () => {
    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv1',
      prevRegion: { center: { x: 10, y: 8 }, radiusMm: 5 },
      newRegion:  { center: { x: 30, y: 20 }, radiusMm: 5 },
    });
    await cmd.apply();
    await cmd.revert();

    const after = useAppStore.getState().activeDocument;
    if (after?.kind !== 'drawing' || snapshot?.document == null) return;
    const dvAfter = after.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dvAfter.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(dvAfter.inputFingerprint).toBe('fp-10-8-r5');
  });

  it('iv-b. redo (apply again after revert) re-applies newRegion', async () => {
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv1',
      prevRegion: { center: { x: 10, y: 8 }, radiusMm: 5 },
      newRegion:  { center: { x: 30, y: 20 }, radiusMm: 5 },
    });
    await cmd.apply();
    await cmd.revert();
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (doc?.kind !== 'drawing') return;
    const dv = doc.document.sheets.find(s => s.id === 's1')!.views.find(v => v.id === 'dv1') as DetailView;
    expect(dv.regionParent.center).toEqual({ x: 30, y: 20 });
  });
});

describe('EditDetailRegionCommand — guard: parent projection missing', () => {
  it('v. apply is a no-op when parent view has no projection', async () => {
    const parentNoProj: BaseView = {
      id: 'pv-noproj',
      kind: 'base',
      positionMm: { x: 20, y: 20 },
      scale: { numerator: 1, denominator: 1 },
      orientation: 'front',
      showHidden: false,
      // no projection
    };
    const detailForNoProj: DetailView = {
      id: 'dv-noproj',
      kind: 'detail',
      parentViewId: 'pv-noproj',
      regionParent: { center: { x: 5, y: 5 }, radiusMm: 3 },
      label: 'B',
      positionMm: { x: 200, y: 100 },
      scale: { numerator: 2, denominator: 1 },
      showHidden: false,
      projection: { visibleEdges: [], hiddenEdges: [], bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } },
      inputFingerprint: 'fp-old',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeSheet(),
            views: [parentNoProj, detailForNoProj],
          }],
        },
      },
    } as never);

    const snapshot = JSON.parse(JSON.stringify(useAppStore.getState().activeDocument));
    const cmd = new EditDetailRegionCommand({
      sheetId: 's1',
      detailViewId: 'dv-noproj',
      prevRegion: { center: { x: 5, y: 5 }, radiusMm: 3 },
      newRegion:  { center: { x: 50, y: 50 }, radiusMm: 10 },
    });
    await cmd.apply(); // must not throw; must be no-op
    expect(useAppStore.getState().activeDocument).toEqual(snapshot);
  });
});

describe('EditDetailRegionCommand — barrel export', () => {
  it('EditDetailRegionCommand is importable from commands index', async () => {
    const mod = await import('../index');
    expect(typeof (mod as Record<string, unknown>).EditDetailRegionCommand).toBe('function');
  });
});
