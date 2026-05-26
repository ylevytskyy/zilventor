import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const makeLine = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem lifecycle (integration)', () => {
  it('loadSketch on empty input gives dof 0 fully-constrained', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    const { dof } = await sys.loadSketch({ primitives: [], constraints: [] });
    expect(dof).toEqual({ count: 0, state: 'fully' });
    await sys.unloadSketch();
  });

  it('loadSketch with one unconstrained line yields dof 4 (two free points)', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    const { dof } = await sys.loadSketch({ primitives: [makeLine('L1', 0, 0, 10, 0)], constraints: [] });
    expect(dof.count).toBe(4);
    expect(dof.state).toBe('under');
    await sys.unloadSketch();
  });

  it('unloadSketch releases WASM resources', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [makeLine('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.unloadSketch();
    // calling unload twice must be safe
    await sys.unloadSketch();
  });

  it('loadSketch rejects a second call without unloadSketch first', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [], constraints: [] });
    await expect(sys.loadSketch({ primitives: [], constraints: [] }))
      .rejects.toThrow(/already loaded/i);
    await sys.unloadSketch();
  });
});
