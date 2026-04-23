import { describe, it, expect } from 'vitest';
import { loadPlanegcs } from '../planegcsLoader';

describe('planegcs loader integration', () => {
  it('initializes WASM and exposes GcsWrapper', async () => {
    const { GcsWrapper } = await loadPlanegcs();
    expect(typeof GcsWrapper).toBe('function');   // class
  });

  it('can create and destroy a GcsWrapper', async () => {
    const { createWrapper } = await loadPlanegcs();
    const wrapper = createWrapper();
    expect(wrapper).toBeDefined();
    wrapper.destroy_gcs_module();
  });
});
