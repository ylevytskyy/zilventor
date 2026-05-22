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

// ── MEDIUM #5: dimensionMath helpers accessible from barrel ──────────────────
describe('shared barrel — dimensionMath re-exports (MED #5)', () => {
  it('exports intersectLines as a function', async () => {
    const mod = await import('../index');
    expect(typeof (mod as any).intersectLines).toBe('function');
  });

  it('exports subtendedAngle as a function', async () => {
    const mod = await import('../index');
    expect(typeof (mod as any).subtendedAngle).toBe('function');
  });

  it('exports formatAngleDeg as a function', async () => {
    const mod = await import('../index');
    expect(typeof (mod as any).formatAngleDeg).toBe('function');
  });

  it('exports computeBaselineMemberOffset as a function', async () => {
    const mod = await import('../index');
    expect(typeof (mod as any).computeBaselineMemberOffset).toBe('function');
  });

  it('exports nextBaselineSlot as a function', async () => {
    const mod = await import('../index');
    expect(typeof (mod as any).nextBaselineSlot).toBe('function');
  });
});
