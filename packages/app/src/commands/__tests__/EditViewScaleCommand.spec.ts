// packages/app/src/commands/__tests__/EditViewScaleCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { EditViewScaleCommand } from '../EditViewScaleCommand';
import type { DrawingDocument, BaseView, ProjectedGeometry } from '@zilventor/shared';

const PROJ: ProjectedGeometry = {
  visibleEdges: [], hiddenEdges: [],
  bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};
const VIEW: BaseView = {
  id: 'view-1', kind: 'base',
  positionMm: { x: 50, y: 50 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
  projection: PROJ,
  inputFingerprint: 'fp-old',
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [VIEW], dimensions: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('EditViewScaleCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } });
  });

  it('apply updates scale and clears inputFingerprint (requires regen)', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      scale: { numerator: 1, denominator: 2 },
    });
    await cmd.apply();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.scale).toEqual({ numerator: 1, denominator: 2 });
    expect(view.inputFingerprint).toBeUndefined(); // cleared to trigger stale-banner
  });

  it('revert restores prior scale and inputFingerprint', async () => {
    const cmd = new EditViewScaleCommand({
      sheetId: 'sheet-1',
      viewId: 'view-1',
      scale: { numerator: 1, denominator: 5 },
    });
    await cmd.apply();
    await cmd.revert();

    const _ad = useAppStore.getState().activeDocument;
    if (!_ad || _ad.kind !== 'drawing') throw new Error('expected drawing');
    const doc = _ad.document;
    const view = doc.sheets[0]!.views[0]!;
    if (view.kind !== 'base') return;
    expect(view.scale).toEqual({ numerator: 1, denominator: 1 });
    expect(view.inputFingerprint).toBe('fp-old');
  });
});
