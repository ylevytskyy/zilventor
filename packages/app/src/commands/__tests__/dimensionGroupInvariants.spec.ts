// packages/app/src/commands/__tests__/dimensionGroupInvariants.spec.ts
import { describe, it, expect } from 'vitest';
import { assertDimensionGroupInvariants } from '../dimensionGroupInvariants';
import type { DrawingDimension } from '@zilventor/shared';
import type { DimensionGroup } from '@zilventor/shared/src/drawing/types';

const baselineGroup: DimensionGroup = {
  kind: 'baseline', id: 'bg1', viewId: 'v1',
  datum: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  direction: 'h', baseOffsetMm: 20, spacingMm: 10,
};

const ordinateGroup: DimensionGroup = {
  kind: 'ordinate', id: 'og1', viewId: 'v1',
  origin: { kind: 'edge-endpoint', edgeId: 'e0', end: 'start' },
  xColumnOffsetMm: 30, yColumnOffsetMm: 25,
};

function validBaselineMem(id: string): DrawingDimension {
  return {
    id, kind: 'baseline', viewId: 'v1', groupId: 'bg1', slot: 0,
    to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
  } as unknown as DrawingDimension;
}

describe('assertDimensionGroupInvariants', () => {
  it('(a) passes for valid baseline group + member', () => {
    expect(() => assertDimensionGroupInvariants({
      dimensions: [validBaselineMem('bm0')],
      dimensionGroups: [baselineGroup],
    })).not.toThrow();
  });

  it('(b) throws orphaned-member when groupId not found', () => {
    const orphan: DrawingDimension = {
      id: 'bm-orphan', kind: 'baseline', viewId: 'v1', groupId: 'missing', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [orphan],
      dimensionGroups: [baselineGroup],
    })).toThrow('orphaned-member');
  });

  it('(c) throws mismatched-kind when baseline dim references ordinate group', () => {
    const badKindDim: DrawingDimension = {
      id: 'bm-bad', kind: 'baseline', viewId: 'v1', groupId: 'og1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [badKindDim],
      dimensionGroups: [ordinateGroup],
    })).toThrow('mismatched-kind');
  });

  it('(d) throws mismatched-viewId when dim.viewId differs from group.viewId', () => {
    const badViewDim: DrawingDimension = {
      id: 'bm-badview', kind: 'baseline', viewId: 'v2', groupId: 'bg1', slot: 0,
      to: { kind: 'edge-endpoint', edgeId: 'e1', end: 'end' },
    } as unknown as DrawingDimension;
    expect(() => assertDimensionGroupInvariants({
      dimensions: [badViewDim],
      dimensionGroups: [baselineGroup],
    })).toThrow('mismatched-viewId');
  });

  it('(e) non-member dim kinds (linear-h, angular) are not checked', () => {
    const linearDim: DrawingDimension = {
      id: 'lh1', kind: 'linear-h', viewId: 'v1',
      from: { kind: 'edge-endpoint', edgeId: 'e1', end: 'start' },
      to: { kind: 'edge-endpoint', edgeId: 'e2', end: 'end' },
      offsetMm: 10,
    };
    expect(() => assertDimensionGroupInvariants({
      dimensions: [linearDim],
      dimensionGroups: [],
    })).not.toThrow();
  });
});
