import { describe, expect, it } from 'vitest';
import { isImportedPart, type PartDocument, type ImportedFeature } from '../types';

const ORIGIN_FEATURES = [
  { kind: 'workAxis', id: 'origin.X', visible: false, source: { mode: 'origin', axis: 'X' } } as const,
  { kind: 'workAxis', id: 'origin.Y', visible: false, source: { mode: 'origin', axis: 'Y' } } as const,
  { kind: 'workAxis', id: 'origin.Z', visible: false, source: { mode: 'origin', axis: 'Z' } } as const,
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } } as const,
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } } as const,
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } } as const,
  { kind: 'workPoint', id: 'origin.O', visible: false, source: { mode: 'origin' } } as const,
];

const importedFeature: ImportedFeature = {
  kind: 'imported',
  id: 'imp-1',
  sourceStep: 'SidePanel.step',
  bodyRef: 'blob-abc',
};

describe('isImportedPart', () => {
  it('returns true when featureTree has exactly one imported feature plus origin features', () => {
    const doc: PartDocument = {
      id: 'p1',
      name: 'SidePanel',
      units: 'mm',
      parameters: {},
      featureTree: [...ORIGIN_FEATURES, importedFeature],
      properties: {},
      materials: [], hardware: [],
    };
    expect(isImportedPart(doc)).toBe(true);
  });

  it('returns false for a parametric part (sketch + extrude)', () => {
    const doc: PartDocument = {
      id: 'p2',
      name: 'Box',
      units: 'mm',
      parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
        { kind: 'extrude', id: 'e1', sketchRef: 's1', distanceParam: 'd', direction: 'forward', operation: 'new' },
      ],
      properties: {},
      materials: [], hardware: [],
    };
    expect(isImportedPart(doc)).toBe(false);
  });

  it('returns false for an empty featureTree (only origins)', () => {
    const doc: PartDocument = {
      id: 'p3', name: 'Empty', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES],
      properties: {},
      materials: [], hardware: [],
    };
    expect(isImportedPart(doc)).toBe(false);
  });

  it('accepts an ImportedFeature carrying isManifold: false (P10 R1 — typecheck-level red)', () => {
    // No runtime validator gates ImportedFeature's shape (verified: only the type
    // definition and panel-preflight.ts comments reference solidColors/isManifold).
    // This case exists so `isManifold: false` typechecks under
    // exactOptionalPropertyTypes and so isImportedPart still recognizes the part —
    // the gate for this slice is `tsc` clean, not a new runtime assertion.
    const feature: ImportedFeature = {
      kind: 'imported',
      id: 'imp-2',
      sourceStep: 'Bracket.step',
      bodyRef: 'blob-def',
      isManifold: false,
    };
    const doc: PartDocument = {
      id: 'p5', name: 'Bracket', units: 'mm', parameters: {},
      featureTree: [...ORIGIN_FEATURES, feature],
      properties: {},
      materials: [], hardware: [],
    };
    expect(isImportedPart(doc)).toBe(true);
    expect(doc.featureTree.find((f) => f.kind === 'imported')).toMatchObject({ isManifold: false });
  });

  it('returns false when imported feature is alongside another non-origin feature', () => {
    const doc: PartDocument = {
      id: 'p4', name: 'Mixed', units: 'mm', parameters: {},
      featureTree: [
        ...ORIGIN_FEATURES,
        importedFeature,
        { kind: 'sketch', id: 's1', plane: { source: 'workPlane', featureId: 'origin.XY' }, primitives: [], constraints: [] },
      ],
      properties: {},
      materials: [], hardware: [],
    };
    expect(isImportedPart(doc)).toBe(false);
  });
});
