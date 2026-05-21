// packages/shared/src/drawing/fingerprint.sectionview.test.ts
// Tests for fingerprintSectionView — extends fingerprint module for section views
import { describe, it, expect } from 'vitest';
import { fingerprintSectionView } from './fingerprint';
import type { SectionView } from './types';

describe('fingerprintSectionView', () => {
  const view: SectionView = {
    id: 'sv1',
    kind: 'section',
    positionMm: { x: 0, y: 0 },
    scale: { numerator: 1, denominator: 1 },
    showHidden: false,
    label: 'A',
    sectionLine: { p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } },
    arrowDirection: 1,
    parentViewId: 'v1',
    mode: 'full',
    plane: { origin: { x: 0, y: 0, z: 50 }, normal: { x: 0, y: 0, z: -1 } },
    hatchSegments: [],
    fingerprint: '',
  };

  it('section view fp is a non-empty string', () => {
    const fp = fingerprintSectionView(view, 'parent-fp-abc');
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });

  it('fp changes when parent source fingerprint changes', () => {
    const fp1 = fingerprintSectionView(view, 'parent-fp-abc');
    const fp2 = fingerprintSectionView(view, 'parent-fp-xyz');
    expect(fp1).not.toBe(fp2);
  });

  it('fp changes when plane changes', () => {
    const viewB: SectionView = {
      ...view,
      plane: { origin: { x: 0, y: 0, z: 60 }, normal: { x: 0, y: 0, z: -1 } },
    };
    const fp1 = fingerprintSectionView(view, 'parent-fp');
    const fp2 = fingerprintSectionView(viewB, 'parent-fp');
    expect(fp1).not.toBe(fp2);
  });
});
