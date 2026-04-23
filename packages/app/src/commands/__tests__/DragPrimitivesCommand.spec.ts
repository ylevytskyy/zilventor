import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { DragPrimitivesCommand } from '../DragPrimitivesCommand';
import { useAppStore } from '../../store/useAppStore';

describe('DragPrimitivesCommand', () => {
  it('apply writes "after" snapshot; revert restores "before"', async () => {
    const before: Record<string, Partial<SketchPrimitive>> = { L1: { x2: 10, y2: 0 } };
    const after:  Record<string, Partial<SketchPrimitive>> = { L1: { x2: 50, y2: 30 } };
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'Part1', units: 'mm', parameters: {},
      featureTree: [{
        kind: 'sketch', id: 'S1', plane: 'XY', constraints: [],
        primitives: [{ id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }]
      }]
    });
    const cmd = new DragPrimitivesCommand('S1', before, after);
    await cmd.apply();
    const prims1 = (useAppStore.getState().activePart!.featureTree[0] as { primitives: SketchPrimitive[] }).primitives;
    expect((prims1[0] as { x2: number }).x2).toBe(50);
    await cmd.revert();
    const prims2 = (useAppStore.getState().activePart!.featureTree[0] as { primitives: SketchPrimitive[] }).primitives;
    expect((prims2[0] as { x2: number }).x2).toBe(10);
  });
});
