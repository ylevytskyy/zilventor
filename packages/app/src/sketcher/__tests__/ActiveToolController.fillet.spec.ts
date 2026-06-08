import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import { FilletTool } from '../tools/FilletTool';
import { ChamferTool } from '../tools/ChamferTool';
import type { SketchPrimitive } from '@zilventor/shared';

/**
 * Task 11 — wire FilletTool + ChamferTool into ActiveToolController.
 *
 * Geometry: two perpendicular lines meeting at the origin.
 *   lx: (0,0) → (10,0)   (corner at start: x1=0, y1=0)
 *   ly: (0,0) → (0,10)   (corner at start: x1=0, y1=0)
 *
 * computeFillet(lx, ly, radius=5):
 *   - corner at (0,0), half-angle = π/4, tanDist = 5/tan(π/4) = 5
 *   - t1 = (5,0), t2 = (0,5), center = (5,5)/√2 * cenDist ≈ (5,5)
 *   - emits 1 arc + 2 trim patches + 2 tangent + 1 dim-radius = 3 constraints
 */

const primitives: SketchPrimitive[] = [
  { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0,  y2: 10 },
];

describe('ActiveToolController — FilletTool integration (Task 11)', () => {
  it("setToolKind('fillet') instantiates a FilletTool", () => {
    const c = new ActiveToolController({
      emitPrimitive: vi.fn(),
      onPreview: vi.fn(),
      updatePrimitive: vi.fn(),
    });
    c.setToolKind('fillet');
    expect(c.currentTool()).toBeInstanceOf(FilletTool);
  });

  it("setToolKind('chamfer') instantiates a ChamferTool", () => {
    const c = new ActiveToolController({
      emitPrimitive: vi.fn(),
      onPreview: vi.fn(),
      updatePrimitive: vi.fn(),
    });
    c.setToolKind('chamfer');
    expect(c.currentTool()).toBeInstanceOf(ChamferTool);
  });

  it('fillet: two picks on corner-sharing lines → arc + 2 updatePrimitive + 3 constraints', () => {
    const emitPrimitive = vi.fn<(p: SketchPrimitive) => void>();
    const updatePrimitive = vi.fn<(id: string, patch: Partial<SketchPrimitive>) => void>();
    const emitConstraint = vi.fn();
    const onPreview = vi.fn();

    const c = new ActiveToolController({
      emitPrimitive,
      onPreview,
      updatePrimitive,
      emitConstraint,
    });

    c.setToolKind('fillet');

    // First pick: click near midpoint of lx (y=0 axis), within 5 units body distance
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    // No commit yet — still waiting for second pick
    expect(emitPrimitive).not.toHaveBeenCalled();
    expect(updatePrimitive).not.toHaveBeenCalled();

    // Second pick: click near midpoint of ly (x=0 axis)
    c.handlePointer({ type: 'click', point: { x: 0, y: 5 } }, primitives);

    // One arc emitted
    expect(emitPrimitive).toHaveBeenCalledTimes(1);
    const arc = emitPrimitive.mock.calls[0]![0];
    expect(arc.kind).toBe('arc');

    // Two trim patches (one per source line)
    expect(updatePrimitive).toHaveBeenCalledTimes(2);

    // Three constraints: tangent-lx, tangent-ly, dim-radius
    expect(emitConstraint).toHaveBeenCalledTimes(3);
    const kinds = emitConstraint.mock.calls.map((call) => call[0].kind);
    expect(kinds.filter((k: string) => k === 'tangent')).toHaveLength(2);
    expect(kinds.filter((k: string) => k === 'dim-radius')).toHaveLength(1);
  });

  it('fillet Escape resets to idle (no commit)', () => {
    const emitPrimitive = vi.fn();
    const updatePrimitive = vi.fn();
    const c = new ActiveToolController({
      emitPrimitive,
      onPreview: vi.fn(),
      updatePrimitive,
    });

    c.setToolKind('fillet');
    // First pick
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    // Escape resets
    c.handleKey('Escape');
    // Second click should NOT commit (tool is idle again, first pick cleared)
    c.handlePointer({ type: 'click', point: { x: 0, y: 5 } }, primitives);
    expect(emitPrimitive).not.toHaveBeenCalled();
    expect(updatePrimitive).not.toHaveBeenCalled();
  });
});
