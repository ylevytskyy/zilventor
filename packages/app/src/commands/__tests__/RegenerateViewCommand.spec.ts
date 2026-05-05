// packages/app/src/commands/__tests__/RegenerateViewCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { RegenerateViewCommand } from '../RegenerateViewCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry, DetailView } from '@zilventor/shared';

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
      views: [VIEW_WITH_OLD], dimensions: [], annotations: [], titleBlock: {},
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
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
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
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
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
