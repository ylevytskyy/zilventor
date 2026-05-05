import { describe, it, expect } from 'vitest';
import type { MaterialEntry } from '../material';
import { getHatchSpec } from '../material';

describe('getHatchSpec', () => {
  it('returns defaults when hatchAngleDeg and hatchSpacingMm are absent', () => {
    const m: MaterialEntry = {
      id: 'm1', name: 'MDF', defaultThickness: 18, color: '#aabbcc',
    };
    const spec = getHatchSpec(m);
    expect(spec.angleDeg).toBe(45);
    expect(spec.spacingMm).toBe(3);
  });

  it('returns explicit values when both fields are present', () => {
    const m: MaterialEntry = {
      id: 'm2', name: 'Birch', defaultThickness: 18, color: '#ffffff',
      hatchAngleDeg: 60, hatchSpacingMm: 5,
    };
    const spec = getHatchSpec(m);
    expect(spec.angleDeg).toBe(60);
    expect(spec.spacingMm).toBe(5);
  });

  it('returns defaults when only hatchAngleDeg is explicitly 0', () => {
    // Edge case: 0 degrees is a valid override (horizontal lines).
    const m: MaterialEntry = {
      id: 'm3', name: 'Glass', defaultThickness: 6, color: '#ccddee',
      hatchAngleDeg: 0, hatchSpacingMm: 2,
    };
    const spec = getHatchSpec(m);
    expect(spec.angleDeg).toBe(0);
    expect(spec.spacingMm).toBe(2);
  });

  it('falls back to default spacing when hatchSpacingMm is absent but hatchAngleDeg present', () => {
    const m: MaterialEntry = {
      id: 'm4', name: 'Steel', defaultThickness: 3, color: '#999999',
      hatchAngleDeg: 30,
    };
    const spec = getHatchSpec(m);
    expect(spec.angleDeg).toBe(30);
    expect(spec.spacingMm).toBe(3);
  });
});
