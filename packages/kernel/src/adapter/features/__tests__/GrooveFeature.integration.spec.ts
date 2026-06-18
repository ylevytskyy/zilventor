import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct, type OcctInstance } from '../../../occt/occtLoader';
import { executeTree } from '../../FeatureTree';
import { newPart, addFeature } from '../../PartDocument';
import { disposeShape, computeBoundingBox } from '../../../occt/SolidOps';
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

describe('GrooveFeature integration — real OCCT cut', () => {
  it('an axis-u groove on the Top face removes ~width×depth×length of material', async () => {
    // Panel without a groove.
    let plain = newPart('Plain');
    plain = addFeature(plain, mkPanel());
    const rPlain = await executeTree(occt, plain);
    expect(rPlain.ok).toBe(true);
    if (!rPlain.ok) return;
    const volPlain = volumeOf(rPlain.value.finalSolid as { handle: unknown });
    disposeShape(rPlain.value.finalSolid);

    // Same panel + a 6mm-wide, 9mm-deep groove running the full length on Top.
    const groove: GrooveFeature = {
      kind: 'groove', id: 'gr-1',
      faceRole: 'Top', axis: 'u', position: 200, width: 6, depth: 9,
    };
    let grooved = newPart('Grooved');
    grooved = addFeature(grooved, mkPanel());
    grooved = addFeature(grooved, groove);
    const rGroove = await executeTree(occt, grooved);
    expect(rGroove.ok).toBe(true);
    if (!rGroove.ok) return;
    const volGroove = volumeOf(rGroove.value.finalSolid as { handle: unknown });

    // Expected removed volume = width × depth × full length = 6 × 9 × 600 = 32400 mm³.
    const removed = volPlain - volGroove;
    expect(removed).toBeCloseTo(6 * 9 * 600, 0);

    // The groove must NOT change the panel's outer bounding box.
    const bbox = computeBoundingBox(occt, rGroove.value.finalSolid);
    expect(bbox[3] - bbox[0]).toBeCloseTo(600, 4);
    expect(bbox[4] - bbox[1]).toBeCloseTo(400, 4);
    expect(bbox[5] - bbox[2]).toBeCloseTo(18, 4);
    disposeShape(rGroove.value.finalSolid);
  }, 120_000);

  it('soft-fails (keeps the intact body) when the groove misses the panel entirely', async () => {
    // A groove positioned far outside the panel: cutShapes removes no material →
    // booleanFailed → the branch records the error and keeps the pre-cut body.
    let plain = newPart('Plain');
    plain = addFeature(plain, mkPanel());
    const rPlain = await executeTree(occt, plain);
    expect(rPlain.ok).toBe(true);
    if (!rPlain.ok) return;
    const volPlain = volumeOf(rPlain.value.finalSolid as { handle: unknown });
    disposeShape(rPlain.value.finalSolid);

    let missed: PartDocument = newPart('Missed');
    missed = addFeature(missed, mkPanel());
    missed = addFeature(missed, { kind: 'groove', id: 'gr-x', faceRole: 'Top', axis: 'u', position: 10000, width: 6, depth: 9 } as GrooveFeature);
    const r = await executeTree(occt, missed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Body unchanged — the missed cut was a no-op.
    expect(volumeOf(r.value.finalSolid as { handle: unknown })).toBeCloseTo(volPlain, 0);
    disposeShape(r.value.finalSolid);
  }, 120_000);
});
