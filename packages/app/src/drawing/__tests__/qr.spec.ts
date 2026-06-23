import { describe, it, expect } from 'vitest';
import { qrMatrix, drawQr } from '../qr';

describe('qrMatrix', () => {
  it('is deterministic and well-formed for a fixed string', () => {
    const m = qrMatrix('Z|1|1/2|600x400x18|MDF');
    // QR symbols are always square and odd-sized (21 for v1 up to 177 for v40).
    expect(m.size).toBeGreaterThanOrEqual(21);
    expect(m.size % 2).toBe(1);
    expect(m.data.length).toBe(m.size * m.size);
    // A real QR has both dark and light modules.
    const dark = m.data.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(m.size * m.size);
    // Determinism: same input → identical matrix.
    const m2 = qrMatrix('Z|1|1/2|600x400x18|MDF');
    expect(m2.size).toBe(m.size);
    expect(Array.from(m2.data)).toEqual(Array.from(m.data));
  });
});

describe('drawQr', () => {
  it('emits one filled rect per dark module (popcount)', () => {
    const m = qrMatrix('hello');
    const dark = m.data.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);
    const rects: Array<[number, number, number, number, string]> = [];
    const pdf = {
      setFillColor: () => {},
      rect: (x: number, y: number, w: number, h: number, style: string) =>
        rects.push([x, y, w, h, style]),
    };
    drawQr(pdf, m, 5, 5, 20);
    expect(rects.length).toBe(dark);
    // module size = sizeMm / matrix size
    expect(rects[0]![2]).toBeCloseTo(20 / m.size, 6);
    expect(rects.every((r) => r[4] === 'F')).toBe(true);
  });
});
