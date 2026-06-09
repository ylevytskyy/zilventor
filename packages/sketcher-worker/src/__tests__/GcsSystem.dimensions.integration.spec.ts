import { describe, it, expect } from 'vitest';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';
import { GcsSystem } from '../GcsSystem';
import { loadPlanegcs } from '../planegcsLoader';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

const circle = (id: string, cx: number, cy: number, r: number): SketchPrimitive =>
  ({ id, kind: 'circle', cx, cy, r });

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

  it('updateDimensionValue on dim-radius emits r patch for the circle (regression: radius readback from GCS)', async () => {
    // Regression: before fix in readDomainPrimitive, circle/arc only read back cx/cy from
    // solved GCS points; the solved radius was never fetched from the GCS primitive object.
    // So a dim-radius update would solve correctly inside planegcs but the returned
    // coords diff contained no `r` patch — the app never knew the radius changed.
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [circle('C1', 0, 0, 10)], constraints: [] });
    const dim: DimensionConstraint = {
      id: 'd0', kind: 'dim-radius', paramName: 'd0', circle: 'C1',
      value: { kind: 'literal', value: 10 }
    };
    const addResult = await sys.addDimension(dim, 10);
    expect(addResult.ok).toBe(true);

    const { coords } = await sys.updateDimensionValue('d0', 25);

    const diff = coords.find(d => d.primitiveId === 'C1');
    expect(diff).toBeDefined();
    // patch.r must be present and equal to the new radius (~25)
    expect((diff!.patch as { r?: number }).r).toBeCloseTo(25, 3);

    await sys.unloadSketch();
  });

  it('updateDimensionValue emits a non-empty coord diff when reverting a dim to its original value (revert path)', async () => {
    // Regression: before the syncDomainFromGcs() fix in updateDimensionValue, the domain
    // baseline was never advanced after each call. When you edited a dim to a new value
    // (e.g. 50→80) then reverted back to the original (80→50), the second call found
    // GCS state == domainPrimitives (both at the load-time position) and coordDiffForAll
    // returned an EMPTY diff. The Zustand store then kept the stale intermediate geometry
    // (length=80) because no patch arrived to move it back to 50.
    // Fix: capture coords, then call syncDomainFromGcs() before returning so the baseline
    // advances after every call — matching addDimension and dragTo.
    const { createWrapper } = await loadPlanegcs();
    const sys = new GcsSystem(createWrapper());
    await sys.loadSketch({ primitives: [line('L1', 0, 0, 50, 0)], constraints: [] });
    await sys.addDimension({
      id: 'd0', kind: 'dim-length', paramName: 'd0', line: 'L1',
      value: { kind: 'literal', value: 50 }
    }, 50);

    // First edit: 50 → 80 (sanity check — must produce a non-empty diff)
    const first = await sys.updateDimensionValue('d0', 80);
    expect(first.coords.length).toBeGreaterThan(0);
    const firstDiff = first.coords.find(d => d.primitiveId === 'L1');
    expect(firstDiff).toBeDefined();

    // Second edit: 80 → 50 (revert to original value). Without syncDomainFromGcs this
    // returns an empty diff because GCS state matches the stale load-time baseline.
    const second = await sys.updateDimensionValue('d0', 50);
    expect(second.coords.length).toBeGreaterThan(0);
    const secondDiff = second.coords.find(d => d.primitiveId === 'L1');
    expect(secondDiff).toBeDefined();

    // The geometry must actually reflect length 50 again.
    const coords = sys.readCoords('L1');
    const len = Math.hypot(coords.x2 - coords.x1, coords.y2 - coords.y1);
    expect(Math.abs(len - 50)).toBeLessThan(1e-3);

    await sys.unloadSketch();
  });
});
