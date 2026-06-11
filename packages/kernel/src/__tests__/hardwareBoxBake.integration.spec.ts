/**
 * Chunk D — kernel hardware bbox bake (присадка slice 6)
 *
 * Proves that a PartDocument with a single `kind:'hardware'` HardwareFeature
 * produces a FULLY-CENTERED box via BRepPrimAPI_MakeBox_4 (two-corner form).
 *
 * Assertions:
 *   (a) volume = l·w·h (= 128·30·12 = 46080 mm³)
 *   (b) centroid ≈ (0,0,0)  — fully centered, NOT at corner
 *   (c) size-change subtest: re-bake with {l:200,...} → volume changes to 200·30·12=72000 mm³
 *       (catches a hardcoded / no-op bake)
 *
 * Pattern: loadOcct() + executeTree() directly (same as dragGizmoBake.integration.spec.ts)
 * so we can call raw OCCT BRepGProp.VolumeProperties_1 on the resulting shape.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../occt/occtLoader';
import { executeTree } from '../adapter/FeatureTree';
import type { PartDocument } from '@zilventor/shared';
import type { HardwareFeature } from '@zilventor/shared/src/hardware-feature';

// Minimal PartDocument fields required by executeTree (no sketch/work features needed
// when the only feature is 'hardware').
const ORIGIN_FEATURES: PartDocument['featureTree'] = [
  { kind: 'workAxis',  id: 'origin.X',  visible: false, source: { mode: 'origin', axis: 'X' } },
  { kind: 'workAxis',  id: 'origin.Y',  visible: false, source: { mode: 'origin', axis: 'Y' } },
  { kind: 'workAxis',  id: 'origin.Z',  visible: false, source: { mode: 'origin', axis: 'Z' } },
  { kind: 'workPlane', id: 'origin.XY', visible: false, source: { mode: 'origin', plane: 'XY' } },
  { kind: 'workPlane', id: 'origin.YZ', visible: false, source: { mode: 'origin', plane: 'YZ' } },
  { kind: 'workPlane', id: 'origin.XZ', visible: false, source: { mode: 'origin', plane: 'XZ' } },
  { kind: 'workPoint', id: 'origin.O',  visible: false, source: { mode: 'origin' } },
];

function makeHwDoc(l: number, w: number, h: number, id: string): PartDocument {
  const hwFeature: HardwareFeature = {
    kind: 'hardware',
    id: 'hw-feat-1',
    hardwareSkuId: 'bar-pull-96',
    bboxMm: { l, w, h },
    attachPoints: [],
  };
  return {
    id,
    name: `Bar Pull ${l}x${w}x${h}`,
    units: 'mm',
    parameters: {},
    featureTree: [...ORIGIN_FEATURES, hwFeature],
    properties: {},
    materials: [],
    hardware: [],
  };
}

describe('hardware bbox bake: BRepPrimAPI_MakeBox_4 fully-centered box (real OCCT)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let oc: any;

  beforeAll(async () => {
    oc = await loadOcct();
  }, 60_000);

  /**
   * Volume + centroid of a solid via BRepGProp.VolumeProperties_1.
   * Returns { mass, cx, cy, cz }.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function massProps(shape: any): { mass: number; cx: number; cy: number; cz: number } {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const mass = props.Mass();
    const c = props.CentreOfMass();
    const cx = c.X(), cy = c.Y(), cz = c.Z();
    props.delete?.();
    return { mass, cx, cy, cz };
  }

  it('(a) volume = l·w·h for bar-pull-96 (128×30×12 = 46080 mm³)', async () => {
    const doc = makeHwDoc(128, 30, 12, 'hw-test-a');
    const result = await executeTree(oc, doc);
    expect(result.ok, result.ok ? '' : `executeTree failed: ${(result as { error: { message: string } }).error.message}`).toBe(true);
    if (!result.ok) return;

    const { mass } = massProps(result.value.finalSolid.handle);
    expect(mass).toBeCloseTo(128 * 30 * 12, 0); // 46080 mm³
  }, 60_000);

  it('(b) centroid ≈ (0,0,0) — box is fully centered on origin', async () => {
    const doc = makeHwDoc(128, 30, 12, 'hw-test-b');
    const result = await executeTree(oc, doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { cx, cy, cz } = massProps(result.value.finalSolid.handle);
    expect(cx).toBeCloseTo(0, 1);
    expect(cy).toBeCloseTo(0, 1);
    expect(cz).toBeCloseTo(0, 1);
  }, 60_000);

  it('(c) size-change: re-bake l=200 changes volume to 200·30·12=72000 mm³', async () => {
    // Uses a fresh part id to avoid any caching
    const doc = makeHwDoc(200, 30, 12, 'hw-test-c');
    const result = await executeTree(oc, doc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { mass } = massProps(result.value.finalSolid.handle);
    expect(mass).toBeCloseTo(200 * 30 * 12, 0); // 72000 mm³
    // Confirm it's different from the 46080 case (not hardcoded)
    expect(mass).not.toBeCloseTo(128 * 30 * 12, 0);
  }, 60_000);
});
