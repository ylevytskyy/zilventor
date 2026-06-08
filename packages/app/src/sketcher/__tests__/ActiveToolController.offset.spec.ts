import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import { OffsetTool } from '../tools/OffsetTool';
import type { SketchPrimitive } from '@zilventor/shared';

// FIX 1 (S1): construction-mode stamp for offset/fillet/chamfer
describe('ActiveToolController — construction mode stamp for offset/fillet/chamfer (S1)', () => {
  const linePrimitives: SketchPrimitive[] = [
    { id: 'l1', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
  ];

  it('offset: emitted primitive has construction===true when isConstructionMode returns true', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const c = new ActiveToolController({
      emitPrimitive: emit,
      onPreview: vi.fn(),
      isConstructionMode: () => true,
    });
    c.setToolKind('offset');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, linePrimitives);   // pick
    c.handlePointer({ type: 'move',  point: { x: 5, y: 4 } }, linePrimitives);   // set side
    c.handlePointer({ type: 'click', point: { x: 5, y: 4 } }, linePrimitives);   // commit
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].construction).toBe(true);
  });

  it('offset: emitted primitive has no construction flag when isConstructionMode returns false', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const c = new ActiveToolController({
      emitPrimitive: emit,
      onPreview: vi.fn(),
      isConstructionMode: () => false,
    });
    c.setToolKind('offset');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, linePrimitives);
    c.handlePointer({ type: 'move',  point: { x: 5, y: 4 } }, linePrimitives);
    c.handlePointer({ type: 'click', point: { x: 5, y: 4 } }, linePrimitives);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].construction).toBeFalsy();
  });

  const cornerPrimitives: SketchPrimitive[] = [
    { id: 'lx', kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'ly', kind: 'line', x1: 0, y1: 0, x2: 0,  y2: 10 },
  ];

  it('fillet: emitted arc has construction===true when isConstructionMode returns true', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const c = new ActiveToolController({
      emitPrimitive: emit,
      onPreview: vi.fn(),
      updatePrimitive: vi.fn(),
      emitConstraint: vi.fn(),
      isConstructionMode: () => true,
    });
    c.setToolKind('fillet');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, cornerPrimitives); // pick lx
    c.handlePointer({ type: 'click', point: { x: 0, y: 5 } }, cornerPrimitives); // pick ly → commit
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('arc');
    expect(emit.mock.calls[0]![0].construction).toBe(true);
  });

  it('chamfer: emitted line has construction===true when isConstructionMode returns true', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const c = new ActiveToolController({
      emitPrimitive: emit,
      onPreview: vi.fn(),
      updatePrimitive: vi.fn(),
      emitConstraint: vi.fn(),
      isConstructionMode: () => true,
    });
    c.setToolKind('chamfer');
    c.handlePointer({ type: 'click', point: { x: 5, y: 0 } }, cornerPrimitives); // pick lx
    c.handlePointer({ type: 'click', point: { x: 0, y: 5 } }, cornerPrimitives); // pick ly → commit
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('line');
    expect(emit.mock.calls[0]![0].construction).toBe(true);
  });
});

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
