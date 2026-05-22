// packages/app/src/commands/__tests__/DeleteDimensionGroupCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteDimensionGroupCommand } from '../DeleteDimensionGroupCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const group: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

// Two members belonging to the group
const mem0 = {
  id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
  to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
} as unknown as DrawingDimension;

const mem1 = {
  id: 'bm1', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 1,
  to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
} as unknown as DrawingDimension;

// A dim belonging to a DIFFERENT group (must survive cascade)
const unrelated: DrawingDimension = {
  id: 'lh1', kind: 'linear-h', viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e3', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e4', end: 'end' },
  offsetMm: 10,
};

function makeDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [],
      dimensions: [mem0, mem1, unrelated],
      dimensionGroups: [group],
      annotations: [], titleBlock: {},
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('DeleteDimensionGroupCommand', () => {
  it('(a) apply removes the group', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensionGroups).toHaveLength(0);
  });

  it('(b) apply cascade-removes all member dims', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims.every((d) => (d as unknown as { groupId?: string }).groupId !== 'bg1')).toBe(true);
  });

  it('(c) cascade does NOT remove unrelated dims', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims.some((d) => d.id === 'lh1')).toBe(true);
  });

  it('(d) revert restores group and members in original order', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'bg1' });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const sheet = doc.sheets[0]!;
    // Group restored
    expect(sheet.dimensionGroups).toHaveLength(1);
    expect(sheet.dimensionGroups[0]!.id).toBe('bg1');
    // Members restored (order: bm0 before bm1)
    const memberIds = sheet.dimensions
      .filter((d) => (d as unknown as { groupId?: string }).groupId === 'bg1')
      .map((d) => d.id);
    expect(memberIds).toEqual(['bm0', 'bm1']);
  });

  it('(e) group-not-found throws', async () => {
    const cmd = new DeleteDimensionGroupCommand({ sheetId: 'sh1', groupId: 'missing' });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });
});
