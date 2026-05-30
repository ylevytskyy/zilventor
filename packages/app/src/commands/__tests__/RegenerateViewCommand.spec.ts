// packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry, DetailView, BreakRegion } from '@zilventor/shared';

vi.mock('@zilventor/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zilventor/shared')>();
  return {
    ...actual,
    applyBreaks: vi.fn().mockReturnValue({
      edges: [{ id: 'frag-regen', kind: 'outline', points: [[0, 0], [55, 0]], sourceFaceIds: [] }],
      breakSymbolEdges: [{ id: 'sym-regen', kind: 'break', points: [[55, -3], [58, 3]], sourceFaceIds: [] }],
    }),
    fingerprintBreaksArray: vi.fn().mockReturnValue('regen-breaks-fp-mock'),
  };
});

const OLD_PROJECTION: ProjectedGeometry = {
  visibleEdges: [{ id: 'e1', kind: 'outline', points: [[0, 0], [100, 0]], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
};

const NEW_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'e1', kind: 'outline', points: [[0, 0], [120, 0]], sourceFaceIds: [] },
    { id: 'e2', kind: 'outline', points: [[0, 0], [0, 60]], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 120, maxY: 60 },
};

const VIEW_WITH_OLD: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: OLD_PROJECTION,
  inputFingerprint: 'old-fingerprint-abc',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW_WITH_OLD], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('RegenerateViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } });
  });

  it('apply replaces projection and inputFingerprint on the target view', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(NEW_PROJECTION);
    expect(view.inputFingerprint).toBe('new-fingerprint-xyz');
  });

  it('revert restores the prior projection and fingerprint', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      projection: NEW_PROJECTION,
      inputFingerprint: 'new-fingerprint-xyz',
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toEqual(OLD_PROJECTION);
    expect(view.inputFingerprint).toBe('old-fingerprint-abc');
  });

  it('revert with no prior projection/fingerprint (fresh view) restores undefined', async () => {
    const freshView: BaseView = {
      id: 'view-fresh', kind: 'base',
      positionMm: { x: 0, y: 0 },
      orientation: 'top',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          ...makeDrawing(),
          sheets: [{
            ...makeDrawing().sheets[0]!,
            views: [freshView],
          }],
        },
      },
    });

    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-1', viewId: 'view-fresh',
      projection: NEW_PROJECTION, inputFingerprint: 'fp-1',
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.projection).toBeUndefined();
    expect(view.inputFingerprint).toBeUndefined();
  });
});

// ── Detail view branch ────────────────────────────────────────────────────

