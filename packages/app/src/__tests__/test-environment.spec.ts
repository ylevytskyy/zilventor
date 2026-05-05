import { describe, it, expect } from 'vitest';

// Regression: under Node 25+, `globalThis.localStorage` is a broken stub
// (no methods); jsdom does not override it under vitest. test-setup.ts
// must provide a working implementation. Locks the bug so future
// regressions surface immediately.
describe('test environment — localStorage', () => {
  it('localStorage.getItem is a function', () => {
    expect(typeof localStorage.getItem).toBe('function');
  });

  it('localStorage.getItem returns null for unset keys', () => {
    expect(localStorage.getItem('__zilv_probe_does_not_exist__')).toBeNull();
  });

  it('localStorage.setItem + getItem round-trip works', () => {
    localStorage.setItem('__zilv_probe__', 'value');
    expect(localStorage.getItem('__zilv_probe__')).toBe('value');
    localStorage.removeItem('__zilv_probe__');
    expect(localStorage.getItem('__zilv_probe__')).toBeNull();
  });
});
