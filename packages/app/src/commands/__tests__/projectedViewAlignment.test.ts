// packages/app/src/commands/__tests__/projectedViewAlignment.test.ts
// M3.4.2 — enforced projected-view alignment: moving a base view shifts every
// dependent ProjectedView (baseViewId === movedViewId) by the same delta.
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { MoveViewCommand } from '../MoveViewCommand';
import type { DrawingDocument, BaseView, ProjectedView } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const BASE: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 100, y: 100 },
  orientation: 'front',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

const TOP: ProjectedView = {
  id: 'proj-top', kind: 'projected',
  positionMm: { x: 100, y: 200 },
  baseViewId: 'base-1',
  direction: 'top',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

const RIGHT: ProjectedView = {
  id: 'proj-right', kind: 'projected',
  positionMm: { x: 220, y: 100 },
  baseViewId: 'base-1',
  direction: 'right',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

// A projected view of a DIFFERENT base — must NOT move when base-1 moves.
const OTHER: ProjectedView = {
  id: 'proj-other', kind: 'projected',
  positionMm: { x: 500, y: 500 },
  baseViewId: 'base-2',
  direction: 'top',
  scale: { numerator: 1, denominator: 1 },
  showHidden: true,
};

function makeDrawing(): DrawingDocument {
  return {
    id: 'd1', name: 'D', units: 'mm',
    source: { partPath: 'parts/p.zipt', sourceKind: 'part' },
    properties: {},
    sheets: [{
      id: 'sheet-1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [BASE, TOP, RIGHT, OTHER],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

function viewById(id: string) {
  const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
  return doc.sheets[0]!.views.find(v => v.id === id)!;
}

describe('MoveViewCommand — projected-view alignment (M3.4.2)', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('moving a base view shifts its dependent projected views by the same delta', async () => {
    // base 100,100 → 130,160 ⇒ delta +30,+60
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'base-1', positionMm: { x: 130, y: 160 } });
    await cmd.apply();

    expect(viewById('base-1').positionMm).toEqual({ x: 130, y: 160 });
    expect(viewById('proj-top').positionMm).toEqual({ x: 130, y: 260 });   // 100+30, 200+60
    expect(viewById('proj-right').positionMm).toEqual({ x: 250, y: 160 }); // 220+30, 100+60
  });

  it('does not move projected views of a different base', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'base-1', positionMm: { x: 130, y: 160 } });
    await cmd.apply();
    expect(viewById('proj-other').positionMm).toEqual({ x: 500, y: 500 });
  });

  it('revert restores the base and every dependent projected view', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'base-1', positionMm: { x: 130, y: 160 } });
    await cmd.apply();
    await cmd.revert();

    expect(viewById('base-1').positionMm).toEqual({ x: 100, y: 100 });
    expect(viewById('proj-top').positionMm).toEqual({ x: 100, y: 200 });
    expect(viewById('proj-right').positionMm).toEqual({ x: 220, y: 100 });
  });

  it('moving a projected view alone does not cascade', async () => {
    const cmd = new MoveViewCommand({ sheetId: 'sheet-1', viewId: 'proj-top', positionMm: { x: 140, y: 240 } });
    await cmd.apply();
    expect(viewById('proj-top').positionMm).toEqual({ x: 140, y: 240 });
    expect(viewById('base-1').positionMm).toEqual({ x: 100, y: 100 });
    expect(viewById('proj-right').positionMm).toEqual({ x: 220, y: 100 });
  });
});
