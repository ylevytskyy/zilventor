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

describe('buildImportedPartDocument solidColors', () => {
  it('sets solidColors on the ImportedFeature when provided', () => {
    const colors: (string | null)[] = ['#ff0000', '#00ff00'];
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, '#ff0000', colors);
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.solidColors).toEqual(colors);
  });

  it('solidColors survives JSON round-trip (persistence)', () => {
    const colors: (string | null)[] = ['#ff0000', null, '#0000ff'];
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, '#ff0000', colors);
    const restored = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const imp = restored.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.solidColors).toEqual(colors);
  });

  it('leaves solidColors undefined when not provided', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, '#ff0000');
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.solidColors).toBeUndefined();
  });
});

describe('buildImportedPartDocument isManifold', () => {
  it('sets isManifold: true on the ImportedFeature when provided', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, undefined, undefined, true);
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.isManifold).toBe(true);
  });

  it('sets isManifold: false on the ImportedFeature — must NOT be dropped by a truthy-spread bug', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, undefined, undefined, false);
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.isManifold).toBe(false);
  });

  it('leaves isManifold undefined when not provided', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step');
    const imp = doc.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.isManifold).toBeUndefined();
  });

  it('isManifold: false survives a JSON persist/reload round-trip (not dropped to undefined)', () => {
    const doc = buildImportedPartDocument('part', 'blob-1', 'f.step', undefined, undefined, undefined, false);
    const restored = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const imp = restored.featureTree.find((f): f is ImportedFeature => f.kind === 'imported');
    expect(imp?.isManifold).toBe(false);
    expect('isManifold' in (imp as object)).toBe(true);
  });
});