const OLD_DETAIL_PROJECTION = {
  visibleEdges: [{ id: 'clip-old', kind: 'outline' as const, points: [[2, 1], [8, 1]] as [number, number][], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
};

const NEW_DETAIL_PROJECTION = {
  visibleEdges: [
    { id: 'clip-new-1', kind: 'outline' as const, points: [[3, 2], [9, 2]] as [number, number][], sourceFaceIds: [] },
    { id: 'clip-new-2', kind: 'outline' as const, points: [[3, 2], [3, 8]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 3, minY: 2, maxX: 9, maxY: 8 },
};

const DETAIL_VIEW_STALE: DetailView = {
  id: 'detail-stale',
  kind: 'detail',
  parentViewId: 'parent-v1',
  regionParent: { kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 200, y: 200 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: OLD_DETAIL_PROJECTION,
  inputFingerprint: 'stale-detail-fp',
};

function makeDrawingWithStaleDetail(): DrawingDocument {
  return {
    id: 'd-regen', name: 'D-Regen', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-regen', name: 'Sheet Regen',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [DETAIL_VIEW_STALE],
      dimensions: [],
      dimensionGroups: [],
      annotations: [],
      titleBlock: {},
    }],
    activeSheetId: 'sheet-regen',
  };
}

describe('RegenerateViewCommand — detail view branch', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawingWithStaleDetail() } });
  });

  it('apply replaces projection and inputFingerprint on a DetailView', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.kind).toBe('detail');
    expect(view.projection).toEqual(NEW_DETAIL_PROJECTION);
    expect(view.inputFingerprint).toBe('fresh-detail-fp');
    // Confirm other fields are intact
    expect(view.label).toBe('A');
    expect(view.regionParent).toEqual({ kind: 'circle', center: { x: 10, y: 8 }, radiusMm: 5 });
  });

  it('revert restores stale projection and old fingerprint on a DetailView', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.projection).toEqual(OLD_DETAIL_PROJECTION);
    expect(view.inputFingerprint).toBe('stale-detail-fp');
  });

  it('other DetailView fields (label, regionParent, positionMm) are unchanged by regenerate', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-regen',
      viewId: 'detail-stale',
      projection: NEW_DETAIL_PROJECTION,
      inputFingerprint: 'fresh-detail-fp',
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.positionMm).toEqual({ x: 200, y: 200 });
    expect(view.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(view.showHidden).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3.15 — RegenerateViewCommand breaks-aware extension
// ─────────────────────────────────────────────────────────────────────────────

const BROKEN_PROJ_RAW: ProjectedGeometry = {
  visibleEdges: [{ id: 'raw-e1', kind: 'outline', points: [[0, 0], [200, 0]] as [number, number][], sourceFaceIds: [] }],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BROKEN_PROJ_APPLIED: ProjectedGeometry = {
  visibleEdges: [
    { id: 'frag-1', kind: 'outline', points: [[0, 0], [55, 0]] as [number, number][], sourceFaceIds: [] },
    { id: 'sym-1', kind: 'break' as const, points: [[55, -3], [58, 3]] as [number, number][], sourceFaceIds: [] },
    { id: 'frag-2', kind: 'outline', points: [[60, 0], [200, 0]] as [number, number][], sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 200, maxY: 80 },
};

const BREAK_REGION: BreakRegion = {
  id: 'br-1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag',
};

const viewWithBreak: BaseView & { breaks: BreakRegion[]; rawProjection?: ProjectedGeometry } = {
  id: 'view-broken', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  projection: BROKEN_PROJ_APPLIED,
  inputFingerprint: 'stale-broken-fp',
  breaks: [BREAK_REGION],
  rawProjection: BROKEN_PROJ_APPLIED, // simulates pre-existing rawProjection
};

describe('RegenerateViewCommand — breaks-aware extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-broken', name: 'D', units: 'mm',
          source: { partPath: 'p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-b', name: 'SB',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [viewWithBreak], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 'sheet-b',
        },
      },
    });
  });

  it('when breaks.length > 0: fresh kernel output stored as rawProjection, applyBreaks produces projection', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-b',
      viewId: 'view-broken',
      projection: BROKEN_PROJ_RAW,
      inputFingerprint: 'fresh-fp',
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };

    // rawProjection must be the fresh kernel output
    expect(v.rawProjection).toEqual(BROKEN_PROJ_RAW);
    // projection is the applyBreaks result (set by mock)
    expect(v.projection).toBeDefined();
    // projection should not be the raw kernel output verbatim (breaks applied)
    expect(v.projection).not.toEqual(BROKEN_PROJ_RAW);
  });

  it('when breaks.length > 0: α-conditional holds after regen', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-b',
      viewId: 'view-broken',
      projection: BROKEN_PROJ_RAW,
      inputFingerprint: 'fresh-fp',
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { breaks?: unknown[]; rawProjection?: unknown };
    expect((v.breaks?.length ?? 0) > 0).toBe(v.rawProjection !== undefined);
  });

  it('when breaks.length === 0: rawProjection stays undefined, projection = fresh kernel output', async () => {
    const viewNoBreaks: BaseView = {
      id: 'view-no-breaks', kind: 'base',
      positionMm: { x: 50, y: 50 },
      orientation: 'front',
      scale: { numerator: 1, denominator: 1 },
      showHidden: false,
      projection: OLD_PROJECTION,
      inputFingerprint: 'stale-no-break-fp',
    };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'd-nb', name: 'D', units: 'mm',
          source: { partPath: 'p.zipt', sourceKind: 'part' },
          properties: {},
          sheets: [{
            id: 'sheet-nb', name: 'SNB',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [viewNoBreaks], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
          }],
          activeSheetId: 'sheet-nb',
        },
      },
    });

    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-nb',
      viewId: 'view-no-breaks',
      projection: NEW_PROJECTION,
      inputFingerprint: 'fresh-fp-nb',
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { rawProjection?: ProjectedGeometry };
    expect(v.projection).toEqual(NEW_PROJECTION);
    expect(v.rawProjection).toBeUndefined();
  });

  it('revert after breaks-path regen restores prior rawProjection and projection', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-b',
      viewId: 'view-broken',
      projection: BROKEN_PROJ_RAW,
      inputFingerprint: 'fresh-fp',
    });
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const v = doc.document.sheets[0]!.views[0]! as
      BaseView & { breaks?: BreakRegion[]; rawProjection?: ProjectedGeometry };
    // rawProjection should be restored to what it was before regen
    expect(v.rawProjection).toEqual(BROKEN_PROJ_APPLIED);
    // projection should be restored
    expect(v.projection).toEqual(BROKEN_PROJ_APPLIED);
  });
});

// ─── Slice 5: RegenerateViewCommand atomically replaces center-mark annotations ──

/** 8 points on a circle of radius r centred at (cx,cy). isArcEdge requires ≥5pts, r≥0.5mm. */
function circlePoints(cx: number, cy: number, r: number, n = 8): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const theta = (2 * Math.PI * i) / n;
    return [cx + r * Math.cos(theta), cy + r * Math.sin(theta)] as [number, number];
  });
}

import type { DrawingAnnotation } from '@zilventor/shared';

const STALE_CM_ANNOTATION: DrawingAnnotation = {
  id: 'cm-view-regen-old-edge',
  kind: 'center-mark',
  viewId: 'view-regen',
  edgeId: 'old-edge',
};

