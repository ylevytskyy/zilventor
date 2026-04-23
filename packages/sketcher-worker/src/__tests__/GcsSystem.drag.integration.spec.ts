import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem drag bracket integration', () => {
  it('dragging one endpoint of an H-constrained line keeps y1 == y2', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 10, 0)],
      constraints: [{ id: 'c1', kind: 'horizontal', line: 'L1' }]
    });
    await sys.beginDrag({ primitiveId: 'L1', anchor: 'end' });
    const r = await sys.dragTo(50, 20);
    expect(r.coords.length).toBeGreaterThanOrEqual(1);
    const final = sys.readCoords('L1');
    expect(Math.abs(final.y1 - final.y2)).toBeLessThan(1e-4);   // still horizontal
    expect(Math.abs(final.x2 - 50)).toBeLessThan(0.5);
    await sys.endDrag();
    await sys.unloadSketch();
  });

  it('dragTo outside a drag bracket throws', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await expect(sys.dragTo(5, 5)).rejects.toThrow(/no active drag/i);
    await sys.unloadSketch();
  });

  it('endDrag returns finalCoords', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.beginDrag({ primitiveId: 'L1', anchor: 'end' });
    await sys.dragTo(30, 30);
    const r = await sys.endDrag();
    expect(r.finalCoords.length).toBeGreaterThanOrEqual(1);
    expect(r.dof.count).toBeGreaterThan(0);   // unconstrained line still under
    await sys.unloadSketch();
  });
});
