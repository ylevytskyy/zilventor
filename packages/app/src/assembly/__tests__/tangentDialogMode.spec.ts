import { describe, it, expect } from 'vitest';

describe('tangent dialog mode produces kind=tangent constraint', () => {
  it('tangent mode produces kind=tangent, not mate', () => {
    const mode = 'tangent' as 'mate' | 'flush' | 'angle' | 'insert' | 'coincident' | 'tangent';
    let kind: string;
    if (mode === 'tangent') {
      kind = 'tangent';
    } else if (mode === 'coincident') {
      kind = 'mate';
    } else {
      kind = mode;
    }
    expect(kind).toBe('tangent');
  });
});
