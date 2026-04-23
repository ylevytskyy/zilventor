import { describe, it, expect, vi } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { ConstraintTool } from '../ConstraintTool';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('ConstraintTool', () => {
  it('H/V need one primitive click', async () => {
    const emit = vi.fn();
    const tool = new ConstraintTool({ kind: 'horizontal', onCommit: emit });
    tool.setPrimitives([line('L1', 0, 0, 10, 5)]);
    await tool.onPointerClick({ x: 5, y: 2.5 });
    expect(emit).toHaveBeenCalledOnce();
    const c = emit.mock.calls[0]![0];
    expect(c.kind).toBe('horizontal');
    expect(c.line).toBe('L1');
  });

  it('parallel/perpendicular/equal/tangent need two primitives', async () => {
    const emit = vi.fn();
    const tool = new ConstraintTool({ kind: 'parallel', onCommit: emit });
    tool.setPrimitives([line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 6)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    expect(emit).not.toHaveBeenCalled();
    await tool.onPointerClick({ x: 5, y: 5.5 });
    expect(emit).toHaveBeenCalledOnce();
    const c = emit.mock.calls[0]![0];
    expect(c.kind).toBe('parallel');
    expect(c.line1).toBe('L1');
    expect(c.line2).toBe('L2');
  });

  it('coincident takes two endpoints', async () => {
    const emit = vi.fn();
    const tool = new ConstraintTool({ kind: 'coincident', onCommit: emit });
    tool.setPrimitives([line('L1', 0, 0, 10, 0), line('L2', 10, 0, 20, 0)]);
    await tool.onPointerClick({ x: 10, y: 0 });
    await tool.onPointerClick({ x: 10, y: 0 });
    expect(emit).toHaveBeenCalledOnce();
    const c = emit.mock.calls[0]![0];
    expect(c.kind).toBe('coincident');
  });

  it('symmetric needs 3 clicks', async () => {
    const emit = vi.fn();
    const tool = new ConstraintTool({ kind: 'symmetric', onCommit: emit });
    tool.setPrimitives([
      line('L1', 0, 0, 10, 0),
      line('L2', 20, 0, 30, 0),
      line('AXIS', 15, -5, 15, 5)
    ]);
    await tool.onPointerClick({ x: 10, y: 0 });
    await tool.onPointerClick({ x: 20, y: 0 });
    expect(emit).not.toHaveBeenCalled();
    await tool.onPointerClick({ x: 15, y: 0 });
    expect(emit).toHaveBeenCalledOnce();
    const c = emit.mock.calls[0]![0];
    expect(c.kind).toBe('symmetric');
    expect(c.axis).toBe('AXIS');
  });

  it('escapePressed resets the state machine', async () => {
    const emit = vi.fn();
    const tool = new ConstraintTool({ kind: 'parallel', onCommit: emit });
    tool.setPrimitives([line('L1', 0, 0, 10, 0), line('L2', 0, 5, 10, 6)]);
    await tool.onPointerClick({ x: 5, y: 0 });
    tool.onEscapePressed();
    await tool.onPointerClick({ x: 5, y: 5.5 });
    expect(emit).not.toHaveBeenCalled();
  });
});
