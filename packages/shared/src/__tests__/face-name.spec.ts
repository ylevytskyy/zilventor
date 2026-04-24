import { describe, it, expect } from 'vitest';
import { canonicalEdgeName, type FaceName } from '../types';

describe('FaceName / EdgeName', () => {
  const a: FaceName = { featureId: 'E1', role: 'top' };
  const b: FaceName = { featureId: 'E1', role: 'side', instance: 0 };

  it('canonicalEdgeName is symmetric', () => {
    const ab = canonicalEdgeName(a, b);
    const ba = canonicalEdgeName(b, a);
    expect(ab).toEqual(ba);
  });

  it('canonicalEdgeName orders faces deterministically', () => {
    const ab = canonicalEdgeName(a, b);
    expect(ab.faceA.role < ab.faceB.role || ab.faceA.featureId < ab.faceB.featureId).toBe(true);
  });
});
