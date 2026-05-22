// packages/app/src/commands/__tests__/AddDimensionGroupCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddDimensionGroupCommand } from '../AddDimensionGroupCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
  };
}

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('AddDimensionGroupCommand', () => {
  it('(a) apply appends baseline group to dimensionGroups', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const groups = doc.sheets[0]!.dimensionGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'baseline', id: 'bg1' });
  });

  it('(b) apply appends ordinate group to dimensionGroups', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: ordinateGroup });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const groups = doc.sheets[0]!.dimensionGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'ordinate', id: 'og1' });
  });

  it('(c) revert removes the group by id', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensionGroups).toHaveLength(0);
  });

  it('(d) apply resolves when viewId not in sheet.views', async () => {
    const cmd = new AddDimensionGroupCommand({ sheetId: 'sh1', group: baselineGroup });
    await expect(cmd.apply()).resolves.toBeUndefined();
  });
});
