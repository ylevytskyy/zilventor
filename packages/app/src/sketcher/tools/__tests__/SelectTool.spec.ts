import { describe, it, expect, vi } from 'vitest';
import type { SketchPrimitive } from '@zilventor/shared';
import { SelectTool } from '../SelectTool';

const line = (id: string, x1: number, y1: number, x2: number, y2: number): SketchPrimitive =>
  ({ id, kind: 'line', x1, y1, x2, y2 });

describe('SelectTool', () => {
  it('pointerClick near a line endpoint selects that endpoint', () => {
    const tool = new SelectTool();
    const prims = [line('L1', 0, 0, 10, 0)];
    tool.setPrimitives(prims);
    const ref = tool.hitTest({ x: 10.2, y: 0.1 }, 1);
    expect(ref).toEqual({ primitiveId: 'L1', anchor: 'end' });
  });

  it('pointerClick far from any endpoint returns null', () => {
    const tool = new SelectTool();
    tool.setPrimitives([line('L1', 0, 0, 10, 0)]);
    expect(tool.hitTest({ x: 100, y: 100 }, 1)).toBeNull();
  });

  it('hitTest on an ellipse returns center anchor when cursor is within tolerance', () => {
    const tool = new SelectTool();
    const ellipse: SketchPrimitive = { id: 'E1', kind: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 2, rotation: 0 };
    tool.setPrimitives([ellipse]);
    const ref = tool.hitTest({ x: 10.5, y: 20.3 }, 2);
    expect(ref).toEqual({ primitiveId: 'E1', anchor: 'center' });
  });

  it('hitTest on an ellipse returns null when cursor is far from center', () => {
    const tool = new SelectTool();
    const ellipse: SketchPrimitive = { id: 'E1', kind: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 2, rotation: 0 };
    tool.setPrimitives([ellipse]);
    expect(tool.hitTest({ x: 100, y: 100 }, 2)).toBeNull();
  });

  it('beginDrag / dragTo / endDrag invokes client in order', async () => {
    const client = {
      beginDrag: vi.fn(async () => undefined),
      dragTo:    vi.fn(async () => ({ coords: [], dof: { count: 0, state: 'fully' as const }, solverMs: 1 })),
      endDrag:   vi.fn(async () => ({ dof: { count: 0, state: 'fully' as const }, finalCoords: [] }))
    };
    const onCoords = vi.fn();
    const onDof = vi.fn();
    const tool = new SelectTool();
    tool.setPrimitives([line('L1', 0, 0, 10, 0)]);
    tool.bind({ client: client as never, onCoords, onDof });

    await tool.onPointerDown({ x: 10.1, y: 0 });
    await tool.onPointerMove({ x: 20, y: 5 });
    await tool.onPointerUp();

    expect(client.beginDrag).toHaveBeenCalledOnce();
    expect(client.dragTo).toHaveBeenCalledOnce();
    expect(client.endDrag).toHaveBeenCalledOnce();
  });
});
