/**
 * GROUPED MULTI-POINT atFace BAKE GUARD — Система-32 shelf-pin grid (real OCCT).
 *
 * This test exercises the exact code path that BakeBoresCommand takes in production:
 * ALL bores sharing (face.role|Ø|depth) are batched into ONE HoleFeature with
 * `points: group.map(g => ({u, v}))` and ONE executeHoleFeature call.
 *
 * Phase 9's per-bore guard (HoleFeature.system32.integration.spec.ts) only validated
 * individual bores on separate fresh panels, explicitly avoiding the sequential
 * multi-cut path due to OCCT face-handle concerns. THIS test validates the
 * grouped bake directly:
 *   - ONE buildPanelBox side panel (SIDE_DIMS = {length:H, width:D, thickness:Tc}).
 *   - shelfPinGrid() → real ~N BoreOp[] (NOT hand-authored coordinates).
 *   - ONE executeHoleFeature call with points[] = all N (u,v) pairs.
 *   - Volume drop ≈ N × π·r²·depth (all holes were drilled, not just first).
 *   - Residual material remains (blind, not through-pierce).
 *   - N matches the generated grid count.
 *
 * Anti-false-green: uses GENERATED grid output so any sign error or u/v swap
 * that places holes outside the face will be caught by OCCT and drop volume.
 *
 * INNER_FACE imported from prisadkaFaceConventions — not a local literal.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { loadOcct } from '../../../occt/occtLoader';
import { buildPanelBox } from '../../../occt/PanelOps';
import { executeHoleFeature } from '../HoleFeature';
import {
  shelfPinGrid,
  columnPositions,
  DEFAULT_SHELF_PIN_PARAMS,
  LEFT_SIDE_INNER_FACE,
} from '@zilventor/shared';
import type { BoreOp, HoleFeature } from '@zilventor/shared';
import type { NamedShape } from '../../../occt/FaceNaming';
import type { OcctShape } from '../../../occt/SolidOps';

// REAL side panel native dims (baseCabinet.ts: leftSide {length:H, width:D, thickness:Tc}).
const H = 720, D = 560, Tc = 18;
const SIDE_DIMS = { length: H, width: D, thickness: Tc };
// INNER_FACE imported from the conventions module — not a local literal.
const INNER_FACE = LEFT_SIDE_INNER_FACE;

describe('GROUPED atFace bake — система-32 shelf-pin grid, all N points in ONE executeHoleFeature (real OCCT)', () => {
  let oc: any;
  beforeAll(async () => { oc = await loadOcct(); });

  /** Build a named side-panel box matching Phase-9's setup exactly. */
  function buildNamed(dims: { length: number; width: number; thickness: number }): NamedShape {
    const { length: L, width: W, thickness: T } = dims;
    const panel = buildPanelBox(oc, dims);
    const faceNamesArr: NamedShape['faceNames'] = [];
    const map = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(panel.shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
    const hL = L / 2, hW = W / 2;
    for (let i = 1; i <= map.Extent(); i++) {
      const faceShape = map.FindKey(i);
      const face = oc.TopoDS.Face_1(faceShape);
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.SurfaceProperties_1(face, props, 1e-7, false);
      const c = props.CentreOfMass();
      const x = c.X(), y = c.Y(), z = c.Z();
      props.delete?.();
      let role: string;
      if (Math.abs(z - T) < 0.5) role = 'Top';
      else if (Math.abs(z) < 0.5) role = 'Bottom';
      else if (Math.abs(y - hW) < 0.5) role = 'Front';
      else if (Math.abs(y + hW) < 0.5) role = 'Back';
      else if (Math.abs(x + hL) < 0.5) role = 'Left';
      else role = 'Right';
      faceNamesArr.push({ name: { featureId: 'panel', role, instance: 0 }, face });
    }
    map.delete();
    return { shape: panel.shape as unknown as OcctShape, faceNames: faceNamesArr } as NamedShape;
  }

  function volumeOf(shape: unknown): number {
    const props = new oc.GProp_GProps_1();
    oc.BRepGProp.VolumeProperties_1(shape, props, 1e-7, false, false);
    const v = props.Mass();
    props.delete?.();
    return v;
  }

  /**
   * Build the GROUPED HoleFeature exactly as BakeBoresCommand.bakedFeaturesFor() does:
   * group by (face.role|Ø|depth), then ONE feature with points[] = all bores in that group.
   */
  function groupedHoleFeature(bores: ReadonlyArray<BoreOp>): HoleFeature {
    // All shelf-pin bores share the same face.role, diameter, and depth — they form ONE group.
    const first = bores[0]!;
    return {
      id: `bake:${first.face.role}:${first.diameter}:${first.depth}`,
      kind: 'hole',
      placement: {
        kind: 'atFace',
        faceName: first.face,
        points: bores.map((b) => ({ u: b.u, v: b.v })),
        axis: 'into-face',
      },
      profile: { kind: 'simple', diameter: { kind: 'literal', value: first.diameter } },
      termination: { kind: 'distance', depth: { kind: 'literal', value: first.depth as number } },
      flipAxis: false,
    };
  }

  it('grouped bake: ONE executeHoleFeature with all N shelf-pin points produces volume drop ≈ N × π·r²·depth (anti-false-green: N from generator)', () => {
    // --- GENERATE the real bore grid (NOT hand-authored) ---
    const bores = shelfPinGrid(SIDE_DIMS, INNER_FACE, DEFAULT_SHELF_PIN_PARAMS);
    const p = DEFAULT_SHELF_PIN_PARAMS;

    // Confirm expected grid count from the generator contract.
    const perColumn = columnPositions(p.bottomMargin, H - p.topMargin, p.pitch).length;
    const expectedN = perColumn * p.columns;
    expect(bores.length).toBe(expectedN);
    expect(expectedN).toBeGreaterThan(10); // sanity: 720mm panel has many holes

    // All bores share the same group key (same face.role|Ø|depth) → ONE feature.
    const allSameGroup = bores.every(
      (b) => b.face.role === bores[0]!.face.role
          && b.diameter === bores[0]!.diameter
          && b.depth === bores[0]!.depth,
    );
    expect(allSameGroup).toBe(true);

    // --- BUILD the panel and run the GROUPED bake (ONE call, N points) ---
    const N = bores.length;
    const volBefore = H * D * Tc; // exact box volume before any holes

    const running = buildNamed(SIDE_DIMS);
    const feature = groupedHoleFeature(bores);

    // This is the exact grouped call BakeBoresCommand makes.
    const result = executeHoleFeature(oc, running, feature, (param: any) => param.value, new Map());

    const volAfter = volumeOf(result.shape);
    const totalDrop = volBefore - volAfter;

    // Expected drop per bore: π · r² · depth (blind cylinder, r = diameter/2).
    const r = p.diameter / 2;          // 2.5 mm
    const cylVol = Math.PI * r * r * p.depth; // ≈ 255.25 mm³ per bore
    const expectedTotalDrop = N * cylVol;

    // ANTI-FALSE-GREEN: a 10% band catches dropped holes. If OCCT silently skips
    // holes (soft-fail), the measured drop will be significantly less than N × cyl.
    // A single-bore drop (N=1) would be ~< (1/N) of expected, failing the lower bound.
    expect(totalDrop).toBeGreaterThan(expectedTotalDrop * 0.85);
    expect(totalDrop).toBeLessThan(expectedTotalDrop * 1.15);

    // BLIND: total drop must be well below N through-piercings (residual remains).
    const throughAllDrop = N * Math.PI * r * r * Tc;
    expect(totalDrop).toBeLessThan(throughAllDrop);

    // Solid is valid: volume is still positive (not collapsed or OCCT failure).
    expect(volAfter).toBeGreaterThan(H * D * Tc * 0.9); // residual > 90% of original

    // Log N and measured values for easy inspection.
    console.log(
      `[grouped-bake] N=${N}, expectedTotalDrop=${expectedTotalDrop.toFixed(1)} mm³, ` +
      `measuredTotalDrop=${totalDrop.toFixed(1)} mm³, ` +
      `ratio=${(totalDrop / expectedTotalDrop).toFixed(3)}`
    );
  });
});
