// packages/shared/src/drawing/__tests__/depthBuffer.spec.ts
import { describe, it, expect } from 'vitest';
import { buildDepthBuffer, adaptivePixelPitch } from '../depthBuffer';
import type { BoundingBox } from '../../types';

describe('adaptivePixelPitch', () => {
  it('clamps to 0.25 when bbox diagonal is 100mm (100/2048 ≈ 0.0488 < 0.25)', () => {
    // bbox spanning 100mm in X only (diagonal = 100)
    const bbox: BoundingBox = [0, 0, 0, 100, 0, 0];
    expect(adaptivePixelPitch(bbox)).toBeCloseTo(0.25, 6);
  });

  it('returns exactly 1.0 when bbox diagonal is 2048mm', () => {
    // Single-axis span of 2048mm → diag = 2048 → 2048/2048 = 1.0
    const bbox: BoundingBox = [0, 0, 0, 2048, 0, 0];
    expect(adaptivePixelPitch(bbox)).toBeCloseTo(1.0, 6);
  });

  it('returns exactly 2.0 when bbox diagonal is 4096mm', () => {
    // Single-axis span of 4096mm → diag = 4096 → 4096/2048 = 2.0
    const bbox: BoundingBox = [0, 0, 0, 4096, 0, 0];
    expect(adaptivePixelPitch(bbox)).toBeCloseTo(2.0, 6);
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

  it('linearly interpolates Z across a non-flat triangle', () => {
    // v0=(0,0,z=0)  v1=(10,0,z=5)  v2=(0,10,z=10); pitch=1mm
    // area2 = (x1-x0)*(y2-y0) - (x2-x0)*(y1-y0) = 10*10 - 0*0 = 100
    //
    // Expected Z is computed via standard barycentric formula:
    //   z(px,py) = b0*z0 + b1*z1 + b2*z2
    // where (b0,b1,b2) = ((w0,w1,w2)/area2) with the [v1→v2,v2→v0,v0→v1] edge-function convention.
    //
    // Pixel (2,2): b0=0.6, b1=0.2, b2=0.2  → z = 0.6*0 + 0.2*5 + 0.2*10 = 3.0
    // Pixel (1,3): b0=0.6, b1=0.1, b2=0.3  → z = 0.6*0 + 0.1*5 + 0.3*10 = 3.5
    // Pixel (3,1): b0=0.6, b1=0.3, b2=0.1  → z = 0.6*0 + 0.3*5 + 0.1*10 = 2.5
    const nonFlatTri: [[number, number, number], [number, number, number], [number, number, number]] = [
      [0, 0, 0],
      [10, 0, 5],
      [0, 10, 10],
    ];
    const smallBbox: BoundingBox = [0, 0, 0, 15, 15, 15];
    const p = 1;
    const buf = buildDepthBuffer([nonFlatTri], smallBbox, p);
    const stride = Math.ceil((15 - 0) / p) + 1;

    expect(buf[2 * stride + 2]).toBeCloseTo(3.0, 4);
    expect(buf[3 * stride + 1]).toBeCloseTo(3.5, 4);
    expect(buf[1 * stride + 3]).toBeCloseTo(2.5, 4);
  });
});
