import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { newPart, addFeature } from '../../PartDocument';
import { disposeShape } from '../../../occt/SolidOps';
import type { PanelFeature, GrooveFeature, PartDocument } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

/** Real-OCCT solid volume via BRepGProp.VolumeProperties_1 (same call api.ts uses). */
function volumeOf(shape: { handle: unknown }): number {
  const ocAny = occt as unknown as {
    GProp_GProps_1: new () => { Mass: () => number; delete?: () => void };
    BRepGProp: { VolumeProperties_1: (h: unknown, p: unknown, a: boolean, b: boolean, c: boolean) => void };
  };
  const props = new ocAny.GProp_GProps_1();
  try {
    ocAny.BRepGProp.VolumeProperties_1(shape.handle, props, true, false, false);
    return props.Mass();
  } finally {
    props.delete?.();
  }
}

const mkPanel = (): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
});

const groove: GrooveFeature = {
  kind: 'groove', id: 'gr-1',
  faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9,
};

describe('feature suppression — executeTree skips suppressed features', () => {
  it('suppressing the groove feature restores the full panel volume (== base only)', async () => {
    // Base: panel only.
    let base = newPart('Base');
    base = addFeature(base, mkPanel());
    const rBase = await executeTree(occt, base);
    expect(rBase.ok).toBe(true);
    if (!rBase.ok) return;
    const volBase = volumeOf(rBase.value.finalSolid as { handle: unknown });
    disposeShape(rBase.value.finalSolid);

    // Panel + groove, with the groove SUPPRESSED → should not cut.
    let doc: PartDocument = newPart('Suppressed');
    doc = addFeature(doc, mkPanel());
    doc = addFeature(doc, groove);
    doc = { ...doc, suppressedFeatureIds: ['gr-1'] };
    const rSup = await executeTree(occt, doc);
    expect(rSup.ok).toBe(true);
    if (!rSup.ok) return;
    expect(volumeOf(rSup.value.finalSolid as { handle: unknown })).toBeCloseTo(volBase, 0);
    disposeShape(rSup.value.finalSolid);
  }, 120_000);

  it('an unsuppressed groove still cuts (control)', async () => {
    let base = newPart('Base');
    base = addFeature(base, mkPanel());
    const rBase = await executeTree(occt, base);
    expect(rBase.ok).toBe(true);
    if (!rBase.ok) return;
    const volBase = volumeOf(rBase.value.finalSolid as { handle: unknown });
    disposeShape(rBase.value.finalSolid);

    let doc = newPart('Grooved');
    doc = addFeature(doc, mkPanel());
    doc = addFeature(doc, groove);
    const r = await executeTree(occt, doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Cut removes 6×9×600 = 32400 mm³.
    expect(volBase - volumeOf(r.value.finalSolid as { handle: unknown })).toBeCloseTo(6 * 9 * 600, 0);
    disposeShape(r.value.finalSolid);
  }, 120_000);
});
