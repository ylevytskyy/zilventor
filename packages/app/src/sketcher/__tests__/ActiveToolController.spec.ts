import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import type { SketchPrimitive } from '@zilventor/shared';

describe('ActiveToolController', () => {
  it('does nothing without an active tool', () => {
    const emit = vi.fn();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    expect(emit).not.toHaveBeenCalled();
  });

  it('routes pointer events to the active tool and commits a line', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'click', point: { x: 100, y: 0 } }, []);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('line');
  });

  it('switching tool mid-draw aborts the prior tool', () => {
    const emit = vi.fn();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []); // first click of line
    c.setToolKind('rect'); // abort line, switch to rect
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'click', point: { x: 10, y: 10 } }, []);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('rectangle');
  });

  it('setToolKind(null) clears the tool', () => {
    const emit = vi.fn();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.setToolKind(null);
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    expect(emit).not.toHaveBeenCalled();
    expect(c.getAnchor()).toBeNull();
  });

  it('handleKey("Enter") on spline with points commits the spline', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('spline');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'click', point: { x: 10, y: 10 } }, []);
    c.handleKey('Enter');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0]![0].kind).toBe('spline');
  });

  it('handleNumericCommit([500]) on line after first click commits a 500mm line', () => {
    const emit = vi.fn<(p: SketchPrimitive) => void>();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    c.setToolKind('line');
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    c.handlePointer({ type: 'move', point: { x: 10, y: 0 } }, []); // set direction
    c.handleNumericCommit([500]);
    expect(emit).toHaveBeenCalledTimes(1);
    if (emit.mock.calls[0]![0].kind === 'line') {
      expect(emit.mock.calls[0]![0].x2).toBeCloseTo(500, 5);
    }
  });

  it('numericFieldCount reflects the active tool', () => {
    const emit = vi.fn();
    const onPreview = vi.fn();
    const c = new ActiveToolController({ emitPrimitive: emit, onPreview });
    expect(c.numericFieldCount()).toBe(0);
    c.setToolKind('rect');
    expect(c.numericFieldCount()).toBe(0); // before first click
    c.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    expect(c.numericFieldCount()).toBe(2); // rect wants [w, h]
  });
});
