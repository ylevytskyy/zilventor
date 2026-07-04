import { describe, it, expect } from 'vitest';
import type { PartDocument } from '@zilventor/shared';
import { deriveImportedPanelDraft } from '../deriveImportedPanelDraft';
import { ORIGIN_FEATURES } from '../originFeatures';

function partWithBoundingBox(boundingBox: readonly [number, number, number, number, number, number] | undefined, opts?: { withImportedFeature?: boolean }): PartDocument {
  const withImported = opts?.withImportedFeature ?? true;
  return {
    id: 'part-1',
    name: 'ImportedThing',
    units: 'mm',
    parameters: {},
    featureTree: withImported
      ? [...ORIGIN_FEATURES, { kind: 'imported', id: 'feat-1', sourceStep: 'x.step', bodyRef: 'blob-1' }]
      : [...ORIGIN_FEATURES],
    ...(boundingBox ? { cachedGeometry: { brepBlobId: 'blob-1', triangleCount: 12, boundingBox } } : {}),
    properties: {},
    materials: [],
    hardware: [],
  };
}

describe('deriveImportedPanelDraft', () => {
  it('maps the smallest bbox extent to thickness and the other two to length/width, threading materialId', () => {
    // extents: x=10-(-10)=20 (middle), y=100-50=50 (largest -> length), z=5-0=5 (smallest -> thickness)
    const part = partWithBoundingBox([-10, 50, 0, 10, 100, 5]);

    const draft = deriveImportedPanelDraft(part, 'mat-oak');

    expect(draft).not.toBeNull();
    expect(draft!.kind).toBe('panel');
    expect(draft!.thickness).toEqual({ kind: 'literal', value: 5 });
    expect(draft!.length).toEqual({ kind: 'literal', value: 50 });
    expect(draft!.width).toEqual({ kind: 'literal', value: 20 });
    expect(draft!.materialId).toBe('mat-oak');
  });

  it('returns null when the part has no imported feature', () => {
    const part = partWithBoundingBox([0, 0, 0, 10, 20, 30], { withImportedFeature: false });

    expect(deriveImportedPanelDraft(part, 'mat-oak')).toBeNull();
  });

  it('returns null when cachedGeometry.boundingBox is missing', () => {
    const part = partWithBoundingBox(undefined);

    expect(deriveImportedPanelDraft(part, 'mat-oak')).toBeNull();
  });

  it('returns null when a bbox extent is degenerate (zero-width)', () => {
    const part = partWithBoundingBox([0, 0, 0, 10, 20, 0]);

    expect(deriveImportedPanelDraft(part, 'mat-oak')).toBeNull();
  });
});
