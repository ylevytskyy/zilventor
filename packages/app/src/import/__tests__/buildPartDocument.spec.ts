import { describe, expect, it } from 'vitest';
import { buildPartDocument } from '../buildPartDocument';
import type { ImporterPartJson } from '../inventorJsonSchema';

const basePart: ImporterPartJson = {
  schemaVersion: 1, kind: 'part', exportedAt: 't',
  source: { iptPath: 'a/b.ipt', fileVersion: 'I' },
  step: 'b.step', name: 'b',
  properties: { partNumber: 'X-1', description: 'd', mass: 1.5 },
  parameters: {
    Width: { value: 600, unit: 'mm', expression: '600 mm' },
    Angle: { value: 45, unit: 'deg', expression: '45 deg' },
  },
};
const importResult = { brepBlobId: 'imp-123', triangleCount: 12, boundingBox: [0, 0, 0, 10, 10, 10] as const, faceCount: 6 };

describe('buildPartDocument', () => {
  it('produces a v9 PartDocument with one ImportedFeature plus 7 origin features', () => {
    const doc = buildPartDocument({ partJson: basePart, importResult, partId: 'p-1', importedFeatureId: 'imp-1' });
    expect(doc.id).toBe('p-1');
    expect(doc.name).toBe('b');
    expect(doc.units).toBe('mm');
    expect(doc.properties).toEqual({ partNumber: 'X-1', description: 'd', mass: 1.5 });
    const origin = doc.featureTree.filter((f) => typeof f.id === 'string' && f.id.startsWith('origin.'));
    expect(origin).toHaveLength(7);
    const nonOrigin = doc.featureTree.filter((f) => !(typeof f.id === 'string' && f.id.startsWith('origin.')));
    expect(nonOrigin).toEqual([
      { kind: 'imported', id: 'imp-1', sourceStep: 'b.step', bodyRef: 'imp-123' },
    ]);
  });

  it('falls back to STEP filename basename when name is empty', () => {
    const j: ImporterPartJson = { ...basePart, name: '', properties: {} };
    const doc = buildPartDocument({ partJson: j, importResult, partId: 'p-2', importedFeatureId: 'imp-2' });
    expect(doc.name).toBe('b');
  });

  it('handles step path with directory and uppercase extension in basename fallback', () => {
    const j: ImporterPartJson = { ...basePart, name: '', step: 'sub/dir/Hinge.STEP', properties: {} };
    const doc = buildPartDocument({ partJson: j, importResult, partId: 'p-3', importedFeatureId: 'imp-3' });
    expect(doc.name).toBe('Hinge');
  });

  it('passes through mm and deg parameters unchanged', () => {
    const doc = buildPartDocument({ partJson: basePart, importResult, partId: 'p-4', importedFeatureId: 'imp-4' });
    expect(doc.parameters.Width).toMatchObject({ name: 'Width', unit: 'mm', value: 600, expression: '600 mm' });
    expect(doc.parameters.Angle).toMatchObject({ name: 'Angle', unit: 'deg', value: 45, expression: '45 deg' });
  });

  it('converts rad → deg, multiplies value by 180/π, annotates expression', () => {
    const j: ImporterPartJson = {
      ...basePart, parameters: { Theta: { value: Math.PI / 2, unit: 'rad', expression: 'pi/2 rad' } },
    };
    const doc = buildPartDocument({ partJson: j, importResult, partId: 'p-5', importedFeatureId: 'imp-5' });
    expect(doc.parameters.Theta!.unit).toBe('deg');
    expect(doc.parameters.Theta!.value).toBeCloseTo(90, 8);
    expect(doc.parameters.Theta!.expression).toContain('converted from rad');
  });

  it('maps unitless → mm with value preserved (degenerate fallback)', () => {
    const j: ImporterPartJson = {
      ...basePart, parameters: { Count: { value: 4, unit: 'unitless', expression: '4' } },
    };
    const doc = buildPartDocument({ partJson: j, importResult, partId: 'p-6', importedFeatureId: 'imp-6' });
    expect(doc.parameters.Count!.unit).toBe('mm');
    expect(doc.parameters.Count!.value).toBe(4);
  });

  it('copies properties bag (no aliasing of input)', () => {
    const doc = buildPartDocument({ partJson: basePart, importResult, partId: 'p-7', importedFeatureId: 'imp-7' });
    expect(doc.properties).not.toBe(basePart.properties);
    expect(doc.properties).toEqual(basePart.properties);
  });
});
