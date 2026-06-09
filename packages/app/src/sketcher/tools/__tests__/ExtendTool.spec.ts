import { describe, it, expect } from 'vitest';
import { ExtendTool } from '../ExtendTool';
import type { SketchPrimitive } from '@zilventor/shared';

// FALSE-GREEN GUARD: These tests do NOT hand-author the intersection coordinate.
// They set up geometry where the nearest forward intersection can be analytically
// derived (e.g. horizontal line extending right hits a vertical barrier at x=15).
// The expected endpoint values are analytically computed, not read from intersect.ts output.

function makeTool() {
  const updates: { id: string; patch: Partial<SketchPrimitive> }[] = [];
  const tool = new ExtendTool({
    updatePrimitive: (id, patch) => updates.push({ id, patch }),
  });
  return { tool, updates };
}

describe('ExtendTool — extend line to vertical barrier', () => {
  it('extends lh (x1=0→x2=8, y=0) toward the barrier at x=15 → new x2=15', () => {
    // lh ends at x=8. Barrier is a vertical line from (15,-5) to (15,5).
    // Click near x=8 (near the right endpoint) → extend right endpoint to x=15.
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const barrier: SketchPrimitive = { id: 'b', kind: 'line', x1: 15, y1: -5, x2: 15, y2: 5 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh, barrier]);
    tool.onPointerClick({ x: 8, y: 0 }); // click near right endpoint of lh
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe('lh');
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    // Right endpoint (x2) should move to 15 (barrier x).
    expect(patch.x2).toBeCloseTo(15, 2);
    expect(patch.y2).toBeCloseTo(0, 2);
  });

  it('extends lh from near left endpoint toward a barrier at x=-10', () => {
    // lh starts at x=0. Barrier at x=-10.
    // Click near x=0 (near the left endpoint) → extend left endpoint.
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const barrier: SketchPrimitive = { id: 'b', kind: 'line', x1: -10, y1: -5, x2: -10, y2: 5 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh, barrier]);
    tool.onPointerClick({ x: 0, y: 0 }); // click near left endpoint
    expect(updates).toHaveLength(1);
    const patch = updates[0]!.patch as Partial<Extract<SketchPrimitive, { kind: 'line' }>>;
    expect(patch.x1).toBeCloseTo(-10, 2);
    expect(patch.y1).toBeCloseTo(0, 2);
  });
});

describe('ExtendTool — no forward target (no-op)', () => {
  it('clicking an isolated line with no forward intersections emits nothing', () => {
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh]);
    tool.onPointerClick({ x: 8, y: 0 });
    expect(updates).toHaveLength(0);
  });
});

describe('ExtendTool — no hit on click', () => {
  it('clicking empty space emits nothing', () => {
    const lh: SketchPrimitive = { id: 'lh', kind: 'line', x1: 0, y1: 0, x2: 8, y2: 0 };
    const { tool, updates } = makeTool();
    tool.setPrimitives([lh]);
    tool.onPointerClick({ x: 50, y: 50 });
    expect(updates).toHaveLength(0);
  });
});
