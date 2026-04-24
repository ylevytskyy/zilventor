import { describe, it, expect } from 'vitest';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GcsSystem dimensions (integration)', () => {
  it('dim-length forces the line to exactly that length', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    };
    const r = await sys.addDimension(dim, 50);
    expect(r.ok).toBe(true);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 50)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('updateDimensionValue changes the length', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    await sys.updateDimensionValue('d0', 100);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 100)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('removeDimension restores DOF', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const before = sys.currentDof();
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    await sys.removeDimension('d0');
    const after = sys.currentDof();
    expect(after.count).toBe(before.count);
    await sys.unloadSketch();
  });

  it('conflicting length (L1=50 + L1=60) returns ok:false conflict', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    const r = await sys.addDimension({
      id: 'd1', kind: 'dim-length', paramName: 'd1', line: 'L1',
      value: { kind: 'literal', value: 60 }
    }, 60);
    expect(r.ok).toBe(false);
    await sys.unloadSketch();
  });

  it('rebuildGcs preserves param-kind dim value via the resolved-value sidecar', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-length', paramName: 'width', line: 'L1',
      value: { kind: 'param', paramName: 'width' }
    };
    await sys.addDimension(dim, 50);
    await sys.addPrimitive(line('L2', 100, 100, 110, 100));
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    // Regression: before the fix, rebuildGcs fed 0 for param-kind and the line
    // collapsed to length 0. The sidecar now keeps 50 alive across the rebuild.
    expect(Math.abs(len - 50)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('updateDimensionValue drives geometry without discarding the param binding', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 10, 0)], constraints: [] });
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-length', paramName: 'width', line: 'L1',
      value: { kind: 'param', paramName: 'width' }
    };
    await sys.addDimension(dim, 50);
    await sys.updateDimensionValue('d0', 100);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 100)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('loadSketch uses dimensionResolvedValues for param-kind dims', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-length', paramName: 'width', line: 'L1',
      value: { kind: 'param', paramName: 'width' }
    };
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 10, 0)],
      constraints: [dim],
      dimensionResolvedValues: { d0: 75 }
    });
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 75)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });

  it('dim-length coexists with a horizontal constraint on the same line', async () => {
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({
      primitives: [line('L1', 0, 0, 22, 0)],
      constraints: [{ id: 'h0', kind: 'horizontal', line: 'L1' }]
    });
    const r = await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);
    expect(r.ok).toBe(true);
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 50)).toBeLessThan(1e-3);
    await sys.unloadSketch();
  });
});
