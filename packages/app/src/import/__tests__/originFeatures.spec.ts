import { describe, it, expect } from 'vitest';
import { ORIGIN_FEATURES, stepFilenameBasename } from '../originFeatures';

describe('originFeatures', () => {
  it('exposes 7 origin features in canonical order', () => {
    expect(ORIGIN_FEATURES.map((f) => f.id)).toEqual([
      'origin.X', 'origin.Y', 'origin.Z',
      'origin.XY', 'origin.YZ', 'origin.XZ',
      'origin.O',
    ]);
    expect(ORIGIN_FEATURES.every((f) => (f as { visible?: boolean }).visible === false)).toBe(true);
  });

  it('every origin feature is keyed origin work-geometry', () => {
    const kinds = ORIGIN_FEATURES.map((f) => f.kind);
    expect(kinds).toEqual(['workAxis', 'workAxis', 'workAxis', 'workPlane', 'workPlane', 'workPlane', 'workPoint']);
  });
});

describe('stepFilenameBasename', () => {
  it('strips a trailing .step (any case)', () => {
    expect(stepFilenameBasename('Foo.step')).toBe('Foo');
    expect(stepFilenameBasename('Foo.STEP')).toBe('Foo');
    expect(stepFilenameBasename('path/to/Foo.step')).toBe('Foo');
  });

  it('strips a trailing .stp (any case)', () => {
    expect(stepFilenameBasename('Bar.stp')).toBe('Bar');
    expect(stepFilenameBasename('Bar.STP')).toBe('Bar');
  });

  it('returns the basename unchanged when no .step/.stp extension', () => {
    expect(stepFilenameBasename('NoExt')).toBe('NoExt');
    expect(stepFilenameBasename('path/to/leaf')).toBe('leaf');
  });
});