const FRESH_ARC_PROJECTION: ProjectedGeometry = {
  visibleEdges: [
    { id: 'new-arc-edge', kind: 'outline', points: circlePoints(10, 10, 5, 8), sourceFaceIds: [] },
  ],
  hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
};

const VIEW_FOR_REGEN: BaseView = {
  id: 'view-regen', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: OLD_PROJECTION,
  inputFingerprint: 'stale-fp',
};

function makeDrawingWithStaleCenterMark(): DrawingDocument {
  return {
    id: 'd-cm', name: 'D-CM', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-cm', name: 'Sheet CM',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW_FOR_REGEN],
      dimensions: [],
      dimensionGroups: [],
      annotations: [STALE_CM_ANNOTATION],  // stale center-mark from previous projection
      titleBlock: {},
    }],
    activeSheetId: 'sheet-cm',
  };
}

describe('RegenerateViewCommand — atomic center-mark replacement (Slice 5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDrawingWithStaleCenterMark() },
    });
  });

  it('apply removes old center-marks for the view and adds fresh ones from the new projection', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-cm',
      viewId: 'view-regen',
      projection: FRESH_ARC_PROJECTION,
      inputFingerprint: 'fresh-fp',
      centerMarkAnnotations: [
        { id: 'cm-view-regen-new-arc-edge', kind: 'center-mark', viewId: 'view-regen', edgeId: 'new-arc-edge' },
      ],
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const sheet = doc.document.sheets[0]!;
    const cms = sheet.annotations.filter(a => a.kind === 'center-mark');
    // Stale center-mark must be gone
    expect(cms.find(a => a.id === 'cm-view-regen-old-edge')).toBeUndefined();
    // Fresh center-mark must be present
    expect(cms.find(a => a.id === 'cm-view-regen-new-arc-edge')).toBeDefined();
    expect(cms).toHaveLength(1);
  });

  it('no center-mark accumulation on repeated applies', async () => {
    const cm1: DrawingAnnotation = { id: 'cm-view-regen-new-arc-edge', kind: 'center-mark', viewId: 'view-regen', edgeId: 'new-arc-edge' };
    const cmd1 = new RegenerateViewCommand({
      sheetId: 'sheet-cm', viewId: 'view-regen',
      projection: FRESH_ARC_PROJECTION, inputFingerprint: 'fp-1',
      centerMarkAnnotations: [cm1],
    });
    await cmd1.apply();

    // Second regen: same viewId but different edgeId (simulates geometry change)
    const freshProj2: ProjectedGeometry = {
      visibleEdges: [{ id: 'new-arc-edge-2', kind: 'outline', points: circlePoints(20, 20, 5, 8), sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 10, minY: 10, maxX: 30, maxY: 30 },
    };
    const cm2: DrawingAnnotation = { id: 'cm-view-regen-new-arc-edge-2', kind: 'center-mark', viewId: 'view-regen', edgeId: 'new-arc-edge-2' };
    const cmd2 = new RegenerateViewCommand({
      sheetId: 'sheet-cm', viewId: 'view-regen',
      projection: freshProj2, inputFingerprint: 'fp-2',
      centerMarkAnnotations: [cm2],
    });
    await cmd2.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const sheet = doc.document.sheets[0]!;
    const cms = sheet.annotations.filter(a => a.kind === 'center-mark');
    expect(cms).toHaveLength(1);
    expect(cms[0]!.id).toBe('cm-view-regen-new-arc-edge-2');
  });

  it('revert restores the stale center-mark and removes the fresh one', async () => {
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-cm',
      viewId: 'view-regen',
      projection: FRESH_ARC_PROJECTION,
      inputFingerprint: 'fresh-fp',
      centerMarkAnnotations: [
        { id: 'cm-view-regen-new-arc-edge', kind: 'center-mark', viewId: 'view-regen', edgeId: 'new-arc-edge' },
      ],
    });
    await cmd.apply();
    await cmd.revert();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const sheet = doc.document.sheets[0]!;
    const cms = sheet.annotations.filter(a => a.kind === 'center-mark');
    expect(cms).toHaveLength(1);
    expect(cms[0]!.id).toBe('cm-view-regen-old-edge');
  });

  it('no centerMarkAnnotations passed → center-marks for this viewId are cleared (projection had no arcs)', async () => {
    const projNoArcs: ProjectedGeometry = {
      visibleEdges: [{ id: 'straight-only', kind: 'outline', points: [[0,0],[100,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
    };
    const cmd = new RegenerateViewCommand({
      sheetId: 'sheet-cm',
      viewId: 'view-regen',
      projection: projNoArcs,
      inputFingerprint: 'fresh-no-arcs',
      // no centerMarkAnnotations → default [] clears old marks
    });
    await cmd.apply();

    const doc = useAppStore.getState().activeDocument;
    if (!doc || doc.kind !== 'drawing') throw new Error();
    const sheet = doc.document.sheets[0]!;
    expect(sheet.annotations.filter(a => a.kind === 'center-mark' && a.viewId === 'view-regen')).toHaveLength(0);
  });
});
