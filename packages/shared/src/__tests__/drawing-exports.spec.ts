import { describe, it, expect } from 'vitest';

describe('shared barrel — drawing re-exports', () => {
  it('exports ISO_SIZES_MM', async () => {
    const mod = await import('../index');
    expect(typeof mod.ISO_SIZES_MM).toBe('object');
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A3']).toEqual({ w: 420, h: 297 });
  });

  it('ISO_SIZES_MM has A0 dimensions', async () => {
    const mod = await import('../index');
    expect((mod.ISO_SIZES_MM as Record<string, unknown>)['A0']).toEqual({ w: 1189, h: 841 });
  });
});
