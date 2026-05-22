// packages/app/src/drawing/__tests__/renderBaselineDim.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDrawingSvg } from '../renderDrawingSvg';
import type { DrawingDocument, DrawingSheet } from '@zilventor/shared';
import type { PartDocument } from '@zilventor/shared';

function makeMinimalSource(): PartDocument {
  return {
    id: 'p1',
    name: 'Part',
    featureTree: [],
    parameters: {},
    properties: {},
    materials: [],
  } as unknown as PartDocument;
}

function makeBaseDrawing(sheets: DrawingSheet[]): DrawingDocument {
  return {
    id: 'drw1',
    name: 'Drawing 1',
    units: 'mm',
    source: { partPath: 'p.zipt', sourceKind: 'part' },
    properties: {},
    sheets,
    activeSheetId: sheets[0]!.id,
  };
}

describe('renderBaselineDim — HS-REND-1: data-dim-kind baseline present', () => {
  it('emits data-dim-kind="baseline" attribute for a baseline dim', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'g1',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'g1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-dim-kind="baseline"');
  });
});

describe('renderBaselineDim — HS-REND-2: data-slot attribute', () => {
  it('emits data-slot="0" for slot=0 member', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'g1',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'g1',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-slot="0"');
  });
});

describe('renderBaselineDim — HS-REND-3: data-group-id attribute', () => {
  it('emits data-group-id matching the groupId', () => {
    const edge1: import('@zilventor/shared').Edge2D = {
      id: 'e1', kind: 'outline', points: [[0, 0], [0, 30]],
    };
    const edge2: import('@zilventor/shared').Edge2D = {
      id: 'e2', kind: 'outline', points: [[50, 0], [50, 30]],
    };
    const sheet: DrawingSheet = {
      id: 's1', name: 'S1',
      size: { kind: 'iso', size: 'A3' },
      orientation: 'landscape',
      views: [{
        id: 'v1', kind: 'base',
        positionMm: { x: 50, y: 50 },
        scale: { numerator: 1, denominator: 1 },
        orientation: 'front',
        showHidden: false,
        projection: {
          visibleEdges: [edge1, edge2],
          hiddenEdges: [],
          bbox: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
        },
      }],
      dimensions: [{
        kind: 'baseline',
        id: 'd-base-1',
        viewId: 'v1',
        groupId: 'grp-abc',
        slot: 0,
        to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      }],
      annotations: [],
      titleBlock: {},
      dimensionGroups: [{
        kind: 'baseline',
        id: 'grp-abc',
        viewId: 'v1',
        datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
        direction: 'h',
        baseOffsetMm: 15,
        spacingMm: 10,
      }],
    };
    const svg = renderDrawingSvg(makeBaseDrawing([sheet]), sheet, makeMinimalSource());
    expect(svg).toContain('data-group-id="grp-abc"');
  });
});
