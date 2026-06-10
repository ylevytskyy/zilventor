// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createTwoComponentPicker } from '../createTwoComponentPicker';
import type { ComponentPath } from '@zilventor/shared';

// The picker is a pure state machine: feed it ComponentPath picks; it resolves
// each to a partPath via the provided resolver and fires onComplete after 2 distinct picks.
describe('createTwoComponentPicker', () => {
  const resolve = (p: ComponentPath): string => `${p[p.length - 1]}.zipt`;

  it('fires onComplete with both partPaths after two distinct picks', () => {
    const calls: Array<[string, string]> = [];
    const picker = createTwoComponentPicker({
      resolvePartPath: resolve,
      onComplete: (a, b) => calls.push([a, b]),
    });
    picker.pick(['C1']);
    expect(calls).toHaveLength(0);
    expect(picker.firstPick()).toBe('C1.zipt');
    picker.pick(['C3']);
    expect(calls).toEqual([['C1.zipt', 'C3.zipt']]);
  });

  it('ignores a repeated pick of the same component (must pick two distinct panels)', () => {
    const calls: Array<[string, string]> = [];
    const picker = createTwoComponentPicker({ resolvePartPath: resolve, onComplete: (a, b) => calls.push([a, b]) });
    picker.pick(['C1']);
    picker.pick(['C1']);            // same → ignored
    expect(calls).toHaveLength(0);
    picker.pick(['C2']);
    expect(calls).toEqual([['C1.zipt', 'C2.zipt']]);
  });

  it('reset() clears the first pick', () => {
    const calls: Array<[string, string]> = [];
    const picker = createTwoComponentPicker({ resolvePartPath: resolve, onComplete: (a, b) => calls.push([a, b]) });
    picker.pick(['C1']);
    picker.reset();
    expect(picker.firstPick()).toBeNull();
    picker.pick(['C2']);
    expect(calls).toHaveLength(0);   // C2 is now the first pick, not the second
    picker.pick(['C3']);
    expect(calls).toEqual([['C2.zipt', 'C3.zipt']]);
  });
});
