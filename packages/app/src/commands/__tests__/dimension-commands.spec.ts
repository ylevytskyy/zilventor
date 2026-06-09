import { describe, it, expect, vi } from 'vitest';
import { AddDimensionCommand, AddDimensionConflictError } from '../AddDimensionCommand';
import { RemoveDimensionCommand } from '../RemoveDimensionCommand';
import { UpdateDimensionValueCommand } from '../UpdateDimensionValueCommand';
import { useAppStore } from '../../store/useAppStore';
import type { SketcherClient } from '../../sketcher/SketcherClient';

const resetStore = () =>
  useAppStore.getState().setActivePart({
    id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
    featureTree: [{ kind: 'sketch', id: 'S1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] }],
    materials: [],
    hardware: [],
  });

describe('dimension commands', () => {
  it('AddDimensionCommand.apply adds, revert removes', async () => {
    resetStore();
    const cmd = new AddDimensionCommand('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
  });

  it('RemoveDimensionCommand.apply removes, revert re-adds', async () => {
    resetStore();
    const snapshot = {
      id: 'd0', kind: 'dim-length' as const, paramName: 'd0', line: 'L1',
      value: { kind: 'literal' as const, value: 50 }
    };
    useAppStore.getState().addDimensionToActiveSketch('S1', snapshot);
    const cmd = new RemoveDimensionCommand('S1', snapshot, 50);
    await cmd.apply();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
    await cmd.revert();
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(1);
  });

  it('UpdateDimensionValueCommand.apply/revert swaps value', async () => {
    resetStore();
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100);
    await cmd.apply();
    const after = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(after).toBe(100);
    await cmd.revert();
    const reverted = (useAppStore.getState().activePart!.featureTree[0] as { constraints: Array<{ value: { value: number } }> }).constraints[0]!.value.value;
    expect(reverted).toBe(50);
  });

  it('AddDimensionCommand.apply calls sketcherClient.addDimension and throws on conflict', async () => {
    resetStore();
    const addDimension = vi.fn().mockResolvedValue({ ok: false, reason: 'conflict', offendingConstraintIds: ['existing'] });
    const removeDimension = vi.fn();
    const client = { addDimension, removeDimension } as unknown as SketcherClient;
    const cmd = new AddDimensionCommand('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'param', paramName: 'd0' }
    }, 50, client);
    await expect(cmd.apply()).rejects.toBeInstanceOf(AddDimensionConflictError);
    expect(addDimension).toHaveBeenCalledWith(expect.objectContaining({ id: 'd0' }), 50);
    expect((useAppStore.getState().activePart!.featureTree[0] as { constraints: unknown[] }).constraints).toHaveLength(0);
  });

  it('AddDimensionCommand.revert calls sketcherClient.removeDimension', async () => {
    resetStore();
    const addDimension = vi.fn().mockResolvedValue({ ok: true, dof: { count: 1, state: 'under' }, coords: [] });
    const removeDimension = vi.fn().mockResolvedValue({ dof: { count: 2, state: 'under' }, coords: [] });
    const client = { addDimension, removeDimension } as unknown as SketcherClient;
    const cmd = new AddDimensionCommand('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'param', paramName: 'd0' }
    }, 50, client);
    await cmd.apply();
    await cmd.revert();
    expect(removeDimension).toHaveBeenCalledWith('d0');
  });

  it('UpdateDimensionValueCommand.apply/revert call sketcherClient.updateDimensionValue with each value', async () => {
    resetStore();
    useAppStore.getState().addDimensionToActiveSketch('S1', {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    });
    const updateDimensionValue = vi.fn().mockResolvedValue({ dof: { count: 1, state: 'under' }, coords: [] });
    const client = { updateDimensionValue } as unknown as SketcherClient;
    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100, client);
    await cmd.apply();
    expect(updateDimensionValue).toHaveBeenLastCalledWith('d0', 100);
    await cmd.revert();
    expect(updateDimensionValue).toHaveBeenLastCalledWith('d0', 50);
  });

  it('UpdateDimensionValueCommand.apply patches store primitives with coords from client', async () => {
    // Arrange: sketch with a line at x1=0,y1=0 → x2=50,y2=0
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [{
        kind: 'sketch', id: 'S1',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 50, y2: 0 }],
        constraints: [{ id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'l1', value: { kind: 'literal', value: 50 } }]
      }],
      materials: [], hardware: [],
    });
    const coordsResult = { dof: { count: 0, state: 'solved' as const }, coords: [{ primitiveId: 'l1', patch: { x2: 100, y2: 0 } }] };
    const updateDimensionValue = vi.fn().mockResolvedValue(coordsResult);
    const client = { updateDimensionValue } as unknown as SketcherClient;

    // Act
    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100, client);
    await cmd.apply();

    // Assert: store primitive l1 must have x2=100 (driven by the returned coords, not hand-authored)
    const sketch = useAppStore.getState().activePart!.featureTree[0] as { primitives: Array<{ id: string; x2: number }> };
    expect(sketch.primitives.find((p) => p.id === 'l1')!.x2).toBe(100);
    // And dof was set
    expect(useAppStore.getState().sketchDof).toEqual(coordsResult.dof);
  });

  it('UpdateDimensionValueCommand.revert patches store primitives with before-coords from client', async () => {
    useAppStore.getState().setActivePart({
      id: 'P1', name: 'P', units: 'mm', parameters: {}, properties: {},
      featureTree: [{
        kind: 'sketch', id: 'S1',
        plane: { source: 'workPlane', featureId: 'origin.XY' },
        primitives: [{ id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
        constraints: [{ id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'l1', value: { kind: 'literal', value: 100 } }]
      }],
      materials: [], hardware: [],
    });
    // On revert the client is called with `before` (50) and returns a diff moving l1.x2 back to 50
    const revertCoordsResult = { dof: { count: 1, state: 'under' as const }, coords: [{ primitiveId: 'l1', patch: { x2: 50, y2: 0 } }] };
    const updateDimensionValue = vi.fn().mockResolvedValue(revertCoordsResult);
    const client = { updateDimensionValue } as unknown as SketcherClient;

    const cmd = new UpdateDimensionValueCommand('S1', 'd0', 50, 100, client);
    // First apply (mock returns a different diff — not important for this revert test)
    updateDimensionValue.mockResolvedValueOnce({ dof: { count: 0, state: 'solved' as const }, coords: [] });
    await cmd.apply();
    // Now revert
    updateDimensionValue.mockResolvedValueOnce(revertCoordsResult);
    await cmd.revert();

    const sketch = useAppStore.getState().activePart!.featureTree[0] as { primitives: Array<{ id: string; x2: number }> };
    expect(sketch.primitives.find((p) => p.id === 'l1')!.x2).toBe(50);
    expect(useAppStore.getState().sketchDof).toEqual(revertCoordsResult.dof);
  });

});