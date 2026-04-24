import { describe, it, expect, vi } from 'vitest';
import { SketcherClient } from '../SketcherClient';
import type { SketcherWorkerApi } from '@zilventor/sketcher-worker';

function makeFakeApi(): SketcherWorkerApi {
  return {
    loadSketch: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const }, warnings: [] })),
    unloadSketch: vi.fn(async () => undefined),
    addPrimitive:   vi.fn(async () => ({ dof: { count: 4, state: 'under' as const } })),
    removePrimitive: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const } })),
    updatePrimitive: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const } })),
    addConstraint:  vi.fn(async () => ({ ok: true as const, dof: { count: 3, state: 'under' as const }, coords: [] })),
    removeConstraint: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const } })),
    beginDrag:  vi.fn(async () => undefined),
    dragTo:     vi.fn(async () => ({ coords: [], dof: { count: 0, state: 'fully' as const }, solverMs: 1 })),
    endDrag:    vi.fn(async () => ({ dof: { count: 0, state: 'fully' as const }, finalCoords: [] })),
    inferFromSnaps: vi.fn(async () => []),
    addDimension: vi.fn(async () => ({ ok: true as const, dof: { count: 3, state: 'under' as const }, coords: [] })),
    removeDimension: vi.fn(async () => ({ dof: { count: 4, state: 'under' as const }, coords: [] })),
    updateDimensionValue: vi.fn(async () => ({ dof: { count: 3, state: 'under' as const }, coords: [] })),
  };
}

describe('SketcherClient', () => {
  it('forwards loadSketch to the underlying worker api', async () => {
    const api = makeFakeApi();
    const client = new SketcherClient(api);
    const r = await client.loadSketch({ primitives: [], constraints: [] });
    expect(r.dof.count).toBe(4);
    expect(api.loadSketch).toHaveBeenCalledOnce();
  });

  it('exposes a typed drag bracket', async () => {
    const api = makeFakeApi();
    const client = new SketcherClient(api);
    await client.beginDrag({ primitiveId: 'L1', anchor: 'end' });
    const r = await client.dragTo(10, 20);
    expect(r.solverMs).toBe(1);
    await client.endDrag();
    expect(api.beginDrag).toHaveBeenCalledOnce();
    expect(api.dragTo).toHaveBeenCalledOnce();
    expect(api.endDrag).toHaveBeenCalledOnce();
  });
});
