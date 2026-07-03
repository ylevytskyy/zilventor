import { describe, it, expect } from 'vitest';
import {
  validateMachiningPresetImport,
  serializeMachiningPresets,
  MachiningPresetValidationError,
} from '../machiningPreset';

const valid = {
  id: 'preset-1',
  name: 'Confirmat face bore',
  opType: 'confirmat-face',
  diameter: 8,
  depth: 13,
  layerName: 'CONFIRMAT',
};

describe('validateMachiningPresetImport', () => {
  it('accepts a single valid preset object and returns a one-element array', () => {
    const out = validateMachiningPresetImport(valid, new Set());
    expect(out).toEqual([valid]);
  });

  it('omits optional offset/toolNumber/speed when not provided', () => {
    const out = validateMachiningPresetImport(valid, new Set());
    expect('offset' in out[0]!).toBe(false);
    expect('toolNumber' in out[0]!).toBe(false);
    expect('speed' in out[0]!).toBe(false);
  });

  it('preserves optional offset/toolNumber/speed when explicitly provided', () => {
    const withOptional = { ...valid, id: 'preset-2', offset: 37, toolNumber: 4, speed: 3000 };
    const out = validateMachiningPresetImport(withOptional, new Set());
    expect(out[0]).toEqual(withOptional);
  });

  it("accepts opType: 'groove'", () => {
    const groove = { ...valid, id: 'preset-groove', opType: 'groove' };
    const out = validateMachiningPresetImport(groove, new Set());
    expect(out[0]!.opType).toBe('groove');
  });

  it("accepts opType: 'keyholeSlot'", () => {
    const keyholeSlot = { ...valid, id: 'preset-keyholeSlot', opType: 'keyholeSlot' };
    const out = validateMachiningPresetImport(keyholeSlot, new Set());
    expect(out[0]!.opType).toBe('keyholeSlot');
  });

  it('accepts an array of preset objects, in order', () => {
    const two = [valid, { ...valid, id: 'preset-2', name: 'Second' }];
    const out = validateMachiningPresetImport(two, new Set());
    expect(out.map((p) => p.id)).toEqual(['preset-1', 'preset-2']);
  });

  it.each([
    ['non-object', 42, /object/i],
    ['missing id', { ...valid, id: undefined }, /id/i],
    ['empty id', { ...valid, id: '' }, /id/i],
    ['missing name', { ...valid, name: undefined }, /name/i],
    ['missing layerName', { ...valid, layerName: undefined }, /layerName/i],
    ['empty layerName', { ...valid, layerName: '' }, /layerName/i],
    ['bad opType', { ...valid, opType: 'sprocket' }, /opType/i],
    ['zero diameter', { ...valid, diameter: 0 }, /diameter/i],
    ['negative diameter', { ...valid, diameter: -5 }, /diameter/i],
    ['non-numeric diameter', { ...valid, diameter: 'x' }, /diameter/i],
    ['zero depth', { ...valid, depth: 0 }, /depth/i],
    ['non-positive toolNumber', { ...valid, toolNumber: 0 }, /toolNumber/i],
    ['non-integer toolNumber', { ...valid, toolNumber: 1.5 }, /toolNumber/i],
    ['non-positive speed', { ...valid, speed: -1 }, /speed/i],
  ])('rejects %s', (_label, input, re) => {
    expect(() => validateMachiningPresetImport(input as unknown, new Set())).toThrow(MachiningPresetValidationError);
    expect(() => validateMachiningPresetImport(input as unknown, new Set())).toThrow(re);
  });

  it('rejects an id that collides with existingIds', () => {
    expect(() => validateMachiningPresetImport(valid, new Set(['preset-1'])))
      .toThrow(/already exists/i);
  });

  it('rejects an intra-batch duplicate id (atomic — second item collides with first)', () => {
    const batch = [valid, { ...valid, name: 'dup' }];
    expect(() => validateMachiningPresetImport(batch, new Set())).toThrow(/already exists/i);
  });
});

describe('serializeMachiningPresets', () => {
  it('round-trips through validateMachiningPresetImport', () => {
    const presets = validateMachiningPresetImport(
      [valid, { ...valid, id: 'preset-2', offset: 37, toolNumber: 4, speed: 3000 }],
      new Set(),
    );
    const json = serializeMachiningPresets(presets);
    const roundTripped = validateMachiningPresetImport(JSON.parse(json), new Set());
    expect(roundTripped).toEqual(presets);
  });
});
