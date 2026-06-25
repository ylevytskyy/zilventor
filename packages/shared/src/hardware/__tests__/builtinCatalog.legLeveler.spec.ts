import { describe, it, expect } from 'vitest';
import { BUILTIN_CATALOG } from '../builtinCatalog';

describe('leg-leveler catalog spec', () => {
  it('leg-leveler-100 carries a 4-screw baseplate spec', () => {
    const entry = BUILTIN_CATALOG.find((e) => e.id === 'leg-leveler-100');
    expect(entry).toBeDefined();
    expect(entry!.legLeveler).toEqual({
      screwCount: 4,
      patternW: 36,
      patternD: 36,
      screwDiameter: 4,
      screwDepth: 13,
    });
  });
});
