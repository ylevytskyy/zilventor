import { describe, it, expect, vi } from 'vitest';
import { ActiveToolController } from '../ActiveToolController';
import type { SketchConstraint } from '@zilventor/shared';

describe('auto-inference on commit', () => {
  it('after a line is committed with h-axis snap, horizontal constraint is emitted', async () => {
    const client = {
      inferFromSnaps: vi.fn(async (): Promise<SketchConstraint[]> =>
        [{ id: 'c1', kind: 'horizontal', line: 'L1', source: 'auto-snap' }])
    };
    const emitConstraint = vi.fn();
    const controller = new ActiveToolController({
      emitPrimitive: () => {},
      onPreview: () => {},
      emitConstraint,
      sketcherClient: client as never
    });
    controller.setToolKind('line');
    // Two clicks to commit a horizontal line (h-axis snap fires automatically)
    controller.handlePointer({ type: 'click', point: { x: 0, y: 0 } }, []);
    controller.handlePointer({ type: 'click', point: { x: 100, y: 0 } }, []);
    // Let the promise resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(emitConstraint).toHaveBeenCalled();
    const c = emitConstraint.mock.calls[0]![0];
    expect(c.kind).toBe('horizontal');
  });
});
