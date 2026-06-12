/**
 * Real-OCCT integration tests for checkInterference.
 * Harness pattern from api.export.integration.spec.ts (makeBoxPart).
 * SC-9: overlap volume asserted against a hand-derived oracle (NOT the producer's output).
 * SC-10: touching-face test measures real OCCT Common volume → tunes VOLUME_THRESHOLD_MM3.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../api';

function posedLeaf(partId: string, tx: number, ty: number, tz: number) {
  return {
    partId,
    pose: {
      translation: { x: tx, y: ty, z: tz },
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    },
  };
}

/**
 * Creates a cube part of the given side length using the canonical
 * sketch+parameter+extrude pattern (matches makeBoxPart in api.export.integration.spec.ts).
 */
async function makeCubePart(api: ReturnType<typeof createKernelApi>, name: string, side: number): Promise<string> {
  const partId = await api.createPart(name);
  await api.setParameter(partId, { name: 'd1', expression: String(side), value: side, unit: 'mm' });
  await api.addFeature(partId, {
    kind: 'sketch',
    id: 's1',
    plane: { source: 'workPlane', featureId: 'origin.XY' },
    primitives: [{ id: 'p1', kind: 'rectangle', x: 0, y: 0, w: side, h: side }],
    constraints: [],
  });
  await api.addFeature(partId, {
    kind: 'extrude',
    id: 'e1',
    sketchRef: 's1',
    distanceParam: 'd1',
    direction: 'forward',
    operation: 'new',
  });
  await api.execute(partId); // warms namedShapeCache
  return partId;
}

describe('checkInterference: real OCCT', () => {
  let api: ReturnType<typeof createKernelApi>;

  beforeAll(async () => {
    api = createKernelApi();
    await api.init();
  }, 120_000);

  /**
   * SC-9 [BLOCKER]: Overlap-volume test with INDEPENDENT oracle.
   *
   * Geometry:
   *   Box A: 50×50×50 cube, at origin [0,50] × [0,50] × [0,50]
   *   Box B: 40×40×40 cube, offset +30 on X → [30,70] × [0,40] × [0,40]
   *
   * Intersection = [30,50] × [0,40] × [0,40] = 20×40×40 = 32000 mm³
   * (derived by hand — independent of kernel output).
   */
  it('SC-9: two overlapping boxes → interference with volume ≈ 32000 mm³', async () => {
    const idA = await makeCubePart(api, 'box50', 50);
    const idB = await makeCubePart(api, 'box40', 40);

    // Box A at identity; Box B shifted +30 on X (overlap = 20×40×40 = 32000 mm³)
    const leaves = [
      posedLeaf(idA, 0, 0, 0),
      posedLeaf(idB, 30, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    console.log('[SC-9] pairs:', JSON.stringify(pairs));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.kind).toBe('interference');
    expect(pairs[0]!.volume).toBeDefined();
    // SC-9 independent oracle: 20 × 40 × 40 = 32000
    expect(Math.abs(pairs[0]!.volume! - 32000)).toBeLessThan(5);
  }, 120_000);

  /**
   * SC-10 [BLOCKER]: Touching-faces test — measures real OCCT Common volume.
   *
   * Two 50×50×50 boxes placed so their faces exactly share the plane X=50:
   *   Box A: [0,50] × [0,50] × [0,50]
   *   Box B at TX=50: [50,100] × [0,50] × [0,50]
   *
   * Real OCCT Common on exactly touching faces → degenerate (should be near 0).
   * This test LOGS the raw volume to tell us whether VOLUME_THRESHOLD_MM3=1.0 is safe.
   * If the raw volume is ≥ 1.0, the threshold must be raised (document the decision).
   */
  it('SC-10: face-touching boxes → NEITHER interference NOR clearance', async () => {
    const idC = await makeCubePart(api, 'boxC50', 50);
    const idD = await makeCubePart(api, 'boxD50', 50);

    // Box D placed at TX=50 → faces touch exactly at X=50
    const leaves = [
      posedLeaf(idC, 0, 0, 0),
      posedLeaf(idD, 50, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    // SC-10: log the raw Common volume that OCCT produces for face-touching geometry
    console.log('[SC-10] touching-face pairs (should be empty):', JSON.stringify(pairs));
    console.log('[SC-10] If non-empty, check raw Common volume and raise VOLUME_THRESHOLD_MM3 if needed');

    // Assert neither interference nor clearance (butt joints must not false-flag)
    expect(pairs).toHaveLength(0);
  }, 120_000);

  /**
   * Clearance test: two boxes 0.5 mm apart, clearanceThreshold = 1.0 → clearance pair.
   */
  it('two boxes 0.5 mm apart → clearance pair with distance ≈ 0.5', async () => {
    const idE = await makeCubePart(api, 'boxE20', 20);
    const idF = await makeCubePart(api, 'boxF20b', 20);

    // Gap of 0.5mm between boxes (box ends at 20, next starts at 20.5)
    const leaves = [
      posedLeaf(idE, 0, 0, 0),
      posedLeaf(idF, 20.5, 0, 0),
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    console.log('[clearance] pairs:', JSON.stringify(pairs));
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.kind).toBe('clearance');
    expect(pairs[0]!.distance).toBeDefined();
    expect(Math.abs(pairs[0]!.distance! - 0.5)).toBeLessThan(0.1);
  }, 120_000);

  /**
   * Clearly separated pair (gap > threshold) → no result.
   */
  it('boxes 10 mm apart with threshold 1.0 → no pairs', async () => {
    const idG = await makeCubePart(api, 'boxG10', 10);

    const leaves = [
      posedLeaf(idG, 0, 0, 0),
      posedLeaf(idG, 100, 0, 0), // same part, 90mm gap (100 - 10 = 90 >> threshold 1.0)
    ];

    const pairs = await api.checkInterference(leaves, {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });

    expect(pairs).toHaveLength(0);
  }, 120_000);

  /**
   * SC-13(c): single leaf → no pairs possible.
   */
  it('SC-13(c): single leaf → empty result', async () => {
    const idH = await makeCubePart(api, 'boxH', 10);
    const pairs = await api.checkInterference([posedLeaf(idH, 0, 0, 0)], {
      volumeThreshold: 1.0,
      clearanceThreshold: 1.0,
    });
    expect(pairs).toHaveLength(0);
  }, 120_000);
});
