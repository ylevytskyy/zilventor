// packages/shared/src/drawing/__tests__/depthBuffer.spec.ts
import { describe, it, expect } from 'vitest';
import { buildDepthBuffer, adaptivePixelPitch } from '../depthBuffer';
import type { BoundingBox } from '../../types';

describe('adaptivePixelPitch', () => {
  it('returns at least 0.25 for small bbox', () => {
    const bbox: BoundingBox = [0, 0, 0, 10, 10, 10];
    expect(adaptivePixelPitch(bbox)).toBeGreaterThanOrEqual(0.25);
  });

  it('returns bbox_diag / 2048 for large bbox exceeding threshold', () => {
    // diag of [0,0,0,2048,2048,2048] = 2048*sqrt(3) ≈ 3547; /2048 ≈ 1.732
    const bbox: BoundingBox = [0, 0, 0, 2048, 2048, 2048];
    const pitch = adaptivePixelPitch(bbox);
    const diag = Math.sqrt(2048 ** 2 + 2048 ** 2 + 2048 ** 2);
    expect(Math.abs(pitch - diag / 2048)).toBeLessThan(1e-9);
    expect(pitch).toBeGreaterThan(0.25);
  });
});

describe('buildDepthBuffer', () => {
  // Single 100×100 flat triangle at z=5 in view-space XY, with Y in [0,100] and X in [0,100]
  const tri: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 5],
    [100, 0, 5],
    [0, 100, 5],
  ];
  const bbox: BoundingBox = [0, 0, 0, 100, 100, 10];
  const pitch = 1; // 1 mm/pixel for easy math

  it('pixel inside the triangle has z ≈ 5', () => {
    const buf = buildDepthBuffer([tri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    // pixel at (10,10) should be covered by the triangle
    const idx = 10 * stride + 10;
    expect(buf[idx]).toBeCloseTo(5, 2);
  });

  it('pixel clearly outside the triangle remains Infinity', () => {
    const buf = buildDepthBuffer([tri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    // pixel at (90,90) is outside the lower-left triangle
    const idx = 90 * stride + 90;
    expect(buf[idx]).toBe(Infinity);
  });

  it('back-face triangle (winding reversed) still rasterises', () => {
    const backTri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 100, 5],
      [100, 0, 5],
      [0, 0, 5],
    ];
    const buf = buildDepthBuffer([backTri], bbox, pitch);
    const stride = Math.ceil((100 - 0) / pitch) + 1;
    const idx = 10 * stride + 10;
    expect(buf[idx]).toBeCloseTo(5, 2);
  });

  it('degenerate (zero-area) triangle is skipped without error', () => {
    const degen: [[number, number, number], [number, number, number], [number, number, number]] = [
      [5, 5, 3],
      [5, 5, 3],
      [5, 5, 3],
    ];
    expect(() => buildDepthBuffer([degen], bbox, pitch)).not.toThrow();
    const buf = buildDepthBuffer([degen], bbox, pitch);
    // All pixels remain Infinity (nothing rasterised)
    const allInf = Array.from(buf).every((v) => v === Infinity);
    expect(allInf).toBe(true);
  });
});
