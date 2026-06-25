import { describe, it, expect } from 'vitest';
import { validateCustomHardwareSku, CustomHardwareValidationError, parseCustomHardwareImport } from './customHardware';
import { BUILTIN_CATALOG } from './builtinCatalog';

const valid = {
  id: 'acme-pull-128',
  name: 'ACME Bar Pull 128mm',
  category: 'drawerHandles',
  vendor: 'ACME',
  notes: 'matte black',
  bboxMm: { l: 140, w: 12, h: 30 },
  attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
};

describe('validateCustomHardwareSku', () => {
  it('accepts a valid entry and returns it normalized', () => {
    const out = validateCustomHardwareSku(valid, new Set());
    expect(out).toEqual({
      id: 'acme-pull-128',
      name: 'ACME Bar Pull 128mm',
      category: 'drawerHandles',
      vendor: 'ACME',
      notes: 'matte black',
      bboxMm: { l: 140, w: 12, h: 30 },
      attachPoints: [{ name: 'screw-a', position: { x: 6, y: 0, z: 0 } }],
    });
  });

  it('defaults vendor and notes to empty string when omitted', () => {
    const { vendor: _vendor, notes: _notes, ...rest } = valid;
    const out = validateCustomHardwareSku(rest, new Set());
    expect(out.vendor).toBe('');
    expect(out.notes).toBe('');
  });

  it('preserves an optional legLeveler when present and valid', () => {
    const withLeg = {
      ...valid,
      id: 'acme-leg',
      category: 'legLevelers',
      legLeveler: { screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13 },
    };
    expect(validateCustomHardwareSku(withLeg, new Set()).legLeveler).toEqual({
      screwCount: 4, patternW: 36, patternD: 36, screwDiameter: 4, screwDepth: 13,
    });
  });

  it.each([
    ['non-object', 42, /object/i],
    ['missing id', { ...valid, id: undefined }, /id/i],
    ['empty id', { ...valid, id: '' }, /id/i],
    ['missing name', { ...valid, name: undefined }, /name/i],
    ['bad category', { ...valid, category: 'sprockets' }, /category/i],
    ['non-numeric bbox', { ...valid, bboxMm: { l: 'x', w: 1, h: 1 } }, /bbox/i],
    ['negative bbox', { ...valid, bboxMm: { l: -1, w: 1, h: 1 } }, /bbox/i],
    ['attachPoints not array', { ...valid, attachPoints: {} }, /attachPoint/i],
    ['attachPoint missing position', { ...valid, attachPoints: [{ name: 'a' }] }, /position/i],
    ['bad legLeveler screwCount', { ...valid, legLeveler: { screwCount: 2, patternW: 1, patternD: 1, screwDiameter: 1, screwDepth: 1 } }, /legLeveler/i],
  ])('rejects %s', (_label, input, re) => {
    expect(() => validateCustomHardwareSku(input as unknown, new Set())).toThrow(CustomHardwareValidationError);
    expect(() => validateCustomHardwareSku(input as unknown, new Set())).toThrow(re);
  });

  it('rejects an id that collides with existingIds', () => {
    expect(() => validateCustomHardwareSku(valid, new Set(['acme-pull-128'])))
      .toThrow(/already exists|collision|duplicate/i);
  });
});

describe('parseCustomHardwareImport', () => {
  const one = JSON.stringify(valid);
  const two = JSON.stringify([valid, { ...valid, id: 'acme-pull-160', name: 'ACME 160' }]);

  it('parses a single object into a one-element array', () => {
    const out = parseCustomHardwareImport(one, BUILTIN_CATALOG);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('acme-pull-128');
  });

  it('parses an array of objects', () => {
    const out = parseCustomHardwareImport(two, BUILTIN_CATALOG);
    expect(out.map((e) => e.id)).toEqual(['acme-pull-128', 'acme-pull-160']);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseCustomHardwareImport('{ not json', BUILTIN_CATALOG)).toThrow(/JSON/i);
  });

  it('rejects an id that collides with a builtin', () => {
    const dup = JSON.stringify({ ...valid, id: BUILTIN_CATALOG[0]!.id });
    expect(() => parseCustomHardwareImport(dup, BUILTIN_CATALOG)).toThrow(/already exists/i);
  });

  it('rejects an intra-batch duplicate id (atomic — second item collides with first)', () => {
    const batch = JSON.stringify([valid, { ...valid, name: 'dup' }]);
    expect(() => parseCustomHardwareImport(batch, BUILTIN_CATALOG)).toThrow(/already exists/i);
  });
});
