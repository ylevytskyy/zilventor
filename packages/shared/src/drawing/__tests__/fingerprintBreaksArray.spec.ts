import { describe, it, expect } from 'vitest';
import { fingerprintBreaksArray } from '../fingerprint';
import type { BreakRegion } from '../types';

const br1: BreakRegion = { id: 'b1', axis: 'x', coordA: 50, coordB: 150, gapMm: 5, style: 'zigzag' };
const br2: BreakRegion = { id: 'b2', axis: 'y', coordA: 20, coordB: 80, gapMm: 5, style: 'zigzag' };

describe('fingerprintBreaksArray (spec §8.1)', () => {
  it('empty array returns a stable 8-char hex string', () => {
    const fp = fingerprintBreaksArray([]);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('same empty array always returns the same hash', () => {
    expect(fingerprintBreaksArray([])).toBe(fingerprintBreaksArray([]));
  });

  it('single break returns a non-empty hash distinct from empty array hash', () => {
    const fpEmpty = fingerprintBreaksArray([]);
    const fpOne   = fingerprintBreaksArray([br1]);
    expect(fpOne).not.toBe(fpEmpty);
    expect(fpOne).toMatch(/^[0-9a-f]{8}$/);
  });

  it('two breaks in different orders produce the same hash (sort by coordA)', () => {
    // br2 has coordA=20 < br1 coordA=50; order should not matter.
    const fpAB = fingerprintBreaksArray([br1, br2]);
    const fpBA = fingerprintBreaksArray([br2, br1]);
    expect(fpAB).toBe(fpBA);
  });

  it('changing coordA produces a different hash', () => {
    const brModified: BreakRegion = { ...br1, coordA: 51 };
    expect(fingerprintBreaksArray([brModified])).not.toBe(fingerprintBreaksArray([br1]));
  });

  it('changing gapMm produces a different hash', () => {
    const brModified: BreakRegion = { ...br1, gapMm: 10 };
    expect(fingerprintBreaksArray([brModified])).not.toBe(fingerprintBreaksArray([br1]));
  });
});
