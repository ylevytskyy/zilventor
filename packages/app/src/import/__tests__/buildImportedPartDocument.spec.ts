import { describe, it, expect } from 'vitest';
import { buildImportedPartDocument } from '../buildImportedPartDocument';
import { ORIGIN_FEATURES } from '../originFeatures';

describe('buildImportedPartDocument', () => {
  it('builds a PartDocument with origin features + one ImportedFeature', () => {
    const part = buildImportedPartDocument('Knob', 'blob-abc', 'Knob.step');

    expect(part.name).toBe('Knob');
    expect(part.units).toBe('mm');
    expect(part.parameters).toEqual({});
    expect(part.materials).toEqual([]);
    expect(part.hardware).toEqual([]);
    expect(part.featureTree).toHaveLength(ORIGIN_FEATURES.length + 1);
    expect(part.featureTree.slice(0, ORIGIN_FEATURES.length)).toEqual(ORIGIN_FEATURES);

    const imported = part.featureTree.at(-1);
    if (!imported || imported.kind !== 'imported') throw new Error('last feature must be imported');
    expect(imported.sourceStep).toBe('Knob.step');
    expect(imported.bodyRef).toBe('blob-abc');
  });

  it('generates a fresh UUID per call when no partId supplied', () => {
    const a = buildImportedPartDocument('x', 'b', 'x.step');
    const b = buildImportedPartDocument('x', 'b', 'x.step');
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(a.id).not.toBe(b.id);
  });

  it('uses provided partId when supplied', () => {
    const part = buildImportedPartDocument('x', 'b', 'x.step', 'explicit-id');
    expect(part.id).toBe('explicit-id');
  });
});
