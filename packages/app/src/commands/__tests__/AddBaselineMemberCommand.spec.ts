// packages/app/src/commands/__tests__/AddBaselineMemberCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddBaselineMemberCommand } from '../AddBaselineMemberCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

function makeDoc(extraDims: DrawingDimension[] = []): DrawingDocument {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{ id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false }],
      dimensions: extraDims,
      dimensionGroups: [baselineGroup],
      annotations: [], titleBlock: {},
    }],
  };
}

const toRef = { kind: 'edge-endpoint' as const, edgeId: 'e1', end: 'end' as const };

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddBaselineMemberCommand', () => {
  it('(a) first member gets slot 0', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'baseline', groupId: 'bg1', slot: 0, viewId: 'v1' });
  });

  it('(b) second member gets slot 1 (max+1)', async () => {
    // Pre-seed a slot-0 member
    const existing: DrawingDimension = {
      id: 'bm-0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: toRef,
    } as unknown as DrawingDimension;
    useAppStore.setState({
      activeDocument: { kind: 'drawing', document: makeDoc([existing]) },
    } as never);
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    const newDim = dims.find((d) => d.id !== 'bm-0')!;
    expect((newDim as unknown as { slot: number }).slot).toBe(1);
  });

  it('(c) revert removes the appended dim', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'bg1', to: toRef });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(d) group-not-found throws', async () => {
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'no-such', to: toRef });
    await expect(cmd.apply()).rejects.toThrow('group-not-found');
  });

  it('(e) wrong-kind throws when group is ordinate', async () => {
    const ordinateGroup: DimensionGroup = {
      kind: 'ordinate', id: 'og1', viewId: 'v1',
      origin: toRef, xColumnOffsetMm: 20, yColumnOffsetMm: 20,
    };
    const doc = makeDoc();
    const sheet = doc.sheets[0]!;
    const patchedDoc: DrawingDocument = {
      ...doc,
      sheets: [{ ...sheet, dimensionGroups: [...(sheet.dimensionGroups ?? []), ordinateGroup] }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: patchedDoc } } as never);
    const cmd = new AddBaselineMemberCommand({ sheetId: 'sh1', groupId: 'og1', to: toRef });
    await expect(cmd.apply()).rejects.toThrow('wrong-kind');
  });

  it('(f) stores sourceParameterName when provided', async () => {
    const cmd = new AddBaselineMemberCommand({
      sheetId: 'sh1', groupId: 'bg1', to: toRef,
      opts: { sourceParameterName: 'width' },
    });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as unknown as { sourceParameterName: string }).sourceParameterName).toBe('width');
  });
});
