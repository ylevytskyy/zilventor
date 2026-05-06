import { describe, it, expect } from 'vitest';
import type { BreakRegion } from '../types';

describe('BreakRegion shape (spec §5.1)', () => {
  it('has all 6 required fields with correct types', () => {
    const br: BreakRegion = {
      id: 'br-1',
      axis: 'x',
      coordA: 50,
      coordB: 150,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.id).toBe('br-1');
    expect(br.axis).toBe('x');
    expect(br.coordA).toBe(50);
    expect(br.coordB).toBe(150);
    expect(br.gapMm).toBe(5);
    expect(br.style).toBe('zigzag');
  });

  it('accepts axis: "y"', () => {
    const br: BreakRegion = {
      id: 'br-y',
      axis: 'y',
      coordA: 30,
      coordB: 80,
      gapMm: 5,
      style: 'zigzag',
    };
    expect(br.axis).toBe('y');
  });

  it('survives JSON round-trip without drift', () => {
    const br: BreakRegion = {
      id: 'br-rt',
      axis: 'x',
      coordA: 100.5,
      coordB: 200.75,
      gapMm: 5,
      style: 'zigzag',
    };
    const parsed = JSON.parse(JSON.stringify(br)) as BreakRegion;
    expect(parsed.coordA).toBe(100.5);
    expect(parsed.coordB).toBe(200.75);
    expect(parsed.style).toBe('zigzag');
  });
});
