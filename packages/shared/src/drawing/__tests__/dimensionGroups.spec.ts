// packages/shared/src/drawing/__tests__/dimensionGroups.spec.ts
import { describe, it, expect } from 'vitest';
import type { DimensionGroup } from '../types';

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
