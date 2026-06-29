import { describe, it, expect } from 'vitest';
import { shouldAutoExplode } from '../autoExplodeHeuristic';

describe('shouldAutoExplode', () => {
  it('returns false when solidCount is 1 (no need to explode a single body)', () => {
    expect(shouldAutoExplode(1, ['#ff0000'])).toBe(false);
  });

  it('returns false when solidCount > 1 but all solids share the same color', () => {
    expect(shouldAutoExplode(3, ['#aabbcc', '#aabbcc', '#aabbcc'])).toBe(false);
  });

  it('returns true when solidCount > 1 and at least 2 distinct non-null colors', () => {
    expect(shouldAutoExplode(3, ['#aabbcc', '#112233', '#aabbcc'])).toBe(true);
  });

  it('returns false when solidCount > 1 but all solidColors are null (no color info)', () => {
    expect(shouldAutoExplode(5, [null, null, null, null, null])).toBe(false);
  });

  it('returns false when solidColors is undefined', () => {
    expect(shouldAutoExplode(4, undefined)).toBe(false);
  });

  it('returns true when solidCount is 2 and both have distinct non-null colors', () => {
    expect(shouldAutoExplode(2, ['#ff0000', '#0000ff'])).toBe(true);
  });
});
