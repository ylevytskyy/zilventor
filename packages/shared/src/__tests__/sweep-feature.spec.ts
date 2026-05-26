import { describe, it, expect } from 'vitest';
import type { Feature, SweepFeature, BooleanOperation } from '../types';

describe('SweepFeature', () => {
  it('accepts path orientation + new operation', () => {
    const f: SweepFeature = {
      id: 'SW1', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'path' },
      operation: 'new',
    };
    const u: Feature = f;
    expect(u.kind).toBe('sweep');
  });

  it('accepts parallel orientation + join operation', () => {
    const f: SweepFeature = {
      id: 'SW2', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'parallel' },
      operation: 'join',
    };
    expect(f.orientation.kind).toBe('parallel');
  });

  it('accepts guideRail orientation with a third sketch + cut operation', () => {
    const f: SweepFeature = {
      id: 'SW3', kind: 'sweep',
      profileSketchId: 'S1', pathSketchId: 'S2',
      orientation: { kind: 'guideRail', guideRailSketchId: 'S3' },
      operation: 'cut',
    };
    if (f.orientation.kind === 'guideRail') {
      expect(f.orientation.guideRailSketchId).toBe('S3');
    }
  });

  it('all three boolean operations are valid', () => {
    const ops: BooleanOperation[] = ['new', 'join', 'cut'];
    expect(ops).toHaveLength(3);
  });
});
