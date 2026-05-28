import { describe, it, expect } from 'vitest';
import { dedupeName } from '../dedupeName';

describe('dedupeName', () => {
  it('returns base unchanged when no collision', () => {
    expect(dedupeName('hinge', [])).toBe('hinge');
  });

  it('returns base unchanged when existing list does not contain base', () => {
    expect(dedupeName('hinge', ['bolt', 'screw'])).toBe('hinge');
  });

  it('appends (2) on first collision', () => {
    expect(dedupeName('hinge', ['hinge'])).toBe('hinge (2)');
  });

  it('skips to (3) when both base and (2) are taken', () => {
    expect(dedupeName('hinge', ['hinge', 'hinge (2)'])).toBe('hinge (3)');
  });

  it('handles gaps in the sequence', () => {
    expect(dedupeName('hinge', ['hinge', 'hinge (3)'])).toBe('hinge (2)');
  });

  it('works when existing list is large', () => {
    const existing = ['hinge', ...Array.from({ length: 9 }, (_, i) => `hinge (${i + 2})`)];
    expect(dedupeName('hinge', existing)).toBe('hinge (11)');
  });
});
