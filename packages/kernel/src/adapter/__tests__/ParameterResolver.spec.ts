import { describe, it, expect } from 'vitest';
import { resolve } from '../ParameterResolver';

describe('ParameterResolver (MVP — numeric literals only)', () => {
  it('parses a simple positive decimal', () => {
    const r = resolve('18', 'mm');
    expect(r).toEqual({ ok: true, value: 18 });
  });

  it('parses a signed decimal', () => {
    const r = resolve('-0.5', 'mm');
    expect(r).toEqual({ ok: true, value: -0.5 });
  });

  it('returns an error for non-numeric expressions', () => {
    const r = resolve('abc', 'mm');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidParameter');
  });

  it('returns an error for NaN literal', () => {
    const r = resolve('NaN', 'mm');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalidParameter');
  });

  it('trims whitespace', () => {
    const r = resolve('  42  ', 'mm');
    expect(r).toEqual({ ok: true, value: 42 });
  });
});
