import { describe, it, expect } from 'vitest';
import { buildImportedPartDocument } from '../buildImportedPartDocument';
import type { ImportedFeature } from '@zilventor/shared';

describe('buildImportedPartDocument color', () => {
  it('sets PartDocument.color and ImportedFeature.color from a hex color', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, '#a01010');
    expect(doc.color).toEqual({ kind: 'hex', hex: '#a01010' });
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.color).toBe('#a01010');
  });

  it('leaves color undefined when no color is given', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step');
    expect(doc.color).toBeUndefined();
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.color).toBeUndefined();
  });
});
