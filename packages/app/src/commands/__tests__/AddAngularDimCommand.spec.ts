// packages/app/src/commands/__tests__/AddAngularDimCommand.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { AddAngularDimCommand } from '../AddAngularDimCommand';
import { useAppStore } from '../../store/useAppStore';
import type { DrawingDocument } from '@zilventor/shared';

type DrawingActive = { kind: 'drawing'; document: DrawingDocument };

function makeEdge2D(id: string) {
  return { id, kind: 'feature' as const, points: [[0, 0], [10, 10]] as ReadonlyArray<readonly [number, number]> };
}

function makeDoc() {
  return {
    id: 'dw1', name: 'Test', units: 'mm',
    source: { partPath: 'parts/box.zipt', sourceKind: 'part' },
    properties: {}, activeSheetId: 'sh1',
    sheets: [{
      id: 'sh1', name: 'Sheet 1',
      size: { kind: 'iso', size: 'A3' }, orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base', positionMm: { x: 0, y: 0 },
        scale: { numerator: 1, denominator: 1 }, orientation: 'front', showHidden: false,
        projection: {
          visibleEdges: [makeEdge2D('e1'), makeEdge2D('e2')],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 100, maxY: 80 },
        },
      }],
      dimensions: [], dimensionGroups: [], annotations: [], titleBlock: {},
    }],
  } satisfies DrawingDocument;
}

const twoEdgesRef = {
  kind: 'two-edges' as const,
  edge1: { viewId: 'v1', edgeId: 'e1' },
  edge2: { viewId: 'v1', edgeId: 'e2' },
};

beforeEach(() => {
  useAppStore.setState({ activeDocument: { kind: 'drawing', document: makeDoc() } } as never);
});

describe('AddAngularDimCommand', () => {
  it('(a) two-edges happy path appends angular dim', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dims = doc.sheets[0]!.dimensions;
    expect(dims).toHaveLength(1);
    expect(dims[0]).toMatchObject({ kind: 'angular', viewId: 'v1' });
  });

  it('(b) default arcSide is inside', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { arcSide: string };
    expect(dim.arcSide).toBe('inside');
  });

  it('(c) default offsetMm = max(15, bboxHeight * 0.1) = max(15, 8) = 15 when bbox.height=80', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    // bbox height = 80, 80*0.1=8, max(15,8)=15
    expect(dim.offsetMm).toBe(15);
  });

  it('(c2) offsetMm = bboxHeight*0.1 when bbox height is large (200)', async () => {
    const doc = makeDoc();
    const sheet = doc.sheets[0]!;
    const view = sheet.views[0]!;
    const bigDoc: DrawingDocument = {
      ...doc,
      sheets: [{
        ...sheet,
        views: [{
          ...view,
          projection: { ...view.projection!, bbox: { minX: 0, minY: 0, maxX: 100, maxY: 200 } },
        }],
      }],
    };
    useAppStore.setState({ activeDocument: { kind: 'drawing', document: bigDoc } } as never);
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    const state = useAppStore.getState();
    const doc2 = (state.activeDocument as unknown as DrawingActive).document;
    const dim = doc2.sheets[0]!.dimensions[0]! as unknown as { offsetMm: number };
    expect(dim.offsetMm).toBeCloseTo(20, 5); // max(15, 200*0.1=20) = 20
  });

  it('(d) explicit arcSide=outside is stored', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef, arcSide: 'outside' });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    const dim = doc.sheets[0]!.dimensions[0]! as unknown as { arcSide: string };
    expect(dim.arcSide).toBe('outside');
  });

  it('(e) edge-not-in-view throws for unknown edgeId', async () => {
    const badRef = { kind: 'two-edges' as const, edge1: { viewId: 'v1', edgeId: 'NO' }, edge2: { viewId: 'v1', edgeId: 'e2' } };
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: badRef });
    await expect(cmd.apply()).rejects.toThrow('edge-not-in-view');
  });

  it('(f) revert removes the placed dim', async () => {
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: twoEdgesRef });
    await cmd.apply();
    await cmd.revert();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions).toHaveLength(0);
  });

  it('(g) arc-kind ref happy path', async () => {
    const arcRef = { kind: 'arc' as const, edge: { viewId: 'v1', edgeId: 'e1' } };
    const cmd = new AddAngularDimCommand({ sheetId: 'sh1', viewId: 'v1', ref: arcRef });
    await cmd.apply();
    const doc = (useAppStore.getState().activeDocument as unknown as DrawingActive).document;
    expect(doc.sheets[0]!.dimensions[0]).toMatchObject({ kind: 'angular' });
  });
});
