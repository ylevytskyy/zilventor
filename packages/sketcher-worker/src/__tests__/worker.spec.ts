import { describe, it, expect, vi } from 'vitest';

// Mock comlink.expose before importing the worker module.
vi.mock('comlink', () => ({
  expose: vi.fn()
}));

// Mock planegcs loader to avoid WASM in this pure unit test.
vi.mock('../planegcsLoader', () => ({
  loadPlanegcs: vi.fn(async () => ({
    GcsWrapper: class {},
    createWrapper: () => ({
      push_primitives_and_params: () => {},
      push_primitive: () => {},
      solve: () => {},
      apply_solution: () => {},
      clear_data: () => {},
      destroy_gcs_module: () => {},
      sketch_index: { get_primitives: () => [] },
      gcs: { dof: () => 0 },
      has_gcs_conflicting_constraints: () => false,
      get_gcs_conflicting_constraints: () => [],
      has_gcs_redundant_constraints: () => false,
      get_gcs_redundant_constraints: () => []
    })
  }))
}));

describe('worker entrypoint', () => {
  it('exposes a SketcherWorkerApi via Comlink on import', async () => {
    const { expose } = await import('comlink');
    await import('../worker');
    expect(expose).toHaveBeenCalledOnce();
    const [api] = (expose as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const impl = api as Record<string, unknown>;
    for (const m of [
      'loadSketch', 'unloadSketch',
      'addPrimitive', 'removePrimitive', 'updatePrimitive',
      'addConstraint', 'removeConstraint',
      'beginDrag', 'dragTo', 'endDrag',
      'inferFromSnaps'
    ]) {
      expect(typeof impl[m]).toBe('function');
    }
  });
});
