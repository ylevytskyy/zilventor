import { describe, it, expect, vi } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { UpdatePrimitiveCommand } from '../UpdatePrimitiveCommand';
import { useAppStore } from '../../store/useAppStore';

const makePart = (primitives: SketchPrimitive[]) => ({
  id: 'P1', name: 'Part1', units: 'mm' as const, parameters: {}, properties: {},
  featureTree: [{
    kind: 'sketch' as const, id: 'S1',
    plane: { source: 'workPlane' as const, featureId: 'origin.XY' },
    constraints: [], primitives,
  }],
  materials: [],
  hardware: [],
});

describe('UpdatePrimitiveCommand', () => {
  it('apply patches a line endpoint; revert restores it', async () => {
    const line: SketchPrimitive = { id: 'L1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    useAppStore.getState().setActivePart(makePart([line]));

    const cmd = new UpdatePrimitiveCommand({
      sketchId: 'S1',
      id: 'L1',
      patch: { x1: 2, y1: 0 },
    });

    await cmd.apply();
    const afterApply = useAppStore.getState().activePart!;
    const sketch = afterApply.featureTree[0];
    if (sketch.kind !== 'sketch') throw new Error('not sketch');
    const prim = sketch.primitives[0];
    if (prim.kind !== 'line') throw new Error('not line');
    expect(prim.x1).toBeCloseTo(2, 6);
    expect(prim.y1).toBeCloseTo(0, 6);
    // unchanged fields survive
    expect(prim.x2).toBeCloseTo(10, 6);

    await cmd.revert();
    const afterRevert = useAppStore.getState().activePart!;
    const sketch2 = afterRevert.featureTree[0];
    if (sketch2.kind !== 'sketch') throw new Error('not sketch');
    const prim2 = sketch2.primitives[0];
    if (prim2.kind !== 'line') throw new Error('not line');
    expect(prim2.x1).toBeCloseTo(0, 6);
    expect(prim2.y1).toBeCloseTo(0, 6);
  });

  it('calls sketcherClient.updatePrimitive on apply and revert when provided', async () => {
    const line: SketchPrimitive = { id: 'L2', kind: 'line', x1: 0, y1: 0, x2: 5, y2: 0 };
    useAppStore.getState().setActivePart(makePart([line]));

    const mockUpdatePrimitive = vi.fn().mockResolvedValue({ dof: 'unknown' });
    const sketcherClient = { updatePrimitive: mockUpdatePrimitive } as any;

    const cmd = new UpdatePrimitiveCommand({
      sketchId: 'S1',
      id: 'L2',
      patch: { x1: 1 },
      sketcherClient,
    });

    await cmd.apply();
    expect(mockUpdatePrimitive).toHaveBeenCalledOnce();
    expect(mockUpdatePrimitive).toHaveBeenCalledWith('L2', { x1: 1 });

    await cmd.revert();
    // called again on revert (with the prior values)
    expect(mockUpdatePrimitive).toHaveBeenCalledTimes(2);
  });

  it('no-ops gracefully when activePart is null', async () => {
    useAppStore.getState().setActivePart(null);
    const cmd = new UpdatePrimitiveCommand({
      sketchId: 'S1',
      id: 'L1',
      patch: { x1: 99 },
    });
    // must not throw
    await expect(cmd.apply()).resolves.toBeUndefined();
    await expect(cmd.revert()).resolves.toBeUndefined();
  });
});
