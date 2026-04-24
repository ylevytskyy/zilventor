import { describe, it, expect, vi } from 'vitest';
import type { SketchPrimitive, DimensionConstraint } from '@zilventor/shared';
import { GeneralDimensionTool } from '../GeneralDimensionTool';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('GeneralDimensionTool', () => {
  it('one line click → dim-length', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    tool.setPrimitives([line('L1', 0, 0, 10, 0)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    expect(onReady).toHaveBeenCalledOnce();
    const [d] = onReady.mock.calls[0]!;
    expect((d as DimensionConstraint).kind).toBe('dim-length');
  });

  it('two line clicks (different lines) → dim-angle', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    tool.setPrimitives([line('L1', 0, 0, 10, 0), line('L2', 0, 0, 0, 10)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    await tool.onPointerClick({ x: 0, y: 5 });
    const [d] = onReady.mock.calls[onReady.mock.calls.length - 1]!;
    expect((d as DimensionConstraint).kind).toBe('dim-angle');
  });

  it('one circle click → dim-radius; second click same circle → dim-diameter', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    const circle: SketchPrimitive = { id: 'C1', kind: 'circle', cx: 0, cy: 0, r: 10 };
    tool.setPrimitives([circle]);
    await tool.onPointerClick({ x: 10, y: 0 });
    expect((onReady.mock.calls[0]![0] as DimensionConstraint).kind).toBe('dim-radius');
    await tool.onPointerClick({ x: 10, y: 0 });
    const last = onReady.mock.calls[onReady.mock.calls.length - 1]![0] as DimensionConstraint;
    expect(last.kind).toBe('dim-diameter');
  });

  it('point + line click produces dim-point-line-distance with the computed perpendicular distance', async () => {
    const onReady = vi.fn();
    const tool = new GeneralDimensionTool({ onDimensionReady: onReady });
    // Horizontal line L1 at y=0, plus L2 whose start endpoint sits 7 units above it.
    tool.setPrimitives([line('L1', 0, 0, 100, 0), line('L2', 50, 7, 60, 9)]);
    // Click L2's start endpoint (within 1 world-unit hit radius).
    await tool.onPointerClick({ x: 50, y: 7 });
    // Click L1's body.
    await tool.onPointerClick({ x: 80, y: 0 });
    const [d] = onReady.mock.calls[onReady.mock.calls.length - 1]!;
    const dim = d as Extract<DimensionConstraint, { kind: 'dim-point-line-distance' }>;
    expect(dim.kind).toBe('dim-point-line-distance');
    expect(dim.value.kind).toBe('literal');
    if (dim.value.kind === 'literal') {
      expect(Math.abs(dim.value.value - 7)).toBeLessThan(1e-6);
    }
  });
});
