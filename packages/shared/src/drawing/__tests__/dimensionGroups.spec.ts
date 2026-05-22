// packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts
import { describe, it, expect } from 'vitest';
import type { DimensionGroup, DrawingDimension } from '../types';

describe('DimensionGroup type — HS-DG-1: baseline group shape', () => {
  it('can construct a baseline DimensionGroup literal', () => {
    const g: DimensionGroup = {
      kind: 'baseline',
      id: 'g1',
      viewId: 'v1',
      datum: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      direction: 'h',
      baseOffsetMm: 20,
      spacingMm: 10,
    };
    expect(g.kind).toBe('baseline');
  });
});

describe('DimensionGroup type — HS-DG-2: ordinate group shape', () => {
  it('can construct an ordinate DimensionGroup literal', () => {
    const g: DimensionGroup = {
      kind: 'ordinate',
      id: 'g2',
      viewId: 'v1',
      origin: { kind: 'edge-endpoint', edgeId: 'e2', end: 'start' },
      xColumnOffsetMm: 30,
      yColumnOffsetMm: 25,
    };
    expect(g.kind).toBe('ordinate');
  });
});

describe('DrawingDimension — HS-DD-1: baseline kind shape', () => {
  it('can construct a baseline DrawingDimension literal', () => {
    const d: DrawingDimension = {
      kind: 'baseline',
      id: 'd1',
      viewId: 'v1',
      groupId: 'g1',
      slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    };
    expect(d.kind).toBe('baseline');
  });
});

describe('DrawingDimension — HS-DD-2: ordinate kind shape', () => {
  it('can construct an ordinate DrawingDimension literal', () => {
    const d: DrawingDimension = {
      kind: 'ordinate',
      id: 'd2',
      viewId: 'v1',
      groupId: 'g2',
      to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      axis: 'x',
    };
    expect(d.kind).toBe('ordinate');
  });
});

describe('DrawingDimension — HS-DD-3: angular kind (two-edges)', () => {
  it('can construct an angular DrawingDimension with two-edges ref', () => {
    const d: DrawingDimension = {
      kind: 'angular',
      id: 'd3',
      viewId: 'v1',
      ref: {
        kind: 'two-edges',
        edge1: { viewId: 'v1', edgeId: 'e1' },
        edge2: { viewId: 'v1', edgeId: 'e2' },
      },
      arcSide: 'inside',
      offsetMm: 15,
    };
    expect(d.kind).toBe('angular');
  });
});

describe('DrawingDimension — HS-DD-4: angular kind (arc)', () => {
  it('can construct an angular DrawingDimension with arc ref', () => {
    const d: DrawingDimension = {
      kind: 'angular',
      id: 'd4',
      viewId: 'v1',
      ref: { kind: 'arc', edge: { viewId: 'v1', edgeId: 'e-arc' } },
      arcSide: 'outside',
      offsetMm: 8,
    };
    expect(d.kind).toBe('angular');
  });
});
