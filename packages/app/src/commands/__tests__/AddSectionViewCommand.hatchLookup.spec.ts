import { describe, it, expect } from 'vitest';
import { getHatchSpec, type MaterialEntry } from '@zilventor/shared';

/**
 * The hatchLookup factory we expect AddSectionViewCommand to use.
 * This test pins the BEHAVIOR; the production code in both AddSectionViewCommand
 * sites and regenerateSectionView must match this shape.
 */
function makeHatchLookup(materials: readonly MaterialEntry[]) {
  return (materialId: string) => {
    const mat = materialId
      ? materials.find((m) => m.id === materialId)
      : materials[0];
    return getHatchSpec(mat ?? { id: materialId, name: '', defaultThickness: 0, color: '#808080' });
  };
}

describe('hatchLookup — part-source fallback to materials[0]', () => {
  const mats: MaterialEntry[] = [
    { id: 'wood', name: 'Wood', defaultThickness: 18, color: '#aabbcc', hatchAngleDeg: 20, hatchSpacingMm: 2 },
    { id: 'steel', name: 'Steel', defaultThickness: 3,  color: '#999999', hatchAngleDeg: 60, hatchSpacingMm: 4 },
  ];

  it('non-empty materialId resolves to that material (no fallback)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('steel')).toEqual({ angleDeg: 60, spacingMm: 4 });
    expect(lookup('wood')).toEqual({ angleDeg: 20, spacingMm: 2 });
  });

  it('empty materialId falls back to materials[0] (single-part case)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('')).toEqual({ angleDeg: 20, spacingMm: 2 });
  });

  it('empty materialId with NO materials returns default 45/3', () => {
    const lookup = makeHatchLookup([]);
    expect(lookup('')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });

  it('unknown materialId returns default 45/3 (not fallback)', () => {
    const lookup = makeHatchLookup(mats);
    expect(lookup('does-not-exist')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });

  it('materials[0] without hatch fields returns default 45/3', () => {
    const lookup = makeHatchLookup([
      { id: 'bare', name: 'Bare', defaultThickness: 18, color: '#aabbcc' },
    ]);
    expect(lookup('')).toEqual({ angleDeg: 45, spacingMm: 3 });
  });
});
