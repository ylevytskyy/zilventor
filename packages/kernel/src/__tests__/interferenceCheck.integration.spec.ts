/**
 * Real-OCCT integration tests for checkInterference.
 * Harness pattern from api.export.integration.spec.ts (makeBoxPart).
 * SC-9: overlap volume asserted against a hand-derived oracle (NOT the producer's output).
 * SC-10: touching-face test measures real OCCT Common volume → tunes VOLUME_THRESHOLD_MM3.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernelApi } from '../api';
import { loadOcct } from '../occt/occtLoader';
import { makeBox, type OcctShape } from '../occt/SolidOps';
import { transformShapeByPose } from '../occt/TransformOps';

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
   * SC-10 diagnostic: raw BRepAlgoAPI_Common volume for exactly coincident-face boxes.
   *
   * Directly computes (without going through checkInterference) the Common of:
   *   Box A: 50×50×50 at origin [0,50]×[0,50]×[0,50]
   *   Box B: 50×50×50 posed at TX=50 → [50,100]×[0,50]×[0,50]
   * Their faces are exactly coincident at X=50.
   *
   * Logs: "SC-10 touching-face Common volume: <n> mm³" or "no solid (degenerate)".
   * Interpretation rule (baked into assertion):
   *   < 0.5 mm³ or no solid → VOLUME_THRESHOLD_MM3=1.0 is safe (≥2× margin)
   *   ≥ 0.5 mm³           → threshold is marginal; controller must decide
   */
  it('SC-10 diagnostic: raw Common volume for touching faces (grounds VOLUME_THRESHOLD_MM3)', async () => {
    // loadOcct() is a cached singleton — already warm from api.init() above.
    const oc = await loadOcct() as any;

    // Build two 50×50×50 boxes via the same SolidOps.makeBox helper the kernel uses.
    const shapeA: OcctShape = makeBox(oc, 50, 50, 50);
    // Pose Box B at TX=+50 so its face at X=0 aligns with Box A's face at X=50.
    const shapeB: OcctShape = transformShapeByPose(oc, makeBox(oc, 50, 50, 50), {
      translation: { x: 50, y: 0, z: 0 },
      quaternion: [0, 0, 0, 1],
    });

    // SC-1 pattern: BRepAlgoAPI_Common_3 + explicit Build (two separate ProgressRange objects).
    const rangeCtor = new oc.Message_ProgressRange_1();
    const rangeBuild = new oc.Message_ProgressRange_1();
    const common = new oc.BRepAlgoAPI_Common_3(
      shapeA.handle as never,
      shapeB.handle as never,
      rangeCtor,
    );
    common.Build(rangeBuild);
    rangeCtor.delete?.();
    rangeBuild.delete?.();

    let rawVolume: number | null = null;
    let hasSolid = false;

    if (!common.HasErrors()) {
      const commonShape = common.Shape();

      // SC-3 pattern: check for SOLID via TopExp_Explorer.
      const explorer = new oc.TopExp_Explorer_2(
        commonShape as never,
        oc.TopAbs_ShapeEnum.TopAbs_SOLID as never,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE as never,
      );
      hasSolid = explorer.More();
      explorer.delete?.();

      if (hasSolid) {
        // Measure volume via BRepGProp.VolumeProperties_1 (SC-3 pattern).
        const props = new oc.GProp_GProps_1();
        try {
          oc.BRepGProp.VolumeProperties_1(commonShape as never, props, true, false, false);
          rawVolume = props.Mass() as number;
        } finally {
          props.delete?.();
        }
      }

      (commonShape as { delete?: () => void }).delete?.();
    }

    common.delete?.();
    (shapeA.handle as { delete?: () => void }).delete?.();
    (shapeB.handle as { delete?: () => void }).delete?.();

    // ── Authoritative SC-10 log ──────────────────────────────────────────────
    if (!hasSolid || rawVolume === null) {
      console.log('SC-10 touching-face Common volume: no solid (degenerate)');
    } else {
      console.log(`SC-10 touching-face Common volume: ${rawVolume} mm³`);
    }

    // Interpretation: if a solid exists with vol ≥ 0.5 mm³ the threshold is marginal.
    if (hasSolid && rawVolume !== null && rawVolume >= 0.5) {
      // Threshold is marginal — controller must decide whether to raise VOLUME_THRESHOLD_MM3.
      console.warn(
        `SC-10 WARNING: raw touching-face volume ${rawVolume} mm³ ≥ 0.5 — VOLUME_THRESHOLD_MM3=1.0 is marginal!`,
      );
    }

    // The touching-face pair must STILL not be flagged by checkInterference.
    // (This is the same geometry; re-run to assert classification is correct.)
    const idC2 = await makeCubePart(api, 'boxC50diag', 50);
    const idD2 = await makeCubePart(api, 'boxD50diag', 50);
    const diagPairs = await api.checkInterference(
      [posedLeaf(idC2, 0, 0, 0), posedLeaf(idD2, 50, 0, 0)],
      { volumeThreshold: 1.0, clearanceThreshold: 1.0 },
    );
    expect(diagPairs).toHaveLength(0);
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

  /**
   * SC-13(b): Degenerate/invalid pair — a partId that was never loaded is skipped,
   * while a valid overlapping pair in the same run still returns an interference result.
   * Uses makeCubePart (same canonical helper as SC-9) so execute() succeeds for valid leaves.
   */
  it('SC-13(b): unloaded leaf is skipped; valid pair in same run still returns', async () => {
    // Two 20mm cubes that overlap by 15mm on X → interference volume = 15×20×20 = 6000 mm³
    const idValid1 = await makeCubePart(api, 'boxValid1', 20);
    const idValid2 = await makeCubePart(api, 'boxValid2', 20);

    const leaves = [
      posedLeaf('NONEXISTENT-PART-ID', 0, 0, 0),  // will be skipped (never loaded)
      posedLeaf(idValid1, 0, 0, 0),
      posedLeaf(idValid2, 5, 0, 0),  // overlap: 20-5=15mm on X → 15×20×20=6000 mm³
    ];

    // Should not throw; the NONEXISTENT leaf is skipped; valid pair (1,2) still found.
    const pairs = await api.checkInterference(leaves, { volumeThreshold: 1.0, clearanceThreshold: 1.0 });
    console.log('[SC-13b] pairs:', JSON.stringify(pairs));
    // The valid pair at indices 1 and 2 should still be detected.
    expect(pairs.some((p) => p.kind === 'interference')).toBe(true);
  }, 120_000);
});
