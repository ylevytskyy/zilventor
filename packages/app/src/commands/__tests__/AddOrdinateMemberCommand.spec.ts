// packages/app/src/commands/__tests__/AddOrdinateMemberCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddOrdinateMemberCommand } from '../AddOrdinateMemberCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

function makeDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [],
      dimensionGroups: [ordinateGroup, baselineGroup],
      annotations: [], titleBlock: {},
    }],
  };
}

const toRef = { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const };

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddOrdinateMemberCommand', () => {
  it('(a) apply appends ordinate dim with axis=x', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'x' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'ordinate', groupId: 'og1', axis: 'x', viewId: 'v1' });
  });

  it('(b) apply appends ordinate dim with axis=y', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'y' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect((doc.sheets[0]!.dimensions[0] as unknown as { axis: string }).axis).toBe('y');
  });

  it('(c) revert removes the appended dim', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'x' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(d) group-not-found throws', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'missing', to: toRef, axis: 'x' });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });

  it('(e) wrong-kind throws when group is baseline', async () => {
    const cmd = new AddOrdinateMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef, axis: 'x' });
    await expect(cmd.apply()).rejects.toThrow('wrong-kind');
  });

  it('(f) sourceParameterName stored when provided', async () => {
    const cmd = new AddOrdinateMemberCommand({
      sheetId: 'sh1', groupId: 'og1', to: toRef, axis: 'y',
      opts: { sourceParameterName: 'height' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as unknown as { sourceParameterName: string }).sourceParameterName).toBe('height');
  });
});
