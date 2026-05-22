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

// ─── F1.2 §9.3 — stepped fingerprint extension ──────────────────────────────
const baseStepped = (): SectionView => ({
  id: 'sv-1',
  kind: 'section',
  parentViewId: 'bv-front',
  sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 120, y: 30 } },
  arrowDirection: 1,
  label: 'A',
  positionMm: { x: 80, y: 180 },
  scale: { numerator: 1, denominator: 1 },
  showHidden: false,
  mode: 'stepped',
  stepSegments: [
    { startSheet: { x: 0,   y: 0 },  endSheet: { x: 60,  y: 0 } },
    { startSheet: { x: 60,  y: 0 },  endSheet: { x: 60,  y: 30 } },
    { startSheet: { x: 60,  y: 30 }, endSheet: { x: 120, y: 30 } },
  ],
  hatchSegments: [],
  fingerprint: '',
}) as unknown as SectionView;

describe('fingerprintSectionView — stepped extension (F1.2 §9.3)', () => {
  it('SS-FP-1: identical stepped views produce identical fingerprints', () => {
    const a = fingerprintSectionView(baseStepped(), 'parent-fp-1');
    const b = fingerprintSectionView(baseStepped(), 'parent-fp-1');
    expect(a).toBe(b);
  });

  it('SS-FP-2: moving a vertex by ≥ 1 µm produces a different fingerprint', () => {
    const view1 = baseStepped();
    // Mutate the middle vertex by 1 µm (0.001 mm — exactly the §9.3 rounding floor).
    const segs1 = view1.stepSegments!;
    const seg1Mid = { ...segs1[1]! };
    seg1Mid.endSheet = { x: seg1Mid.endSheet.x + 0.001, y: seg1Mid.endSheet.y };
    const seg2Mut = { ...segs1[2]!, startSheet: seg1Mid.endSheet };
    const view2 = {
      ...view1,
      stepSegments: [segs1[0]!, seg1Mid, seg2Mut],
    } as unknown as SectionView;

    const fpA = fingerprintSectionView(view1, 'parent-fp-1');
    const fpB = fingerprintSectionView(view2, 'parent-fp-1');
    expect(fpA).not.toBe(fpB);
  });

  it('SS-FP-3: stepped fingerprint differs from full-section fingerprint with same sectionLine endpoints', () => {
    const stepped = baseStepped();
    const fullEquivalent: SectionView = {
      ...stepped,
      mode: 'full',
      stepSegments: undefined,
    } as unknown as SectionView;
    const fpStepped = fingerprintSectionView(stepped, 'parent-fp-1');
    const fpFull = fingerprintSectionView(fullEquivalent, 'parent-fp-1');
    expect(fpStepped).not.toBe(fpFull);
  });
});
