import { describe, it, expect } from 'vitest';
import { fingerprintSectionView } from '../fingerprint';
import type { SectionView } from '../types';

function makeFullSV(overrides: Partial<SectionView> = {}): SectionView {
  return {
    id: 'sv-test', kind: 'section', parentViewId: 'v1',
    sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
    arrowDirection: 1, label: 'A', positionMm: { x: 10, y: 130 },
    scale: { numerator: 1, denominator: 1 }, showHidden: false,
    mode: 'full', hatchSegments: [], fingerprint: '',
    ...overrides,
  };
}

function makeHalfSV(overrides: Partial<SectionView> = {}): SectionView {
  return {
    id: 'sv-half', kind: 'section', parentViewId: 'v1',
    sectionLine: { p0: { x: 0, y: 50 }, p1: { x: 200, y: 50 } },
    arrowDirection: 1, label: 'B', positionMm: { x: 10, y: 200 },
    scale: { numerator: 1, denominator: 1 }, showHidden: false,
    mode: 'half', cutSide: 1,
    splitPlane: { origin: { x: 100, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
    hatchSegments: [], fingerprint: '',
    ...overrides,
  };
}

const PARENT_FP = 'deadbeef';

describe('fingerprintSectionView (HS-FP-1..5)', () => {
  it('HS-FP-1: two identical half-section views → same fingerprint', () => {
    expect(fingerprintSectionView(makeHalfSV(), PARENT_FP)).toBe(fingerprintSectionView(makeHalfSV(), PARENT_FP));
  });
  it('HS-FP-2: cutSide flipped → different fingerprint', () => {
    const fp1 = fingerprintSectionView(makeHalfSV({ cutSide: 1 }), PARENT_FP);
    const fp2 = fingerprintSectionView(makeHalfSV({ cutSide: -1 }), PARENT_FP);
    expect(fp1).not.toBe(fp2);
  });
  it('HS-FP-3: splitPlane.origin shifted 0.5 mm → different fingerprint', () => {
    const fp1 = fingerprintSectionView(makeHalfSV(), PARENT_FP);
    const fp2 = fingerprintSectionView(makeHalfSV({ splitPlane: { origin: { x: 100.5, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } } }), PARENT_FP);
    expect(fp1).not.toBe(fp2);
  });
  it('HS-FP-4: full-section fp ≠ half-section fp with same section plane', () => {
    expect(fingerprintSectionView(makeFullSV(), PARENT_FP)).not.toBe(fingerprintSectionView(makeHalfSV(), PARENT_FP));
  });
  it('HS-FP-5: back-filled view (mode full) → stable fingerprint, different from half', () => {
    const fp1 = fingerprintSectionView(makeFullSV(), PARENT_FP);
    expect(fp1).toBe(fingerprintSectionView(makeFullSV(), PARENT_FP));
    expect(fp1).not.toBe(fingerprintSectionView(makeHalfSV(), PARENT_FP));
    expect(fp1).toMatch(/^[0-9a-f]{8}$/);
  });
  it('sub-1e-3 change → same fingerprint (toFixed(3) rounding bucket)', () => {
    const fp1 = fingerprintSectionView(makeHalfSV(), PARENT_FP);
    const fp2 = fingerprintSectionView(makeHalfSV({ splitPlane: { origin: { x: 100.0001, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } } }), PARENT_FP);
    expect(fp1).toBe(fp2);
  });
});
