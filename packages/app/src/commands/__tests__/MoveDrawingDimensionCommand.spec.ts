// packages/app/src/commands/__tests__/MoveDrawingDimensionCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MoveDrawingDimensionCommand } from '../MoveDrawingDimensionCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument, DrawingDimension } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

const dim1: DrawingDimension = {
  id: 'dim1',
  kind: 'linear-h',
  viewId: 'v1',
  from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
  to:   { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  offsetMm: 10,
};

function makeDrawingDoc(): DrawingDocument {
  return {
    id: 'dw1', name: 'Test Drawing', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [], dimensions: [dim1], annotations: [], titleBlock: {}, dimensionGroups: [],
    }],
  };
}

beforeEach(() => {
  useAppStore.setState({
    activeDocument: { kind: 'drawing', document: makeDrawingDoc() },
  } as never);
});

describe('MoveDrawingDimensionCommand', () => {
  it('(a) apply updates offsetMm on the target dimension', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]!;
    expect((dim as { offsetMm: number }).offsetMm).toBe(25);
  });

  it('(a) apply updates angleDeg on radial dimensions when provided', async () => {
    // Seed a radial dim
    const radialDim: DrawingDimension = { id: 'dim2', kind: 'radial', viewId: 'v1', edgeId: 'arc1', offsetMm: 5, angleDeg: 0 };
    useAppStore.setState({
      activeDocument: {
        kind: 'drawing',
        document: {
          id: 'dw1', name: 'Test Drawing', units: 'mm',
          source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
          properties: {}, activeSheetId: 'sh1',
          sheets: [{
            id: 'sh1', name: 'Sheet 1',
            size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
            views: [], dimensions: [radialDim], annotations: [], titleBlock: {}, dimensionGroups: [],
          }],
        },
      },
    } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim2', offsetMm: 12, angleDeg: 45 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number; angleDeg: number };
    expect(dim.offsetMm).toBe(12);
    expect(dim.angleDeg).toBe(45);
  });

  it('(b) revert restores prior offsetMm', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });

  it('(c) revert is idempotent', async () => {
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'dim1', offsetMm: 25 });
    await cmd.apply();
    await cmd.revert();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as { offsetMm: number };
    expect(dim.offsetMm).toBe(10);
  });
});

import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

describe('MoveDrawingDimensionCommand — F5 new kinds', () => {
  function makeDocWithBaseline(): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'baseline', id: 'bg1', viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      direction: 'h', baseOffsetMm: 20, spacingMm: 10,
    };
    const mem: DrawingDimension = {
      id: 'bm0', kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  function makeDocWithOrdinate(axis: 'x' | 'y'): DrawingDocument {
    const group: DimensionGroup = {
      kind: 'ordinate', id: 'og1', viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
      xColumnOffsetMm: 30, yColumnOffsetMm: 25,
    };
    const mem: DrawingDimension = {
      id: 'om0', kind: 'ordinate', viewId: 'v1', groupId: 'og1', axis,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    return {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [mem], dimensionGroups: [group], annotations: [], titleBlock: {},
      }],
    };
  }

  it('(a) baseline drag mutates group.baseOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithBaseline() } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0', offsetMm: 35 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { baseOffsetMm: number };
    expect(group.baseOffsetMm).toBe(35);
  });

  it('(b) baseline drag revert restores group.baseOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithBaseline() } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0', offsetMm: 35 });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { baseOffsetMm: number };
    expect(group.baseOffsetMm).toBe(20);
  });

  it('(c) ordinate axis=x drag mutates group.xColumnOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithOrdinate('x') } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'om0', offsetMm: 50 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { xColumnOffsetMm: number; yColumnOffsetMm: number };
    expect(group.xColumnOffsetMm).toBe(50);
    expect(group.yColumnOffsetMm).toBe(25); // unchanged
  });

  it('(d) ordinate axis=y drag mutates group.yColumnOffsetMm', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithOrdinate('y') } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'om0', offsetMm: 60 });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { yColumnOffsetMm: number };
    expect(group.yColumnOffsetMm).toBe(60);
  });

  it('(e) angular drag mutates dim.offsetMm directly', async () => {
    const angularDim: DrawingDimension = {
      id: 'ang1', kind: 'angular', viewId: 'v1',
      ref: { kind: 'two-edges', edge1: { viewId: 'v1', edgeId: 'e1' }, edge2: { viewId: 'v1', edgeId: 'e2' } },
      arcSide: 'inside', offsetMm: 15,
    } as unknown as DrawingDimension;
    const doc: DrawingDocument = {
      id: 'dw1', name: 'Test', units: 'mm',
      source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
      properties: {}, activeSheetId: 'sh1',
      sheets: [{
        id: 'sh1', name: 'Sheet 1',
        size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
        views: [], dimensions: [angularDim], dimensionGroups: [], annotations: [], titleBlock: {},
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: doc } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'ang1', offsetMm: 30 });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    const dim = doc2.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    expect(dim.offsetMm).toBe(30);
  });

  it('(f) revert-then-revert leaves baseline group unchanged after first revert', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithBaseline() } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'bm0', offsetMm: 40 });
    await cmd.apply();
    await cmd.revert();
    // Second revert should be a no-op — group should still have the original baseOffsetMm=20
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { baseOffsetMm: number };
    expect(group.baseOffsetMm).toBe(20);
  });

  it('(g) revert-then-revert leaves ordinate group unchanged after first revert', async () => {
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDocWithOrdinate('x') } } as never);
    const cmd = new MoveDrawingDimensionCommand({ sheetId: 'sh1', dimId: 'om0', offsetMm: 55 });
    await cmd.apply();
    await cmd.revert();
    // Second revert should be a no-op — group should still have the original xColumnOffsetMm=30
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const group = doc.sheets[0]!.dimensionGroups[0]! as unknown as { xColumnOffsetMm: number };
    expect(group.xColumnOffsetMm).toBe(30);
  });
});
