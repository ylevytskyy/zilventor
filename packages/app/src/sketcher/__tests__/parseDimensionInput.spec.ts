import { describe, it, expect } from 'vitest';
import { parseDimensionInput } from '../parseDimensionInput';

describe('parseDimensionInput', () => {
  it('rejects empty string', () => {
    expect(parseDimensionInput('dim-length', '')).toEqual({ ok: false });
  });

  it('rejects NaN string', () => {
    expect(parseDimensionInput('dim-length', 'abc')).toEqual({ ok: false });
  });

  it('rejects zero for dim-length', () => {
    expect(parseDimensionInput('dim-length', '0')).toEqual({ ok: false });
  });

  it('rejects negative for dim-length', () => {
    expect(parseDimensionInput('dim-length', '-5')).toEqual({ ok: false });
  });

  it('accepts positive for dim-length', () => {
    expect(parseDimensionInput('dim-length', '50')).toEqual({ ok: true, value: 50 });
  });

  it('rejects zero for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '0')).toEqual({ ok: false });
  });

  it('rejects negative for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '-3')).toEqual({ ok: false });
  });

  it('accepts positive for dim-radius', () => {
    expect(parseDimensionInput('dim-radius', '5')).toEqual({ ok: true, value: 5 });
  });

  it('rejects zero for dim-diameter', () => {
    expect(parseDimensionInput('dim-diameter', '0')).toEqual({ ok: false });
  });

  it('accepts positive for dim-diameter', () => {
    expect(parseDimensionInput('dim-diameter', '10')).toEqual({ ok: true, value: 10 });
  });

  it('accepts any number for dim-distance', () => {
    expect(parseDimensionInput('dim-distance', '0')).toEqual({ ok: true, value: 0 });
    expect(parseDimensionInput('dim-distance', '-10')).toEqual({ ok: true, value: -10 });
    expect(parseDimensionInput('dim-distance', '25.5')).toEqual({ ok: true, value: 25.5 });
  });

  it('accepts any number for dim-point-line-distance', () => {
    expect(parseDimensionInput('dim-point-line-distance', '0')).toEqual({ ok: true, value: 0 });
  });

  // dim-angle: values are STORED IN DEGREES (GcsSystem.ts:593 does the deg→rad conversion
  // internally when feeding the solver). parseDimensionInput must return degrees as-is — NO conversion.
  it('passes through degrees as-is for dim-angle (input "45" → value 45)', () => {
    const res = parseDimensionInput('dim-angle', '45');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(45);
  });

  it('passes through degrees as-is for dim-angle (input "90" → value 90, NOT π/2)', () => {
    const res = parseDimensionInput('dim-angle', '90');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(90);
  });

  it('passes through negative angle as-is (dim-angle, "-30" → -30)', () => {
    const res = parseDimensionInput('dim-angle', '-30');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(-30);
  });

  it('passes through zero angle as-is (dim-angle, "0" → 0)', () => {
    const res = parseDimensionInput('dim-angle', '0');
    expect(res.ok).toBe(true);
    expect((res as { ok: true; value: number }).value).toBe(0);
  });
});
