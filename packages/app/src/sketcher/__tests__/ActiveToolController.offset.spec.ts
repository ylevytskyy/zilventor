import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import { OffsetTool } from '../tools/OffsetTool';
import type { SketchPrimitive } from '@zilventor/shared';

describe('ActiveToolController — OffsetTool integration (Task 7)', () => {
  it("setToolKind('offset') instantiates an OffsetTool", () => {
    const c = new ActiveToolController({ emitPrimitive: vi.fn(), onPreview: vi.fn() });
    c.setToolKind('offset');
    expect(c.currentTool()).toBeInstanceOf(OffsetTool);
  });

  it('pick → move → click-commit emits a line offset by ~4 units', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });

    const primitives: SketchPrimitive[] = [
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ];

    c.setToolKind('offset');

    // First click: pick the line near its midpoint
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    // No commit yet — still in 'picked' state
    expect(emit).not.toHaveBeenCalled();

    // Move cursor to offset side (y=4)
    c.handlePointer({ type: 'move', point: { x: 5, y: 4 } }, primitives);
    // Preview should have fired
    expect(onPreview).toHaveBeenCalled();

    // Second click: commit
    c.handlePointer({ type: 'click', point: { x: 5, y: 4 } }, primitives);
    expect(emit).toHaveBeenCalledTimes(1);

    const committed = emit.mock.calls[0]![0];
    expect(committed.kind).toBe('line');
    if (committed.kind === 'line') {
      // The offset line should be shifted ~4 units in y
      expect(committed.y1).toBeCloseTo(4, 1);
      expect(committed.y2).toBeCloseTo(4, 1);
    }
  });

  it('Escape after picking resets to idle (no commit)', () => {
    const emit = vi.fn();
    const primitives: SketchPrimitive[] = [
      { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    ];
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview: vi.fn() });
    c.setToolKind('offset');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, primitives);
    c.handleKey('Escape');
    // After escape, a second click should NOT commit (tool is idle again)
    c.handlePointer({ type: 'click', point: { x: 5, y: 4 } }, primitives);
    expect(emit).not.toHaveBeenCalled();
  });

  it('numericFieldCount() returns 1 when offset tool is active', () => {
    const c = new ActiveToolController({ emitPrimitive: vi.fn(), onPreview: vi.fn() });
    c.setToolKind('offset');
    expect(c.numericFieldCount()).toBe(1);
  });

  it('getAnchor() returns null for OffsetTool', () => {
    const c = new ActiveToolController({ emitPrimitive: vi.fn(), onPreview: vi.fn() });
    c.setToolKind('offset');
    expect(c.getAnchor()).toBeNull();
  });
});
