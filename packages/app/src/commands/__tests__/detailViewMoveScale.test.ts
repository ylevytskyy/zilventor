// packages/app/src/commands/__tests__/detailViewMoveScale.test.ts
// Sanity tests: MoveViewCommand and EditViewScaleCommand work on DetailView
// WITHOUT any modification to those commands.
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MoveViewCommand } from '../MoveViewCommand';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import type { DrawingDocument, DetailView } from '@zilventor/shared';

const DETAIL: DetailView = {
  id: 'dv1',
  kind: 'detail',
  parentViewId: 'base-v1',
  regionParent: { center: { x: 10, y: 8 }, radiusMm: 5 },
  label: 'A',
  positionMm: { x: 100, y: 100 },
  scale: { numerator: 2, denominator: 1 },
  showHidden: false,
  projection: {
    visibleEdges: [{ id: 'e1', kind: 'outline' as const, points: [[2, 1], [8, 1]] as [number, number][], sourceFaceIds: [] }],
    hiddenEdges: [],
    bbox: { minX: 2, minY: 1, maxX: 8, maxY: 7 },
  },
  inputFingerprint: 'detail-fp-abc',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [DETAIL],
      dimensions: [],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [],
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('MoveViewCommand — sanity on DetailView (no command code change)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply moves the detail view to the new position', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 200, y: 150 } });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]!;
    expect(view.positionMm).toEqual({ x: 200, y: 150 });
    expect(view.kind).toBe('detail');
  });

  it('revert restores prior position on detail view', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 200, y: 150 } });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]!;
    expect(view.positionMm).toEqual({ x: 100, y: 100 });
  });

  it('regionParent and label are unchanged after move', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'dv1', positionMm: { x: 300, y: 250 } });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(view.label).toBe('A');
  });
});

describe('EditViewScaleCommand — sanity on DetailView (no command code change)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply updates scale on detail view to 5:1', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 5, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.scale).toEqual({ numerator: 5, denominator: 1 });
    expect(view.kind).toBe('detail');
  });

  it('apply clears inputFingerprint on detail view (triggers stale-banner)', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 4, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    // inputFingerprint must be cleared so the stale-banner appears
    expect(view.inputFingerprint).toBeUndefined();
  });

  it('revert restores prior scale and inputFingerprint on detail view', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 5, denominator: 1 },
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.scale).toEqual({ numerator: 2, denominator: 1 });
    expect(view.inputFingerprint).toBe('detail-fp-abc');
  });

  it('regionParent and label are unchanged after scale edit', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'dv1',
      scale: { numerator: 3, denominator: 1 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const view = _ad.document.sheets[0]!.views[0]! as DetailView;
    expect(view.regionParent).toEqual({ center: { x: 10, y: 8 }, radiusMm: 5 });
    expect(view.label).toBe('A');
  });
});
