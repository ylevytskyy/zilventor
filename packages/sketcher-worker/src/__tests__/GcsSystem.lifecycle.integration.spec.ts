import { describe, it, expect } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const makeLine = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem lifecycle (integration)', () => {
  it('decomposes an ellipse into 5 solver points (center + 4 axis endpoints)', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    // loadSketch calls pushPrimitiveDecomposition internally
    await sys.loadSketch({
      primitives: [
        { id: 'el1', kind: 'ellipse', cx: 4, cy: 5, rx: 6, ry: 2, rotation: 0 } as SketchPrimitive,
      ],
      constraints: [],
    });
    // DOF: 5 points × 2 coords = 10 degrees of freedom (all free, no constraints)
    expect(sys.currentDof().count).toBe(10);
    await sys.unloadSketch();
  });

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

  it('decomposes and reads back a point primitive', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    // A single unconstrained point has 2 DOF (x and y are free).
    const { dof } = await sys.loadSketch({
      primitives: [{ id: 'pt1', kind: 'point', x: 2, y: 3 } as SketchPrimitive],
      constraints: [],
    });
    expect(dof.count).toBe(2);
    expect(dof.state).toBe('under');
    // addPrimitive exercises readDomainPrimitive (via rebuildGcs + coordDiffForAll)
    // without throwing, confirming the readback switch handles 'point'.
    await sys.addPrimitive({ id: 'pt2', kind: 'point', x: 5, y: 7 } as SketchPrimitive);
    expect(sys.currentDof().count).toBe(4); // two free points → 4 DOF
    await sys.unloadSketch();
  });

  it('point readback returns correct solved coordinates after drag (not just original)', async () => {
    // This test guards that readDomainPrimitive's 'point' branch correctly reads
    // the solved x/y from the GCS via the 'self' key in decomp.pointIds.
    // If the key lookup silently falls through and returns `original`, the drag
    // result finalCoords would be empty (no diff) — the test would FAIL.
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [{ id: 'pt1', kind: 'point', x: 2, y: 3 } as SketchPrimitive],
      constraints: [],
    });

    // beginDrag resolves the point via decomp.pointIds['self']; the internal 'self'
    // key is only accessible by casting since PointRef's public anchor union doesn't
    // include it — this is intentional (point primitives are DXF-import-only).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await sys.beginDrag({ primitiveId: 'pt1', anchor: 'self' } as any);
    await sys.dragTo(10, 20);
    const { finalCoords } = await sys.endDrag();

    // finalCoords diffs against load-time baseline — must contain pt1's patch.
    const patch = finalCoords.find(d => d.primitiveId === 'pt1');
    expect(patch).toBeDefined();
    // The solved position must be close to where we dragged.
    expect((patch!.patch as { x?: number }).x).toBeCloseTo(10, 1);
    expect((patch!.patch as { y?: number }).y).toBeCloseTo(20, 1);

    await sys.unloadSketch();
  });
});
