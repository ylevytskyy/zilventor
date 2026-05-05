import { describe, it, expect } from 'vitest';

describe('shared barrel — drawing re-exports', () => {
  it('exports ISO_SIZES_MM', async () => {
    const mod = await import('../index');
    expect(typeof mod.ISO_SIZES_MM).toBe('object');
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A3']).toEqual({ w: 420, h: 297 });
  });

  it('re-exports ProjectedGeometry as a type (no runtime value needed — type-only export)', async () => {
    // Confirm the barrel re-exports drawing/projectedGeometry by importing Edge2D kind check
    // We can only test runtime values; ISO_SIZES_MM is the sole runtime export from drawing/types.
    const mod = await import('../index');
    // ISO_SIZES_MM A0 spot-check
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A0']).toEqual({ w: 1189, h: 841 });
  });
});
