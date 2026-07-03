import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { newPart, addFeature } from '../../PartDocument';
import { disposeShape } from '../../../occt/SolidOps';
import type { PanelFeature, KeyholeSlotFeature, PartDocument } from '@zilventor/shared';

let occt: OcctInstance;
beforeAll(async () => { occt = await loadOcct(); }, 60_000);

/** Real-OCCT solid volume via BRepGProp.VolumeProperties_1 (same call
 *  TenonMortiseFeature's/GrooveFeature's integration tests use). */
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

const mkPanel = (over: Partial<PanelFeature> = {}): PanelFeature => ({
  kind: 'panel', id: 'pf-1',
  length: { kind: 'literal', value: 600 },
  width: { kind: 'literal', value: 400 },
  thickness: { kind: 'literal', value: 18 },
  thicknessFromMaterial: true,
  materialId: 'mat-1',
  grain: 'length',
  edgeBands: { front: null, back: null, left: null, right: null },
  ...over,
});

async function runOne(feature?: KeyholeSlotFeature, suppressedFeatureIds?: string[]) {
  let doc: PartDocument = newPart('P');
  doc = addFeature(doc, mkPanel());
  if (feature) doc = addFeature(doc, feature);
  if (suppressedFeatureIds) doc = { ...doc, suppressedFeatureIds };
  const r = await executeTree(occt, doc);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('executeTree failed');
  return r.value;
}

describe('KeyholeSlotFeature integration — cylinder∪box pocket cut from a real panel', () => {
  it('cuts a real pocket whose removed volume is in the sane range of the analytic cylinder+box-minus-overlap estimate', async () => {
    const plain = await runOne();
    const volPlain = volumeOf(plain.finalSolid);
    disposeShape(plain.finalSolid);

    // Top face, axis=u, direction=1, entryDiameter=slotWidth=15 (r=7.5) so the
    // slot box's cross-range exactly spans the entry circle's diameter and its
    // run-range starts exactly at the hole center — the box covers EXACTLY the
    // near half of the entry-hole disk (u>=200 half), giving an exact overlap
    // of pi*r^2/2 between the cylinder and box footprints (not merely bounded).
    //   V_cyl  = pi*r^2*depth        = pi*7.5^2*6  ≈ 1060.29
    //   V_box  = slotWidth*slotLength*depth = 15*25*6 = 2250
    //   V_ovlp = (pi*r^2/2)*depth    = pi*7.5^2/2*6 ≈ 530.14
    //   estimate = V_cyl + V_box - V_ovlp ≈ 2780.14
    const feature: KeyholeSlotFeature = {
      kind: 'keyholeSlot', id: 'ks-1', faceRole: 'Top', u: 200, v: 150,
      axis: 'u', direction: 1, entryDiameter: 15, slotWidth: 15, slotLength: 25, depth: 6,
    };
    const cut = await runOne(feature);
    const volCut = volumeOf(cut.finalSolid);
    disposeShape(cut.finalSolid);

    const removed = volPlain - volCut;
    const estimate = Math.PI * 7.5 * 7.5 * 6 + 15 * 25 * 6 - (Math.PI * 7.5 * 7.5 / 2) * 6;
    expect(removed).toBeGreaterThan(0.7 * estimate);
    expect(removed).toBeLessThan(1.3 * estimate);
  }, 120_000);
});
