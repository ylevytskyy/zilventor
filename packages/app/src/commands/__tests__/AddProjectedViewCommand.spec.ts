// packages/app/src/commands/__tests__/AddProjectedViewCommand.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { AddProjectedViewCommand } from '../AddProjectedViewCommand';
import type { DrawingDocument, BaseView } from '@zilventor/shared';

vi.mock('../../drawing/projectViewFromSource', () => ({
  projectViewFromSource: vi.fn().mockResolvedValue({
    projection: {
      visibleEdges: [{ id: 'proj-right-e0', kind: 'outline', points: [[0,0],[30,0],[30,50],[0,50],[0,0]], sourceFaceIds: [] }],
      hiddenEdges: [],
      bbox: { minX: 0, minY: 0, maxX: 30, maxY: 50 },
    },
    inputFingerprint: 'mock-proj-fp',
  }),
}));

vi.mock('@zilventor/shared/src/drawing/deriveProjectedOrientation', () => ({
  deriveProjectedOrientation: vi.fn().mockReturnValue('right' as import('@zilventor/shared/src/drawing/viewMatrix').ViewOrientation),
}));

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const BASE_VIEW: BaseView = {
  id: 'base-1', kind: 'base',
  positionMm: { x: 100, y: 100 },
  orientation: 'front',
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
      views: [BASE_VIEW], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
    activeSheetId: 'sheet-1',
  };
}

describe('AddProjectedViewCommand', () => {
  beforeEach(() => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDrawing() } } as never);
  });

  it('apply appends a projected view with correct fields', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'base-1',
      direction: 'right',
      positionMm: { x: 200, y: 100 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const views = doc.sheets[0]!.views;
    expect(views).toHaveLength(2);
    const pv = views[1]!;
    expect(pv.kind).toBe('projected');
    if (pv.kind !== 'projected') return;
    expect(pv.baseViewId).toBe('base-1');
    expect(pv.direction).toBe('right');
    expect(pv.scale).toEqual({ numerator: 1, denominator: 1 }); // inherited from base
    expect(pv.projection).toBeDefined();
  });

  it('apply throws when baseViewId does not exist on the sheet', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'no-such-view',
      direction: 'top',
      positionMm: { x: 0, y: 0 },
    });
    await expect(cmd.apply()).rejects.toThrow(/BASE_VIEW_NOT_FOUND/);
  });

  it('revert removes the projected view', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'base-1',
      direction: 'left',
      positionMm: { x: 0, y: 100 },
    });
    await cmd.apply();
    await cmd.revert();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.views).toHaveLength(1);
    expect(doc.sheets[0]!.views[0]!.id).toBe('base-1');
  });

  it('apply stores projection and inputFingerprint from projectViewFromSource', async () => {
    const cmd = new AddProjectedViewCommand({
      sheetId: 'sheet-1',
      baseViewId: 'base-1',
      direction: 'right',
      positionMm: { x: 200, y: 100 },
    });
    await cmd.apply();

    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const pv = doc.sheets[0]!.views[1]!;
    if (pv.kind !== 'projected') return;
    expect(pv.projection).toBeDefined();
    expect(pv.projection?.visibleEdges).toHaveLength(1);
    expect(pv.inputFingerprint).toBe('mock-proj-fp');
  });
});
