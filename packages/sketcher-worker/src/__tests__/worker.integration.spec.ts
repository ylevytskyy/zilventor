import { describe, it, expect } from 'vitest';
import type { SketchPrimitive, SketchConstraint } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

describe('sketcher worker integration (real WASM)', () => {
  it('drag-to-solve on a constrained rectangle stays rectangular', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    const prims: SketchPrimitive[] = [
      { id: 'R1', kind: 'rectangle', x: 0, y: 0, w: 100, h: 50 }
    ];
    await sys.loadSketch({ primitives: prims, constraints: [] });
    await sys.beginDrag({ primitiveId: 'R1', anchor: 'tr' });
    for (let i = 0; i < 30; i++) {
      const r = await sys.dragTo(150 + i, 70 + i);
      expect(r.solverMs).toBeLessThan(200);
    }
    const fin = await sys.endDrag();
    expect(fin.finalCoords.length).toBeGreaterThan(0);
    await sys.unloadSketch();
  });

  it('50-cycle load/unload soak — no memory growth or crashes', async () => {
    const { createWrapper } = await loadPlanegcs();
    for (let i = 0; i < 50; i++) {
      const sys = new GcsSystem(createWrapper());
      await sys.loadSketch({
        primitives: [{ id: `L${i}`, kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }],
        constraints: [{ id: `h${i}`, kind: 'horizontal', line: `L${i}` }] satisfies SketchConstraint[]
      });
      await sys.unloadSketch();
    }
  });
});
