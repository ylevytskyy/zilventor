import { describe, it, expect } from 'vitest';
import {
  validateLabelHeaderPresetImport,
  serializeLabelHeaderPresets,
  LabelHeaderPresetValidationError,
} from '../labelHeaderPreset';

const valid = {
  id: 'preset-1',
  name: 'Acme Kitchens',
  line1: 'Acme Kitchens Ltd.',
  line2: 'Job #1042',
};

describe('validateLabelHeaderPresetImport', () => {
  it('accepts a single valid preset object and returns a one-element array', () => {
    const out = validateLabelHeaderPresetImport(valid, new Set());
    expect(out).toEqual([valid]);
  });

  it('accepts an array of preset objects, in order', () => {
    const two = [valid, { ...valid, id: 'preset-2', name: 'Second' }];
    const out = validateLabelHeaderPresetImport(two, new Set());
    expect(out.map((p) => p.id)).toEqual(['preset-1', 'preset-2']);
  });

  it('accepts an empty line1/line2 (header lines are optional in practice)', () => {
    const blank = { ...valid, line1: '', line2: '' };
    const out = validateLabelHeaderPresetImport(blank, new Set());
    expect(out[0]).toEqual(blank);
  });

  it.each([
    ['non-object', 42, /object/i],
    ['missing id', { ...valid, id: undefined }, /id/i],
    ['empty id', { ...valid, id: '' }, /id/i],
    ['missing name', { ...valid, name: undefined }, /name/i],
    ['empty name', { ...valid, name: '' }, /name/i],
    ['missing line1', { ...valid, line1: undefined }, /line1/i],
    ['non-string line1', { ...valid, line1: 42 }, /line1/i],
    ['missing line2', { ...valid, line2: undefined }, /line2/i],
    ['non-string line2', { ...valid, line2: 42 }, /line2/i],
  ])('rejects %s', (_label, input, re) => {
    expect(() => validateLabelHeaderPresetImport(input as unknown, new Set())).toThrow(LabelHeaderPresetValidationError);
    expect(() => validateLabelHeaderPresetImport(input as unknown, new Set())).toThrow(re);
  });

  it('rejects an id that collides with existingIds', () => {
    expect(() => validateLabelHeaderPresetImport(valid, new Set(['preset-1'])))
      .toThrow(/already exists/i);
  });

  it('rejects an intra-batch duplicate id atomically (store-equivalent input unchanged)', () => {
    const batch = [valid, { ...valid, name: 'dup' }];
    expect(() => validateLabelHeaderPresetImport(batch, new Set())).toThrow(/already exists/i);
  });
});

describe('serializeLabelHeaderPresets', () => {
  it('round-trips through validateLabelHeaderPresetImport', () => {
    const presets = validateLabelHeaderPresetImport(
      [valid, { ...valid, id: 'preset-2', name: 'Second' }],
      new Set(),
    );
    const json = serializeLabelHeaderPresets(presets);
    const roundTripped = validateLabelHeaderPresetImport(JSON.parse(json), new Set());
    expect(roundTripped).toEqual(presets);
  });
});
